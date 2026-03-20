"""
daily_open_options_multi.py

Multi-ticker intraday options bot with:
- Entry once per ticker per day (no re-entry even if stopped out)
- Gap filter (no >3% adverse gap)
- Entry triggers:
    LONG: stock breaks above FIRST green 5-min candle high
    SHORT: stock breaks below FIRST red 5-min candle low
- Stop Loss: based on UNDERLYING stock price threshold (passed in)
    LONG: stop if stock <= sl_stock
    SHORT: stop if stock >= sl_stock
    On SL hit: close ALL open option positions whose symbol starts with ticker
- Take Profit management:
    If option position reaches +50% unrealized P/L (unrealized_plpc):
        sell half (rounded down; if qty==1, close all)
        mark partial taken (persisted)
        then arm "breakeven stop": if unrealized P/L falls back to <= 0%, close remainder
- Persistence (JSON file) to survive restarts/day-over-day and track partials and traded_today.

USAGE:
python daily_open_options_multi.py --plans '[
  {"ticker":"AAPL","contract":"AAPL260220C00200000","qty":2,"type":"LONG","sl_stock":187.50},
  {"ticker":"TSLA","contract":"TSLA260220P00180000","qty":4,"type":"SHORT","sl_stock":205.00}
]'

"""

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, date
from pathlib import Path
from typing import Optional

import pytz

from alpaca.trading.client import TradingClient
from alpaca.trading.requests import MarketOrderRequest
from alpaca.data.historical import StockHistoricalDataClient
from alpaca.data.requests import StockBarsRequest, StockLatestTradeRequest
from alpaca.data.timeframe import TimeFrame

import math
from alpaca.trading.requests import LimitOrderRequest
from alpaca.trading.enums import TimeInForce, OrderSide

from alpaca.data.historical import OptionHistoricalDataClient
from alpaca.data.requests import OptionLatestQuoteRequest
from alpaca.data.enums import OptionsFeed

# Force UTF-8 output on Windows (prevents UnicodeEncodeError with cp1252 terminals)
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except AttributeError:
        pass  # Python < 3.7 fallback — errors="replace" means bad chars print as ? not crash


# =========================
# CONFIG / CREDENTIALS
# =========================

#TESTING ACCOUNT
# API_KEY = "PKJSSHZDVLLAXO2K52XOVZDZDR"
# API_SECRET = "6CXHtA6qugFdySXWfHuPby9E2WuXdR1EFfgYuuDy4C2N"

# 'Real' Paper Trade Account
API_KEY = "PK37Q6SNLKAPP3RWZSAALOG3N4"
API_SECRET = "55fVpuVwK4h7vth7YPLVWcw79gzQkxsJrMoQvemGou9L"

PAPER = True

NYC = pytz.timezone("America/New_York")

MARKET_OPEN_HHMM = (9, 30)
MARKET_CLOSE_HHMM = (15, 55)   # stop slightly before 4pm

GAP_LIMIT = 0.03               # 3% overnight gap threshold
SCAN_CANDLE_MINUTES = 5        # define trigger candles as 5-min aggregates
POLL_SECONDS = 60               # loop cadence

TP_PCT = 0.25                  # +30% triggers partial
BE_STOP_PCT = 0.00             # back to 0% triggers remainder exit

STATE_PATH    = Path("daily_bot_state.json")
SETTINGS_PATH = Path("settings.json")


def load_settings() -> dict:
    """Load settings.json written by the dashboard. Falls back to safe defaults."""
    defaults = {
        "tp_pct":        0.25,
        "hard_stop_pct": 0.50,
        "trail_offset":  0.20,
        "gap_limit":     0.03,
        "poll_seconds":  60,
    }
    try:
        if SETTINGS_PATH.exists():
            data = json.loads(SETTINGS_PATH.read_text())
            defaults.update({k: v for k, v in data.items() if k in defaults})
    except Exception as e:
        print(f"[settings] Could not read settings.json: {e}. Using defaults.")
    return defaults


# =========================
# DATA MODELS
# =========================
@dataclass
class Plan:
    ticker: str
    contract: str
    qty: int
    direction: str   # LONG or SHORT
    sl_stock: float  # underlying stock stop price
    tp_stock: float  # underlying stock take-profit price



@dataclass
class State:
    plan: Plan
    has_entered: bool = False
    trigger_level: Optional[float] = None
    trigger_ts: Optional[object] = None

    took_partial: bool = False
    entry_avg_price: Optional[float] = None
    last_plpc: Optional[float] = None


# =========================
# TIME HELPERS
# =========================
def now_nyc() -> datetime:
    return datetime.now(NYC)

def today_nyc() -> date:
    return now_nyc().date()

def is_after(hh: int, mm: int) -> bool:
    n = now_nyc()
    return (n.hour > hh) or (n.hour == hh and n.minute >= mm)

def wait_until_market_open():
    while not is_after(*MARKET_OPEN_HHMM):
        n = now_nyc()
        print(f"[WAIT] {n.strftime('%Y-%m-%d %H:%M:%S %Z')} Waiting for market open...")
        time.sleep(60)

def should_stop_for_close() -> bool:
    return is_after(*MARKET_CLOSE_HHMM)


# =========================
# PERSISTENCE HELPERS
# =========================
def _date_key(d: date) -> str:
    return d.strftime("%Y-%m-%d")

def load_state_file() -> dict:
    if not STATE_PATH.exists():
        return {}
    try:
        return json.loads(STATE_PATH.read_text())
    except Exception:
        # If corrupted, start fresh
        return {}

def save_state_file(state: dict) -> None:
    tmp = str(STATE_PATH) + ".tmp"
    Path(tmp).write_text(json.dumps(state, indent=2, sort_keys=True))
    os.replace(tmp, STATE_PATH)

def get_day_bucket(state: dict, day: date) -> dict:
    dk = _date_key(day)
    if "days" not in state:
        state["days"] = {}
    if dk not in state["days"]:
        state["days"][dk] = {"traded_today": [], "tickers": {}}
    return state["days"][dk]



def get_carry_bucket(state: dict) -> list:
    """List of positions to carry into the next session (consumed once at startup)."""
    if "carry" not in state or not isinstance(state["carry"], list):
        state["carry"] = []
    return state["carry"]

