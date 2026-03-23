"""
Trading Dashboard — FastAPI Backend
Wraps daily_option_trader.py and exposes state + control via REST API.
Run: uvicorn main:app --reload --port 8000
"""

import json
import os
import re
import subprocess
import sys
import signal
from datetime import date, datetime
from pathlib import Path
from typing import Optional
import psutil

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from alpaca.trading.client import TradingClient
import dotenv   
dotenv.load_dotenv()
# ── Path config ──────────────────────────────────────────────────────────────
# Adjust this to wherever your bot + state file live
BOT_DIR = Path(__file__).parent.parent / "bot"
BOT_SCRIPT = BOT_DIR / "daily_option_trader.py"
STATE_FILE = BOT_DIR / "daily_bot_state.json"
PLANS_FILE = BOT_DIR / "plans.json"
BOT_LOG_FILE = BOT_DIR / "bot.log"
PID_FILE = BOT_DIR / "bot.pid"
PL_HISTORY_FILE = BOT_DIR / "pl_history.json"

# ── Alpaca credentials ────────────────────────────────────────────────────────
# These must match what's in your daily_option_trader.py
API_KEY = os.getenv("ALPACA_API_KEY")
API_SECRET = os.getenv("ALPACA_API_SECRET")
PAPER      = True

def _get_trading_client() -> TradingClient:
    return TradingClient(API_KEY, API_SECRET, paper=PAPER)

