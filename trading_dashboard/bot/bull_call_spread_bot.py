#!/usr/bin/env python3
"""
Bull Call Spread Bot
====================
Scans for bull call spread entry candidates, places spreads on qualifying
stocks, and monitors open positions for three automated exit conditions:

  1. Profit target  — close when the spread gains ≥ profit_target_pct of debit paid
  2. Stop loss      — close when the spread loses ≥ stop_loss_pct  of debit paid
  3. Time stop      — close when DTE reaches time_stop_dte (default 21)

Configuration  : bot/bcs_settings.json   (edit via the EDGE dashboard → Settings)
Persistent state: bot/bcs_state.json
Log output      : bot/bcs_bot.log        (stdout/stderr redirected by the backend)
PID file        : bot/bcs_bot.pid

Start / stop via the EDGE Options dashboard (/api/bcs/bot/start|stop).
"""

import json
import logging
import os
import re
import signal
import sys
import time
import uuid
from datetime import date, timedelta
from pathlib import Path
from typing import Optional

import dotenv
import httpx

dotenv.load_dotenv()

# ── Credentials ────────────────────────────────────────────────────────────────
API_KEY    = os.getenv("ALPACA_API_KEY",    "")
API_SECRET = os.getenv("ALPACA_API_SECRET", "")
PAPER      = True

ALPACA_BASE_URL = "https://paper-api.alpaca.markets" if PAPER else "https://api.alpaca.markets"
DATA_BASE_URL   = "https://data.alpaca.markets"

# ── Paths ──────────────────────────────────────────────────────────────────────
BOT_DIR       = Path(__file__).parent
SETTINGS_FILE = BOT_DIR / "bcs_settings.json"
STATE_FILE    = BOT_DIR / "bcs_state.json"
PID_FILE      = BOT_DIR / "bcs_bot.pid"

# ── Logging ────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [BCS] %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("bcs_bot")

# ── Graceful shutdown ──────────────────────────────────────────────────────────
_shutdown = False


def _handle_signal(signum, frame):
    global _shutdown
    log.info("Shutdown signal received — finishing current cycle then exiting.")
    _shutdown = True


signal.signal(signal.SIGTERM, _handle_signal)
signal.signal(signal.SIGINT,  _handle_signal)

# ── Default settings (mirrors BullCallSpreadSettings in main.py) ───────────────
SETTING_DEFAULTS = {
    "enabled":           True,
    "universe":          "usa",
    "price_min":         50.0,
    "price_max":         200.0,
    "spread_width_pct":  0.075,
    "dte_min":           30,
    "dte_max":           45,
    "prefer_monthly":    True,
    "max_debit_pct":     0.02,
    "qty":               1,
    "profit_target_pct": 0.50,
    "stop_loss_pct":     0.50,
    "time_stop_dte":     21,
    "poll_seconds":      300,
}

# Focused scan universe — large enough to catch liquid setups without
# making hundreds of API calls per cycle.  The full universe is available
# via the dashboard scanner; the bot uses this tighter list for speed.
BOT_UNIVERSE = [
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AMD",
    "NFLX", "COST", "AVGO", "ORCL", "CRM",   "PANW", "SNOW", "PLTR",
    "COIN", "CRWD", "DDOG", "ZS",   "NET",   "MDB",  "HUBS", "TTD",
    "RBLX", "SOFI", "HOOD", "PYPL", "V",     "MA",   "GS",   "MS",
    "JPM",  "BAC",  "JNJ",  "PFE",  "MRK",   "ABBV", "LLY",  "TMO",
    "UNH",  "CVS",  "ISRG", "HD",   "LOW",   "TGT",  "SBUX", "NKE",
    "DIS",  "CMCSA",
]


# ── Settings & state I/O ───────────────────────────────────────────────────────

def _load_settings() -> dict:
    base = dict(SETTING_DEFAULTS)
    if not SETTINGS_FILE.exists():
        return base
    try:
        saved = json.loads(SETTINGS_FILE.read_text())
        return {**base, **saved}
    except Exception:
        return base


def _load_state() -> dict:
    if not STATE_FILE.exists():
        return {"positions": []}
    try:
        return json.loads(STATE_FILE.read_text())
    except Exception:
        return {"positions": []}


def _save_state(state: dict):
    tmp = str(STATE_FILE) + ".tmp"
    Path(tmp).write_text(json.dumps(state, indent=2))
    os.replace(tmp, STATE_FILE)


# ── Alpaca REST helpers ────────────────────────────────────────────────────────