def seed_states_from_any_open_positions(trading_client: TradingClient, states: dict[str, State]) -> None:
    """
    If plans.json is empty, we still want to keep the bot alive to manage any
    *already open* option positions in Alpaca.

    This function scans Alpaca open positions and creates minimal runtime State/Plan
    objects for any option symbols (or any symbol) it finds, keyed by the ticker prefix.

    Notes:
    - We infer ticker as the leading letters of the position symbol (works for OCC option sym like TSLA260...).
    - We set wide SL/TP sentinels so stock-based SL/TP won't auto-fire unless you provided them via carry/plans.
    - The bot will still run TP-partial + breakeven-stop management because that is option P/L based.
    """
    import re

    positions = trading_client.get_all_positions()
    if not positions:
        return

    for p in positions:
        sym = str(p.symbol).upper().strip()
        if not sym:
            continue

        m = re.match(r"^([A-Z]+)", sym)
        if not m:
            continue

        ticker = m.group(1)

        # Don't overwrite existing plan/state (from plans or carry)
        if ticker in states:
            continue

        try:
            qty = int(float(p.qty))
        except Exception:
            qty = 1

        # "Disable" stock-based SL/TP by using huge sentinels.
        # This keeps management focused on option P/L (partial + BE stop) unless you set real SL/TP elsewhere.
        plan = Plan(
            ticker=ticker,
            contract=sym,
            qty=qty,
            direction="LONG",      # unknown; only matters for entry/trigger logic which won't run if has_entered=True
            sl_stock=-1e18,        # won't trigger
            tp_stock=1e18,         # won't trigger
        )
        st = State(plan=plan, has_entered=True)

        try:
            st.entry_avg_price = float(p.avg_entry_price)
        except Exception:
            st.entry_avg_price = None

        states[ticker] = st
        print(f"[BOOT] Seeded from Alpaca open position: {ticker} -> {sym} qty={qty}")

def compute_total_unrealized_pl_pct(pos) -> float | None:
    """
    Compute TOTAL unrealized P/L% since entry using cost basis and current market value.
    This avoids ambiguity about whether API 'unrealized_plpc' is daily or total.
    Returns a decimal (e.g., 0.25 for +25%), or None if not computable.
    """
    try:
        cost_basis = float(pos.cost_basis)          # total dollars paid
        market_value = float(pos.market_value)      # current total value
        if cost_basis <= 0:
            return None
        return (market_value - cost_basis) / cost_basis
    except Exception:
        return None


def consume_carry_positions(
    trading_client: TradingClient,
    states: dict[str, State],
    app_state: dict,
    traded_today: set[str],
) -> set[str]:
    """
    At startup:
    - Load any carried positions from STATE_PATH ("carry")
    - Verify they actually exist in Alpaca open positions
    - If the ticker is NOT in today's plans, create an in-memory State/Plan anyway
      so the bot will still monitor/managed the position.
    - Always clear the carry bucket immediately so it can't be used twice

    Returns the set of tickers that were successfully carried.
    """
    carry = list(get_carry_bucket(app_state))

    # Clear immediately (so a crash later won't reuse these twice)
    app_state["carry"] = []
    save_state_file(app_state)

    if not carry:
        return set()

    open_positions = trading_client.get_all_positions()
    carried_ok: set[str] = set()

    def _default_sl_tp(direction: str):
        # Use huge sentinels to effectively "disable" stock SL/TP if missing
        # LONG: SL triggers if stock <= sl_stock, TP triggers if stock >= tp_stock
        # SHORT: SL triggers if stock >= sl_stock, TP triggers if stock <= tp_stock
        if direction == "LONG":
            return (-1e18, 1e18)   # SL very low, TP very high
        else:
            return (1e18, -1e18)   # SL very high, TP very low

    for item in carry:
        try:
            ticker = str(item.get("ticker", "")).upper().strip()
            contract = str(item.get("contract", "")).upper().strip()
        except Exception:
            continue

        if not ticker:
            continue

        # Confirm it exists in Alpaca
        pos = None
        if contract:
            for p in open_positions:
                if p.symbol == contract:
                    pos = p
                    break
        if pos is None:
            for p in open_positions:
                if p.symbol.startswith(ticker):
                    pos = p
                    break

        if pos is None:
            print(f"[BOOT] Carry ignored for {ticker}: no matching Alpaca open position found.")
            continue

        # --- IMPORTANT CHANGE ---
        # If ticker isn't in today's plans (states), create a plan/state so we still run.
        if ticker not in states:
            direction = str(item.get("direction", "LONG")).upper().strip()
            if direction not in ("LONG", "SHORT"):
                direction = "LONG"

            sl_default, tp_default = _default_sl_tp(direction)

            try:
                sl_stock = float(item.get("sl_stock")) if item.get("sl_stock") is not None else sl_default
            except Exception:
                sl_stock = sl_default

            try:
                tp_stock = float(item.get("tp_stock")) if item.get("tp_stock") is not None else tp_default
            except Exception:
                tp_stock = tp_default

            try:
                qty_from_item = int(item.get("qty")) if item.get("qty") is not None else None
            except Exception:
                qty_from_item = None

            try:
                qty_from_pos = int(float(pos.qty))
            except Exception:
                qty_from_pos = qty_from_item if qty_from_item is not None else 1

            plan = Plan(
                ticker=ticker,
                contract=pos.symbol,
                qty=qty_from_pos,
                direction=direction,
                sl_stock=sl_stock,
                tp_stock=tp_stock,
            )
            states[ticker] = State(plan=plan)

        st = states[ticker]
        st.has_entered = True

        # Restore partial state (best-effort)
        st.took_partial = bool(item.get("took_partial", False))
        try:
            st.entry_avg_price = float(item.get("entry_avg_price")) if item.get("entry_avg_price") is not None else None
        except Exception:
            st.entry_avg_price = None

        # Update plan contract/qty to what is actually open (safer than trusting carry blindly)
        st.plan.contract = pos.symbol
        try:
            st.plan.qty = int(float(pos.qty))
        except Exception:
            pass

        # Mark as traded today so we never re-enter this ticker today
        traded_today.add(ticker)

        # Persist into today's day bucket for continuity
        day_bucket = get_day_bucket(app_state, today_nyc())
        day_bucket["traded_today"] = sorted(set(day_bucket.get("traded_today", [])) | {ticker})
        tinfo = day_bucket.setdefault("tickers", {}).setdefault(ticker, {})
        tinfo["original_qty"] = int(item.get("original_qty", st.plan.qty))
        tinfo["took_partial"] = bool(item.get("took_partial", False))
        tinfo["partial_qty_sold"] = int(item.get("partial_qty_sold", 0))
        save_state_file(app_state)

        carried_ok.add(ticker)
        print(f"[BOOT] Carried {ticker}: {pos.symbol} qty={pos.qty}")

    return carried_ok


