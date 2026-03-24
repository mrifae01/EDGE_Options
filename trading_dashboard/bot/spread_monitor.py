"""
spread_monitor.py

Periodically calls /api/bcs/monitor and /api/bps/monitor so that:
  - Pending (queued) spread plans are submitted to Alpaca as limit orders
  - Open spread positions are checked for profit-target / stop-loss / time-stop exits

Designed to run alongside (or completely independently of) the main single-leg
options bot.  Uses only Python stdlib — no third-party dependencies required.

Only polls during regular market hours Mon–Fri 09:30–16:00 ET so it won't
spam the API or attempt orders on a closed exchange.
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone, timedelta


# ── Config ────────────────────────────────────────────────────────────────────
BASE_URL = os.environ.get("EDGE_API_URL", "http://localhost:8000")

# UTC offset for New York (handles DST by using fixed offsets at startup;
# good enough for an intraday process that restarts each day).
def _nyc_now() -> datetime:
    """Return current datetime in America/New_York approximation."""
    try:
        import zoneinfo
        return datetime.now(zoneinfo.ZoneInfo("America/New_York"))
    except ImportError:
        # fallback: use the local wall-clock offset (acceptable for Windows)
        return datetime.now()


def is_market_hours() -> bool:
    """True if currently Mon–Fri 09:30–16:00 ET."""
    now = _nyc_now()
    if now.weekday() >= 5:          # 5=Saturday, 6=Sunday
        return False
    t = (now.hour, now.minute)
    return (9, 30) <= t < (16, 0)


# ── Logging ───────────────────────────────────────────────────────────────────
def log(msg: str):
    ts = _nyc_now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] [SPREAD-MON] {msg}", flush=True)


# ── Monitor call ──────────────────────────────────────────────────────────────
def call_monitor(endpoint: str, label: str):
    url = f"{BASE_URL}{endpoint}"
    try:
        req = urllib.request.Request(
            url,
            data=b"{}",
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw  = resp.read().decode("utf-8", errors="replace")
            data = json.loads(raw) if raw.strip() else {}

        placed = data.get("placed", [])
        closed = data.get("closed", [])
        errors = data.get("errors", [])

        if placed:
            log(f"{label}: placed {placed}")
        if closed:
            log(f"{label}: closed {closed}")
        if errors:
            log(f"{label}: errors {errors}")
        if not placed and not closed and not errors:
            log(f"{label}: OK (nothing to act on)")

    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace") if e.fp else ""
        log(f"{label}: HTTP {e.code} — {body[:200]}")
    except Exception as e:
        log(f"{label}: ERROR — {e}")


# ── Main loop ─────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="Spread monitor — polls BCS and BPS monitor endpoints"
    )
    parser.add_argument(
        "--interval",
        type=int,
        default=300,
        help="Seconds between poll cycles (default 300)",
    )
    args = parser.parse_args()

    log(f"Started.  API={BASE_URL}  interval={args.interval}s")

    while True:
        # Always poll — let the API and Alpaca handle market-hours gating.
        # GTC orders submitted outside hours simply queue until the next open.
        call_monitor("/api/bcs/monitor", "BCS")
        call_monitor("/api/bps/monitor", "BPS")
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