app = FastAPI(title="Options Trading Dashboard", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Pydantic models ───────────────────────────────────────────────────────────
class Plan(BaseModel):
    ticker: str
    contract: str
    qty: int
    type: str           # LONG or SHORT
    sl_stock: float
    tp_stock: float


class BotSettings(BaseModel):
    tp_pct: float = 0.25          # partial TP threshold
    hard_stop_pct: float = 0.50   # hard stop loss (stored as positive, applied negative)
    trail_offset: float = 0.20    # trailing stop offset after partial
    gap_limit: float = 0.03       # gap filter threshold
    poll_seconds: int = 60        # loop cadence


# ── Bot process helpers ───────────────────────────────────────────────────────
def _read_pid() -> Optional[int]:
    if PID_FILE.exists():
        try:
            return int(PID_FILE.read_text().strip())
        except Exception:
            return None
    return None


def _write_pid(pid: int):
    PID_FILE.write_text(str(pid))


def _clear_pid():
    if PID_FILE.exists():
        PID_FILE.unlink()


def _is_running(pid: Optional[int]) -> bool:
    if pid is None:
        return False
    try:
        proc = psutil.Process(pid)
        return proc.is_running() and proc.status() != psutil.STATUS_ZOMBIE
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        return False


# ── State file helpers ────────────────────────────────────────────────────────
def _load_state() -> dict:
    if not STATE_FILE.exists():
        return {}
    try:
        return json.loads(STATE_FILE.read_text())
    except Exception:
        return {}


def _today_key() -> str:
    return date.today().strftime("%Y-%m-%d")


def _get_today_bucket(state: dict) -> dict:
    return state.get("days", {}).get(_today_key(), {"traded_today": [], "tickers": {}})


def _load_plans() -> list:
    if not PLANS_FILE.exists():
        return []
    try:
        return json.loads(PLANS_FILE.read_text())
    except Exception:
        return []


def _save_plans(plans: list):
    PLANS_FILE.write_text(json.dumps(plans, indent=2))


def _read_log_tail(n_lines: int = 200) -> list[str]:
    if not BOT_LOG_FILE.exists():
        return []
    try:
        lines = BOT_LOG_FILE.read_text(errors="replace").splitlines()
        return lines[-n_lines:]
    except Exception:
        return []


# ── Routes: status & control ─────────────────────────────────────────────────
@app.get("/api/status")
def get_status():
    pid     = _read_pid()
    running = _is_running(pid)
    if not running:
        _clear_pid()
        pid = None

    state = _load_state()
    today = _get_today_bucket(state)
    carry = state.get("carry", [])

    # Pull live account info from Alpaca
    account_info = {}
    try:
        client  = _get_trading_client()
        account = client.get_account()
        account_info = {
            "portfolio_value":   float(account.portfolio_value),
            "cash":              float(account.cash),
            "buying_power":      float(account.buying_power),
            "equity":            float(account.equity),
            "daytrade_count":    int(account.daytrade_count),
            "account_number":    str(account.account_number),
        }
    except Exception as e:
        account_info = {"error": str(e)}

    return {
        "bot_running":    running,
        "pid":            pid,
        "date":           _today_key(),
        "traded_today":   today.get("traded_today", []),
        "carry_count":    len(carry),
        "account":        account_info,
        "market_warning": _check_market_hours(),
    }


def _check_market_hours() -> Optional[str]:
    """
    Returns a warning string if market is closed/holiday, or None if OK to trade.
    Uses Alpaca calendar API so bank holidays are handled automatically.
    """
    import pytz
    from datetime import timedelta
    nyc = pytz.timezone("America/New_York")
    now = datetime.now(nyc)
    weekday = now.weekday()  # 0=Mon, 6=Sun

    # Weekend fast-check (no API call needed)
    if weekday == 5:
        return "It's Saturday — US markets are closed. The bot will have nothing to trade."
    if weekday == 6:
        return "It's Sunday — US markets are closed. The bot will have nothing to trade."

    # Check Alpaca calendar for today (handles bank holidays)
    try:
        client = _get_trading_client()
        today_str = now.strftime("%Y-%m-%d")
        calendar = client.get_calendar(filters={"start": today_str, "end": today_str})

        if not calendar:
            return f"Today ({today_str}) is a market holiday — US markets are closed."

        # Check if we are past market close (4:00 PM ET on a trading day)
        close_time = now.replace(hour=16, minute=0, second=0, microsecond=0)
        if now > close_time:
            next_open = "Monday" if weekday == 4 else "tomorrow"
            return f"Market closed for today (after 4:00 PM ET). Bot can still run to manage carried positions — next open: {next_open}."

    except Exception as e:
        # If calendar check fails, don't block startup
        return None

    return None


@app.get("/api/market-status")
def get_market_status():
    """Returns current market status and any warnings."""
    warning = _check_market_hours()
    import pytz
    nyc = pytz.timezone("America/New_York")
    now = datetime.now(nyc)

    # Try to get clock from Alpaca
    is_open = False
    next_open = None
    try:
        client = _get_trading_client()
        clock = client.get_clock()
        is_open = bool(clock.is_open)
        next_open = str(clock.next_open) if clock.next_open else None
    except Exception:
        pass

    return {
        "is_open":   is_open,
        "warning":   warning,
        "next_open": next_open,
        "server_time_et": now.strftime("%Y-%m-%d %H:%M:%S %Z"),
    }


@app.post("/api/bot/start")
def start_bot():
    pid = _read_pid()
    if _is_running(pid):
        raise HTTPException(status_code=400, detail="Bot is already running.")

    if not BOT_SCRIPT.exists():
        raise HTTPException(status_code=500, detail=f"Bot script not found at {BOT_SCRIPT}")

    # Build command — pass plans file only if it exists and has entries
    cmd = [sys.executable, str(BOT_SCRIPT)]
    if PLANS_FILE.exists() and _load_plans():
        cmd += ["--plans", str(PLANS_FILE)]

    log_fd = open(BOT_LOG_FILE, "a")
    proc = subprocess.Popen(
        cmd,
        cwd=str(BOT_DIR),
        stdout=log_fd,
        stderr=log_fd,
        start_new_session=True,
    )
    _write_pid(proc.pid)

    plans_count = len(_load_plans()) if PLANS_FILE.exists() else 0
    warning = _check_market_hours()
    return {
        "message":     "Bot started.",
        "pid":         proc.pid,
        "plans_count": plans_count,
        "warning":     warning,
    }


@app.post("/api/bot/stop")
def stop_bot():
    pid = _read_pid()
    if not _is_running(pid):
        _clear_pid()
        raise HTTPException(status_code=400, detail="Bot is not running.")
    try:
        os.kill(pid, signal.SIGTERM)
        _clear_pid()
        return {"message": f"Bot (PID {pid}) stopped."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/bot/logs")
def get_logs(lines: int = 200):
    return {"logs": _read_log_tail(lines)}


# ── Routes: positions & P/L ───────────────────────────────────────────────────
@app.get("/api/positions")
def get_positions():
    """
    Pulls live positions directly from Alpaca, then enriches with bot state
    (peak P/L, partial status, trailing stop info) where available.
    """
    # 1) Fetch live positions from Alpaca
    try:
        client = _get_trading_client()
        alpaca_positions = client.get_all_positions()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Alpaca API error: {e}")

    # 2) Load bot state for enrichment
    state       = _load_state()
    today       = _get_today_bucket(state)
    carry       = state.get("carry", [])
    tickers_info = today.get("tickers", {})

    # Build lookup maps from bot state for quick access
    carry_map = {c.get("ticker", "").upper(): c for c in carry}

    # SL/TP lookup — merge carry and plans so we always have the latest levels
    plans_map = {p.get("ticker", "").upper(): p for p in _load_plans()}
    sl_tp_map = {}
    for t, c in carry_map.items():
        sl_tp_map[t] = {"sl_stock": c.get("sl_stock"), "tp_stock": c.get("tp_stock")}
    for t, p in plans_map.items():
        if t not in sl_tp_map:
            sl_tp_map[t] = {"sl_stock": p.get("sl_stock"), "tp_stock": p.get("tp_stock")}
        else:
            # plans override carry if both present (more recent edit)
            if p.get("sl_stock") is not None: sl_tp_map[t]["sl_stock"] = p.get("sl_stock")
            if p.get("tp_stock") is not None: sl_tp_map[t]["tp_stock"] = p.get("tp_stock")

    # Helper: infer ticker from OCC symbol (leading letters)
    def _ticker_from_symbol(sym: str) -> str:
        m = re.match(r"^([A-Z]+)", sym.upper().strip())
        return m.group(1) if m else sym.upper()

    # 3) Build enriched position list from live Alpaca data
    positions = []
    for p in alpaca_positions:
        sym    = str(p.symbol).upper().strip()
        ticker = _ticker_from_symbol(sym)

        # Compute total unrealized P/L %
        try:
            cost_basis   = float(p.cost_basis)
            market_value = float(p.market_value)
            plpc = (market_value - cost_basis) / cost_basis if cost_basis > 0 else None
        except Exception:
            plpc = None

        try:
            avg_entry = float(p.avg_entry_price)
        except Exception:
            avg_entry = None

        try:
            current_qty = int(float(p.qty))
        except Exception:
            current_qty = 0

        # Enrich from bot state (today's tickers)
        bot_info  = tickers_info.get(ticker, {})
        carry_info = carry_map.get(ticker, {})

        took_partial     = bool(bot_info.get("took_partial", carry_info.get("took_partial", False)))
        original_qty     = int(bot_info.get("original_qty", carry_info.get("original_qty", current_qty)))
        partial_qty_sold = int(bot_info.get("partial_qty_sold", carry_info.get("partial_qty_sold", 0)))
        peak_plpc        = bot_info.get("peak_plpc", carry_info.get("peak_plpc"))
        trail_stop       = (peak_plpc - 0.20) if (took_partial and peak_plpc is not None) else None

        # Determine status
        if ticker in carry_map:
            status = "carry"
        else:
            status = "active"

        # Days held — from bot state entry date or Alpaca asset_id creation fallback
        entry_date_str = bot_info.get("entry_date", carry_info.get("entry_date"))
        days_held = None
        if entry_date_str:
            try:
                from datetime import date as _date
                entry_dt = _date.fromisoformat(entry_date_str[:10])
                days_held = (_date.today() - entry_dt).days
            except Exception:
                pass

        # Greeks — from Alpaca option snapshot if available
        greeks = {}
        try:
            from alpaca.data.historical import OptionHistoricalDataClient
            from alpaca.data.requests import OptionSnapshotRequest
            opt_client = OptionHistoricalDataClient(API_KEY, API_SECRET)
            snap_req   = OptionSnapshotRequest(symbol_or_symbols=[sym])
            snaps      = opt_client.get_option_snapshot(snap_req)
            snap       = snaps.get(sym)
            if snap and snap.greeks:
                greeks = {
                    "delta": round(float(snap.greeks.delta), 4) if snap.greeks.delta is not None else None,
                    "theta": round(float(snap.greeks.theta), 4) if snap.greeks.theta is not None else None,
                    "gamma": round(float(snap.greeks.gamma), 4) if snap.greeks.gamma is not None else None,
                    "vega":  round(float(snap.greeks.vega),  4) if snap.greeks.vega  is not None else None,
                    "iv":    round(float(snap.greeks.implied_volatility), 4) if snap.greeks.implied_volatility is not None else None,
                }
        except Exception:
            pass  # Greeks unavailable for this symbol / no options data subscription

        positions.append({
            "ticker":           ticker,
            "contract":         sym,
            "current_qty":      current_qty,
            "original_qty":     original_qty,
            "took_partial":     took_partial,
            "partial_qty_sold": partial_qty_sold,
            "entry_avg_price":  avg_entry,
            "last_plpc":        plpc,
            "peak_plpc":        peak_plpc,
            "trail_stop":       trail_stop,
            "market_value":     float(p.market_value)   if p.market_value   else None,
            "cost_basis":       float(p.cost_basis)     if p.cost_basis     else None,
            "unrealized_pl":    float(p.unrealized_pl)  if p.unrealized_pl  else None,
            "days_held":        days_held,
            "greeks":           greeks,
            "status":           status,
            "sl_stock":         sl_tp_map.get(ticker, {}).get("sl_stock"),
            "tp_stock":         sl_tp_map.get(ticker, {}).get("tp_stock"),
            "stock_price":      None,  # filled in batch below
        })

    # Batch-fetch live stock prices for all position tickers
    if positions:
        try:
            tickers_list = list({p["ticker"] for p in positions})
            stock_snaps  = _get_stock_snapshot(tickers_list)
            price_map    = {}
            for sym2, snap in stock_snaps.items():
                try:
                    price_map[sym2.upper()] = round(float(snap.get("latestTrade", {}).get("p") or snap.get("latestQuote", {}).get("ap") or 0), 2) or None
                except Exception:
                    pass
            for pos2 in positions:
                pos2["stock_price"] = price_map.get(pos2["ticker"])
        except Exception:
            for pos2 in positions:
                pos2.setdefault("stock_price", None)

    # Tag positions that belong to a spread strategy so the Dashboard can label them
    try:
        # Build lookup maps for BCS (bull call spread)
        bcs_state = _load_bcs_state()
        bcs_open  = [p for p in bcs_state.get("positions", []) if p.get("status") == "open"]
        bcs_long  = {p["long_contract"]:  p for p in bcs_open}
        bcs_short = {p["short_contract"]: p for p in bcs_open}

        # Build lookup maps for BPS (bear put spread)
        bps_state = _load_bps_state()
        bps_open  = [p for p in bps_state.get("positions", []) if p.get("status") == "open"]
        bps_long  = {p["long_contract"]:  p for p in bps_open}
        bps_short = {p["short_contract"]: p for p in bps_open}

        for pos2 in positions:
            sym2 = pos2["contract"]
            if sym2 in bcs_long:
                sp = bcs_long[sym2]
                pos2["strategy_label"] = "bull_call_spread"
                pos2["spread_leg"]     = "long"
                pos2["spread_pair"]    = sp.get("short_contract")
                pos2["spread_id"]      = sp.get("id")
            elif sym2 in bcs_short:
                sp = bcs_short[sym2]
                pos2["strategy_label"] = "bull_call_spread"
                pos2["spread_leg"]     = "short"
                pos2["spread_pair"]    = sp.get("long_contract")
                pos2["spread_id"]      = sp.get("id")
            elif sym2 in bps_long:
                sp = bps_long[sym2]
                pos2["strategy_label"] = "bear_put_spread"
                pos2["spread_leg"]     = "long"
                pos2["spread_pair"]    = sp.get("short_contract")
                pos2["spread_id"]      = sp.get("id")
            elif sym2 in bps_short:
                sp = bps_short[sym2]
                pos2["strategy_label"] = "bear_put_spread"
                pos2["spread_leg"]     = "short"
                pos2["spread_pair"]    = sp.get("long_contract")
                pos2["spread_id"]      = sp.get("id")
            else:
                pos2.setdefault("strategy_label", None)
                pos2.setdefault("spread_leg",     None)
                pos2.setdefault("spread_pair",    None)
                pos2.setdefault("spread_id",      None)
    except Exception:
        pass

    return {"positions": positions}


@app.get("/api/history")
def get_history():
    """Returns per-day trade history from the state file."""
    state = _load_state()
    days = state.get("days", {})
    history = []
    for day_key in sorted(days.keys(), reverse=True):
        bucket = days[day_key]
        traded = bucket.get("traded_today", [])
        tickers = bucket.get("tickers", {})
        history.append({
            "date": day_key,
            "traded_tickers": traded,
            "tickers": tickers,
        })
    return {"history": history}


# ── Routes: plans ─────────────────────────────────────────────────────────────
# ── Position management ───────────────────────────────────────────────────────
CLOSE_QUEUE_FILE = BOT_DIR / "close_queue.json"

def _load_close_queue() -> list:
    if not CLOSE_QUEUE_FILE.exists():
        return []
    try:
        return json.loads(CLOSE_QUEUE_FILE.read_text())
    except Exception:
        return []

def _save_close_queue(q: list):
    CLOSE_QUEUE_FILE.write_text(json.dumps(q, indent=2))

def _market_is_open() -> bool:
    try:
        client = _get_trading_client()
        return bool(client.get_clock().is_open)
    except Exception:
        # Fallback: rough ET hours check
        import pytz
        nyc = pytz.timezone("America/New_York")
        now = datetime.now(nyc)
        mins = now.hour * 60 + now.minute
        return now.weekday() < 5 and 570 <= mins < 960  # Mon-Fri 9:30-4:00


class PositionUpdate(BaseModel):
    sl_stock: Optional[float] = None
    tp_stock: Optional[float] = None


@app.patch("/api/positions/{ticker}")
def update_position(ticker: str, body: PositionUpdate):
    """Update SL and/or TP for an open position in bot state."""
    ticker = ticker.upper()
    state  = _load_state()

    updated = False

    # Update in carry list
    carry = state.get("carry", [])
    for c in carry:
        if c.get("ticker", "").upper() == ticker:
            if body.sl_stock is not None: c["sl_stock"] = body.sl_stock
            if body.tp_stock is not None: c["tp_stock"] = body.tp_stock
            updated = True

    # Update in today's tickers bucket
    today_key = _today_key()
    today_bucket = state.get("days", {}).get(today_key, {})
    tinfo = today_bucket.get("tickers", {}).get(ticker)
    if tinfo is not None:
        if body.sl_stock is not None: tinfo["sl_stock"] = body.sl_stock
        if body.tp_stock is not None: tinfo["tp_stock"] = body.tp_stock
        updated = True

    # Also update plans.json so if the bot restarts it picks up the new levels
    plans = _load_plans()
    for p in plans:
        if p.get("ticker", "").upper() == ticker:
            if body.sl_stock is not None: p["sl_stock"] = body.sl_stock
            if body.tp_stock is not None: p["tp_stock"] = body.tp_stock
            updated = True
    _save_plans(plans)

    # Persist state
    STATE_FILE.write_text(json.dumps(state, indent=2))

    if not updated:
        # Position may only exist in Alpaca with no bot state — that's fine, we still saved plans
        pass

    return {"message": f"Updated {ticker}.", "sl_stock": body.sl_stock, "tp_stock": body.tp_stock}


@app.post("/api/positions/{ticker}/close")
def close_position(ticker: str):
    """
    Close an open position immediately if the market is open.
    If the market is closed, add to the close queue for next open.
    """
    ticker = ticker.upper()

    if _market_is_open():
        # Execute immediately via Alpaca
        try:
            client = _get_trading_client()
            # Find the actual option contract symbol for this ticker
            positions = client.get_all_positions()
            closed = []
            for p in positions:
                sym = str(p.symbol).upper()
                # Match by underlying ticker (OCC symbol starts with ticker letters)
                import re as _re2
                m = _re2.match(r"^([A-Z]+)", sym)
                underlying = m.group(1) if m else sym
                if underlying == ticker:
                    client.close_position(sym)
                    closed.append(sym)
            if not closed:
                raise HTTPException(status_code=404, detail=f"No open position found for {ticker}")
            return {"message": f"Closed {ticker} immediately.", "contracts": closed, "queued": False}
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Alpaca error: {e}")
    else:
        # Market closed — add to queue
        queue = _load_close_queue()
        # Remove any existing entry for this ticker to avoid duplicates
        queue = [q for q in queue if q.get("ticker") != ticker]
        queue.append({
            "ticker":    ticker,
            "queued_at": datetime.utcnow().isoformat() + "Z",
        })
        _save_close_queue(queue)
        return {
            "message": f"{ticker} queued for close at next market open.",
            "queued": True,
            "queue": queue,
        }


@app.get("/api/close-queue")
def get_close_queue():
    """Return all positions queued for close at next market open."""
    return {"queue": _load_close_queue()}


@app.delete("/api/close-queue/{ticker}")
def remove_from_close_queue(ticker: str):
    """Cancel a queued close."""
    ticker = ticker.upper()
    queue  = [q for q in _load_close_queue() if q.get("ticker") != ticker]
    _save_close_queue(queue)
    return {"message": f"Removed {ticker} from close queue.", "queue": queue}



@app.get("/api/plans")
def get_plans():
    plans = _load_plans()

    # Auto-remove plans that have already been executed.
    # Checks THREE sources so nothing slips through:
    #   1. traded_today in state.json  — written by bot at order submission
    #   2. carry list in state.json    — bot is actively holding the position
    #   3. live Alpaca positions        — ground truth, catches any missed logging
    try:
        executed = set()

        state = _load_state()
        today = _get_today_bucket(state)

        # Source 1: traded_today flag
        for t in today.get("traded_today", []):
            if t: executed.add(t.upper())

        # Source 2: carry list (bot is actively holding these)
        for c in state.get("carry", []):
            t = c.get("ticker", "")
            if t: executed.add(t.upper())

        # Source 3: live Alpaca positions (most reliable ground truth)
        try:
            client = _get_trading_client()
            alpaca_positions = client.get_all_positions()
            for p in alpaca_positions:
                sym = str(p.symbol).upper().strip()
                m   = re.match(r"^([A-Z]+)", sym)
                if m: executed.add(m.group(1))
        except Exception:
            pass  # Alpaca unavailable — rely on state.json only

        if executed:
            before = len(plans)
            plans  = [p for p in plans if p.get("ticker", "").upper() not in executed]
            if len(plans) < before:
                _save_plans(plans)  # persist so cleanup survives a page reload

    except Exception:
        pass  # never let cleanup errors break the plans response

    return {"plans": plans}


@app.post("/api/plans")
def save_plans(plans: list[Plan]):
    pid = _read_pid()
    if _is_running(pid):
        raise HTTPException(
            status_code=400,
            detail="Cannot modify plans while bot is running. Stop the bot first."
        )
    data = [p.model_dump() for p in plans]
    _save_plans(data)
    return {"message": f"Saved {len(data)} plan(s).", "plans": data}


@app.delete("/api/plans/{ticker}")
def delete_plan(ticker: str):
    pid = _read_pid()
    if _is_running(pid):
        raise HTTPException(status_code=400, detail="Stop the bot before modifying plans.")
    plans = _load_plans()
    plans = [p for p in plans if p.get("ticker", "").upper() != ticker.upper()]
    _save_plans(plans)
    return {"message": f"Deleted plan for {ticker.upper()}.", "plans": plans}


# ── Routes: settings ──────────────────────────────────────────────────────────
SETTINGS_FILE = BOT_DIR / "settings.json"

@app.get("/api/settings")
def get_settings():
    if not SETTINGS_FILE.exists():
        return BotSettings().model_dump()
    try:
        return json.loads(SETTINGS_FILE.read_text())
    except Exception:
        return BotSettings().model_dump()


@app.post("/api/settings")
def save_settings(settings: BotSettings):
    SETTINGS_FILE.write_text(json.dumps(settings.model_dump(), indent=2))
    return {"message": "Settings saved.", **settings.model_dump()}



# ── P&L History Tracking ──────────────────────────────────────────────────────
def _load_pl_history() -> dict:
    if not PL_HISTORY_FILE.exists():
        return {}
    try:
        return json.loads(PL_HISTORY_FILE.read_text())
    except Exception:
        return {}

def _save_pl_history(h: dict):
    tmp = str(PL_HISTORY_FILE) + ".tmp"
    Path(tmp).write_text(json.dumps(h))
    os.replace(tmp, PL_HISTORY_FILE)

@app.post("/api/pl-snapshot")
def record_pl_snapshot():
    """Called by frontend every 60s to persist a P&L data point for the chart."""
    try:
        client = _get_trading_client()
        alpaca_positions = client.get_all_positions()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Alpaca error: {e}")

    import re as _re
    total_pl   = 0.0
    total_cost = 0.0
    pos_snap   = {}

    for p in alpaca_positions:
        try:
            sym    = str(p.symbol).upper().strip()
            m      = _re.match(r"^([A-Z]+)", sym)
            ticker = m.group(1) if m else sym
            upl    = float(p.unrealized_pl or 0)
            cost   = float(p.cost_basis or 0)
            mv     = float(p.market_value or 0)
            plpc   = (mv - cost) / cost if cost > 0 else 0
            total_pl   += upl
            total_cost += cost
            pos_snap[ticker] = {"pl": round(upl, 2), "plpc": round(plpc, 4)}
        except Exception:
            continue

    total_plpc = total_pl / total_cost if total_cost > 0 else 0

    history = _load_pl_history()
    day_key = _today_key()
    if day_key not in history:
        history[day_key] = []

    history[day_key].append({
        "ts":         datetime.now().strftime("%H:%M"),
        "total_pl":   round(total_pl, 2),
        "total_plpc": round(total_plpc, 4),
        "positions":  pos_snap,
    })

    # Keep max 500 snapshots per day (~8hr trading day at 1/min)
    history[day_key] = history[day_key][-500:]

    # Retain only last 7 days
    for old_day in sorted(history.keys(), reverse=True)[7:]:
        del history[old_day]

    _save_pl_history(history)
    return {"recorded": True, "total_pl": round(total_pl, 2), "total_plpc": round(total_plpc, 4)}


@app.get("/api/pl-history")
def get_pl_history(days: int = 1):
    """Returns P&L time series. days=1 for today, days=7 for a week."""
    history = _load_pl_history()
    result  = []
    for day_key in sorted(list(history.keys()), reverse=True)[:days]:
        result.append({"date": day_key, "snapshots": history[day_key]})
    result.sort(key=lambda x: x["date"])
    return {"history": result}


# ── Screener ──────────────────────────────────────────────────────────────────
import httpx
from typing import Optional, List

ALPACA_BASE_URL = "https://paper-api.alpaca.markets" if PAPER else "https://api.alpaca.markets"
DATA_BASE_URL   = "https://data.alpaca.markets"


def _alpaca_headers() -> dict:
    return {
        "APCA-API-KEY-ID":     API_KEY,
        "APCA-API-SECRET-KEY": API_SECRET,
        "accept":              "application/json",
    }


def _get_stock_snapshot(symbols: List[str]) -> dict:
    """Fetch latest stock quotes/bars for a list of symbols."""
    if not symbols:
        return {}
    url = f"{DATA_BASE_URL}/v2/stocks/snapshots"
    params = {"symbols": ",".join(symbols), "feed": "iex"}
    resp = httpx.get(url, headers=_alpaca_headers(), params=params, timeout=15)
    resp.raise_for_status()
    return resp.json()


def _get_option_chain(underlying: str, expiry_date: Optional[str] = None,
                      option_type: Optional[str] = None,
                      strike_gte: Optional[float] = None,
                      strike_lte: Optional[float] = None) -> list:
    """
    Fetch option chain for an underlying via Alpaca REST.
    Returns list of option contract snapshots.
    """
    url = f"{DATA_BASE_URL}/v1beta1/options/snapshots/{underlying}"
    params = {"feed": "indicative", "limit": 500}
    if expiry_date:  params["expiration_date"] = expiry_date
    if option_type:  params["type"]            = option_type.lower()  # "call" or "put"
    if strike_gte:   params["strike_price_gte"] = strike_gte
    if strike_lte:   params["strike_price_lte"] = strike_lte

    try:
        resp = httpx.get(url, headers=_alpaca_headers(), params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        from datetime import date as _date
        import re as _re

        def _parse_option_symbol(sym):
            # Format: AAPL260223C00220000
            # = underlying + YYMMDD + C/P + strike*1000 (8 digits)
            m = _re.match(r"^([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$", sym)
            if not m:
                return None, None, None
            _, yy, mm, dd, cp, strike_raw = m.groups()
            expiry_str = f"20{yy}-{mm}-{dd}"
            try:
                expiry_date = _date.fromisoformat(expiry_str)
                dte = (expiry_date - _date.today()).days
            except Exception:
                expiry_str, dte = None, None
            strike = int(strike_raw) / 1000.0
            opt_type = "call" if cp == "C" else "put"
            return strike, expiry_str, dte, opt_type

        results = []
        for sym, snap in data.get("snapshots", {}).items():
            greeks = snap.get("greeks") or {}
            quote  = snap.get("latestQuote") or {}
            strike, expiry, dte, opt_type = _parse_option_symbol(sym)
            bid       = quote.get("bp")
            ask       = quote.get("ap")
            mid       = round((bid + ask) / 2, 2) if bid is not None and ask is not None else None
            last      = snap.get("latestTrade", {}).get("p")
            day_close = snap.get("dailyBar",    {}).get("c")
            prev_close= snap.get("prevDailyBar",{}).get("c")
            chg = round(day_close - prev_close, 2) if day_close is not None and prev_close is not None else None
            results.append({
                "symbol":        sym,
                "underlying":    underlying,
                "type":          opt_type or ("call" if "C" in sym else "put"),
                "strike":        strike,
                "expiry":        expiry,
                "dte":           dte,
                "bid":           bid,
                "ask":           ask,
                "mid":           mid,
                "last":          last,
                "chg":           chg,
                "iv":            snap.get("impliedVolatility"),
                "delta":         greeks.get("delta"),
                "theta":         greeks.get("theta"),
                "gamma":         greeks.get("gamma"),
                "vega":          greeks.get("vega"),
                "volume":        snap.get("dailyBar", {}).get("v"),
                "open_interest": None,
                "oi":            None,
            })
        return results
    except Exception as e:
        return []


def _apply_filters(contracts: list, filters: dict) -> list:
    """Apply numeric/type filters to a list of option contracts."""
    out = []
    for c in contracts:
        # Option type filter
        if filters.get("option_type") and c.get("type") != filters["option_type"].lower():
            continue
        # DTE range
        if filters.get("dte_min") is not None and (c.get("dte") or 999) < filters["dte_min"]:
            continue
        if filters.get("dte_max") is not None and (c.get("dte") or 0) > filters["dte_max"]:
            continue
        # Delta range
        if filters.get("delta_min") is not None and (c.get("delta") or 0) < filters["delta_min"]:
            continue
        if filters.get("delta_max") is not None and (c.get("delta") or 0) > filters["delta_max"]:
            continue
        # IV range
        if filters.get("iv_min") is not None and (c.get("iv") or 0) < filters["iv_min"]:
            continue
        if filters.get("iv_max") is not None and (c.get("iv") or 0) > filters["iv_max"]:
            continue
        # Volume
        if filters.get("volume_min") is not None and (c.get("volume") or 0) < filters["volume_min"]:
            continue
        # OI
        if filters.get("oi_min") is not None and (c.get("open_interest") or 0) < filters["oi_min"]:
            continue
        # Premium range
        mid = None
        if c.get("bid") is not None and c.get("ask") is not None:
            mid = (c["bid"] + c["ask"]) / 2
        if filters.get("premium_min") is not None and (mid or 0) < filters["premium_min"]:
            continue
        if filters.get("premium_max") is not None and (mid or 999999) > filters["premium_max"]:
            continue

        c["mid"] = round(mid, 2) if mid is not None else None
        out.append(c)

    # Sort
    sort_by = filters.get("sort_by", "volume")
    reverse = filters.get("sort_desc", True)
    out.sort(key=lambda x: (x.get(sort_by) or 0), reverse=reverse)
    return out[:filters.get("limit", 50)]


class ScreenerRequest(BaseModel):
    tickers:     List[str]
    option_type: Optional[str]  = None   # "call" | "put" | None=both
    expiry_date: Optional[str]  = None   # "YYYY-MM-DD"
    dte_min:     Optional[int]  = None
    dte_max:     Optional[int]  = None
    delta_min:   Optional[float]= None
    delta_max:   Optional[float]= None
    iv_min:      Optional[float]= None   # as decimal e.g. 0.3 = 30%
    iv_max:      Optional[float]= None
    strike_gte:  Optional[float]= None
    strike_lte:  Optional[float]= None
    volume_min:  Optional[int]  = None
    oi_min:      Optional[int]  = None
    premium_min: Optional[float]= None
    premium_max: Optional[float]= None
    sort_by:     Optional[str]  = "volume"
    sort_desc:   Optional[bool] = True
    limit:       Optional[int]  = 50


@app.post("/api/screener/run")
def run_screener(req: ScreenerRequest):
    """Run option screener for given tickers + filters."""
    filters   = req.model_dump()
    DEFAULT_OPTIONABLE = [
        "SPY","QQQ","AAPL","MSFT","NVDA","AMZN","TSLA","META","GOOGL","AMD",
        "NFLX","BABA","COIN","PLTR","MSTR","GME","AMC","HOOD","SOFI","RIVN",
    ]
    tickers = [t.upper().strip() for t in (req.tickers or []) if t.strip()]
    if not tickers:
        tickers = DEFAULT_OPTIONABLE

    # Fetch stock prices for context
    try:
        stock_snaps = _get_stock_snapshot(tickers)
    except Exception:
        stock_snaps = {}

    all_results = []
    errors      = []
    for ticker in tickers:
        snap  = stock_snaps.get(ticker, {})
        price = None
        try:
            price = snap.get("latestTrade", {}).get("p") or snap.get("latestQuote", {}).get("ap")
        except Exception:
            pass

        contracts = _get_option_chain(
            underlying=ticker,
            expiry_date=filters.get("expiry_date"),
            option_type=filters.get("option_type"),
            strike_gte=filters.get("strike_gte"),
            strike_lte=filters.get("strike_lte"),
        )
        filtered = _apply_filters(contracts, filters)

        for c in filtered:
            c["stock_price"] = round(price, 2) if price else None
            # Moneyness
            if price and c.get("strike"):
                s = c["strike"]
                if c["type"] == "call":
                    c["moneyness"] = round((s - price) / price * 100, 2)
                else:
                    c["moneyness"] = round((price - s) / price * 100, 2)
            all_results.append(c)

        if not filtered:
            errors.append(f"{ticker}: no contracts matched filters")

    # Re-sort combined results
    all_results.sort(key=lambda x: (x.get(filters.get("sort_by","volume")) or 0), reverse=bool(filters.get("sort_desc", True)))

    return {
        "results": all_results[:filters.get("limit", 50)],
        "total":   len(all_results),
        "errors":  errors,
    }


class AIScreenerRequest(BaseModel):
    prompt: str
    tickers: Optional[List[str]] = None  # override tickers from AI if provided


@app.post("/api/screener/ai")
def ai_screener(req: AIScreenerRequest):
    """
    Takes natural language prompt, uses Claude to extract filter params,
    then runs the screener.
    """
    import anthropic

    client  = anthropic.Anthropic()
    today   = _today_key()

    system = f"""You are an options trading screener assistant. Today is {today}.
Convert the user's natural language description into a JSON object of screener filters.

Return ONLY valid JSON, no explanation, no markdown. Use these exact keys:
{{
  "tickers": ["AAPL", "TSLA"],       // list of stock tickers to screen (required)
  "option_type": "call" | "put" | null,
  "expiry_date": "YYYY-MM-DD" | null, // specific expiry date
  "dte_min": integer | null,           // min days to expiration
  "dte_max": integer | null,           // max days to expiration
  "delta_min": float | null,           // e.g. 0.3
  "delta_max": float | null,           // e.g. 0.7
  "iv_min": float | null,              // implied vol as decimal e.g. 0.3 = 30%
  "iv_max": float | null,
  "strike_gte": float | null,
  "strike_lte": float | null,
  "volume_min": integer | null,
  "oi_min": integer | null,
  "premium_min": float | null,         // option price (mid) in dollars
  "premium_max": float | null,
  "sort_by": "volume" | "delta" | "iv" | "dte" | "mid" | "open_interest",
  "sort_desc": true | false,
  "limit": integer                     // max results, default 25
}}

Rules:
- Always include at least one ticker in tickers array
- For "cheap calls", set premium_max around 2.00
- For "high delta", set delta_min around 0.6
- For "0DTE", set dte_max to 0
- For "weekly", set dte_max to 7
- For "momentum plays", set volume_min around 500 and sort_by volume
- For "income/theta plays", sort_by theta and option_type put
- Infer reasonable defaults if something is vague
- iv values are decimals (0.5 = 50% IV)"""

    try:
        msg = client.messages.create(
            model="claude-opus-4-5",
            max_tokens=512,
            system=system,
            messages=[{"role": "user", "content": req.prompt}]
        )
        raw = msg.content[0].text.strip()

        # Strip markdown fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        raw = raw.strip()

        parsed = json.loads(raw)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=422, detail=f"AI returned invalid JSON: {e}. Raw: {raw[:200]}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI parse error: {e}")

    # Override tickers if user explicitly provided them
    if req.tickers:
        parsed["tickers"] = [t.upper() for t in req.tickers]

    if not parsed.get("tickers"):
        raise HTTPException(status_code=422, detail="AI could not determine which tickers to screen. Please mention specific stocks.")

    # Run the same screener logic
    screener_req = ScreenerRequest(**{k: v for k, v in parsed.items() if k in ScreenerRequest.model_fields})
    result = run_screener(screener_req)
    result["ai_filters"] = parsed   # return what AI inferred so UI can show it
    result["ai_prompt"]  = req.prompt
    return result


# ── Stock Screener ────────────────────────────────────────────────────────────
import math
from datetime import date, timedelta

# Popular tickers grouped by universe for the "scan all" feature
STOCK_UNIVERSES = {
    # US-listed equities — broad coverage across large, mid, and sector names
    "usa": [
        # Mega cap / S&P 500 core
        "AAPL","MSFT","NVDA","AMZN","GOOGL","GOOG","META","TSLA","BRK.B","LLY",
        "AVGO","JPM","V","XOM","UNH","WMT","MA","JNJ","PG","HD","COST","MRK",
        "ABBV","CRM","CVX","AMD","NFLX","BAC","KO","PEP","ORCL","CSCO","ACN",
        "MCD","TMO","ABT","LIN","DHR","ADBE","NKE","TXN","NEE","QCOM","PM",
        "INTC","IBM","AMGN","SBUX","GE","CAT","DE","NOW","INTU","AMAT","KLAC",
        "LRCX","PANW","SNPS","CDNS","MRVL","FTNT","WDAY","TEAM","DDOG","ZS",
        # Financials
        "GS","MS","WFC","C","AXP","BLK","SCHW","CME","ICE","CB","PGR","MET",
        # Healthcare
        "PFE","BMY","GILD","REGN","VRTX","ISRG","ELV","HUM","CI","CVS","MCK",
        # Energy
        "COP","EOG","SLB","MPC","VLO","PSX","OXY","HAL","DVN","BKR","FANG",
        # Consumer
        "AMZN","TGT","LOW","TJX","ROST","EBAY","ETSY","W","DG","DLTR","YUM",
        # Industrials
        "HON","RTX","LMT","NOC","BA","UPS","FDX","UNP","NSC","CSX","MMM","EMR",
        # Materials / Real Estate
        "LIN","APD","NEM","FCX","VMC","MLM","PLD","AMT","EQIX","SPG","O",
        # Communication / Media
        "DIS","CMCSA","NFLX","CHTR","T","VZ","TMUS","PARA","WBD","FOXA",
        # Small/mid growth & popular names
        "PLTR","SNOW","NET","MDB","CRWD","S","OKTA","HUBS","TTD","RBLX",
        "COIN","HOOD","SOFI","UPST","AFRM","RIVN","LCID","LAZR","JOBY",
        "GME","AMC","MSTR","MARA","RIOT","CLSK","BTBT","HUT","CIFR","CORZ",
        # ETFs (US-listed)
        "SPY","QQQ","IWM","DIA","VTI","VOO","IVV","TQQQ","SQQQ","UVXY",
        "XLK","XLF","XLE","XLV","XLU","XLI","XLC","XLB","XLRE","XLP","XLY",
        "GLD","SLV","TLT","HYG","LQD","EEM","EFA","GDX","GDXJ","USO","UNG",
    ],
    "sp500":  [
        "MMM","AOS","ABT","ABBV","ACN","ADBE","AMD","AES","AFL","A","APD","ABNB",
        "AKAM","ALB","ARE","ALGN","ALLE","LNT","ALL","GOOGL","GOOG","MO","AMZN","AMCR",
        "AEE","AAL","AEP","AXP","AIG","AMT","AWK","AMP","AME","AMGN","APH","ADI",
        "ANSS","AON","APA","APO","AAPL","AMAT","APTV","ACGL","ADM","ANET","AJG","AIZ",
        "T","ATO","ADSK","ADP","AZO","AVB","AVY","AXON","BKR","BALL","BAC","BK",
        "BBWI","BAX","BDX","BRK.B","BBY","TECH","BIIB","BLK","BX","BA","BCR","BMY",
        "AVGO","BR","BRO","BF.B","BLDR","BSX","BMI","CBRE","CDS","CPB","COF","CAH",
        "KMX","CCL","CARR","CTLT","CAT","CBOE","CBRE","CDW","CE","COR","CNC","CNP",
        "CF","CRL","SCHW","CHTR","CVX","CMG","CB","CHD","CI","CINF","CTAS","CSCO",
        "C","CFG","CLX","CME","CMS","KO","CTSH","CL","CMCSA","CMA","CAG","COP",
        "ED","STZ","CEG","COO","CPRT","GLW","CSGP","COST","CTRA","CCI","CSX","CMI",
        "CVS","DHR","DHI","DRI","DVA","DAY","DE","DELL","DAL","DVN","DXCM","FANG",
        "DLR","DFS","DG","DLTR","D","DPZ","DOV","DOW","DHI","DTE","DUK","DD",
        "EMN","ETN","EBAY","ECL","EIX","EW","EA","ELV","LLY","EMR","ENPH","ETR",
        "EOG","EPAM","EQT","EFX","EQIX","EQR","ESS","EL","ETSY","EG","EVRG","ES",
        "EXC","EXPE","EXPD","EXR","XOM","FFIV","FDS","FICO","FAST","FRT","FDX","FIS",
        "FITB","FSLR","FE","FI","FMC","F","FTNT","FTV","FOXA","FOX","BEN","FCX",
        "GRMN","IT","GE","GEHC","GEV","GEN","GNRC","GD","GIS","GPC","GILD","GPN",
        "GL","GDDY","GS","HAL","HIG","HAS","HCA","DOC","HSIC","HSY","HES","HPE",
        "HLT","HOLX","HD","HON","HRL","HST","HWM","HPQ","HUBB","HUM","HBAN","HII",
        "IBM","IEX","IDXX","ITW","INCY","IR","PODD","INTC","ICE","IFF","IP","IPG",
        "INTU","ISRG","IVZ","INVH","IQV","IRM","JBHT","JBL","JKHY","J","JNJ","JCI",
        "JPM","JNPR","K","KVUE","KDP","KEY","KEYS","KMB","KIM","KMI","KLAC","KHC",
        "KR","LHX","LH","LRCX","LW","LVS","LDOS","LEN","LNC","LIN","LYV","LKQ",
        "LMT","L","LOW","LULU","LYB","MTB","MRO","MPC","MKTX","MAR","MMC","MLM",
        "MAS","MA","MTCH","MKC","MCD","MCK","MDT","MRK","META","MET","MTD","MGM",
        "MCHP","MU","MSFT","MAA","MRNA","MHK","MOH","TAP","MDLZ","MPWR","MNST","MCO",
        "MS","MOS","MSI","MSCI","NDAQ","NTAP","NFLX","NEM","NWSA","NWS","NEE","NKE",
        "NI","NDSN","NSC","NTRS","NOC","NCLH","NRG","NUE","NVDA","NVR","NXPI","ORLY",
        "OXY","ODFL","OMC","ON","OKE","ORCL","OTIS","PCAR","PKG","PANW","PH","PAYX",
        "PAYC","PYPL","PNR","PEP","PFE","PCG","PM","PSX","PNW","PNC","POOL","PPG",
        "PPL","PFG","PG","PGR","PLD","PRU","PEG","PTC","PSA","PHM","QRVO","PWR",
        "QCOM","DGX","RL","RJF","RTX","O","REG","REGN","RF","RSG","RMD","RVTY",
        "ROK","ROL","ROP","ROST","RCL","SPGI","CRM","SBAC","SLB","STX","SRE","NOW",
        "SHW","SPG","SWKS","SJM","SW","SNA","SOLV","SO","LUV","SWK","SBUX","STT",
        "STLD","STE","SYK","SMCI","SYF","SNPS","SYY","TMUS","TROW","TTWO","TPR","TRGP",
        "TGT","TEL","TDY","TFX","TER","TSLA","TXN","TMO","TJX","TSCO","TT","TDG",
        "TRV","TRMB","TFC","TYL","TSN","USB","UBER","UDR","ULTA","UNP","UAL","UPS",
        "URI","UNH","UHS","VLO","VTR","VLTO","VRSN","VRSK","VZ","VRTX","VICI","V",
        "VMC","WRB","GWW","WAB","WBA","WMT","DIS","WBD","WM","WAT","WEC","WFC",
        "WELL","WST","WDC","WRK","WY","WHR","WMB","WTW","WDAY","WYNN","XEL","XYL",
        "YUM","ZBRA","ZBH","ZTS",
    ],
    "mag7":   ["AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA"],
    "etfs":   ["SPY","QQQ","IWM","DIA","XLK","XLF","XLE","XLV","GLD","TLT","TQQQ","SQQQ","VTI","VOO"],
    "growth": ["PLTR","SNOW","NET","MDB","CRWD","DDOG","ZS","PANW","COIN","HOOD","SOFI","RBLX","TTD","HUBS"],
    "meme":   ["GME","AMC","MSTR","PLTR","RIVN","LCID","SOFI","HOOD","COIN","BBBY","SPCE","CLOV"],
}

def _fetch_daily_bars(ticker: str, lookback: int = 60) -> list:
    """
    Fetch daily OHLCV bars from Alpaca REST.
    Returns list of {t, o, h, l, c, v} dicts sorted oldest first.
    Tries sip first, falls back to iex if 403.
    """
    end   = date.today()
    start = end - timedelta(days=lookback + 30)
    url   = f"{DATA_BASE_URL}/v2/stocks/{ticker}/bars"

    for feed in ("sip", "iex"):
        params = {
            "timeframe": "1Day",
            "start":     start.isoformat(),
            "end":       end.isoformat(),
            "limit":     lookback + 30,
            "feed":      feed,
            "sort":      "asc",
        }
        try:
            resp = httpx.get(url, headers=_alpaca_headers(), params=params, timeout=15)
            if resp.status_code == 403:
                continue  # try next feed
            resp.raise_for_status()
            return resp.json().get("bars", [])
        except Exception:
            continue
    return []


def _fetch_multi_bars(tickers: list, lookback: int = 60) -> dict:
    """
    Batch fetch daily bars for multiple tickers.
    Handles pagination (next_page_token) automatically.
    Uses sip feed (full US market data); falls back to iex if 403.
    """
    if not tickers:
        return {}

    end   = date.today()
    start = end - timedelta(days=lookback + 30)  # extra cushion for holidays/weekends
    url   = f"{DATA_BASE_URL}/v2/stocks/bars"

    all_bars: dict = {}
    feed = "sip"

    # Process in chunks of 50 tickers to avoid URL length limits
    chunk_size = 50
    for chunk_start in range(0, len(tickers), chunk_size):
        chunk = tickers[chunk_start : chunk_start + chunk_size]
        page_token = None

        for attempt in range(2):  # retry with iex if sip fails
            params = {
                "symbols":   ",".join(chunk),
                "timeframe": "1Day",
                "start":     start.isoformat(),
                "end":       end.isoformat(),
                "limit":     1000,
                "feed":      feed,
                "sort":      "asc",
            }
            try:
                while True:
                    if page_token:
                        params["page_token"] = page_token

                    resp = httpx.get(url, headers=_alpaca_headers(), params=params, timeout=30)

                    if resp.status_code == 403 and feed == "sip":
                        feed = "iex"
                        break  # retry with iex

                    resp.raise_for_status()
                    body      = resp.json()
                    bars_page = body.get("bars", {})

                    if isinstance(bars_page, dict):
                        for ticker, bars in bars_page.items():
                            if ticker not in all_bars:
                                all_bars[ticker] = []
                            all_bars[ticker].extend(bars)

                    page_token = body.get("next_page_token")
                    if not page_token:
                        break  # no more pages

                break  # chunk succeeded, move to next

            except Exception:
                if attempt == 0 and feed == "sip":
                    feed = "iex"
                else:
                    break  # give up on this chunk

    return all_bars


# ── Indicator calculations ────────────────────────────────────────────────────

def _sma(closes: list, period: int) -> list:
    """Simple moving average. Returns list same length (None for first period-1 values)."""
    result = []
    for i in range(len(closes)):
        if i < period - 1:
            result.append(None)
        else:
            result.append(sum(closes[i - period + 1 : i + 1]) / period)
    return result

def _ema(closes: list, period: int) -> list:
    """Exponential moving average."""
    result = []
    k = 2 / (period + 1)
    for i, c in enumerate(closes):
        if i == 0:
            result.append(c)
        else:
            result.append(c * k + result[-1] * (1 - k))
    # Mask first period-1 values as None for consistency
    return [None if i < period - 1 else v for i, v in enumerate(result)]

def _rsi(closes: list, period: int = 14) -> list:
    """RSI using Wilder smoothing."""
    if len(closes) < period + 1:
        return [None] * len(closes)
    gains, losses = [], []
    for i in range(1, len(closes)):
        diff = closes[i] - closes[i-1]
        gains.append(max(diff, 0))
        losses.append(abs(min(diff, 0)))
    result = [None] * len(closes)
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    for i in range(period, len(closes)):
        avg_gain = (avg_gain * (period - 1) + gains[i-1]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i-1]) / period
        if avg_loss == 0:
            result[i] = 100
        else:
            rs = avg_gain / avg_loss
            result[i] = 100 - (100 / (1 + rs))
    return result

def _atr(bars: list, period: int = 14) -> list:
    """Average True Range."""
    trs = [None]
    for i in range(1, len(bars)):
        h  = bars[i]["h"]
        l  = bars[i]["l"]
        pc = bars[i-1]["c"]
        trs.append(max(h - l, abs(h - pc), abs(l - pc)))
    result = [None] * len(bars)
    valid  = [t for t in trs[1:] if t is not None]
    if len(valid) < period:
        return result
    atr = sum(valid[:period]) / period
    result[period] = atr
    for i in range(period + 1, len(bars)):
        if trs[i] is not None:
            atr = (atr * (period - 1) + trs[i]) / period
            result[i] = atr
    return result

def _vwap(bars: list) -> list:
    """VWAP (cumulative, resets each bar for daily — returns rolling VWAP)."""
    result = []
    cum_pv = 0; cum_v = 0
    for b in bars:
        tp = (b["h"] + b["l"] + b["c"]) / 3
        cum_pv += tp * b["v"]
        cum_v  += b["v"]
        result.append(cum_pv / cum_v if cum_v else None)
    return result

def _volume_ratio(volumes: list, period: int = 20) -> list:
    """Current volume / average volume over period."""
    result = []
    for i in range(len(volumes)):
        if i < period:
            result.append(None)
        else:
            avg = sum(volumes[i - period : i]) / period
            result.append(round(volumes[i] / avg, 2) if avg > 0 else None)
    return result

def _detect_sma_cross(sma_fast: list, sma_slow: list) -> str | None:
    """
    Detect if the most recent bar has a golden cross (fast crossed above slow)
    or death cross (fast crossed below slow).
    Compares last two bars.
    """
    # Need at least 2 valid values from both
    pairs = [(f, s) for f, s in zip(sma_fast, sma_slow) if f is not None and s is not None]
    if len(pairs) < 2:
        return None
    prev_f, prev_s = pairs[-2]
    curr_f, curr_s = pairs[-1]
    if prev_f <= prev_s and curr_f > curr_s:
        return "golden"   # bullish cross
    if prev_f >= prev_s and curr_f < curr_s:
        return "death"    # bearish cross
    return "none"

def _pct_change(closes: list, periods: int = 1) -> float | None:
    """% change over last N periods."""
    if len(closes) < periods + 1:
        return None
    old = closes[-(periods+1)]
    new = closes[-1]
    return round((new - old) / old * 100, 2) if old else None

# ── MACD helper ───────────────────────────────────────────────────────────────
def _macd(closes: list, fast: int = 12, slow: int = 26, signal: int = 9):
    """Returns (macd_line, signal_line) as lists aligned to closes."""
    ema_fast   = _ema(closes, fast)
    ema_slow   = _ema(closes, slow)
    macd_line  = [
        (f - s) if (f is not None and s is not None) else None
        for f, s in zip(ema_fast, ema_slow)
    ]
    # Signal line = EMA of macd_line (skip Nones)
    # Build a compact version, compute EMA, then re-expand
    valid_start = next((i for i, v in enumerate(macd_line) if v is not None), None)
    if valid_start is None:
        return macd_line, [None] * len(closes)
    compact    = [v for v in macd_line if v is not None]
    sig_compact = _ema(compact, signal)
    # Re-expand back to full length
    sig_line = [None] * valid_start + sig_compact
    return macd_line, sig_line


def _macd_crossed_above(macd_line: list, sig_line: list, lookback: int = 3) -> bool:
    """True if MACD crossed above signal within the last `lookback` bars."""
    n = len(macd_line)
    for i in range(1, lookback + 1):
        idx  = n - i
        pidx = n - i - 1
        if idx < 1 or pidx < 0:
            continue
        m, s, mp, sp = macd_line[idx], sig_line[idx], macd_line[pidx], sig_line[pidx]
        if None in (m, s, mp, sp):
            continue
        if m > s and mp <= sp:
            return True
    return False


def _macd_crossed_below(macd_line: list, sig_line: list, lookback: int = 3) -> bool:
    """True if MACD crossed below signal within the last `lookback` bars."""
    n = len(macd_line)
    for i in range(1, lookback + 1):
        idx  = n - i
        pidx = n - i - 1
        if idx < 1 or pidx < 0:
            continue
        m, s, mp, sp = macd_line[idx], sig_line[idx], macd_line[pidx], sig_line[pidx]
        if None in (m, s, mp, sp):
            continue
        if m < s and mp >= sp:
            return True
    return False


def _adx(bars: list, period: int = 14) -> list:
    """Average Directional Index (simplified Wilder smoothing)."""
    if len(bars) < period + 1:
        return [None] * len(bars)
    tr_list, pdm_list, ndm_list = [], [], []
    for i in range(1, len(bars)):
        h, l, pc = bars[i]["h"], bars[i]["l"], bars[i-1]["c"]
        ph, pl   = bars[i-1]["h"], bars[i-1]["l"]
        tr_list.append(max(h - l, abs(h - pc), abs(l - pc)))
        up   = h - ph; dn = pl - l
        pdm_list.append(up  if up  > dn and up  > 0 else 0)
        ndm_list.append(dn  if dn  > up and dn  > 0 else 0)

    def _wilder_smooth(lst, p):
        if len(lst) < p:
            return [None] * len(lst)
        out = [None] * p
        sm  = sum(lst[:p])
        out.append(sm)
        for v in lst[p:]:
            sm = sm - sm / p + v
            out.append(sm)
        return out

    atr_s  = _wilder_smooth(tr_list, period)
    pdm_s  = _wilder_smooth(pdm_list, period)
    ndm_s  = _wilder_smooth(ndm_list, period)

    di_plus, di_minus, dx_list = [], [], []
    for i in range(len(atr_s)):
        a, p, n = atr_s[i], pdm_s[i], ndm_s[i]
        if None in (a, p, n) or a == 0:
            di_plus.append(None); di_minus.append(None); dx_list.append(None)
        else:
            dp = 100 * p / a; dm = 100 * n / a
            di_plus.append(dp); di_minus.append(dm)
            denom = dp + dm
            dx_list.append(100 * abs(dp - dm) / denom if denom else None)

    # ADX = Wilder smooth of DX
    valid_dx = [(i, v) for i, v in enumerate(dx_list) if v is not None]
    if len(valid_dx) < period:
        return [None] * (len(bars))
    start_i  = valid_dx[period - 1][0]
    adx_vals  = [None] * (start_i + 1)
    sm        = sum(v for _, v in valid_dx[:period]) / period
    adx_vals.append(sm)
    for _, v in valid_dx[period:]:
        sm = (sm * (period - 1) + v) / period
        adx_vals.append(sm)
    # Pad to match bars length
    while len(adx_vals) < len(bars):
        adx_vals.append(adx_vals[-1])
    return adx_vals[:len(bars)]


# ── Strategies file ───────────────────────────────────────────────────────────
STRATEGIES_FILE = BOT_DIR / "strategies.json"

PILOT_STRATEGY = {
    "id":          "pilot",
    "name":        "Pilot Strategy",
    "description": "Momentum breakout: RSI 50-70 / 30-50, Price vs EMA20 + SMA50, volume surge, MACD crossover, ADX > 25",
    "version":     1,
    "params": {
        "rsi_period":    14,
        "ema_period":    20,
        "sma_period":    50,
        "macd_fast":     12,
        "macd_slow":     26,
        "macd_signal":   9,
        "adx_period":    14,
        "vol_mult":      1.5,
        "macd_lookback": 3,
        "adx_min":       25,
    },
    "universe": "sp500",
    "locked":   True,   # built-in, cannot be deleted — only cloned/renamed
}


def _load_strategies() -> list:
    if not STRATEGIES_FILE.exists():
        seeds = [PILOT_STRATEGY]
        STRATEGIES_FILE.write_text(json.dumps(seeds, indent=2))
        return seeds
    try:
        data = json.loads(STRATEGIES_FILE.read_text())
        # Always ensure pilot exists
        ids = {s["id"] for s in data}
        if "pilot" not in ids:
            data.insert(0, PILOT_STRATEGY)
            STRATEGIES_FILE.write_text(json.dumps(data, indent=2))
        return data
    except Exception:
        return [PILOT_STRATEGY]


def _save_strategies(strategies: list):
    STRATEGIES_FILE.write_text(json.dumps(strategies, indent=2))


def _run_pilot_strategy(bars: list, params: dict) -> dict | None:
    """
    Pilot Strategy logic — translated directly from options_screener.py.
    Returns {"signal": "CALL"|"PUT", ...indicators} or None if no signal.
    """
    if len(bars) < 60:
        return None

    closes  = [b["c"] for b in bars]
    volumes = [b["v"] for b in bars]

    rsi      = _rsi(closes, params["rsi_period"])
    ema20    = _ema(closes, params["ema_period"])
    sma50    = _sma(closes, params["sma_period"])
    volr     = _volume_ratio(volumes, 20)
    macd_l, macd_s = _macd(closes, params["macd_fast"], params["macd_slow"], params["macd_signal"])
    adx_vals = _adx(bars, params["adx_period"])

    def last(lst):
        return next((v for v in reversed(lst) if v is not None), None)

    rsi_v   = last(rsi)
    ema20_v = last(ema20)
    sma50_v = last(sma50)
    volr_v  = last(volr)
    adx_v   = last(adx_vals)
    price   = bars[-1]["c"]
    vol     = bars[-1]["v"]

    if None in (rsi_v, ema20_v, sma50_v, volr_v, adx_v):
        return None

    vol_surge    = volr_v >= params["vol_mult"]
    adx_strong   = adx_v  >= params["adx_min"]
    macd_up      = _macd_crossed_above(macd_l, macd_s, params["macd_lookback"])
    macd_down    = _macd_crossed_below(macd_l, macd_s, params["macd_lookback"])

    base = {
        "price":    round(price, 2),
        "rsi":      round(rsi_v, 1),
        "adx":      round(adx_v, 1),
        "vol_ratio": round(volr_v, 2),
        "ema20":    round(ema20_v, 2),
        "sma50":    round(sma50_v, 2),
    }

    # CALL signal
    if (50 <= rsi_v <= 70 and
            price > ema20_v and
            price > sma50_v and
            vol_surge and macd_up and adx_strong):
        return {**base, "signal": "CALL"}

    # PUT signal
    if (30 <= rsi_v <= 50 and
            price < ema20_v and
            price < sma50_v and
            vol_surge and macd_down and adx_strong):
        return {**base, "signal": "PUT"}

    return None


# ── Strategy dispatch ─────────────────────────────────────────────────────────
def _run_strategy(strategy: dict, tickers: list) -> dict:
    """Run a strategy against a list of tickers. Returns {results, errors, tickers_scanned}."""
    params   = strategy.get("params", {})
    lookback = 180   # 6 months — enough for MACD/ADX warmup

    bars_map = _fetch_multi_bars(tickers, lookback)
    results, errors = [], []

    for ticker in tickers:
        bars = bars_map.get(ticker, [])
        if not bars:
            errors.append(f"{ticker}: no bar data")
            continue
        try:
            sig = _run_pilot_strategy(bars, params)
            if sig:
                sig["ticker"] = ticker
                results.append(sig)
        except Exception as e:
            errors.append(f"{ticker}: {e}")

    results.sort(key=lambda x: x.get("vol_ratio", 0), reverse=True)
    return {"results": results, "errors": errors, "tickers_scanned": len(tickers)}



def _compute_indicators(bars: list) -> dict | None:
    """
    Compute all indicators for a ticker given its bar data.
    Returns a flat dict of the most recent values.
    """
    if len(bars) < 5:
        return None

    closes  = [b["c"] for b in bars]
    volumes = [b["v"] for b in bars]

    sma10  = _sma(closes, 10)
    sma20  = _sma(closes, 20)
    sma50  = _sma(closes, 50)
    sma200 = _sma(closes, 200)
    ema9   = _ema(closes, 9)
    ema21  = _ema(closes, 21)
    rsi14  = _rsi(closes, 14)
    atr14  = _atr(bars, 14)
    vwap_  = _vwap(bars)
    volr20 = _volume_ratio(volumes, 20)

    latest = bars[-1]
    prev   = bars[-2] if len(bars) >= 2 else bars[-1]

    def last(lst): return next((v for v in reversed(lst) if v is not None), None)

    sma10_val  = last(sma10)
    sma20_val  = last(sma20)
    sma50_val  = last(sma50)
    sma200_val = last(sma200)

    return {
        "close":          round(latest["c"], 2),
        "open":           round(latest["o"], 2),
        "high":           round(latest["h"], 2),
        "low":            round(latest["l"], 2),
        "volume":         int(latest["v"]),
        "prev_close":     round(prev["c"], 2),
        "change_pct":     _pct_change(closes, 1),
        "change_5d":      _pct_change(closes, 5),
        "change_20d":     _pct_change(closes, 20),
        "sma10":          round(sma10_val, 2) if sma10_val else None,
        "sma20":          round(sma20_val, 2) if sma20_val else None,
        "sma50":          round(sma50_val, 2) if sma50_val else None,
        "sma200":         round(sma200_val, 2) if sma200_val else None,
        "ema9":           round(last(ema9),  2) if last(ema9)  else None,
        "ema21":          round(last(ema21), 2) if last(ema21) else None,
        "rsi14":          round(last(rsi14), 1) if last(rsi14) else None,
        "atr14":          round(last(atr14), 3) if last(atr14) else None,
        "vwap":           round(last(vwap_), 2) if last(vwap_) else None,
        "vol_ratio_20d":  last(volr20),
        "sma_cross_10_20": _detect_sma_cross(sma10, sma20),
        "sma_cross_50_200": _detect_sma_cross(sma50, sma200),
        "above_sma20":    (latest["c"] > sma20_val)  if sma20_val  else None,
        "above_sma50":    (latest["c"] > sma50_val)  if sma50_val  else None,
        "above_sma200":   (latest["c"] > sma200_val) if sma200_val else None,
        "bar_date":       latest.get("t", "")[:10],
    }


# ── Filter application ────────────────────────────────────────────────────────

def _apply_stock_filters(indicators: dict, filters: dict) -> bool:
    """Returns True if this ticker passes all active filters."""
    def between(val, lo, hi):
        """Only apply bound checks when a bound is actually set. Skip if both None."""
        if lo is None and hi is None:
            return True   # no filter set — always pass
        if val is None:
            return False  # filter is set but value couldn't be computed — fail
        if lo is not None and val < lo: return False
        if hi is not None and val > hi: return False
        return True

    c = indicators

    if not between(c.get("close"),         filters.get("price_min"),      filters.get("price_max")):      return False
    if not between(c.get("volume"),        filters.get("volume_min"),     filters.get("volume_max")):     return False
    if not between(c.get("change_pct"),    filters.get("change_pct_min"), filters.get("change_pct_max")): return False
    if not between(c.get("change_5d"),     filters.get("change_5d_min"),  filters.get("change_5d_max")):  return False
    if not between(c.get("rsi14"),         filters.get("rsi_min"),        filters.get("rsi_max")):        return False
    if not between(c.get("vol_ratio_20d"), filters.get("vol_ratio_min"),  None):                          return False
    if not between(c.get("atr14"),         filters.get("atr_min"),        filters.get("atr_max")):        return False

    # SMA cross filters
    if filters.get("sma_cross") and filters["sma_cross"] != "any":
        pairs = filters["sma_cross"].split("_x_")  # e.g. "10_x_20" => [10,20]
        fast_p, slow_p = int(pairs[0]), int(pairs[1])
        cross_key = f"sma_cross_{fast_p}_{slow_p}"
        cross_dir = filters.get("sma_cross_dir") or ""
        cross_val = c.get(cross_key)
        if cross_dir:
            # Specific direction required
            if cross_val != cross_dir:
                return False
        else:
            # Any direction — just need a cross to have occurred (golden or death)
            if cross_val not in ("golden", "death"):
                return False

    # Price vs MA filters
    if filters.get("above_sma20")  is True  and not c.get("above_sma20"):  return False
    if filters.get("above_sma50")  is True  and not c.get("above_sma50"):  return False
    if filters.get("above_sma200") is True  and not c.get("above_sma200"): return False
    if filters.get("below_sma20")  is True  and c.get("above_sma20"):      return False
    if filters.get("below_sma50")  is True  and c.get("above_sma50"):      return False

    # Price vs VWAP
    if filters.get("above_vwap") is True and c.get("vwap") and c["close"] < c["vwap"]:  return False
    if filters.get("below_vwap") is True and c.get("vwap") and c["close"] > c["vwap"]:  return False

    return True


class StockScreenerRequest(BaseModel):
    tickers:         Optional[List[str]] = None
    universe:        Optional[str]       = None   # "usa" | "sp500" | "mag7" | "etfs" | "growth" | "meme"
    lookback_days:   Optional[int]       = 60
    # Price/volume
    price_min:       Optional[float]     = None
    price_max:       Optional[float]     = None
    volume_min:      Optional[int]       = None
    volume_max:      Optional[int]       = None
    vol_ratio_min:   Optional[float]     = None   # current vol / 20d avg, e.g. 1.5 = 50% above avg
    # Performance
    change_pct_min:  Optional[float]     = None   # 1-day % change
    change_pct_max:  Optional[float]     = None
    change_5d_min:   Optional[float]     = None
    change_5d_max:   Optional[float]     = None
    # Technicals
    rsi_min:         Optional[float]     = None
    rsi_max:         Optional[float]     = None
    atr_min:         Optional[float]     = None
    atr_max:         Optional[float]     = None
    # MA crosses (detected on the most recent bar)
    sma_cross:       Optional[str]       = None   # "10_x_20" | "50_x_200" | "any"
    sma_cross_dir:   Optional[str]       = None   # "golden" | "death"
    # Price vs MA booleans
    above_sma20:     Optional[bool]      = None
    above_sma50:     Optional[bool]      = None
    above_sma200:    Optional[bool]      = None
    below_sma20:     Optional[bool]      = None
    below_sma50:     Optional[bool]      = None
    above_vwap:      Optional[bool]      = None
    below_vwap:      Optional[bool]      = None
    # Output
    sort_by:         Optional[str]       = "vol_ratio_20d"
    sort_desc:       Optional[bool]      = True
    limit:           Optional[int]       = 25


@app.post("/api/screener/stocks/run")
def run_stock_screener(req: StockScreenerRequest):
    """Run stock screener with technical indicator filters."""
    # Resolve ticker list
    tickers = list(req.tickers or [])
    if req.universe and req.universe in STOCK_UNIVERSES:
        tickers = list(set(tickers + STOCK_UNIVERSES[req.universe]))
    if not tickers:
        tickers = list(STOCK_UNIVERSES.get("usa", []))

    tickers = [t.upper().strip() for t in tickers]

    filters = req.model_dump()

    # Auto-determine lookback based on which indicators the filters need
    # SMA200 needs ~280 calendar days, SMA50 needs ~75, default is 90
    needs_sma200 = any([
        filters.get("above_sma200"),
        filters.get("below_sma200"),
        filters.get("sma_cross") == "50_x_200",
    ])
    needs_sma50 = any([
        filters.get("above_sma50"),
        filters.get("below_sma50"),
        filters.get("sma_cross") in ("10_x_20", "50_x_200"),
    ])
    if needs_sma200:
        auto_lookback = 300
    elif needs_sma50:
        auto_lookback = 100
    else:
        auto_lookback = 90

    lookback = min(req.lookback_days or auto_lookback, 365)

    # Batch-fetch bars
    bars_map = _fetch_multi_bars(tickers, lookback)
    results = []
    errors  = []

    no_data_count    = 0
    insufficient_count = 0
    filtered_count   = 0

    for ticker in tickers:
        bars = bars_map.get(ticker, [])
        if not bars:
            no_data_count += 1
            if no_data_count <= 5:  # only report first 5 to keep errors manageable
                errors.append(f"{ticker}: no bar data")
            continue

        ind = _compute_indicators(bars)
        if ind is None:
            insufficient_count += 1
            continue

        if _apply_stock_filters(ind, filters):
            ind["ticker"] = ticker
            results.append(ind)
        else:
            filtered_count += 1

    if no_data_count > 5:
        errors.append(f"... and {no_data_count - 5} more tickers with no bar data")

    # Diagnostic summary when nothing matches
    if not results:
        errors.append(
            f"Diagnostic: {len(tickers)} tickers scanned, "
            f"{no_data_count} had no data, "
            f"{insufficient_count} had insufficient history, "
            f"{filtered_count} had data but didn't match filters"
        )

    # Sort
    sort_key  = req.sort_by or "vol_ratio_20d"
    sort_desc = req.sort_desc if req.sort_desc is not None else True
    results.sort(key=lambda x: (x.get(sort_key) or 0), reverse=sort_desc)
    results = results[:req.limit or 25]

    return {"results": results, "total": len(results), "errors": errors, "tickers_scanned": len(tickers)}


class AIStockScreenerRequest(BaseModel):
    prompt:  str
    tickers: Optional[List[str]] = None
    universe: Optional[str]      = None


@app.post("/api/screener/stocks/ai")
def ai_stock_screener(req: AIStockScreenerRequest):
    """Natural language → stock screener filters via Claude."""
    import anthropic
    client = anthropic.Anthropic()
    today  = _today_key()

    system = f"""You are a stock technical analysis screener assistant. Today is {today}.
Convert the user\'s natural language description into a JSON object of screener filters.

Return ONLY valid JSON, no explanation, no markdown. Use these exact keys:
{{
  "tickers":        ["AAPL", "TSLA"] | null,  // specific tickers, or null to use a universe
  "universe":       "usa" | "sp500" | "mag7" | "etfs" | "growth" | "meme" | null,
  "lookback_days":  integer,           // how many days of history needed, default 60
  "price_min":      float | null,
  "price_max":      float | null,
  "volume_min":     integer | null,
  "vol_ratio_min":  float | null,      // e.g. 1.5 means volume 50% above 20d average
  "change_pct_min": float | null,      // 1-day % change e.g. 2 = up 2%
  "change_pct_max": float | null,
  "change_5d_min":  float | null,
  "change_5d_max":  float | null,
  "rsi_min":        float | null,      // RSI 0-100
  "rsi_max":        float | null,
  "atr_min":        float | null,
  "atr_max":        float | null,
  "sma_cross":      "10_x_20" | "50_x_200" | null,  // which pair to check for a cross
  "sma_cross_dir":  "golden" | "death" | null,       // golden=bullish, death=bearish
  "above_sma20":    true | null,
  "above_sma50":    true | null,
  "above_sma200":   true | null,
  "below_sma20":    true | null,
  "below_sma50":    true | null,
  "above_vwap":     true | null,
  "below_vwap":     true | null,
  "sort_by":        "vol_ratio_20d" | "change_pct" | "rsi14" | "volume" | "close" | "atr14",
  "sort_desc":      true | false,
  "limit":          integer
}}

Rules:
- "10/20 SMA cross" or "10/20 crossover" → sma_cross: "10_x_20", sma_cross_dir: "golden"
- "death cross" → sma_cross_dir: "death"
- "above 200 SMA" or "above 200-day" → above_sma200: true
- "oversold" → rsi_max: 35
- "overbought" → rsi_min: 65
- "high volume" or "volume surge" → vol_ratio_min: 1.5
- "momentum" → sort_by: "change_pct", change_pct_min: 1
- "S&P 500" or "S&P" → universe: "sp500"  // full ~500 constituents
- "large cap" or "blue chip" → universe: "sp500"  // full ~500 constituents
- "big tech" or "magnificent 7" → universe: "mag7"
- "ETFs" → universe: "etfs"
- If specific stocks are mentioned, set tickers array (do NOT also set universe)
- If no tickers/universe obvious from context, use universe: "usa"
- Set lookback_days to at least 210 if SMA200 or 50/200 cross is needed, else 60"""

    try:
        msg = client.messages.create(
            model="claude-opus-4-5",
            max_tokens=600,
            system=system,
            messages=[{"role": "user", "content": req.prompt}]
        )
        raw = msg.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"): raw = raw[4:]
        raw = raw.strip()
        parsed = json.loads(raw)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=422, detail=f"AI returned invalid JSON: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI error: {e}")

    # User overrides
    if req.tickers:  parsed["tickers"]  = [t.upper() for t in req.tickers]
    if req.universe: parsed["universe"] = req.universe

    valid_keys = StockScreenerRequest.model_fields.keys()
    stock_req  = StockScreenerRequest(**{k: v for k, v in parsed.items() if k in valid_keys})
    result     = run_stock_screener(stock_req)
    result["ai_filters"] = parsed
    result["ai_prompt"]  = req.prompt
    return result