# =========================
# ORDER HELPERS (SMART LIMIT)
# =========================

def _round_to_cent(x: float) -> float:
    return math.floor(x * 100 + 0.5) / 100.0

def get_option_bid_ask(option_data_client: OptionHistoricalDataClient, contract: str):
    """
    Returns (bid, ask) floats or (None, None) if unavailable.
    """
    req = OptionLatestQuoteRequest(symbol_or_symbols=contract, feed=OptionsFeed.INDICATIVE)
    quotes = option_data_client.get_option_latest_quote(req)

    q = quotes.get(contract) if hasattr(quotes, "get") else quotes[contract]
    bid = getattr(q, "bid_price", None)
    ask = getattr(q, "ask_price", None)

    bid = float(bid) if bid is not None else None
    ask = float(ask) if ask is not None else None
    return bid, ask

def submit_smart_limit(
    trading_client: TradingClient,
    option_data_client: OptionHistoricalDataClient,
    contract: str,
    qty: int,
    side: str,  # "buy" or "sell"
    total_timeout_sec: int = 180,      # Total timeout of 3 minutes
    step_wait_sec: int = 10,            # retry every 10 seconds
    spread_threshold: float = 0.25,
    start_offset: float = 0.01,
    step_offset: float = 0.02,
    max_slippage_to_ask: float = 0.00, # no slippage by default
    fallback_to_market: bool = False,
    pain_cap_frac: float = 0.40,
):
    """
    Places a limit order and retries by cancel/re-submit with improved pricing
    until filled or timeout.

    - BUY: walks limit up toward (and optionally beyond) ask
    - SELL: walks limit down toward (and optionally below) bid
    """
    side = side.lower().strip()
    if side not in ("buy", "sell"):
        raise ValueError("side must be 'buy' or 'sell'")

    attempts = max(1, int(math.ceil(total_timeout_sec / max(1, step_wait_sec))))
    last_spread = None
    last_limit_px = None
    for i in range(attempts):
        had_quote = False
        bid, ask = get_option_bid_ask(option_data_client, contract)

        # If no usable quote, place a "best effort" limit based on side.
        # With INDICATIVE feed this should usually exist, but keep it safe.
        if bid is None or ask is None or bid <= 0 or ask <= 0 or ask < bid:
            # fallback: be aggressive with a 1-cent "walking" approach
            # (still no market order)
            base = ask if side == "buy" and ask else bid if side == "sell" and bid else None
            if base is None:
                print(f"[ORDER] {contract} {side.upper()} x{qty} NO_QUOTE -> cannot price limit, retrying...")
                time.sleep(step_wait_sec)
                continue
            limit_px = base
            reason = "NO_QUOTE_FALLBACK"
        else:
            had_quote = True
            spread = ask - bid
            last_spread = spread
            mid = (bid + ask) / 2.0

            # Increase aggressiveness each attempt
            offset = start_offset + i * step_offset

            if side == "buy":
                target = mid + offset

                # Two caps:
                # 1) normal cap near ask (optionally allow slight slippage above ask)
                ask_cap = ask + max_slippage_to_ask

                # 2) "max pain cap": do not pay more than mid + 40% of spread (tunable)
                pain_cap = mid + (pain_cap_frac * spread)

                cap = min(ask_cap, pain_cap)

                # If cap is below bid (pathological), clamp to bid.
                if cap < bid:
                    cap = bid

                limit_px = min(cap, max(bid, target))

            else:
                # Walk down: start near mid, then move toward bid; allow optional slippage below bid
                target = mid - offset
                cap = bid - max_slippage_to_ask
                limit_px = max(cap, min(ask, target))

            reason = f"{'TIGHT' if spread <= spread_threshold else 'WIDE'}_SPREAD spread={spread:.2f}"

        limit_px = _round_to_cent(float(limit_px))
        # Monotonic ratchet (BUY): never decrease across attempts,
        # but also never exceed the cap we computed this iteration.
        if side == "buy" and had_quote and last_limit_px is not None:
            # cap can be undefined in NO_QUOTE path; only apply ratchet when we had a quote
            cap_for_ratchet = _round_to_cent(float(cap))
            limit_px = max(cap_for_ratchet, max(limit_px, last_limit_px))

        last_limit_px = limit_px

        print(f"[ORDER] {contract} {side.upper()} x{qty} attempt={i+1}/{attempts} "
              f"bid={bid} ask={ask} limit={limit_px:.2f} ({reason})")

        order = LimitOrderRequest(
            symbol=contract,
            qty=qty,
            side=OrderSide.BUY if side == "buy" else OrderSide.SELL,
            time_in_force=TimeInForce.DAY,
            limit_price=limit_px,
        )
        placed = trading_client.submit_order(order)
        oid = placed.id

        # wait step_wait_sec and check fill status
        end_t = time.time() + step_wait_sec
        while time.time() < end_t:
            o = trading_client.get_order_by_id(oid)
            status = str(getattr(o, "status", "")).lower()

            if status == "filled":
                print(f"[ORDER] {contract} {side.upper()} status=filled [OK]")
                return o

            if status == "partially_filled":
                # treat partial fill as success
                print(f"[ORDER] {contract} {side.upper()} status=partially_filled [OK] (continuing)")
                return o

            time.sleep(0.5)

        # not filled yet -> FINAL status check, then cancel and retry
        try:
            o_final = trading_client.get_order_by_id(oid)
            status_final = str(getattr(o_final, "status", "")).lower()

            if status_final == "filled":
                print(f"[ORDER] {contract} {side.upper()} status=filled [OK] (detected on final check)")
                return o_final

            if status_final == "partially_filled":
                print(f"[ORDER] {contract} {side.upper()} status=partially_filled [OK] (detected on final check)")
                return o_final

        except Exception as e:
            # If we can't fetch status, proceed to cancel attempt.
            print(f"[ORDER] final status check failed: {e}")

        # Try cancel
        try:
            trading_client.cancel_order_by_id(oid)
            print(
                f"[ORDER] {contract} {side.upper()} not filled in {step_wait_sec}s "
                f"(tried @ {last_limit_px:.2f}) -> canceled, retrying..."
            )

        except Exception as e:
            msg = str(e).lower()

            # [OK] If it filled between our last poll and cancel, STOP RETRYING.
            if "already in \"filled\" state" in msg or "already filled" in msg or "42210000" in msg:
                try:
                    o_filled = trading_client.get_order_by_id(oid)
                    print(f"[ORDER] {contract} {side.upper()} status=filled [OK] (filled between poll and cancel)")
                    return o_filled
                except Exception:
                    # Even if we can't re-fetch, treat as filled to prevent duplicate orders
                    print(f"[ORDER] {contract} {side.upper()} appears filled (cancel rejected as filled). Stopping retries [OK]")
                    return placed

            # Otherwise, real cancel failure; keep retrying
            print(f"[ORDER] cancel failed: {e}")

    # If this is an ENTRY buy and we still aren't filled, force a market order.
    print(f"[ORDER] {contract} {side.upper()} not filled after {total_timeout_sec}s [TIMEOUT]")

    # Market fallback ONLY if spread is TIGHT on the most recent usable quote.
    if fallback_to_market and side == "buy":
        if last_spread is not None and last_spread <= spread_threshold:
            print(f"[ORDER] {contract} BUY -> submitting MARKET order as final fallback (TIGHT spread={last_spread:.2f}).")
            return submit_entry_market(trading_client, contract, qty)
        else:
            print(
                f"[ORDER] {contract} BUY -> NO market fallback because spread is WIDE "
                f"(spread={'N/A' if last_spread is None else f'{last_spread:.2f}'}, threshold={spread_threshold:.2f})."
            )

    print(f"[ORDER] {contract} {side.upper()} giving up.")
    return None