def _headers() -> dict:
    return {
        "APCA-API-KEY-ID":     API_KEY,
        "APCA-API-SECRET-KEY": API_SECRET,
        "accept":              "application/json",
    }


def _get_account() -> dict:
    resp = httpx.get(f"{ALPACA_BASE_URL}/v2/account", headers=_headers(), timeout=15)
    resp.raise_for_status()
    return resp.json()


def _is_market_open() -> bool:
    try:
        resp = httpx.get(f"{ALPACA_BASE_URL}/v2/clock", headers=_headers(), timeout=10)
        if resp.status_code == 200:
            return bool(resp.json().get("is_open", False))
    except Exception:
        pass
    return False


def _fetch_daily_bars(ticker: str, lookback: int = 120) -> list:
    end   = date.today()
    start = end - timedelta(days=lookback + 30)
    url   = f"{DATA_BASE_URL}/v2/stocks/{ticker}/bars"
    for feed in ("sip", "iex"):
        try:
            resp = httpx.get(url, headers=_headers(), params={
                "timeframe": "1Day",
                "start":     start.isoformat(),
                "end":       end.isoformat(),
                "limit":     lookback + 30,
                "feed":      feed,
                "sort":      "asc",
            }, timeout=15)
            if resp.status_code == 403:
                continue
            resp.raise_for_status()
            return resp.json().get("bars", [])
        except Exception:
            continue
    return []


def _fetch_option_chain(underlying: str, expiry_date: str,
                        strike_gte: Optional[float] = None,
                        strike_lte: Optional[float] = None) -> list:
    """Fetch call-only option snapshots for a given underlying + expiry."""
    url    = f"{DATA_BASE_URL}/v1beta1/options/snapshots/{underlying}"
    params = {"feed": "indicative", "limit": 500, "type": "call",
               "expiration_date": expiry_date}
    if strike_gte is not None:
        params["strike_price_gte"] = strike_gte
    if strike_lte is not None:
        params["strike_price_lte"] = strike_lte

    try:
        resp = httpx.get(url, headers=_headers(), params=params, timeout=15)
        resp.raise_for_status()
        results = []
        for sym, snap in resp.json().get("snapshots", {}).items():
            m = re.match(r"^([A-Z]+)(\d{6})([CP])(\d{8})$", sym)
            if not m or m.group(3) != "C":
                continue
            strike = int(m.group(4)) / 1000.0
            q      = snap.get("latestQuote") or {}
            bid    = q.get("bp")
            ask    = q.get("ap")
            mid    = round((bid + ask) / 2, 3) if bid is not None and ask is not None else None
            results.append({
                "symbol": sym,
                "strike": strike,
                "bid":    bid,
                "ask":    ask,
                "mid":    mid,
                "iv":     snap.get("impliedVolatility"),
                "delta":  (snap.get("greeks") or {}).get("delta"),
                "volume": (snap.get("dailyBar") or {}).get("v"),
            })
        return results
    except Exception as e:
        log.debug(f"Option chain fetch failed for {underlying}: {e}")
        return []


def _get_option_mid(contract: str) -> Optional[float]:
    """Return current mid-price for a single option contract."""
    url    = f"{DATA_BASE_URL}/v1beta1/options/snapshots"
    params = {"symbols": contract, "feed": "indicative"}
    try:
        resp  = httpx.get(url, headers=_headers(), params=params, timeout=10)
        snaps = resp.json().get("snapshots", {}) if resp.status_code == 200 else {}
        snap  = snaps.get(contract, {})
        q     = snap.get("latestQuote") or {}
        b, a  = q.get("bp"), q.get("ap")
        if b is not None and a is not None:
            return round((float(b) + float(a)) / 2, 3)
    except Exception:
        pass
    return None