@app.get("/api/screener/stocks/universes")
def get_universes():
    """Returns available stock universes."""
    return {
        "universes": [
            {"id": "usa",          "label": "USA (broad)",       "count": len(STOCK_UNIVERSES["usa"])},
            {"id": "mag7",         "label": "Magnificent 7",     "count": len(STOCK_UNIVERSES["mag7"])},
            {"id": "etfs",         "label": "Major ETFs",        "count": len(STOCK_UNIVERSES["etfs"])},
            {"id": "meme",         "label": "High Beta / Meme",  "count": len(STOCK_UNIVERSES["meme"])},
        ]
    }



# ── Strategies endpoints ──────────────────────────────────────────────────────

@app.get("/api/strategies")
def get_strategies():
    """List all strategies."""
    return {"strategies": _load_strategies()}


class StrategyCreate(BaseModel):
    name:        str
    description: Optional[str] = ""
    params:      Optional[dict] = None
    universe:    Optional[str]  = "sp500"


@app.post("/api/strategies")
def create_strategy(body: StrategyCreate):
    """Create a new custom strategy (cloned from pilot defaults if no params given)."""
    strategies = _load_strategies()
    import uuid, time
    new_id  = "strat_" + str(int(time.time()))
    default_params = PILOT_STRATEGY["params"].copy()
    new_strat = {
        "id":          new_id,
        "name":        body.name.strip(),
        "description": body.description or "",
        "version":     1,
        "params":      body.params or default_params,
        "universe":    body.universe or "sp500",
        "locked":      False,
    }
    strategies.append(new_strat)
    _save_strategies(strategies)
    return {"strategy": new_strat}