def submit_entry(trading_client: TradingClient, option_data_client: OptionHistoricalDataClient, contract: str, qty: int):
    # More aggressive: retry faster, walk pricing faster, and fallback to market if still not filled.
    return submit_smart_limit(
        trading_client,
        option_data_client,
        contract,
        qty,
        side="buy",
        total_timeout_sec=126,     # 2 minute total
        step_wait_sec=7,          # reprice every 7s (18 attempts)
        start_offset=0.02,        # start closer to ask
        step_offset=0.03,         # move faster each attempt
        max_slippage_to_ask=0.03, # allow up to +3 cents over ask cap
        fallback_to_market=True,  # FINAL fallback
    )


# def submit_sell(trading_client: TradingClient, option_data_client: OptionHistoricalDataClient, contract: str, qty: int):
#     return submit_smart_limit(trading_client, option_data_client, contract, qty, side="sell")
# Submit sell should remain Market order for faster execution


# =========================
# TRADING DAY HELPERS
# =========================
def get_prev_trading_day(d: date) -> date:
    # weekday-only logic; not holiday-aware
    if d.weekday() == 0:   # Monday -> Friday
        return d - timedelta(days=3)
    if d.weekday() == 6:   # Sunday -> Friday
        return d - timedelta(days=2)
    return d - timedelta(days=1)

def get_first_completed_5m_bar(data_client: StockHistoricalDataClient, ticker: str):
    df_1m = fetch_intraday_1m(data_client, ticker, today_nyc())
    if df_1m is None or df_1m.empty:
        return None, None

    bars_5m = resample_to_5m(df_1m)

    # Market opens at 9:30 → first completed 5m candle closes at 9:35
    first_bar_time = NYC.localize(
        datetime.combine(today_nyc(), datetime.min.time())
        .replace(hour=9, minute=35)
    )

    if first_bar_time not in bars_5m.index:
        return None, None

    close_5m = float(bars_5m.loc[first_bar_time, "close"])
    return close_5m, first_bar_time



# =========================
# MARKET DATA
# =========================
def fetch_intraday_1m(data_client: StockHistoricalDataClient, ticker: str, day: date):
    start = NYC.localize(datetime.combine(day, datetime.min.time()))
    end = NYC.localize(datetime.combine(day, datetime.max.time()))
    req = StockBarsRequest(
        symbol_or_symbols=[ticker],
        timeframe=TimeFrame.Minute,
        start=start,
        end=end,
        feed="iex",
    )
    df = data_client.get_stock_bars(req).df
    if df is None or len(df) == 0:
        return None
    df = df.reset_index()
    df = df[df["symbol"] == ticker].copy()
    df = df.set_index("timestamp").sort_index()
    # Ensure NYC timezone (Alpaca often returns UTC timestamps)
    if df.index.tz is None:
        df.index = df.index.tz_localize("UTC").tz_convert(NYC)
    else:
        df.index = df.index.tz_convert(NYC)

    return df

def resample_to_5m(df_1m, day: date | None = None):
    """
    Resample 1m -> 5m in NYC time, aligned to the regular session.
    Bars are labeled at the RIGHT edge (so 09:30-09:35 prints as 09:35).
    """
    # Ensure NYC tz for correct bucket alignment
    if df_1m.index.tz is None:
        df_1m = df_1m.tz_localize("UTC").tz_convert(NYC)
    else:
        df_1m = df_1m.tz_convert(NYC)

    # Filter to regular session only (RTH)
    df_1m = df_1m.between_time("09:30", "16:00", inclusive="left")
    if df_1m.empty:
        return df_1m

    # Pick a deterministic session start for origin alignment
    if day is None:
        day = df_1m.index[0].date()

    session_start = NYC.localize(datetime.combine(day, datetime.min.time()).replace(hour=9, minute=30))

    bars_5m = (
        df_1m
        .resample(
            f"{SCAN_CANDLE_MINUTES}min",   # <-- fixes FutureWarning
            origin=session_start,
            label="right",
            closed="left"
        )
        .agg(
            open=("open", "first"),
            high=("high", "max"),
            low=("low", "min"),
            close=("close", "last"),
            volume=("volume", "sum"),
        )
        .dropna()
    )
    return bars_5m