def _place_limit_order(symbol: str, qty: int, side: str, limit_price: float) -> dict:
    """side = 'buy' | 'sell'"""
    resp = httpx.post(
        f"{ALPACA_BASE_URL}/v2/orders",
        headers={**_headers(), "content-type": "application/json"},
        json={
            "symbol":        symbol,
            "qty":           str(qty),
            "side":          side,
            "type":          "limit",
            "time_in_force": "day",
            "limit_price":   str(round(limit_price, 2)),
        },
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()


def _place_market_order(symbol: str, qty: int, side: str) -> dict:
    """side = 'buy' | 'sell'"""
    resp = httpx.post(
        f"{ALPACA_BASE_URL}/v2/orders",
        headers={**_headers(), "content-type": "application/json"},
        json={
            "symbol":        symbol,
            "qty":           str(qty),
            "side":          side,
            "type":          "market",
            "time_in_force": "day",
        },
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()


# ── Technical indicator helpers (self-contained) ───────────────────────────────

def _sma(closes: list, period: int) -> list:
    result = []
    for i in range(len(closes)):
        if i < period - 1:
            result.append(None)
        else:
            result.append(sum(closes[i - period + 1: i + 1]) / period)
    return result


# ── Strategy logic ─────────────────────────────────────────────────────────────

def _is_bullish_trend(bars: list) -> bool:
    """
    Price > SMA20, price > SMA50, AND higher-high + higher-low
    comparing the most recent 10-day window to the prior 10-day window.
    """
    if len(bars) < 55:
        return False
    closes = [b["c"] for b in bars]

    def last(lst):
        return next((v for v in reversed(lst) if v is not None), None)

    sma20 = last(_sma(closes, 20))
    sma50 = last(_sma(closes, 50))
    if sma20 is None or sma50 is None:
        return False
    price = closes[-1]
    if price <= sma20 or price <= sma50:
        return False

    recent_high = max(b["h"] for b in bars[-10:])
    recent_low  = min(b["l"] for b in bars[-10:])
    prior_high  = max(b["h"] for b in bars[-20:-10])
    prior_low   = min(b["l"] for b in bars[-20:-10])
    return recent_high > prior_high and recent_low > prior_low


def _detect_entry_trigger(bars: list) -> bool:
    """
    Pullback + bounce confirmation:
      - A red daily candle whose low is within 3% of SMA20
      - Immediately followed by a green candle with above-average volume
    Looks back up to 3 bars so a signal one or two days old is still caught.
    """
    if len(bars) < 25:
        return False
    closes  = [b["c"] for b in bars]
    volumes = [b["v"] for b in bars]

    def last(lst):
        return next((v for v in reversed(lst) if v is not None), None)

    sma20   = last(_sma(closes, 20))
    avg_vol = sum(volumes[-21:-1]) / 20 if len(volumes) >= 21 else sum(volumes) / max(len(volumes), 1)
    if sma20 is None:
        return False

    for lookback in range(1, 4):
        if lookback + 1 > len(bars):
            continue
        red_bar   = bars[-(lookback + 1)]
        green_bar = bars[-lookback]
        if red_bar["c"] < red_bar["o"] and green_bar["c"] > green_bar["o"]:
            near_support  = abs(red_bar["l"] - sma20) / sma20 <= 0.03
            strong_volume = green_bar.get("v", 0) > avg_vol
            if near_support and strong_volume:
                return True
    return False


def _find_expiry(dte_min: int, dte_max: int, prefer_monthly: bool) -> str:
    today    = date.today()
    min_date = today + timedelta(days=dte_min)
    max_date = today + timedelta(days=dte_max)

    if prefer_monthly:
        for offset in range(4):
            ref   = today + timedelta(days=offset * 30)
            first = ref.replace(day=1)
            first_friday = first + timedelta(days=(4 - first.weekday()) % 7)
            third_friday = first_friday + timedelta(weeks=2)
            if min_date <= third_friday <= max_date:
                return third_friday.isoformat()

    return min_date.isoformat()


def _find_strikes(chain: list, price: float, spread_width_pct: float):
    if not chain:
        return None, None
    chain_sorted = sorted(chain, key=lambda c: c["strike"])
    long_item    = min(chain_sorted, key=lambda c: abs(c["strike"] - price))
    short_target = price * (1.0 + spread_width_pct)
    short_item   = min(chain_sorted, key=lambda c: abs(c["strike"] - short_target))
    if short_item["strike"] <= long_item["strike"]:
        above = [c for c in chain_sorted if c["strike"] > long_item["strike"]]
        if not above:
            return long_item, None
        short_item = above[0]
    return long_item, short_item


def _net_debit(long_item: dict, short_item: dict) -> Optional[float]:
    la = long_item.get("ask")
    sb = short_item.get("bid")
    if la is not None and sb is not None:
        return round(la - sb, 2)
    lm = long_item.get("mid")
    sm = short_item.get("mid")
    if lm is not None and sm is not None:
        return round(lm - sm, 2)
    return None


def _get_spread_pl(pos: dict) -> tuple:
    """
    Returns (current_spread_value, pl_pct, dte_remaining).
    Any component may be None if data is unavailable.
    """
    expiry_str    = pos.get("expiry", "")
    dte_remaining = None
    try:
        dte_remaining = (date.fromisoformat(expiry_str) - date.today()).days
    except Exception:
        pass

    long_mid  = _get_option_mid(pos["long_contract"])
    short_mid = _get_option_mid(pos["short_contract"])

    if long_mid is not None and short_mid is not None:
        spread_val = long_mid - short_mid
        net_deb    = pos.get("net_debit", 0) or 0
        pl_pct     = (spread_val - net_deb) / net_deb if net_deb > 0 else None
        return round(spread_val, 3), pl_pct, dte_remaining

    return None, None, dte_remaining


def _check_exit(pos: dict, settings: dict) -> Optional[str]:
    profit_target = settings.get("profit_target_pct", 0.50)
    stop_loss     = settings.get("stop_loss_pct",     0.50)
    time_stop     = settings.get("time_stop_dte",     21)

    _, pl_pct, dte_remaining = _get_spread_pl(pos)

    if pl_pct is not None and pl_pct >= profit_target:
        return f"profit_target (+{round(pl_pct * 100, 1)}%)"
    if pl_pct is not None and pl_pct <= -stop_loss:
        return f"stop_loss ({round(pl_pct * 100, 1)}%)"
    if dte_remaining is not None and dte_remaining <= time_stop:
        return f"time_stop ({dte_remaining} DTE)"
    return None


def _close_spread(pos: dict):
    qty = pos.get("qty", 1)
    for symbol, side, label in [
        (pos["long_contract"],  "sell", "long"),
        (pos["short_contract"], "buy",  "short"),
    ]:
        try:
            _place_market_order(symbol, qty, side)
            log.info(f"Closed {label} leg: {symbol}")
        except Exception as e:
            log.error(f"Failed to close {label} leg {symbol}: {e}")


# ── Main trading loop ──────────────────────────────────────────────────────────

def _monitor_exits(settings: dict, state: dict) -> int:
    """Check all open positions for exit conditions. Returns number closed."""
    positions = state.get("positions", [])
    closed_count = 0

    for i, pos in enumerate(positions):
        if pos.get("status") != "open":
            continue
        reason = _check_exit(pos, settings)
        if not reason:
            continue

        log.info(f"EXIT triggered for {pos['ticker']} ({pos['id']}): {reason}")
        _close_spread(pos)
        positions[i]["status"]      = "closed"
        positions[i]["exit_reason"] = reason
        positions[i]["exit_date"]   = date.today().isoformat()
        closed_count += 1

    if closed_count:
        state["positions"] = positions
        _save_state(state)
        log.info(f"Closed {closed_count} position(s) this cycle.")

    return closed_count


def _scan_and_enter(settings: dict, state: dict) -> int:
    """
    Scan BOT_UNIVERSE for entry candidates, apply all filters, and place
    spreads for qualifying tickers not already held. Returns # of new entries.
    """
    price_min        = settings.get("price_min",        50.0)
    price_max        = settings.get("price_max",        200.0)
    spread_width_pct = settings.get("spread_width_pct", 0.075)
    dte_min          = settings.get("dte_min",          30)
    dte_max          = settings.get("dte_max",          45)
    prefer_monthly   = settings.get("prefer_monthly",   True)
    max_debit_pct    = settings.get("max_debit_pct",    0.02)
    qty              = settings.get("qty",              1)

    active_tickers = {
        p["ticker"]
        for p in state.get("positions", [])
        if p.get("status") == "open"
    }

    try:
        account         = _get_account()
        portfolio_value = float(account.get("portfolio_value", 0))
    except Exception as e:
        log.error(f"Cannot fetch account balance — aborting entry scan: {e}")
        return 0

    target_expiry = _find_expiry(dte_min, dte_max, prefer_monthly)
    log.info(f"Entry scan | expiry target: {target_expiry} | universe: {len(BOT_UNIVERSE)} tickers")

    new_entries = 0

    for ticker in BOT_UNIVERSE:
        if _shutdown:
            break
        if ticker in active_tickers:
            continue

        bars = _fetch_daily_bars(ticker, 120)
        if len(bars) < 55:
            continue

        price = bars[-1]["c"]
        if not (price_min <= price <= price_max):
            continue
        if not _is_bullish_trend(bars):
            continue
        if not _detect_entry_trigger(bars):
            continue

        log.info(f"Trigger confirmed: {ticker} @ ${price:.2f}")

        chain = _fetch_option_chain(
            ticker, target_expiry,
            strike_gte=round(price * 0.88, 2),
            strike_lte=round(price * 1.20, 2),
        )
        if not chain:
            log.debug(f"{ticker}: no option chain found for {target_expiry}")
            continue

        long_item, short_item = _find_strikes(chain, price, spread_width_pct)
        if long_item is None or short_item is None:
            log.debug(f"{ticker}: suitable strikes not available")
            continue

        debit = _net_debit(long_item, short_item)
        if debit is None or debit <= 0:
            log.debug(f"{ticker}: invalid net debit ({debit})")
            continue

        # Liquidity gate: both legs must have a valid market
        if long_item.get("bid") is None or short_item.get("ask") is None:
            log.debug(f"{ticker}: insufficient option liquidity, skipping")
            continue

        total_debit = debit * qty * 100
        max_allowed = portfolio_value * max_debit_pct
        if total_debit > max_allowed:
            log.info(
                f"{ticker}: debit ${total_debit:.2f} > cap ${max_allowed:.2f} "
                f"({max_debit_pct * 100:.1f}% of ${portfolio_value:,.0f}) — skipping"
            )
            continue

        long_limit  = round(long_item.get("ask")  or long_item.get("mid")  or debit * 1.05, 2)
        short_limit = round(max(short_item.get("bid") or 0.05, 0.01), 2)

        log.info(
            f"{ticker}: PLACING BCS  "
            f"long={long_item['symbol']} @${long_limit}  "
            f"short={short_item['symbol']} @${short_limit}  "
            f"debit=${debit:.2f}  total=${total_debit:.2f}"
        )

        try:
            _place_limit_order(long_item["symbol"],  qty, "buy",  long_limit)
        except Exception as e:
            log.error(f"{ticker}: long leg order failed — {e}")
            continue

        try:
            _place_limit_order(short_item["symbol"], qty, "sell", short_limit)
        except Exception as e:
            log.error(f"{ticker}: short leg order failed (long already submitted) — {e}")

        new_pos = {
            "id":             str(uuid.uuid4())[:8],
            "ticker":         ticker,
            "long_contract":  long_item["symbol"],
            "short_contract": short_item["symbol"],
            "long_strike":    long_item["strike"],
            "short_strike":   short_item["strike"],
            "expiry":         target_expiry,
            "qty":            qty,
            "net_debit":      debit,
            "debit_paid":     round(total_debit, 2),
            "entry_date":     date.today().isoformat(),
            "status":         "open",
            "exit_reason":    None,
            "exit_date":      None,
        }
        state.setdefault("positions", []).append(new_pos)
        _save_state(state)
        active_tickers.add(ticker)
        new_entries += 1
        log.info(f"{ticker}: position recorded (id={new_pos['id']})")

    return new_entries


# ── Entry point ────────────────────────────────────────────────────────────────

def main():
    log.info("=" * 60)
    log.info("Bull Call Spread Bot starting.")
    log.info(f"PID: {os.getpid()} | PAPER: {PAPER}")
    log.info("=" * 60)

    PID_FILE.write_text(str(os.getpid()))

    try:
        while not _shutdown:
            settings = _load_settings()

            if not settings.get("enabled", True):
                log.info("Strategy disabled in settings — sleeping.")
                _interruptible_sleep(settings.get("poll_seconds", 300))
                continue

            state = _load_state()

            # ── Exit monitoring (runs even when market is closed for DTE checks) ──
            log.info("Checking open positions for exit conditions …")
            _monitor_exits(settings, state)

            # ── Entry scan (market hours only) ──────────────────────────────────
            if _is_market_open():
                state = _load_state()   # reload after potential exit saves
                log.info("Market open — running entry scan …")
                n = _scan_and_enter(settings, state)
                if n:
                    log.info(f"Opened {n} new spread(s) this cycle.")
                else:
                    log.info("No new entries this cycle.")
            else:
                log.info("Market closed — entry scan skipped.")

            poll = settings.get("poll_seconds", 300)
            log.info(f"Cycle complete. Sleeping {poll}s …")
            _interruptible_sleep(poll)

    finally:
        if PID_FILE.exists():
            PID_FILE.unlink(missing_ok=True)
        log.info("Bull Call Spread Bot shut down cleanly.")


def _interruptible_sleep(seconds: int):
    """Sleep in 1-second increments so SIGTERM is handled promptly."""
    for _ in range(seconds):
        if _shutdown:
            break
        time.sleep(1)


if __name__ == "__main__":
    main()