@app.patch("/api/strategies/{strategy_id}")
def update_strategy(strategy_id: str, body: StrategyCreate):
    """Update a strategy (cannot modify locked built-ins)."""
    strategies = _load_strategies()
    for s in strategies:
        if s["id"] == strategy_id:
            if s.get("locked"):
                raise HTTPException(status_code=400, detail="Built-in strategies cannot be modified. Clone it first.")
            s["name"]        = body.name.strip()
            s["description"] = body.description or s.get("description", "")
            if body.params:  s["params"]   = body.params
            if body.universe: s["universe"] = body.universe
            s["version"]     = s.get("version", 1) + 1
            _save_strategies(strategies)
            return {"strategy": s}
    raise HTTPException(status_code=404, detail="Strategy not found")


@app.delete("/api/strategies/{strategy_id}")
def delete_strategy(strategy_id: str):
    """Delete a strategy (cannot delete locked built-ins)."""
    strategies = _load_strategies()
    target = next((s for s in strategies if s["id"] == strategy_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Strategy not found")
    if target.get("locked"):
        raise HTTPException(status_code=400, detail="Built-in strategies cannot be deleted.")
    strategies = [s for s in strategies if s["id"] != strategy_id]
    _save_strategies(strategies)
    return {"message": f"Deleted {strategy_id}"}


@app.post("/api/strategies/{strategy_id}/run")
def run_strategy(strategy_id: str):
    """Run a strategy against its configured universe and return results."""
    strategies = _load_strategies()
    strategy   = next((s for s in strategies if s["id"] == strategy_id), None)
    if not strategy:
        raise HTTPException(status_code=404, detail="Strategy not found")

    universe_id = strategy.get("universe", "sp500")
    tickers     = list(STOCK_UNIVERSES.get(universe_id, STOCK_UNIVERSES["sp500"]))

    result = _run_strategy(strategy, tickers)
    return {
        **result,
        "strategy_id":   strategy_id,
        "strategy_name": strategy["name"],
        "universe":      universe_id,
        "total":         len(result["results"]),
    }



# ── Debug / diagnostics ───────────────────────────────────────────────────────
@app.get("/api/debug/bars")
def debug_bars(symbols: str = "AAPL,MSFT,SPY", feed: str = "iex", lookback: int = 10):
    """
    Debug endpoint — shows exactly what bar data comes back from Alpaca
    for a few symbols, with full error details exposed.
    Hit: /api/debug/bars?symbols=AAPL,MSFT&feed=sip
    """
    from datetime import date, timedelta
    tickers = [t.strip().upper() for t in symbols.split(",") if t.strip()]
    end     = date.today()
    start   = end - timedelta(days=lookback + 10)
    results = {}

    # Test 1: multi-bar batch endpoint
    url_multi = f"{DATA_BASE_URL}/v2/stocks/bars"
    params_multi = {
        "symbols":   ",".join(tickers),
        "timeframe": "1Day",
        "start":     start.isoformat(),
        "end":       end.isoformat(),
        "limit":     500,
        "feed":      feed,
        "sort":      "asc",
    }
    try:
        r = httpx.get(url_multi, headers=_alpaca_headers(), params=params_multi, timeout=15)
        body = r.json()
        bars = body.get("bars", {})
        results["multi_bar_endpoint"] = {
            "status_code": r.status_code,
            "url":         url_multi,
            "params":      params_multi,
            "tickers_returned": list(bars.keys()),
            "bar_counts":  {t: len(v) for t, v in bars.items()},
            "sample_bar":  next(iter(bars.values()), [None])[0] if bars else None,
            "error_body":  body if r.status_code != 200 else None,
        }
    except Exception as e:
        results["multi_bar_endpoint"] = {"error": str(e)}

    # Test 2: single-ticker endpoint
    test_ticker = tickers[0]
    url_single = f"{DATA_BASE_URL}/v2/stocks/{test_ticker}/bars"
    params_single = {
        "timeframe": "1Day",
        "start":     start.isoformat(),
        "end":       end.isoformat(),
        "limit":     20,
        "feed":      feed,
        "sort":      "asc",
    }
    try:
        r = httpx.get(url_single, headers=_alpaca_headers(), params=params_single, timeout=15)
        body = r.json()
        bars = body.get("bars", [])
        results["single_bar_endpoint"] = {
            "status_code": r.status_code,
            "ticker":      test_ticker,
            "bars_returned": len(bars),
            "first_bar":   bars[0] if bars else None,
            "last_bar":    bars[-1] if bars else None,
            "error_body":  body if r.status_code != 200 else None,
        }
    except Exception as e:
        results["single_bar_endpoint"] = {"error": str(e)}

    # Test 3: snapshot endpoint (for comparison — live quote data)
    url_snap = f"{DATA_BASE_URL}/v2/stocks/snapshots"
    try:
        r = httpx.get(url_snap, headers=_alpaca_headers(),
                      params={"symbols": ",".join(tickers[:3]), "feed": feed}, timeout=15)
        body = r.json()
        results["snapshot_endpoint"] = {
            "status_code":      r.status_code,
            "tickers_returned": list(body.keys()) if isinstance(body, dict) else [],
            "sample":           next(iter(body.values()), None) if isinstance(body, dict) else body,
        }
    except Exception as e:
        results["snapshot_endpoint"] = {"error": str(e)}

    # Test 4: check what feed options exist (try sip vs iex)
    feed_tests = {}
    for test_feed in ["sip", "iex"]:
        try:
            r = httpx.get(
                f"{DATA_BASE_URL}/v2/stocks/{test_ticker}/bars",
                headers=_alpaca_headers(),
                params={"timeframe":"1Day","start":str(end-timedelta(days=5)),"end":str(end),"limit":5,"feed":test_feed},
                timeout=10,
            )
            body = r.json()
            bars = body.get("bars",[])
            feed_tests[test_feed] = {"status": r.status_code, "bars": len(bars), "error": body.get("message") if r.status_code!=200 else None}
        except Exception as e:
            feed_tests[test_feed] = {"error": str(e)}
    results["feed_comparison"] = feed_tests

    return results


@app.get("/api/debug/screener-trace")
def debug_screener_trace(symbols: str = "AAPL,MSFT", feed: str = "iex"):
    """
    Runs the full indicator pipeline on a few stocks and returns raw indicator
    values so you can see exactly what was computed and what filters would catch.
    """
    from datetime import date, timedelta
    tickers = [t.strip().upper() for t in symbols.split(",") if t.strip()]

    # Force sip feed for this trace
    end   = date.today()
    start = end - timedelta(days=120)  # enough for SMA50 + most indicators
    url   = f"{DATA_BASE_URL}/v2/stocks/bars"
    params = {"symbols": ",".join(tickers), "timeframe": "1Day",
              "start": start.isoformat(), "end": end.isoformat(),
              "limit": 500, "feed": feed, "sort": "asc"}

    try:
        r    = httpx.get(url, headers=_alpaca_headers(), params=params, timeout=20)
        raw  = r.json()
        bars_map = raw.get("bars", {})
        if r.status_code != 200:
            return {"error": raw, "status": r.status_code}
    except Exception as e:
        return {"error": str(e)}

    trace = {}
    for ticker in tickers:
        bars = bars_map.get(ticker, [])
        trace[ticker] = {
            "bars_fetched": len(bars),
            "date_range":   f"{bars[0].get('t','?')[:10]} → {bars[-1].get('t','?')[:10]}" if bars else "none",
        }
        if bars:
            ind = _compute_indicators(bars)
            trace[ticker]["indicators"] = ind
        else:
            trace[ticker]["indicators"] = None

    return {"trace": trace, "feed_used": feed}


# ── Chart bar data ────────────────────────────────────────────────────────────
@app.get("/api/chart/bars")
def get_chart_bars(symbol: str, lookback_days: int = 365, timeframe: str = "1Day"):
    """
    Returns OHLCV bars for chart rendering.
    timeframe: 1Day (default) | 1Week | 4Hour | 1Hour
    lookback_days is used for Daily/Weekly. Intraday uses fixed windows.
    """
    sym = symbol.upper()

    if timeframe == "1Week":
        bars = _fetch_bars_tf(sym, "1Week", lookback_days=lookback_days * 5)
        if not bars:
            # Resample daily -> weekly as fallback
            daily = _fetch_daily_bars(sym, lookback=lookback_days)
            bars  = _resample_to_weekly(daily)
    elif timeframe == "4Hour":
        bars = _fetch_intraday_bars(sym, "1Hour", lookback_days=120)
        bars = _resample_4h(bars)
    elif timeframe == "1Hour":
        bars = _fetch_intraday_bars(sym, "1Hour", lookback_days=90)
    else:  # 1Day default
        bars = _fetch_daily_bars(sym, lookback=lookback_days)

    if not bars:
        raise HTTPException(status_code=404, detail=f"No bar data found for {sym}")
    return bars


# ── Earnings date endpoint ─────────────────────────────────────────────────────
_earnings_cache: dict = {}
_EARNINGS_CACHE_TTL_HOURS = 6

# Hardcoded fallback — Q1 2026 earnings dates for common watchlist tickers
# Update each quarter. Source: earningswhispers.com / stockanalysis.com
_EARNINGS_FALLBACK: dict[str, str] = {
    # March 2026
    "ORCL":  "2026-03-10",
    "ADBE":  "2026-03-18",
    # April 2026
    "JPM":   "2026-04-14",
    "WFC":   "2026-04-14",
    "GS":    "2026-04-14",
    "BAC":   "2026-04-15",
    "MS":    "2026-04-16",
    "NFLX":  "2026-04-16",
    "TSM":   "2026-04-17",
    "ASML":  "2026-04-15",
    "UNH":   "2026-04-15",
    "JNJ":   "2026-04-15",
    "ABBV":  "2026-04-24",
    "PG":    "2026-04-24",
    "V":     "2026-04-28",
    "MA":    "2026-04-29",
    "MSFT":  "2026-04-29",
    "META":  "2026-04-29",
    "GOOGL": "2026-04-28",
    "GOOG":  "2026-04-28",
    "AMZN":  "2026-04-30",
    "AAPL":  "2026-04-30",
    "AMD":   "2026-04-28",
    "QCOM":  "2026-04-29",
    "INTC":  "2026-04-23",
    "IBM":   "2026-04-22",
    "TSLA":  "2026-04-22",
    "GE":    "2026-04-22",
    "XOM":   "2026-05-01",
    "CVX":   "2026-05-01",
    # May 2026
    "NVDA":  "2026-05-28",
    "AVGO":  "2026-06-04",
    "CRM":   "2026-05-27",
    "NOW":   "2026-04-23",
    "CRWD":  "2026-06-03",
    "PLTR":  "2026-05-05",
    "HOOD":  "2026-04-30",
    "SOFI":  "2026-04-28",
    "MARA":  "2026-05-11",
    "DELL":  "2026-05-28",
    "WMT":   "2026-05-19",
    "CSCO":  "2026-05-13",
    "ORCL":  "2026-03-10",
    # Index ETFs — no earnings
    "SPY": None, "QQQ": None, "IWM": None, "DIA": None,
    "TQQQ": None, "SQQQ": None, "UVXY": None, "VIX": None,
}

def _fallback_earn(sym: str) -> dict | None:
    """Return earnings from hardcoded calendar, or None if not present / in the past."""
    if sym not in _EARNINGS_FALLBACK:
        return None
    d = _EARNINGS_FALLBACK[sym]
    if d is None:
        return None
    ed = date.fromisoformat(d)
    da = (ed - date.today()).days
    if da >= -1:
        return {"date": d, "days_away": max(da, 0)}
    return None

def _try_stockanalysis(sym: str, client: httpx.Client) -> dict | None:
    """Scrape next earnings date from stockanalysis.com — no auth required."""
    try:
        url = f"https://stockanalysis.com/stocks/{sym.lower()}/"
        r = client.get(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "text/html",
        })
        print(f"[earnings] {sym} stockanalysis -> {r.status_code}")
        if r.status_code != 200:
            return None
        html = r.text

        # Strategy 1: look for earningsDate in Next.js __NEXT_DATA__ JSON blob
        next_data = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.DOTALL)
        if next_data:
            try:
                blob = json.loads(next_data.group(1))
                # Walk the JSON looking for earningsDate key
                blob_str = json.dumps(blob)
                ed_match = re.search(r'"earningsDate"\s*:\s*"(\d{4}-\d{2}-\d{2})"', blob_str)
                if ed_match:
                    ed = date.fromisoformat(ed_match.group(1))
                    da = (ed - date.today()).days
                    if da >= -1:
                        print(f"[earnings] {sym} NEXT_DATA earningsDate: {ed}")
                        return {"date": ed.strftime("%Y-%m-%d"), "days_away": max(da, 0)}
                # Also look for nextEarningsDate
                ne_match = re.search(r'"nextEarningsDate"\s*:\s*"(\d{4}-\d{2}-\d{2})"', blob_str)
                if ne_match:
                    ed = date.fromisoformat(ne_match.group(1))
                    da = (ed - date.today()).days
                    if da >= -1:
                        print(f"[earnings] {sym} NEXT_DATA nextEarningsDate: {ed}")
                        return {"date": ed.strftime("%Y-%m-%d"), "days_away": max(da, 0)}
            except Exception as e:
                print(f"[earnings] {sym} NEXT_DATA parse error: {e}")

        # Strategy 2: look for date only in a narrow window around "Earnings Date" text
        earn_section = re.search(r'[Ee]arnings\s*[Dd]ate.{0,200}?(\d{4}-\d{2}-\d{2})', html, re.DOTALL)
        if earn_section:
            ed = date.fromisoformat(earn_section.group(1))
            da = (ed - date.today()).days
            if -1 <= da <= 365:
                print(f"[earnings] {sym} section match: {ed}")
                return {"date": ed.strftime("%Y-%m-%d"), "days_away": max(da, 0)}

        print(f"[earnings] {sym} stockanalysis: no earnings date found in page")
    except Exception as e:
        print(f"[earnings] {sym} stockanalysis error: {e}")
    return None