def get_latest_completed_5m_close(data_client: StockHistoricalDataClient, ticker: str, lookback_minutes: int = 90):
    """
    Returns (close_5m, ts_5m) for the most recent *COMPLETED* 5-minute bar (RTH, NYC time).

    Key points:
    - We resample 1m -> 5m with label='right', closed='left' so 09:30-09:35 is labeled 09:35.
    - A bar is considered completed if its label (right-edge timestamp) is <= the current time floored to 5 minutes.
    - This avoids the common off-by-one issue where the *still-forming* bucket shows up as the latest bar.
    """
    end = now_nyc()
    start = end - timedelta(minutes=lookback_minutes)

    req = StockBarsRequest(
        symbol_or_symbols=[ticker],
        timeframe=TimeFrame.Minute,
        start=start,
        end=end,
        feed="iex",
    )
    df = data_client.get_stock_bars(req).df
    if df is None or len(df) == 0:
        return None, None

    df = df.reset_index()
    df = df[df["symbol"] == ticker].copy()
    df = df.set_index("timestamp").sort_index()

    # Ensure NYC tz for correct bucket alignment
    if df.index.tz is None:
        df.index = df.index.tz_localize("UTC").tz_convert(NYC)
    else:
        df.index = df.index.tz_convert(NYC)

    bars_5m = resample_to_5m(df, today_nyc())
    if bars_5m is None or bars_5m.empty:
        return None, None

    # Determine the latest COMPLETED 5m bar end time (right-edge label)
    now_floor = end.replace(second=0, microsecond=0)
    now_floor = now_floor - timedelta(minutes=now_floor.minute % SCAN_CANDLE_MINUTES)

    # If we're before the first completed 5m bar (09:35), return None
    session_start = NYC.localize(datetime.combine(today_nyc(), datetime.min.time()).replace(hour=9, minute=30))
    first_completed_end = session_start + timedelta(minutes=SCAN_CANDLE_MINUTES)
    if now_floor < first_completed_end:
        return None, None

    # Pick the latest bar whose label is <= now_floor
    eligible = bars_5m[bars_5m.index <= now_floor]
    if eligible.empty:
        return None, None

    ts = eligible.index[-1]
    close_5m = float(eligible["close"].iloc[-1])
    return close_5m, ts

def compute_gap_pct(prev_close: float, today_open: float) -> float:
    if prev_close <= 0:
        return 0.0
    return (today_open - prev_close) / prev_close

def get_prev_close_and_today_open(data_client: StockHistoricalDataClient, ticker: str):
    today = today_nyc()

    # Sometimes right after open the first bars aren't available yet.
    # Retry instead of failing/triggering disable.
    max_attempts = 10
    wait_sec = 60

    today_df = None
    for attempt in range(1, max_attempts + 1):
        today_df = fetch_intraday_1m(data_client, ticker, today)
        if today_df is not None and not today_df.empty:
            break

        if attempt < max_attempts:
            print(f"[{ticker}] Today's bars not available yet. Waiting {wait_sec}s and retrying ({attempt}/{max_attempts})...")
            time.sleep(wait_sec)

    if today_df is None or today_df.empty:
        raise RuntimeError(f"Could not fetch today's data for {ticker} ({today}) after {max_attempts} attempts.")

    today_open = float(today_df["open"].iloc[0])

    # Find last day with data (holiday/weekend aware)
    prev_day, prev_close = find_last_close_day(data_client, ticker, start_day=today, max_lookback_days=14)

    return prev_close, today_open



def find_first_signal_level(data_client: StockHistoricalDataClient, ticker: str, direction: str):
    df_1m = fetch_intraday_1m(data_client, ticker, today_nyc())
    if df_1m is None or df_1m.empty:
        return None, None

    bars_5m = resample_to_5m(df_1m, today_nyc())

    if direction == "LONG":
        first_green = bars_5m[bars_5m["close"] > bars_5m["open"]].head(1)
        if first_green.empty:
            return None, None
        ts = first_green.index[0]
        level = float(first_green["high"].iloc[0])
        return level, ts

    if direction == "SHORT":
        first_red = bars_5m[bars_5m["close"] < bars_5m["open"]].head(1)
        if first_red.empty:
            return None, None
        ts = first_red.index[0]
        level = float(first_red["low"].iloc[0])
        return level, ts

    raise ValueError("direction must be LONG or SHORT")

def get_latest_stock_price(data_client: StockHistoricalDataClient, ticker: str) -> float:
    trade = data_client.get_stock_latest_trade(
        StockLatestTradeRequest(symbol_or_symbols=ticker, feed="iex")
    )
    return float(trade[ticker].price)


# =========================
# ORDER HELPERS
# =========================
def submit_entry_market(trading_client: TradingClient, contract: str, qty: int):
    order = MarketOrderRequest(
        symbol=contract,
        qty=qty,
        side="buy",
        time_in_force="day",
    )
    return trading_client.submit_order(order)

def submit_sell(trading_client: TradingClient, contract: str, qty: int):
    order = MarketOrderRequest(
        symbol=contract,
        qty=qty,
        side="sell",
        time_in_force="day",
    )
    return trading_client.submit_order(order)

def close_all_for_ticker(trading_client: TradingClient, ticker: str) -> bool:
    positions = trading_client.get_all_positions()
    closed_any = False
    for p in positions:
        if p.symbol.startswith(ticker):
            print(f"[{ticker}] Closing position {p.symbol} qty={p.qty}")
            trading_client.close_position(p.symbol)
            closed_any = True
    return closed_any

def get_position_for_contract(trading_client: TradingClient, contract: str):
    positions = trading_client.get_all_positions()
    for p in positions:
        if p.symbol == contract:
            return p
    return None


# =========================
# STRATEGY HELPERS
# =========================
def gap_filter_ok(data_client: StockHistoricalDataClient, plan: Plan) -> bool:
    prev_close, today_open = get_prev_close_and_today_open(data_client, plan.ticker)
    gap = compute_gap_pct(prev_close, today_open)
    print(f"[{plan.ticker}] GAP prev_close={prev_close:.2f} open={today_open:.2f} gap={gap*100:.2f}%")

    if plan.direction == "LONG" and gap < -GAP_LIMIT:
        print(f"[{plan.ticker}] ABORT: LONG rejected (gap down > {GAP_LIMIT*100:.1f}%).")
        return False
    if plan.direction == "SHORT" and gap > GAP_LIMIT:
        print(f"[{plan.ticker}] ABORT: SHORT rejected (gap up > {GAP_LIMIT*100:.1f}%).")
        return False
    return True

def entry_condition_met(direction: str, price: float, trigger: float) -> bool:
    return (price > trigger) if direction == "LONG" else (price < trigger)

def stock_sl_hit(plan: Plan, stock_price: float) -> bool:
    # SL is an underlying stock threshold.
    # LONG: stop if stock <= sl_stock
    # SHORT: stop if stock >= sl_stock
    if plan.direction == "LONG":
        return stock_price <= plan.sl_stock
    else:
        return stock_price >= plan.sl_stock


# =========================
# BOOTSTRAP / RECONCILE OPEN POSITIONS
# =========================
def bootstrap_from_open_positions(trading_client: TradingClient, states: dict[str, State], app_state: dict):
    day_bucket = get_day_bucket(app_state, today_nyc())
    traded_today = set(day_bucket.get("traded_today", []))

    positions = trading_client.get_all_positions()

    for ticker, st in states.items():
        open_for_ticker = [p for p in positions if p.symbol.startswith(ticker)]
        if not open_for_ticker:
            continue

        traded_today.add(ticker)
        st.has_entered = True

        # prefer exact contract match if present
        pos = None
        for p in open_for_ticker:
            if p.symbol == st.plan.contract:
                pos = p
                break
        if pos is None:
            pos = open_for_ticker[0]

        current_qty = int(float(pos.qty))
        tinfo = day_bucket.setdefault("tickers", {}).get(ticker, {})

        # original_qty for partial inference
        if "original_qty" in tinfo:
            original_qty = int(tinfo["original_qty"])
        else:
            original_qty = st.plan.qty if st.plan.qty else current_qty
            day_bucket.setdefault("tickers", {}).setdefault(ticker, {})["original_qty"] = original_qty

        # took_partial
        if "took_partial" in tinfo:
            st.took_partial = bool(tinfo["took_partial"])
        else:
            st.took_partial = current_qty < original_qty
            day_bucket.setdefault("tickers", {}).setdefault(ticker, {})["took_partial"] = st.took_partial

        # partial_qty_sold
        if "partial_qty_sold" not in tinfo:
            day_bucket.setdefault("tickers", {}).setdefault(ticker, {})["partial_qty_sold"] = max(0, original_qty - current_qty)

        try:
            st.entry_avg_price = float(pos.avg_entry_price)
        except Exception:
            st.entry_avg_price = None

    day_bucket["traded_today"] = sorted(traded_today)
    save_state_file(app_state)
    return traded_today


# =========================
# TP / BE STOP MANAGEMENT
# =========================
def maybe_take_partial_and_arm_be_stop(trading_client: TradingClient, st: State, app_state: dict):
    pos = get_position_for_contract(trading_client, st.plan.contract)
    if pos is None:
        return

    plpc_total = compute_total_unrealized_pl_pct(pos)
    if plpc_total is None:
        plpc_total = float(pos.unrealized_plpc)  # fallback if fields unavailable
    st.last_plpc = plpc_total
    plpc = plpc_total


    if st.entry_avg_price is None:
        try:
            st.entry_avg_price = float(pos.avg_entry_price)
        except Exception:
            st.entry_avg_price = None

    if (not st.took_partial) and plpc >= TP_PCT:
        qty = int(float(pos.qty))
        original_qty = st.plan.qty

        day_bucket = get_day_bucket(app_state, today_nyc())
        tinfo = day_bucket.setdefault("tickers", {}).setdefault(st.plan.ticker, {})
        tinfo["original_qty"] = original_qty

        if qty <= 1:
            print(f"[{st.plan.ticker}] TP hit (+{plpc*100:.2f}%). Qty=1 so closing all.")
            close_all_for_ticker(trading_client, st.plan.ticker)

            st.took_partial = True
            tinfo["took_partial"] = True
            tinfo["partial_qty_sold"] = int(tinfo.get("partial_qty_sold", 0)) + qty
            save_state_file(app_state)
            return True

        half = qty // 2
        if half < 1:
            half = 1

        print(f"[{st.plan.ticker}] TP hit (+{plpc*100:.2f}%). Selling half: {half}/{qty}")
        submit_sell(trading_client, st.plan.contract, half)

        st.took_partial = True
        tinfo["took_partial"] = True
        tinfo["partial_qty_sold"] = int(tinfo.get("partial_qty_sold", 0)) + half
        save_state_file(app_state)
    return False


def find_last_close_day(data_client: StockHistoricalDataClient, ticker: str, start_day: date, max_lookback_days: int = 14):
    """
    Walk backward from start_day (exclusive) up to max_lookback_days until we find a day
    with intraday data, and return (day_found, close_price).

    This handles weekends and market holidays (when no bars exist).
    """
    d = start_day
    for i in range(1, max_lookback_days + 1):
        d = d - timedelta(days=1)
        df = fetch_intraday_1m(data_client, ticker, d)
        if df is None or df.empty:
            continue
        last_close = float(df["close"].iloc[-1])
        return d, last_close

    raise RuntimeError(
        f"Could not find any prior trading day data for {ticker} within last {max_lookback_days} calendar days."
    )


def breakeven_stop_hit(trading_client: TradingClient, st: State) -> bool:
    if not st.took_partial:
        return False
    pos = get_position_for_contract(trading_client, st.plan.contract)
    if pos is None:
        return False
    plpc_total = compute_total_unrealized_pl_pct(pos)
    if plpc_total is None:
        plpc_total = float(pos.unrealized_plpc)  # fallback
    st.last_plpc = plpc_total
    return plpc_total <= BE_STOP_PCT


def stock_tp_hit(plan: Plan, stock_price: float) -> bool:
    # LONG: take profit if stock >= tp_stock
    # SHORT: take profit if stock <= tp_stock
    if plan.direction == "LONG":
        return stock_price >= plan.tp_stock
    else:
        return stock_price <= plan.tp_stock


def persist_carry_from_open_positions(trading_client: TradingClient, states: dict[str, State], app_state: dict) -> None:
    """Persist ONLY actually-open positions (not just watched tickers) into app_state['carry'].

    This runs at end-of-day. We DO NOT close positions here.
    """
    open_positions = trading_client.get_all_positions()

    day_bucket = get_day_bucket(app_state, today_nyc())
    tickers_info = day_bucket.setdefault("tickers", {})

    carry_out: list[dict] = []

    for ticker, st in states.items():
        # Prefer exact contract match; fall back to any position starting with ticker
        pos = None
        for p in open_positions:
            if p.symbol == st.plan.contract:
                pos = p
                break
        if pos is None:
            for p in open_positions:
                if p.symbol.startswith(ticker):
                    pos = p
                    break
        if pos is None:
            continue  # not entered (or already closed) -> do not carry

        try:
            qty = int(float(pos.qty))
        except Exception:
            qty = st.plan.qty

        tinfo = tickers_info.get(ticker, {}) if isinstance(tickers_info, dict) else {}

        carry_out.append(
            {
                "ticker": ticker,
                "contract": pos.symbol,
                "qty": qty,
                "direction": st.plan.direction,
                "sl_stock": st.plan.sl_stock,
                "tp_stock": st.plan.tp_stock,
                "took_partial": bool(st.took_partial),
                "entry_avg_price": st.entry_avg_price,
                "original_qty": int(tinfo.get("original_qty", st.plan.qty)),
                "partial_qty_sold": int(tinfo.get("partial_qty_sold", 0)),
            }
        )

    app_state["carry"] = carry_out
    save_state_file(app_state)