@app.get("/api/earnings")
def get_earnings(symbol: str):
    """
    Returns next earnings date for a stock ticker.
    Tries Yahoo v11, v10, and v7/quote in sequence.
    Cached per ticker for 6 hours.
    Response: { date: "YYYY-MM-DD" | null, days_away: int | null }
    """
    sym = symbol.upper()
    now = datetime.now()

    if sym in _earnings_cache:
        entry = _earnings_cache[sym]
        age_hours = (now - entry["fetched_at"]).total_seconds() / 3600
        if age_hours < _EARNINGS_CACHE_TTL_HOURS:
            return {"date": entry["date"], "days_away": entry["days_away"]}

    result = {"date": None, "days_away": None}
    with httpx.Client(timeout=10, follow_redirects=True) as client:
        found = (_try_stockanalysis(sym, client)
              or _fallback_earn(sym))
        if found:
            result = found
            print(f"[earnings] {sym} final -> {result}")
        else:
            print(f"[earnings] {sym} all sources returned null")

    _earnings_cache[sym] = {"fetched_at": now, **result}
    return result


def _fetch_bars_tf(ticker: str, timeframe: str, lookback_days: int = 365) -> list:
    """Fetch bars for a given Alpaca timeframe string (1Day, 1Week, etc.)"""
    end   = date.today()
    start = end - timedelta(days=lookback_days + 30)
    url   = f"{DATA_BASE_URL}/v2/stocks/{ticker}/bars"
    for feed in ("sip", "iex"):
        try:
            resp = httpx.get(url, headers=_alpaca_headers(), params={
                "timeframe": timeframe, "start": start.isoformat(),
                "end": end.isoformat(), "limit": lookback_days + 30,
                "feed": feed, "sort": "asc",
            }, timeout=15)
            if resp.status_code == 403:
                continue
            resp.raise_for_status()
            return resp.json().get("bars", [])
        except Exception:
            continue
    return []