# =========================
# MAIN
# =========================
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--plans",
        required=False,
        default=None,
        help="Path to plans JSON file. Optional — bot will still manage carried positions if no plans provided.",
    )
    args = parser.parse_args()

    raw: list[dict] = []
    if args.plans:
        try:
            with open(args.plans, "r") as f:
                raw = json.load(f)
            if not isinstance(raw, list):
                raw = []
        except Exception as e:
            print(f"[WARN] Could not load plans file ({args.plans}): {e}. Continuing with no new plans.")
            raw = []
    else:
        print("[BOOT] No --plans file provided. Will manage carried positions only.")

    plans: list[Plan] = []
    for p in raw:
        try:
            plans.append(
                Plan(
                    ticker=str(p["ticker"]).upper().strip(),
                    contract=str(p["contract"]).upper().strip(),
                    qty=int(p["qty"]),
                    direction=str(p["type"]).upper().strip(),
                    sl_stock=float(p["sl_stock"]),
                    tp_stock=float(p["tp_stock"]),
                )
            )
        except Exception as e:
            print(f"[WARN] Skipping malformed plan entry {p}: {e}")

    trading_client = TradingClient(API_KEY, API_SECRET, paper=PAPER)
    data_client = StockHistoricalDataClient(API_KEY, API_SECRET)
    option_data_client = OptionHistoricalDataClient(API_KEY, API_SECRET)

    settings = load_settings()
    hard_stop_pct  = settings["hard_stop_pct"]   # e.g. 0.50 means close at -50%
    effective_tp   = settings["tp_pct"]
    effective_poll = settings["poll_seconds"]
    effective_gap  = settings["gap_limit"]
    print(f"[settings] hard_stop={hard_stop_pct*100:.0f}%  tp_pct={effective_tp*100:.0f}%  "
          f"poll={effective_poll}s  gap_limit={effective_gap*100:.0f}%")

    wait_until_market_open()

    # Load persistent state for today
    app_state = load_state_file()
    day_bucket = get_day_bucket(app_state, today_nyc())

    # Build per-ticker runtime state
    states: dict[str, State] = {pl.ticker: State(plan=pl) for pl in plans}

    # traded_today: anything already opened/carried counts as traded today
    traded_today = set(day_bucket.get("traded_today", []))

    # 0) Consume any carried positions from yesterday (and clear carry immediately)
    carried_ok = consume_carry_positions(trading_client, states, app_state, traded_today)
    # =========================
    # PRE-FLIGHT DEBUG SNAPSHOT
    # =========================
    print("\n================ PRE-FLIGHT DEBUG ================")

    print("\n[DEBUG] Raw plans.json:")
    if not raw:
        print("  (EMPTY)")
    else:
        for p in raw:
            print(f"  {p}")

    print("\n[DEBUG] Raw daily_bot_state.json:")
    if not app_state:
        print("  (EMPTY FILE)")
    else:
        print(json.dumps(app_state, indent=2))

    print("\n[DEBUG] Consumed carry positions (this run):")
    if not carried_ok:
        print("  (NONE)")
    else:
        for t in carried_ok:
            print(f"  - {t}")

    print("\n[DEBUG] traded_today (after carry consumption):")
    print(f"  {sorted(traded_today) if traded_today else '(EMPTY)'}")

    print("\n[DEBUG] Runtime states (effective tickers to monitor):")
    if not states:
        print("  (NO ACTIVE STATES)")
    else:
        for ticker, st in states.items():
            print(f"\n  TICKER: {ticker}")
            print(f"    contract     : {st.plan.contract}")
            print(f"    qty          : {st.plan.qty}")
            print(f"    direction    : {st.plan.direction}")
            print(f"    sl_stock     : {st.plan.sl_stock}")
            print(f"    tp_stock     : {st.plan.tp_stock}")
            print(f"    has_entered  : {st.has_entered}")
            print(f"    took_partial : {st.took_partial}")
            print(f"    entry_avg_px : {st.entry_avg_price}")

    print("\n================ END PRE-FLIGHT ==================\n")    
    # 1) Gap filter per ticker (disable those that fail)
    # NOTE: skip gap filter for tickers already in an open position (carried)

    disabled = set()
    for t, st in states.items():
        if t in carried_ok:
            continue
        try:
            if not gap_filter_ok(data_client, st.plan):
                disabled.add(t)
        except Exception as e:
            print(f"[{t}] GAP check failed: {e}. Disabling.")
            disabled.add(t)

    for t in disabled:
        states.pop(t, None)

    if not states:
        # No plans + no carry-derived states.
        # BUT we still may have open positions that need monitoring.
        seed_states_from_any_open_positions(trading_client, states)

        if not states:
            print("[STOP] No active plans after gap filters and no Alpaca open positions to manage.")
            return


    # 2) Bootstrap open-position state (in case the bot restarted mid-day)
    traded_today |= set(bootstrap_from_open_positions(trading_client, states, app_state))

    print(f"[BOOT] Active tickers: {list(states.keys())}")
    print(f"[BOOT] traded_today: {sorted(traded_today)}")

    # 3) Main session loop
    try:
      while not should_stop_for_close() and states:
        # Pull positions once per loop for efficiency
        open_positions = trading_client.get_all_positions()

        for ticker, st in list(states.items()):
            # Mark entered if any open position exists for ticker (including day-over-day)
            has_any_pos = any(p.symbol.startswith(ticker) for p in open_positions)
            st.has_entered = has_any_pos

            # Always fetch underlying stock price (needed for SL and entry checks)
            try:
                stock_px = get_latest_stock_price(data_client, ticker)
            except Exception as e:
                print(f"[{ticker}] Price fetch failed: {e}")
                continue

            # 3A) If not entered, enforce "no re-entry today"
            if not st.has_entered:
                if ticker in traded_today:
                    print(f"[{ticker}] Skipping entry: ticker already traded today.")
                    continue

                # Find / cache first trigger candle
                if st.trigger_level is None:
                    trig, ts = find_first_signal_level(data_client, ticker, st.plan.direction)
                    if trig is None:
                        print(f"[{ticker}] Waiting for first qualifying candle...")
                        continue
                    st.trigger_level, st.trigger_ts = trig, ts
                    print(f"[{ticker}] Trigger={st.trigger_level:.2f} @ {st.trigger_ts}")
                
                # Entry check: latest COMPLETED 5m close vs trigger
                close_5m, close_ts = get_latest_completed_5m_close(data_client, ticker)
                if close_5m is None:
                    print(f"[{ticker}] Waiting for completed 5m candle close...")
                    continue
                    
                if close_5m is None:
                    print(f"[{ticker}] Waiting for completed 5m candle close...")
                    continue

                if st.plan.direction == "LONG":
                    enter_ok = close_5m > st.trigger_level
                else:
                    enter_ok = close_5m < st.trigger_level

                if enter_ok:
                    print(
                        f"[{ticker}] ENTRY on 5m close. close_5m={close_5m:.2f} @ {close_ts} "
                        f"trigger={st.trigger_level:.2f} ({st.plan.direction}). Buying {st.plan.contract} x{st.plan.qty}"
                    )
                    submit_entry(trading_client, option_data_client, st.plan.contract, st.plan.qty)

                    st.has_entered = True

                    # Persist "traded today" and baseline ticker tracking
                    traded_today.add(ticker)
                    day_bucket = get_day_bucket(app_state, today_nyc())
                    day_bucket["traded_today"] = sorted(set(day_bucket.get("traded_today", [])) | {ticker})
                    tinfo = day_bucket.setdefault("tickers", {}).setdefault(ticker, {})
                    tinfo["original_qty"] = st.plan.qty
                    tinfo["took_partial"] = False
                    tinfo["partial_qty_sold"] = 0
                    save_state_file(app_state)
                else:
                    # Avoid spamming the same 5m close every loop; only print when the completed 5m bar advances.
                    last_printed_ts = getattr(st, "last_printed_5m_ts", None)
                    if last_printed_ts != close_ts:
                        st.last_printed_5m_ts = close_ts
                        print(
                            f"[{ticker}] Watching: 5m_close={close_5m:.2f} @ {close_ts} "
                            f"trigger={st.trigger_level:.2f} ({st.plan.direction})"
                        )

                continue  # next ticker
                 
            # 3B) Entered: underlying stock TP overrides everything
            if stock_tp_hit(st.plan, stock_px):
                print(f"[{ticker}] STOCK TP hit at {stock_px:.2f} (TP={st.plan.tp_stock}). Closing ALL for ticker.")
                close_all_for_ticker(trading_client, ticker)

                # keep ticker in traded_today so no re-entry
                traded_today.add(ticker)
                day_bucket = get_day_bucket(app_state, today_nyc())
                day_bucket["traded_today"] = sorted(set(day_bucket.get("traded_today", [])) | {ticker})
                save_state_file(app_state)

                states.pop(ticker, None)
                continue

            if stock_sl_hit(st.plan, stock_px):
                print(f"[{ticker}] STOCK SL hit at {stock_px:.2f} (SL={st.plan.sl_stock}). Closing ALL for ticker.")
                close_all_for_ticker(trading_client, ticker)

                # Keep ticker in traded_today so no re-entry
                traded_today.add(ticker)
                day_bucket = get_day_bucket(app_state, today_nyc())
                day_bucket["traded_today"] = sorted(set(day_bucket.get("traded_today", [])) | {ticker})
                save_state_file(app_state)

                states.pop(ticker, None)
                continue

            # 3C) Hard stop — option P/L below threshold from settings.json
            pos_check = get_position_for_contract(trading_client, st.plan.contract)
            if pos_check is not None:
                plpc_check = compute_total_unrealized_pl_pct(pos_check)
                if plpc_check is None:
                    try:
                        plpc_check = float(pos_check.unrealized_plpc)
                    except Exception:
                        plpc_check = None
                st.last_plpc = plpc_check
                if plpc_check is not None and plpc_check <= -hard_stop_pct:
                    print(f"[{ticker}] HARD STOP hit: option P/L={plpc_check*100:.1f}% "
                          f"<= -{hard_stop_pct*100:.0f}%. Closing ALL.")
                    close_all_for_ticker(trading_client, ticker)
                    traded_today.add(ticker)
                    day_bucket = get_day_bucket(app_state, today_nyc())
                    day_bucket["traded_today"] = sorted(set(day_bucket.get("traded_today", [])) | {ticker})
                    save_state_file(app_state)
                    states.pop(ticker, None)
                    continue

            # 3D) TP partial + BE stop (option P/L based)
            closed_all = maybe_take_partial_and_arm_be_stop(trading_client, st, app_state)
            if closed_all:
                states.pop(ticker, None)
                continue

            if breakeven_stop_hit(trading_client, st):
                print(f"[{ticker}] Breakeven stop hit (P/L back to 0%). Closing remaining for ticker.")
                close_all_for_ticker(trading_client, ticker)
                states.pop(ticker, None)
                continue

            # Status line
            if st.last_plpc is not None:
                print(f"[{ticker}] Stock={stock_px:.2f} OptionP/L={st.last_plpc*100:.2f}% partial={st.took_partial}")
            else:
                print(f"[{ticker}] Stock={stock_px:.2f} (position open) partial={st.took_partial}")

        print("----")
        time.sleep(POLL_SECONDS)

    except KeyboardInterrupt:
        print("\n[SHUTDOWN] Bot stopped (Ctrl-C). Saving carry + SL/TP...")
        _emergency_persist(trading_client, states, app_state)
        return

    # 4) End-of-day: DO NOT flatten. Persist any still-open positions into STATE_PATH['carry'] for tomorrow
    if states:
        persist_carry_from_open_positions(trading_client, states, app_state)

        if app_state.get("carry"):
            print(
                f"[CLOSE] Close cutoff reached. Saved carry positions for tomorrow: "
                f"{[c['ticker'] for c in app_state['carry']]}"
            )
        else:
            print("[CLOSE] Close cutoff reached. No open positions to carry.")


def _emergency_persist(trading_client, states, app_state):
    """Persist carry + SL/TP on any unexpected shutdown (Ctrl-C, SIGTERM)."""
    if not states:
        return
    try:
        persist_carry_from_open_positions(trading_client, states, app_state)
        tickers = [e["ticker"] for e in app_state.get("carry", [])]
        if tickers:
            print(f"[SHUTDOWN] Carry saved for: {tickers}")
        else:
            print("[SHUTDOWN] No open positions to carry.")
    except Exception as ex:
        print(f"[SHUTDOWN] Emergency persist failed: {ex}")


if __name__ == "__main__":
    main()


# DTE: 21–45 days
# Delta: 0.35–0.55
# Strike: ATM or 1 ITM
# Avoid: <14 DTE unless day trading

# Example of plans.json entry:
#   {
#     "ticker": "AAPL",
#     "contract": "AAPL260220C00190000",
#     "qty": 2,
#     "type": "LONG",
#     "sl_stock": 185.0,
#     "tp_stock": 210.0
#   }

# New validation: if P%L is 50% or higher, and TP has not hit yet, move SL to 30% to lock in gains while still allowing for some upside. This is a common technique to protect profits while giving the trade room to breathe.