def _fetch_intraday_bars(ticker: str, timeframe: str, lookback_days: int = 90) -> list:
    """Fetch intraday bars (1Hour etc.) from Alpaca, market hours only."""
    from datetime import datetime, timezone
    end   = datetime.now(timezone.utc)
    start = end - timedelta(days=lookback_days)
    url   = f"{DATA_BASE_URL}/v2/stocks/{ticker}/bars"
    all_bars = []
    page_token = None
    for feed in ("sip", "iex"):
        try:
            while True:
                params = {
                    "timeframe": timeframe,
                    "start":     start.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "end":       end.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "limit":     10000, "feed": feed, "sort": "asc",
                }
                if page_token:
                    params["page_token"] = page_token
                resp = httpx.get(url, headers=_alpaca_headers(), params=params, timeout=20)
                if resp.status_code == 403:
                    all_bars = []
                    break
                resp.raise_for_status()
                data = resp.json()
                all_bars.extend(data.get("bars", []))
                page_token = data.get("next_page_token")
                if not page_token:
                    break
            if all_bars:
                return all_bars
        except Exception:
            all_bars = []
            page_token = None
            continue
    return []


def _resample_to_weekly(daily_bars: list) -> list:
    """Resample daily bars into ISO-week weekly bars (Mon–Fri)."""
    from collections import defaultdict
    weeks: dict = defaultdict(list)
    for b in daily_bars:
        t = b.get("t", "")[:10]
        try:
            d   = date.fromisoformat(t)
            mon = d - timedelta(days=d.weekday())  # Monday of that week
            weeks[mon.isoformat()].append(b)
        except Exception:
            continue
    result = []
    for week_start in sorted(weeks):
        wbars = weeks[week_start]
        result.append({
            "t": week_start + "T00:00:00Z",
            "o": wbars[0]["o"],
            "h": max(b["h"] for b in wbars),
            "l": min(b["l"] for b in wbars),
            "c": wbars[-1]["c"],
            "v": sum(b.get("v", 0) for b in wbars),
        })
    return result


def _resample_4h(hourly_bars: list) -> list:
    """Resample 1-hour bars into 4-hour bars (09:30, 13:30 ET buckets)."""
    from collections import defaultdict
    import pytz
    ET = pytz.timezone("America/New_York")
    buckets: dict = defaultdict(list)
    for b in hourly_bars:
        t_str = b.get("t", "")
        try:
            from datetime import datetime
            # Parse ISO timestamp
            if t_str.endswith("Z"):
                t_str = t_str[:-1] + "+00:00"
            dt_utc = datetime.fromisoformat(t_str)
            dt_et  = dt_utc.astimezone(ET)
            # 4-hour buckets: 09:30–13:29 -> 09:30, 13:30–17:29 -> 13:30
            hour = dt_et.hour + dt_et.minute / 60
            if 9.5 <= hour < 13.5:
                bucket_h = 9
                bucket_m = 30
            else:
                bucket_h = 13
                bucket_m = 30
            key = dt_et.replace(hour=bucket_h, minute=bucket_m, second=0, microsecond=0)
            buckets[key].append(b)
        except Exception:
            continue
    result = []
    for key in sorted(buckets):
        bs = buckets[key]
        result.append({
            "t": key.isoformat(),
            "o": bs[0]["o"],
            "h": max(x["h"] for x in bs),
            "l": min(x["l"] for x in bs),
            "c": bs[-1]["c"],
            "v": sum(x.get("v", 0) for x in bs),
        })
    return result



# ── Signal detection for plans ────────────────────────────────────────────────
@app.get("/api/plans/signals")
def get_plan_signals():
    """
    For each active plan, fetch intraday 5-min bars and detect the first
    qualified candle signal (first green bar for LONG, first red for SHORT).
    Returns signal level, current stock price, and whether entry condition is met.
    """
    plans = _load_plans()
    if not plans:
        return {"signals": []}

    results = []
    for plan in plans:
        ticker    = plan.get("ticker", "").upper()
        direction = plan.get("type", "LONG")
        try:
            # Get latest stock price from snapshot
            snap_data = _get_stock_snapshot([ticker])
            snap      = snap_data.get(ticker, {})
            cur_price = None
            try:
                cur_price = snap.get("latestTrade", {}).get("p") or snap.get("latestQuote", {}).get("ap")
                if cur_price: cur_price = round(float(cur_price), 2)
            except Exception:
                pass

            # Fetch intraday 1-min bars and resample to 5-min
            from datetime import date, datetime, timezone
            import pandas as pd

            today_str = date.today().isoformat()
            url_bars  = f"{DATA_BASE_URL}/v2/stocks/{ticker}/bars"
            params    = {
                "timeframe":  "5Min",
                "start":      f"{today_str}T09:30:00-04:00",
                "end":        f"{today_str}T16:00:00-04:00",
                "feed":       "iex",
                "limit":      100,
            }
            resp = httpx.get(url_bars, headers=_alpaca_headers(), params=params, timeout=15)
            bars_data = resp.json().get("bars", []) if resp.status_code == 200 else []

            signal_level  = None
            signal_time   = None
            qualified     = False
            entry_met     = False

            if bars_data:
                for bar in bars_data:
                    o, c = bar.get("o", 0), bar.get("c", 0)
                    if direction == "LONG"  and c > o:
                        signal_level = round(float(bar.get("h", 0)), 2)
                        signal_time  = bar.get("t", "")
                        qualified    = True
                        break
                    elif direction == "SHORT" and c < o:
                        signal_level = round(float(bar.get("l", 0)), 2)
                        signal_time  = bar.get("t", "")
                        qualified    = True
                        break

            if qualified and cur_price is not None and signal_level is not None:
                if direction == "LONG":
                    entry_met = cur_price > signal_level
                else:
                    entry_met = cur_price < signal_level

            results.append({
                "ticker":       ticker,
                "contract":     plan.get("contract", ""),
                "direction":    direction,
                "qty":          plan.get("qty", 1),
                "sl_stock":     plan.get("sl_stock"),
                "tp_stock":     plan.get("tp_stock"),
                "cur_price":    cur_price,
                "signal_level": signal_level,
                "signal_time":  signal_time,
                "qualified":    qualified,
                "entry_met":    entry_met,
            })
        except Exception as e:
            results.append({
                "ticker":    ticker,
                "contract":  plan.get("contract", ""),
                "direction": direction,
                "qty":       plan.get("qty", 1),
                "sl_stock":  plan.get("sl_stock"),
                "tp_stock":  plan.get("tp_stock"),
                "error":     str(e),
                "qualified": False,
                "entry_met": False,
            })

    return {"signals": results}


# ── Market Overview ────────────────────────────────────────────────────────────
@app.get("/api/overview")
def get_overview():
    """
    Returns snapshot data for key market indices + a computed sentiment score.
    Symbols: SPY (S&P500), QQQ (Nasdaq), IWM (Russell 2000), DIA (Dow).
    VIX is not available via Alpaca so we approximate fear via SPY 20d volatility.
    """
    from datetime import date, timedelta
    import statistics, math

    SYMBOLS = ["SPY", "QQQ", "IWM", "DIA"]

    # ── Latest quotes ──────────────────────────────────────────────────────────
    try:
        snaps = _get_stock_snapshot(SYMBOLS)
    except Exception:
        snaps = {}

    def _snap_price(sym):
        s = snaps.get(sym, {})
        try:
            p = s.get("latestTrade", {}).get("p") or s.get("latestQuote", {}).get("ap")
            return round(float(p), 2) if p else None
        except Exception:
            return None

    def _snap_prev_close(sym):
        s = snaps.get(sym, {})
        try:
            p = s.get("prevDailyBar", {}).get("c") or s.get("dailyBar", {}).get("o")
            return round(float(p), 2) if p else None
        except Exception:
            return None

    indices = []
    for sym in SYMBOLS:
        price      = _snap_price(sym)
        prev_close = _snap_prev_close(sym)
        chg        = round(price - prev_close, 2)          if price and prev_close else None
        chg_pct    = round((chg / prev_close) * 100, 2)    if chg and prev_close  else None
        indices.append({
            "symbol":    sym,
            "price":     price,
            "prev_close":prev_close,
            "chg":       chg,
            "chg_pct":   chg_pct,
        })

    # ── SPY 20-day daily bars for SMA + volatility ─────────────────────────────
    spy_bars = []
    try:
        end_dt   = date.today()
        start_dt = end_dt - timedelta(days=220)  # enough for SMA200
        url      = f"{DATA_BASE_URL}/v2/stocks/SPY/bars"
        params   = {"timeframe":"1Day","start":start_dt.isoformat(),"end":end_dt.isoformat(),"feed":"iex","limit":300,"sort":"asc"}
        resp     = httpx.get(url, headers=_alpaca_headers(), params=params, timeout=20)
        if resp.status_code == 200:
            spy_bars = resp.json().get("bars", [])
    except Exception:
        pass

    closes = [b["c"] for b in spy_bars if b.get("c")]

    def sma(closes, n):
        if len(closes) < n: return None
        return round(sum(closes[-n:]) / n, 2)

    sma10  = sma(closes, 10)
    sma20  = sma(closes, 20)
    sma50  = sma(closes, 50)
    sma200 = sma(closes, 200)

    # Realized 20-day annualised volatility (proxy for fear)
    vol_pct = None
    if len(closes) >= 21:
        rets = [math.log(closes[i]/closes[i-1]) for i in range(len(closes)-20, len(closes))]
        try:
            vol_pct = round(statistics.stdev(rets) * math.sqrt(252) * 100, 1)
        except Exception:
            pass

    spy_price = closes[-1] if closes else _snap_price("SPY")

    # ── Sentiment score 0-100 ──────────────────────────────────────────────────
    # Composed of 4 signals, each 0-25 pts:
    # 1. SPY vs SMA200 (trend)
    # 2. SPY vs SMA50  (medium trend)
    # 3. 20d momentum (SPY return)
    # 4. Volatility (inverse — low vol = calm = bullish)
    score = 50  # neutral default
    signals = []

    if spy_price and sma200:
        above = spy_price > sma200
        pts   = 25 if above else 0
        score += pts - 12.5
        signals.append({"label":"vs SMA 200","value":f"{'Above' if above else 'Below'} ${sma200}","bullish":above})

    if spy_price and sma50:
        above = spy_price > sma50
        pts   = 25 if above else 0
        score += pts - 12.5
        signals.append({"label":"vs SMA 50","value":f"{'Above' if above else 'Below'} ${sma50}","bullish":above})

    if len(closes) >= 20:
        mom = round((closes[-1] - closes[-20]) / closes[-20] * 100, 2)
        pts = min(max((mom + 10) / 20 * 25, 0), 25)  # map -10% to +10% → 0 to 25
        score += pts - 12.5
        signals.append({"label":"20d Momentum","value":f"{'+' if mom>0 else ''}{mom}%","bullish":mom>0})

    if vol_pct is not None:
        # low vol (<12%) = bullish, high vol (>30%) = bearish
        pts = min(max((30 - vol_pct) / 18 * 25, 0), 25)
        score += pts - 12.5
        signals.append({"label":"Realized Vol (20d)","value":f"{vol_pct}% ann.","bullish":vol_pct < 18})

    score = round(min(max(score, 0), 100), 1)

    if score >= 70:   sentiment = "Greed"
    elif score >= 55: sentiment = "Mild Greed"
    elif score >= 45: sentiment = "Neutral"
    elif score >= 30: sentiment = "Mild Fear"
    else:             sentiment = "Fear"

    return {
        "indices":     indices,
        "sma":         {"sma10":sma10,"sma20":sma20,"sma50":sma50,"sma200":sma200},
        "vol_pct":     vol_pct,
        "sentiment":   sentiment,
        "score":       score,
        "signals":     signals,
        "spy_bars_count": len(spy_bars),
    }

# ── Debug: raw option chain response ──────────────────────────────────────────
@app.get("/api/debug/option-chain")
def debug_option_chain(symbol: str = "AAPL", expiry: str = ""):
    """Returns raw Alpaca option snapshot response for debugging field names."""
    url = f"{DATA_BASE_URL}/v1beta1/options/snapshots/{symbol.upper()}"
    params = {"feed": "indicative", "limit": 3}
    if expiry: params["expiration_date"] = expiry
    try:
        resp = httpx.get(url, headers=_alpaca_headers(), params=params, timeout=15)
        raw  = resp.json()
        # Show first snapshot in full so we can see the exact field structure
        snaps = raw.get("snapshots", {})
        first_key = next(iter(snaps), None)
        return {
            "status":      resp.status_code,
            "symbol_count": len(snaps),
            "first_symbol": first_key,
            "first_snapshot": snaps.get(first_key),
            "all_keys": list(snaps.keys())[:5],
        }
    except Exception as e:
        return {"error": str(e)}

# ═══════════════════════════════════════════════════════════════════════════════
# ── Bull Call Spread Strategy ──────────────────────────────────────────────────
# ═══════════════════════════════════════════════════════════════════════════════

BCS_SETTINGS_FILE = BOT_DIR / "bcs_settings.json"
BCS_STATE_FILE    = BOT_DIR / "bcs_state.json"


class BullCallSpreadSettings(BaseModel):
    enabled:           bool  = True
    # Stock universe / price filter
    universe:          str   = "usa"
    price_min:         float = 50.0
    price_max:         float = 200.0
    # Spread construction
    spread_width_pct:  float = 0.075   # short strike = stock * (1 + this)
    # DTE targeting
    dte_min:           int   = 30
    dte_max:           int   = 45
    prefer_monthly:    bool  = True    # prefer 3rd-Friday monthly expirations
    # Risk management
    max_debit_pct:     float = 0.02    # max % of portfolio value per spread
    qty:               int   = 1       # contracts per spread
    # Exit rules
    profit_target_pct: float = 0.50   # close when gain ≥ 50 % of debit paid
    stop_loss_pct:     float = 0.50   # close when loss ≥ 50 % of debit paid
    time_stop_dte:     int   = 21     # close when DTE reaches this value
    # Bot poll cadence
    poll_seconds:      int   = 300


# ── BCS file helpers ───────────────────────────────────────────────────────────

def _load_bcs_settings() -> dict:
    if not BCS_SETTINGS_FILE.exists():
        return BullCallSpreadSettings().model_dump()
    try:
        return json.loads(BCS_SETTINGS_FILE.read_text())
    except Exception:
        return BullCallSpreadSettings().model_dump()


def _save_bcs_settings(s: dict):
    BCS_SETTINGS_FILE.write_text(json.dumps(s, indent=2))


def _load_bcs_state() -> dict:
    if not BCS_STATE_FILE.exists():
        return {"positions": []}
    try:
        return json.loads(BCS_STATE_FILE.read_text())
    except Exception:
        return {"positions": []}


def _save_bcs_state(state: dict):
    tmp = str(BCS_STATE_FILE) + ".tmp"
    Path(tmp).write_text(json.dumps(state, indent=2))
    os.replace(tmp, BCS_STATE_FILE)


# ── BCS strategy helpers ───────────────────────────────────────────────────────

def _bcs_is_bullish_trend(bars: list) -> bool:
    """
    Returns True when the stock satisfies all three bullish-trend conditions:
      1. Current close > SMA20
      2. Current close > SMA50
      3. The most recent 10-day window shows a higher high AND a higher low
         compared with the prior 10-day window  (= making HH/HL on daily chart).
    """
    if len(bars) < 55:
        return False

    closes = [b["c"] for b in bars]
    sma20_vals = _sma(closes, 20)
    sma50_vals = _sma(closes, 50)

    def last(lst):
        return next((v for v in reversed(lst) if v is not None), None)

    sma20 = last(sma20_vals)
    sma50 = last(sma50_vals)
    price = closes[-1]

    if sma20 is None or sma50 is None:
        return False
    if price <= sma20 or price <= sma50:
        return False

    # Higher-highs / higher-lows via 10-bar rolling windows
    recent_high = max(b["h"] for b in bars[-10:])
    recent_low  = min(b["l"] for b in bars[-10:])
    prior_high  = max(b["h"] for b in bars[-20:-10])
    prior_low   = min(b["l"] for b in bars[-20:-10])

    return recent_high > prior_high and recent_low > prior_low


def _bcs_detect_entry_trigger(bars: list) -> tuple:
    """
    Detects: pullback to SMA20 support  →  red candle at support  →  green bounce
    with above-average volume on the bounce candle.

    Looks back up to 3 bars for the red/green pair so the scan isn't strictly
    limited to "yesterday was red, today is green."

    Returns (triggered: bool, details: dict | None).
    """
    if len(bars) < 25:
        return False, None

    closes  = [b["c"] for b in bars]
    volumes = [b["v"] for b in bars]

    sma20_vals = _sma(closes, 20)

    def last(lst):
        return next((v for v in reversed(lst) if v is not None), None)

    sma20 = last(sma20_vals)
    if sma20 is None:
        return False, None

    avg_vol = sum(volumes[-21:-1]) / 20 if len(volumes) >= 21 else sum(volumes) / max(len(volumes), 1)

    # Slide the window: red_bar = bars[-lookback-1], green_bar = bars[-lookback]
    for lookback in range(1, 4):
        if lookback + 1 > len(bars):
            continue
        red_bar   = bars[-(lookback + 1)]
        green_bar = bars[-lookback]

        is_red   = red_bar["c"]   < red_bar["o"]
        is_green = green_bar["c"] > green_bar["o"]
        if not (is_red and is_green):
            continue

        # Red candle low within 3 % of SMA20 = "touching support"
        near_support  = abs(red_bar["l"] - sma20) / sma20 <= 0.03
        strong_volume = green_bar.get("v", 0) > avg_vol

        if near_support and strong_volume:
            return True, {
                "red_candle":  {
                    "date":  red_bar.get("t", "")[:10],
                    "open":  red_bar["o"],
                    "close": red_bar["c"],
                    "low":   red_bar["l"],
                },
                "green_candle": {
                    "date":   green_bar.get("t", "")[:10],
                    "open":   green_bar["o"],
                    "close":  green_bar["c"],
                    "volume": green_bar["v"],
                },
                "sma20":      round(sma20, 2),
                "avg_volume": round(avg_vol),
            }

    return False, None


def _bcs_find_expiry(dte_min: int, dte_max: int, prefer_monthly: bool) -> str:
    """
    Return an expiry date string (YYYY-MM-DD) that falls inside [dte_min, dte_max].
    When prefer_monthly is True, tries to land on the 3rd Friday of each month
    before falling back to exactly dte_min days out.
    """
    from datetime import timedelta
    today    = date.today()
    min_date = today + timedelta(days=dte_min)
    max_date = today + timedelta(days=dte_max)

    if prefer_monthly:
        for month_offset in range(4):
            ref   = today + timedelta(days=month_offset * 30)
            first = ref.replace(day=1)
            # Weekday of the 1st: 0=Mon … 4=Fri … 6=Sun
            days_to_friday = (4 - first.weekday()) % 7
            first_friday   = first + timedelta(days=days_to_friday)
            third_friday   = first_friday + timedelta(weeks=2)
            if min_date <= third_friday <= max_date:
                return third_friday.isoformat()

    return min_date.isoformat()


def _bcs_find_strikes(chain: list, stock_price: float, spread_width_pct: float) -> tuple:
    """
    From a list of call option contracts (single expiry), pick:
      long  strike → ATM  (closest to stock_price)
      short strike → closest to stock_price * (1 + spread_width_pct), must be > long

    Returns (long_contract_dict, short_contract_dict) or (None, None) on failure.
    """
    calls = [c for c in chain if c.get("type") == "call" and c.get("strike") is not None]
    if not calls:
        return None, None

    calls.sort(key=lambda c: c["strike"])
    long_item    = min(calls, key=lambda c: abs(c["strike"] - stock_price))
    short_target = stock_price * (1.0 + spread_width_pct)
    short_item   = min(calls, key=lambda c: abs(c["strike"] - short_target))

    # Guarantee short strike is strictly above long strike
    if short_item["strike"] <= long_item["strike"]:
        above = [c for c in calls if c["strike"] > long_item["strike"]]
        if not above:
            return long_item, None
        short_item = above[0]

    return long_item, short_item


def _bcs_net_debit(long_item: dict, short_item: dict) -> Optional[float]:
    """
    Worst-case net debit per share = long ask − short bid.
    Falls back to mid-price difference when bid/ask are unavailable.
    """
    long_ask  = long_item.get("ask")
    short_bid = short_item.get("bid")
    if long_ask is not None and short_bid is not None:
        return round(long_ask - short_bid, 2)
    # mid fallback
    lm = long_item.get("mid")
    sm = short_item.get("mid")
    if lm is not None and sm is not None:
        return round(lm - sm, 2)
    return None


def _bcs_scan(settings: dict, tickers_override: Optional[List[str]] = None) -> dict:
    """
    Full scanner:
      1. Pull daily bars for the chosen universe (or tickers_override list).
      2. Filter by price range, bullish trend, and entry trigger.
      3. For each candidate, fetch the option chain and build the spread.
    Returns {"candidates": [...], "scanned": N, "matched": N, ...}.
    """
    universe         = settings.get("universe", "usa")
    price_min        = settings.get("price_min", 50.0)
    price_max        = settings.get("price_max", 200.0)
    dte_min          = settings.get("dte_min", 30)
    dte_max          = settings.get("dte_max", 45)
    prefer_monthly   = settings.get("prefer_monthly", True)
    spread_width_pct = settings.get("spread_width_pct", 0.075)
    qty              = settings.get("qty", 1)

    if tickers_override:
        tickers = [t.upper().strip() for t in tickers_override if t.strip()]
    else:
        tickers = list(STOCK_UNIVERSES.get(universe, STOCK_UNIVERSES["usa"]))
    bars_map      = _fetch_multi_bars(tickers, 120)
    target_expiry = _bcs_find_expiry(dte_min, dte_max, prefer_monthly)

    candidates, errors = [], []

    for ticker in tickers:
        bars = bars_map.get(ticker, [])
        if len(bars) < 55:
            continue

        price = bars[-1]["c"]
        if not (price_min <= price <= price_max):
            continue

        if not _bcs_is_bullish_trend(bars):
            continue

        triggered, trigger_details = _bcs_detect_entry_trigger(bars)
        if not triggered:
            continue

        # Fetch calls for the target expiry, bracket ±15 % around current price
        try:
            chain = _get_option_chain(
                underlying=ticker,
                expiry_date=target_expiry,
                option_type="call",
                strike_gte=round(price * 0.88, 2),
                strike_lte=round(price * 1.20, 2),
            )
        except Exception as e:
            errors.append(f"{ticker}: option chain error — {e}")
            continue

        if not chain:
            errors.append(f"{ticker}: no calls found for expiry {target_expiry}")
            continue

        long_item, short_item = _bcs_find_strikes(chain, price, spread_width_pct)
        if long_item is None or short_item is None:
            errors.append(f"{ticker}: could not find suitable strikes")
            continue

        net_debit = _bcs_net_debit(long_item, short_item)
        if net_debit is None or net_debit <= 0:
            errors.append(f"{ticker}: invalid net debit ({net_debit})")
            continue

        # Liquidity check: require a valid bid/ask on both legs
        if long_item.get("bid") is None or short_item.get("ask") is None:
            errors.append(f"{ticker}: insufficient option liquidity")
            continue

        spread_width = round(short_item["strike"] - long_item["strike"], 2)
        max_gain     = round((spread_width - net_debit) * 100, 2)
        max_loss     = round(net_debit * 100, 2)
        risk_reward  = round(max_gain / max_loss, 2) if max_loss > 0 else None
        dte          = long_item.get("dte") or short_item.get("dte")

        candidates.append({
            "ticker":                  ticker,
            "price":                   round(price, 2),
            "expiry":                  target_expiry,
            "dte":                     dte,
            "long_contract":           long_item["symbol"],
            "short_contract":          short_item["symbol"],
            "long_strike":             long_item["strike"],
            "short_strike":            short_item["strike"],
            "spread_width":            spread_width,
            "long_bid":                long_item.get("bid"),
            "long_ask":                long_item.get("ask"),
            "short_bid":               short_item.get("bid"),
            "short_ask":               short_item.get("ask"),
            "net_debit":               net_debit,
            "net_debit_total":         round(net_debit * 100 * qty, 2),
            "max_gain_per_contract":   max_gain,
            "max_loss_per_contract":   max_loss,
            "risk_reward":             risk_reward,
            "long_delta":              long_item.get("delta"),
            "long_iv":                 long_item.get("iv"),
            "long_volume":             long_item.get("volume"),
            "short_volume":            short_item.get("volume"),
            "trigger":                 trigger_details,
        })

    candidates.sort(key=lambda x: x.get("risk_reward") or 0, reverse=True)
    return {
        "candidates":    candidates,
        "scanned":       len(tickers),
        "matched":       len(candidates),
        "target_expiry": target_expiry,
        "errors":        errors[:20],
    }


def _bcs_get_position_pl(pos: dict) -> dict:
    """
    Fetch current mid-prices for both legs and compute unrealised P/L.
    Returns a copy of pos enriched with current_spread_value, pl_pct,
    pl_dollars, and dte_remaining.
    """
    from datetime import timedelta

    expiry_str = pos.get("expiry", "")
    dte_remaining = None
    try:
        dte_remaining = (date.fromisoformat(expiry_str) - date.today()).days
    except Exception:
        pass

    long_contract  = pos.get("long_contract",  "")
    short_contract = pos.get("short_contract", "")
    net_debit_val  = pos.get("net_debit", 0) or 0
    qty            = pos.get("qty", 1)

    long_mid = short_mid = None
    try:
        from alpaca.data.historical import OptionHistoricalDataClient
        from alpaca.data.requests   import OptionSnapshotRequest
        opt_client = OptionHistoricalDataClient(API_KEY, API_SECRET)
        for symbol, slot in [(long_contract, "long"), (short_contract, "short")]:
            try:
                snaps = opt_client.get_option_snapshot(
                    OptionSnapshotRequest(symbol_or_symbols=[symbol])
                )
                snap = snaps.get(symbol)
                if snap and snap.latest_quote:
                    b = snap.latest_quote.bid_price
                    a = snap.latest_quote.ask_price
                    if b is not None and a is not None:
                        mid = (float(b) + float(a)) / 2
                        if slot == "long":
                            long_mid = round(mid, 3)
                        else:
                            short_mid = round(mid, 3)
            except Exception:
                pass
    except Exception:
        pass

    current_spread_value = pl_pct = pl_dollars = None
    if long_mid is not None and short_mid is not None:
        current_spread_value = round(long_mid - short_mid, 3)
        if net_debit_val > 0:
            pl_pct     = round((current_spread_value - net_debit_val) / net_debit_val, 4)
            pl_dollars = round((current_spread_value - net_debit_val) * 100 * qty, 2)

    return {
        **pos,
        "current_long_mid":     long_mid,
        "current_short_mid":    short_mid,
        "current_spread_value": current_spread_value,
        "pl_pct":               pl_pct,
        "pl_dollars":           pl_dollars,
        "dte_remaining":        dte_remaining,
    }


def _bcs_check_exit(pos_pl: dict, settings: dict) -> Optional[str]:
    """
    Evaluate the three exit rules against a position that already has P/L data.
    Returns a human-readable reason string, or None if no exit is warranted.
    """
    profit_target = settings.get("profit_target_pct", 0.50)
    stop_loss     = settings.get("stop_loss_pct",     0.50)
    time_stop     = settings.get("time_stop_dte",     21)

    pl_pct        = pos_pl.get("pl_pct")
    dte_remaining = pos_pl.get("dte_remaining")

    if pl_pct is not None and pl_pct >= profit_target:
        return f"profit_target (+{round(pl_pct * 100, 1)}% ≥ +{int(profit_target * 100)}%)"
    if pl_pct is not None and pl_pct <= -stop_loss:
        return f"stop_loss ({round(pl_pct * 100, 1)}% ≤ -{int(stop_loss * 100)}%)"
    if dte_remaining is not None and dte_remaining <= time_stop:
        return f"time_stop ({dte_remaining} DTE ≤ {time_stop} DTE)"
    return None


def _bcs_close_spread(pos: dict, trading_client) -> dict:
    """
    Place market orders to close both legs:
      - Sell-to-close the long call
      - Buy-to-close the short call
    """
    from alpaca.trading.requests import MarketOrderRequest
    from alpaca.trading.enums    import OrderSide, TimeInForce

    errors, submitted = [], []
    qty = pos.get("qty", 1)

    for symbol, side, label in [
        (pos["long_contract"],  OrderSide.SELL, "long"),
        (pos["short_contract"], OrderSide.BUY,  "short"),
    ]:
        try:
            trading_client.submit_order(MarketOrderRequest(
                symbol=symbol,
                qty=qty,
                side=side,
                time_in_force=TimeInForce.DAY,
            ))
            submitted.append(label)
        except Exception as e:
            errors.append(f"close {label} ({symbol}): {e}")

    return {"success": len(errors) == 0, "submitted": submitted, "errors": errors}


# ── BCS API endpoints ──────────────────────────────────────────────────────────

@app.get("/api/bcs/settings")
def get_bcs_settings():
    """Return current bull call spread strategy parameters."""
    return _load_bcs_settings()


@app.post("/api/bcs/settings")
def save_bcs_settings(settings: BullCallSpreadSettings):
    """Persist bull call spread strategy parameters."""
    data = settings.model_dump()
    _save_bcs_settings(data)
    return {"message": "BCS settings saved.", **data}


class BCSScanRequest(BaseModel):
    tickers: Optional[List[str]] = None   # when set, scan only these tickers


@app.post("/api/bcs/scan")
def run_bcs_scan(req: Optional[BCSScanRequest] = None):
    """
    Scan for bull call spread entry candidates.
    Optional body: {"tickers": ["AAPL", "NVDA", ...]} to scope the scan to a
    specific list (e.g. the Screener watchlist).  Omit the body to scan the
    full universe defined in BCS settings.
    """
    settings = _load_bcs_settings()
    override = (req.tickers if req and req.tickers else None)
    try:
        result = _bcs_scan(settings, tickers_override=override)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"BCS scan error: {e}")
    return result


@app.get("/api/bcs/positions")
def get_bcs_positions():
    """
    Return all open BCS positions enriched with live P/L data and
    exit-condition flags so the dashboard can display them correctly.
    """
    state    = _load_bcs_state()
    settings = _load_bcs_settings()
    open_pos = [p for p in state.get("positions", []) if p.get("status") == "open"]

    enriched = []
    for pos in open_pos:
        try:
            pos_pl      = _bcs_get_position_pl(pos)
            exit_signal = _bcs_check_exit(pos_pl, settings)
            pos_pl["exit_signal"] = exit_signal
            enriched.append(pos_pl)
        except Exception as e:
            enriched.append({**pos, "error": str(e), "exit_signal": None})

    return {"positions": enriched}


@app.post("/api/bcs/monitor")
def monitor_bcs_positions():
    """
    Check every open BCS position for profit-target, stop-loss, or time-stop
    triggers. Closes qualifying positions via market orders and updates state.
    Safe to call repeatedly — idempotent on already-closed positions.
    """
    state    = _load_bcs_state()
    settings = _load_bcs_settings()
    positions = state.get("positions", [])

    closed, errors = [], []
    trading_client = None

    for i, pos in enumerate(positions):
        if pos.get("status") != "open":
            continue
        try:
            pos_pl = _bcs_get_position_pl(pos)
            reason = _bcs_check_exit(pos_pl, settings)
            if not reason:
                continue

            if trading_client is None:
                trading_client = _get_trading_client()

            result = _bcs_close_spread(pos, trading_client)
            positions[i]["status"]      = "closed"
            positions[i]["exit_reason"] = reason
            positions[i]["exit_date"]   = _today_key()
            closed.append({
                "id":          pos["id"],
                "ticker":      pos["ticker"],
                "exit_reason": reason,
                "result":      result,
            })
        except Exception as e:
            errors.append(f"{pos.get('ticker', '?')} ({pos.get('id', '?')}): {e}")

    if closed:
        state["positions"] = positions
        _save_bcs_state(state)

    return {
        "closed":     closed,
        "errors":     errors,
        "open_count": sum(1 for p in positions if p.get("status") == "open"),
    }


class BCSPlaceRequest(BaseModel):
    ticker:         str
    long_contract:  str
    short_contract: str
    long_strike:    float
    short_strike:   float
    expiry:         str
    net_debit:      float
    long_ask:       Optional[float] = None   # limit price for the long leg
    short_bid:      Optional[float] = None   # limit price for the short leg
    qty:            Optional[int]   = None   # overrides settings.qty when set


@app.post("/api/bcs/place")
def place_bcs_spread(req: BCSPlaceRequest):
    """
    Place a bull call spread from a scan candidate.
    Validates that the total debit does not exceed max_debit_pct × portfolio value
    before submitting orders, then records the position in bcs_state.json.
    """
    import uuid
    from alpaca.trading.requests import LimitOrderRequest
    from alpaca.trading.enums    import OrderSide, TimeInForce

    settings      = _load_bcs_settings()
    qty           = req.qty if req.qty is not None else settings.get("qty", 1)
    max_debit_pct = settings.get("max_debit_pct", 0.02)

    trading_client = _get_trading_client()

    try:
        account         = trading_client.get_account()
        portfolio_value = float(account.portfolio_value)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Cannot fetch account balance: {e}")

    total_debit = req.net_debit * qty * 100      # per share × contracts × multiplier
    max_allowed = portfolio_value * max_debit_pct
    if total_debit > max_allowed:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Net debit ${total_debit:.2f} exceeds the {max_debit_pct * 100:.1f}% "
                f"portfolio cap (${max_allowed:.2f}). Trade skipped."
            ),
        )

    # Limit prices — use provided ask/bid or fall back to a safe approximation
    long_limit  = round(req.long_ask  or req.net_debit * 1.05, 2)
    short_limit = round(max(req.short_bid or 0.05, 0.01), 2)

    try:
        trading_client.submit_order(LimitOrderRequest(
            symbol=req.long_contract,
            qty=qty,
            side=OrderSide.BUY,
            time_in_force=TimeInForce.DAY,
            limit_price=long_limit,
        ))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Long leg submission failed: {e}")

    short_warnings = []
    try:
        trading_client.submit_order(LimitOrderRequest(
            symbol=req.short_contract,
            qty=qty,
            side=OrderSide.SELL,
            time_in_force=TimeInForce.DAY,
            limit_price=short_limit,
        ))
    except Exception as e:
        short_warnings.append(f"Short leg submission failed: {e}")

    # Record the new position regardless of whether the short leg filled
    state = _load_bcs_state()
    new_pos = {
        "id":             str(uuid.uuid4())[:8],
        "ticker":         req.ticker.upper(),
        "long_contract":  req.long_contract,
        "short_contract": req.short_contract,
        "long_strike":    req.long_strike,
        "short_strike":   req.short_strike,
        "expiry":         req.expiry,
        "qty":            qty,
        "net_debit":      req.net_debit,
        "debit_paid":     round(total_debit, 2),
        "entry_date":     _today_key(),
        "status":         "open",
        "exit_reason":    None,
        "exit_date":      None,
    }
    state.setdefault("positions", []).append(new_pos)
    _save_bcs_state(state)

    return {
        "message":        f"Bull call spread opened on {req.ticker}.",
        "id":             new_pos["id"],
        "long_contract":  req.long_contract,
        "short_contract": req.short_contract,
        "qty":            qty,
        "net_debit":      req.net_debit,
        "total_debit":    round(total_debit, 2),
        "warnings":       short_warnings,
    }


@app.delete("/api/bcs/positions/{position_id}")
def close_bcs_position_manually(position_id: str):
    """Manually close an open BCS position by its ID (market orders on both legs)."""
    state     = _load_bcs_state()
    positions = state.get("positions", [])
    pos       = next(
        (p for p in positions if p.get("id") == position_id and p.get("status") == "open"),
        None,
    )
    if pos is None:
        raise HTTPException(status_code=404, detail=f"Open position '{position_id}' not found.")

    trading_client = _get_trading_client()
    result = _bcs_close_spread(pos, trading_client)

    for p in positions:
        if p.get("id") == position_id:
            p["status"]      = "closed"
            p["exit_reason"] = "manual"
            p["exit_date"]   = _today_key()

    state["positions"] = positions
    _save_bcs_state(state)

    return {"message": f"Position {position_id} closed.", "result": result}



# ── Bear Put Spread Strategy ───────────────────────────────────────────────────

BPS_SETTINGS_FILE = BOT_DIR / "bps_settings.json"
BPS_STATE_FILE    = BOT_DIR / "bps_state.json"


class BearPutSpreadSettings(BaseModel):
    enabled:           bool  = True
    universe:          str   = "usa"
    price_min:         float = 50.0
    price_max:         float = 200.0
    spread_width_pct:  float = 0.075   # short strike = stock * (1 - this)
    dte_min:           int   = 30
    dte_max:           int   = 45
    prefer_monthly:    bool  = True
    max_debit_pct:     float = 0.02
    qty:               int   = 1
    profit_target_pct: float = 0.50
    stop_loss_pct:     float = 0.50
    time_stop_dte:     int   = 21
    poll_seconds:      int   = 300


# ── BPS file helpers ───────────────────────────────────────────────────────────

def _load_bps_settings() -> dict:
    if not BPS_SETTINGS_FILE.exists():
        return BearPutSpreadSettings().model_dump()
    try:
        return json.loads(BPS_SETTINGS_FILE.read_text())
    except Exception:
        return BearPutSpreadSettings().model_dump()


def _save_bps_settings(s: dict):
    BPS_SETTINGS_FILE.write_text(json.dumps(s, indent=2))


def _load_bps_state() -> dict:
    if not BPS_STATE_FILE.exists():
        return {"positions": []}
    try:
        return json.loads(BPS_STATE_FILE.read_text())
    except Exception:
        return {"positions": []}


def _save_bps_state(state: dict):
    tmp = str(BPS_STATE_FILE) + ".tmp"
    Path(tmp).write_text(json.dumps(state, indent=2))
    os.replace(tmp, BPS_STATE_FILE)


# ── BPS strategy helpers ───────────────────────────────────────────────────────

def _bps_is_bearish_trend(bars: list) -> bool:
    """
    Returns True when:
      1. Current close < SMA20
      2. Current close < SMA50
      3. Most recent 10-day window shows a lower high AND a lower low
         vs. the prior 10-day window  (= making LH/LL on daily chart).
    """
    if len(bars) < 55:
        return False

    closes = [b["c"] for b in bars]
    sma20_vals = _sma(closes, 20)
    sma50_vals = _sma(closes, 50)

    def last(lst):
        return next((v for v in reversed(lst) if v is not None), None)

    sma20 = last(sma20_vals)
    sma50 = last(sma50_vals)
    price = closes[-1]

    if sma20 is None or sma50 is None:
        return False
    if price >= sma20 or price >= sma50:
        return False

    recent_high = max(b["h"] for b in bars[-10:])
    recent_low  = min(b["l"] for b in bars[-10:])
    prior_high  = max(b["h"] for b in bars[-20:-10])
    prior_low   = min(b["l"] for b in bars[-20:-10])

    return recent_high < prior_high and recent_low < prior_low


def _bps_detect_entry_trigger(bars: list) -> tuple:
    """
    Detects: dead-cat bounce toward SMA20 resistance →
             green candle high within 3 % of SMA20 (approaching resistance) →
             red rejection candle with above-average volume.

    Returns (triggered: bool, details: dict | None).
    """
    if len(bars) < 25:
        return False, None

    closes  = [b["c"] for b in bars]
    volumes = [b["v"] for b in bars]
    sma20_vals = _sma(closes, 20)

    def last(lst):
        return next((v for v in reversed(lst) if v is not None), None)

    sma20 = last(sma20_vals)
    if sma20 is None:
        return False, None

    avg_vol = sum(volumes[-21:-1]) / 20 if len(volumes) >= 21 else sum(volumes) / max(len(volumes), 1)

    # green_bar = bounce candle (approaches SMA20 resistance)
    # red_bar   = rejection candle that follows
    for lookback in range(1, 4):
        if lookback + 1 > len(bars):
            continue
        green_bar = bars[-(lookback + 1)]
        red_bar   = bars[-lookback]

        is_green = green_bar["c"] > green_bar["o"]
        is_red   = red_bar["c"]   < red_bar["o"]
        if not (is_green and is_red):
            continue

        near_resistance = abs(green_bar["h"] - sma20) / sma20 <= 0.03
        strong_volume   = red_bar.get("v", 0) > avg_vol

        if near_resistance and strong_volume:
            return True, {
                "green_candle": {
                    "date":  green_bar.get("t", "")[:10],
                    "open":  green_bar["o"],
                    "close": green_bar["c"],
                    "high":  green_bar["h"],
                },
                "red_candle": {
                    "date":   red_bar.get("t", "")[:10],
                    "open":   red_bar["o"],
                    "close":  red_bar["c"],
                    "volume": red_bar["v"],
                },
                "sma20":      round(sma20, 2),
                "avg_volume": round(avg_vol),
            }

    return False, None


def _bps_find_strikes(chain: list, stock_price: float, spread_width_pct: float) -> tuple:
    """
    From a list of put option contracts (single expiry), pick:
      long  strike → ATM (closest to stock_price)            — the higher strike
      short strike → closest to stock_price * (1 - spread_width_pct) — the lower strike

    Returns (long_contract_dict, short_contract_dict) or (None, None) on failure.
    """
    puts = [c for c in chain if c.get("type") == "put" and c.get("strike") is not None]
    if not puts:
        return None, None

    puts.sort(key=lambda c: c["strike"])
    long_item    = min(puts, key=lambda c: abs(c["strike"] - stock_price))
    short_target = stock_price * (1.0 - spread_width_pct)
    short_item   = min(puts, key=lambda c: abs(c["strike"] - short_target))

    # Guarantee short strike is strictly below long strike
    if short_item["strike"] >= long_item["strike"]:
        below = [c for c in puts if c["strike"] < long_item["strike"]]
        if not below:
            return long_item, None
        short_item = below[-1]

    return long_item, short_item


def _bps_scan(settings: dict, tickers_override: Optional[List[str]] = None) -> dict:
    """
    Bear put spread scanner:
      1. Pull daily bars for the chosen universe (or tickers_override list).
      2. Filter by price range, bearish trend, and rejection-at-resistance trigger.
      3. For each candidate, fetch the put chain and construct the spread.
    """
    universe         = settings.get("universe", "usa")
    price_min        = settings.get("price_min", 50.0)
    price_max        = settings.get("price_max", 200.0)
    dte_min          = settings.get("dte_min", 30)
    dte_max          = settings.get("dte_max", 45)
    prefer_monthly   = settings.get("prefer_monthly", True)
    spread_width_pct = settings.get("spread_width_pct", 0.075)
    qty              = settings.get("qty", 1)

    if tickers_override:
        tickers = [t.upper().strip() for t in tickers_override if t.strip()]
    else:
        tickers = list(STOCK_UNIVERSES.get(universe, STOCK_UNIVERSES["usa"]))

    bars_map      = _fetch_multi_bars(tickers, 120)
    target_expiry = _bcs_find_expiry(dte_min, dte_max, prefer_monthly)  # reuse — same logic

    candidates, errors = [], []

    for ticker in tickers:
        bars = bars_map.get(ticker, [])
        if len(bars) < 55:
            continue

        price = bars[-1]["c"]
        if not (price_min <= price <= price_max):
            continue

        if not _bps_is_bearish_trend(bars):
            continue

        triggered, trigger_details = _bps_detect_entry_trigger(bars)
        if not triggered:
            continue

        try:
            chain = _get_option_chain(
                underlying=ticker,
                expiry_date=target_expiry,
                option_type="put",
                strike_gte=round(price * 0.80, 2),
                strike_lte=round(price * 1.05, 2),
            )
        except Exception as e:
            errors.append(f"{ticker}: option chain error — {e}")
            continue

        if not chain:
            errors.append(f"{ticker}: no puts found for expiry {target_expiry}")
            continue

        long_item, short_item = _bps_find_strikes(chain, price, spread_width_pct)
        if long_item is None or short_item is None:
            errors.append(f"{ticker}: could not find suitable put strikes")
            continue

        net_debit = _bcs_net_debit(long_item, short_item)  # formula identical
        if net_debit is None or net_debit <= 0:
            errors.append(f"{ticker}: invalid net debit ({net_debit})")
            continue

        if long_item.get("bid") is None or short_item.get("ask") is None:
            errors.append(f"{ticker}: insufficient option liquidity")
            continue

        # Width = long strike − short strike (put spread is measured downward)
        spread_width = round(long_item["strike"] - short_item["strike"], 2)
        max_gain     = round((spread_width - net_debit) * 100, 2)
        max_loss     = round(net_debit * 100, 2)
        risk_reward  = round(max_gain / max_loss, 2) if max_loss > 0 else None
        dte          = long_item.get("dte") or short_item.get("dte")

        candidates.append({
            "ticker":                  ticker,
            "price":                   round(price, 2),
            "expiry":                  target_expiry,
            "dte":                     dte,
            "long_contract":           long_item["symbol"],
            "short_contract":          short_item["symbol"],
            "long_strike":             long_item["strike"],
            "short_strike":            short_item["strike"],
            "spread_width":            spread_width,
            "long_bid":                long_item.get("bid"),
            "long_ask":                long_item.get("ask"),
            "short_bid":               short_item.get("bid"),
            "short_ask":               short_item.get("ask"),
            "net_debit":               net_debit,
            "net_debit_total":         round(net_debit * 100 * qty, 2),
            "max_gain_per_contract":   max_gain,
            "max_loss_per_contract":   max_loss,
            "risk_reward":             risk_reward,
            "long_delta":              long_item.get("delta"),
            "long_iv":                 long_item.get("iv"),
            "long_volume":             long_item.get("volume"),
            "short_volume":            short_item.get("volume"),
            "trigger":                 trigger_details,
        })

    candidates.sort(key=lambda x: x.get("risk_reward") or 0, reverse=True)
    return {
        "candidates":    candidates,
        "scanned":       len(tickers),
        "matched":       len(candidates),
        "target_expiry": target_expiry,
        "errors":        errors[:20],
    }


def _bps_get_position_pl(pos: dict) -> dict:
    """Fetch current mid-prices for both legs and compute unrealised P/L."""
    expiry_str    = pos.get("expiry", "")
    dte_remaining = None
    try:
        dte_remaining = (date.fromisoformat(expiry_str) - date.today()).days
    except Exception:
        pass

    long_contract  = pos.get("long_contract",  "")
    short_contract = pos.get("short_contract", "")
    net_debit_val  = pos.get("net_debit", 0) or 0
    qty            = pos.get("qty", 1)

    long_mid = short_mid = None
    try:
        from alpaca.data.historical import OptionHistoricalDataClient
        from alpaca.data.requests   import OptionSnapshotRequest
        opt_client = OptionHistoricalDataClient(API_KEY, API_SECRET)
        for symbol, slot in [(long_contract, "long"), (short_contract, "short")]:
            try:
                snaps = opt_client.get_option_snapshot(
                    OptionSnapshotRequest(symbol_or_symbols=[symbol])
                )
                snap = snaps.get(symbol)
                if snap and snap.latest_quote:
                    b = snap.latest_quote.bid_price
                    a = snap.latest_quote.ask_price
                    if b is not None and a is not None:
                        mid = (float(b) + float(a)) / 2
                        if slot == "long":
                            long_mid = round(mid, 3)
                        else:
                            short_mid = round(mid, 3)
            except Exception:
                pass
    except Exception:
        pass

    current_spread_value = pl_pct = pl_dollars = None
    if long_mid is not None and short_mid is not None:
        current_spread_value = round(long_mid - short_mid, 3)
        if net_debit_val > 0:
            pl_pct     = round((current_spread_value - net_debit_val) / net_debit_val, 4)
            pl_dollars = round((current_spread_value - net_debit_val) * 100 * qty, 2)

    return {
        **pos,
        "current_long_mid":     long_mid,
        "current_short_mid":    short_mid,
        "current_spread_value": current_spread_value,
        "pl_pct":               pl_pct,
        "pl_dollars":           pl_dollars,
        "dte_remaining":        dte_remaining,
    }


def _bps_check_exit(pos_pl: dict, settings: dict) -> Optional[str]:
    profit_target = settings.get("profit_target_pct", 0.50)
    stop_loss     = settings.get("stop_loss_pct",     0.50)
    time_stop     = settings.get("time_stop_dte",     21)
    pl_pct        = pos_pl.get("pl_pct")
    dte_remaining = pos_pl.get("dte_remaining")
    if pl_pct is not None and pl_pct >= profit_target:
        return f"profit_target (+{round(pl_pct * 100, 1)}% ≥ +{int(profit_target * 100)}%)"
    if pl_pct is not None and pl_pct <= -stop_loss:
        return f"stop_loss ({round(pl_pct * 100, 1)}% ≤ -{int(stop_loss * 100)}%)"
    if dte_remaining is not None and dte_remaining <= time_stop:
        return f"time_stop ({dte_remaining} DTE ≤ {time_stop} DTE)"
    return None


def _bps_close_spread(pos: dict, trading_client) -> dict:
    """Sell-to-close the long put; buy-to-close the short put."""
    from alpaca.trading.requests import MarketOrderRequest
    from alpaca.trading.enums    import OrderSide, TimeInForce

    errors, submitted = [], []
    qty = pos.get("qty", 1)

    for symbol, side, label in [
        (pos["long_contract"],  OrderSide.SELL, "long"),
        (pos["short_contract"], OrderSide.BUY,  "short"),
    ]:
        try:
            trading_client.submit_order(MarketOrderRequest(
                symbol=symbol, qty=qty, side=side, time_in_force=TimeInForce.DAY,
            ))
            submitted.append(label)
        except Exception as e:
            errors.append(f"close {label} ({symbol}): {e}")

    return {"success": len(errors) == 0, "submitted": submitted, "errors": errors}


# ── BPS API endpoints ──────────────────────────────────────────────────────────

@app.get("/api/bps/settings")
def get_bps_settings():
    return _load_bps_settings()


@app.post("/api/bps/settings")
def save_bps_settings(settings: BearPutSpreadSettings):
    data = settings.model_dump()
    _save_bps_settings(data)
    return {"message": "BPS settings saved.", **data}


class BPSScanRequest(BaseModel):
    tickers: Optional[List[str]] = None


@app.post("/api/bps/scan")
def run_bps_scan(req: Optional[BPSScanRequest] = None):
    settings = _load_bps_settings()
    override = (req.tickers if req and req.tickers else None)
    try:
        result = _bps_scan(settings, tickers_override=override)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"BPS scan error: {e}")
    return result


@app.get("/api/bps/positions")
def get_bps_positions():
    state    = _load_bps_state()
    settings = _load_bps_settings()
    open_pos = [p for p in state.get("positions", []) if p.get("status") == "open"]
    enriched = []
    for pos in open_pos:
        try:
            pos_pl      = _bps_get_position_pl(pos)
            exit_signal = _bps_check_exit(pos_pl, settings)
            pos_pl["exit_signal"] = exit_signal
            enriched.append(pos_pl)
        except Exception as e:
            enriched.append({**pos, "error": str(e), "exit_signal": None})
    return {"positions": enriched}


@app.post("/api/bps/monitor")
def monitor_bps_positions():
    state     = _load_bps_state()
    settings  = _load_bps_settings()
    positions = state.get("positions", [])
    closed, errors = [], []
    trading_client = None
    for i, pos in enumerate(positions):
        if pos.get("status") != "open":
            continue
        try:
            pos_pl = _bps_get_position_pl(pos)
            reason = _bps_check_exit(pos_pl, settings)
            if not reason:
                continue
            if trading_client is None:
                trading_client = _get_trading_client()
            result = _bps_close_spread(pos, trading_client)
            positions[i]["status"]      = "closed"
            positions[i]["exit_reason"] = reason
            positions[i]["exit_date"]   = _today_key()
            closed.append({"id": pos["id"], "ticker": pos["ticker"], "exit_reason": reason, "result": result})
        except Exception as e:
            errors.append(f"{pos.get('ticker', '?')} ({pos.get('id', '?')}): {e}")
    if closed:
        state["positions"] = positions
        _save_bps_state(state)
    return {
        "closed":     closed,
        "errors":     errors,
        "open_count": sum(1 for p in positions if p.get("status") == "open"),
    }


class BPSPlaceRequest(BaseModel):
    ticker:         str
    long_contract:  str
    short_contract: str
    long_strike:    float
    short_strike:   float
    expiry:         str
    net_debit:      float
    long_ask:       Optional[float] = None
    short_bid:      Optional[float] = None
    qty:            Optional[int]   = None


@app.post("/api/bps/place")
def place_bps_spread(req: BPSPlaceRequest):
    import uuid
    from alpaca.trading.requests import LimitOrderRequest
    from alpaca.trading.enums    import OrderSide, TimeInForce

    settings       = _load_bps_settings()
    qty            = req.qty if req.qty is not None else settings.get("qty", 1)
    max_debit_pct  = settings.get("max_debit_pct", 0.02)
    trading_client = _get_trading_client()

    try:
        account         = trading_client.get_account()
        portfolio_value = float(account.portfolio_value)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Cannot fetch account balance: {e}")

    total_debit = req.net_debit * qty * 100
    max_allowed = portfolio_value * max_debit_pct
    if total_debit > max_allowed:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Net debit ${total_debit:.2f} exceeds the {max_debit_pct * 100:.1f}% "
                f"portfolio cap (${max_allowed:.2f}). Trade skipped."
            ),
        )

    long_limit  = round(req.long_ask  or req.net_debit * 1.05, 2)
    short_limit = round(max(req.short_bid or 0.05, 0.01), 2)

    try:
        trading_client.submit_order(LimitOrderRequest(
            symbol=req.long_contract, qty=qty, side=OrderSide.BUY,
            time_in_force=TimeInForce.DAY, limit_price=long_limit,
        ))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Long leg submission failed: {e}")

    short_warnings = []
    try:
        trading_client.submit_order(LimitOrderRequest(
            symbol=req.short_contract, qty=qty, side=OrderSide.SELL,
            time_in_force=TimeInForce.DAY, limit_price=short_limit,
        ))
    except Exception as e:
        short_warnings.append(f"Short leg submission failed: {e}")

    state = _load_bps_state()
    new_pos = {
        "id":             str(uuid.uuid4())[:8],
        "ticker":         req.ticker.upper(),
        "long_contract":  req.long_contract,
        "short_contract": req.short_contract,
        "long_strike":    req.long_strike,
        "short_strike":   req.short_strike,
        "expiry":         req.expiry,
        "qty":            qty,
        "net_debit":      req.net_debit,
        "debit_paid":     round(total_debit, 2),
        "entry_date":     _today_key(),
        "status":         "open",
        "exit_reason":    None,
        "exit_date":      None,
    }
    state.setdefault("positions", []).append(new_pos)
    _save_bps_state(state)

    return {
        "message":        f"Bear put spread opened on {req.ticker}.",
        "id":             new_pos["id"],
        "long_contract":  req.long_contract,
        "short_contract": req.short_contract,
        "qty":            qty,
        "net_debit":      req.net_debit,
        "total_debit":    round(total_debit, 2),
        "warnings":       short_warnings,
    }


@app.delete("/api/bps/positions/{position_id}")
def close_bps_position_manually(position_id: str):
    state     = _load_bps_state()
    positions = state.get("positions", [])
    pos       = next(
        (p for p in positions if p.get("id") == position_id and p.get("status") == "open"),
        None,
    )
    if pos is None:
        raise HTTPException(status_code=404, detail=f"Open BPS position '{position_id}' not found.")
    trading_client = _get_trading_client()
    result = _bps_close_spread(pos, trading_client)
    for p in positions:
        if p.get("id") == position_id:
            p["status"]      = "closed"
            p["exit_reason"] = "manual"
            p["exit_date"]   = _today_key()
    state["positions"] = positions
    _save_bps_state(state)
    return {"message": f"BPS position {position_id} closed.", "result": result}


# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "timestamp": datetime.now().isoformat()}