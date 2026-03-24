import { useState, useCallback } from "react"
import { api } from "../lib/api.js"
import { Search, X, RefreshCw, TrendingDown, AlertTriangle, ChevronRight } from "lucide-react"
import "./BearPutSpread.css"

// ── Read watchlist from the Screener tab's localStorage key ──────────────────
function loadScreenerWatchlist() {
  try {
    const raw = localStorage.getItem("screener_watchlist_v1")
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(v, d = 2) { return v != null ? Number(v).toFixed(d) : "—" }

// ── Spread detail side-panel ──────────────────────────────────────────────────
function SpreadDetail({ candidate, onPlace, onClose, placing }) {
  if (!candidate) return null
  const c = candidate

  const maxGain   = c.max_gain_per_contract
  const maxLoss   = c.max_loss_per_contract
  // breakeven for a put spread = long strike − net debit
  const breakeven = c.long_strike != null && c.net_debit != null
    ? (c.long_strike - c.net_debit).toFixed(2)
    : "—"

  return (
    <div className="bps-detail">
      <div className="bps-detail-header">
        <div>
          <div className="bps-detail-ticker">{c.ticker}</div>
          <div className="mono dim" style={{ fontSize: 12 }}>Bear Put Spread · {c.expiry}</div>
        </div>
        <button className="btn btn-ghost icon-btn" onClick={onClose}><X size={14} /></button>
      </div>

      <div className="bps-detail-price">
        <span className="mono dim">Stock&nbsp;</span>
        <span className="mono">${fmt(c.price)}</span>
        {c.dte != null && <span className="bps-dte-chip">{c.dte} DTE</span>}
      </div>

      {/* Long leg (higher-strike put — BUY) */}
      <div className="bps-leg bps-leg-long">
        <div className="bps-leg-label">BUY (long)</div>
        <div className="bps-leg-contract mono">{c.long_contract}</div>
        <div className="bps-leg-row">
          <span className="dim">Strike</span>
          <span className="mono">${fmt(c.long_strike)}</span>
        </div>
        <div className="bps-leg-row">
          <span className="dim">Ask</span>
          <span className="mono">{c.long_ask != null ? `$${fmt(c.long_ask)}` : "—"}</span>
        </div>
        {c.long_delta != null && (
          <div className="bps-leg-row">
            <span className="dim">Delta</span>
            <span className="mono">{c.long_delta.toFixed(2)}</span>
          </div>
        )}
        {c.long_iv != null && (
          <div className="bps-leg-row">
            <span className="dim">IV</span>
            <span className="mono">{(c.long_iv * 100).toFixed(1)}%</span>
          </div>
        )}
      </div>

      {/* Short leg (lower-strike put — SELL) */}
      <div className="bps-leg bps-leg-short">
        <div className="bps-leg-label">SELL (short)</div>
        <div className="bps-leg-contract mono">{c.short_contract}</div>
        <div className="bps-leg-row">
          <span className="dim">Strike</span>
          <span className="mono">${fmt(c.short_strike)}</span>
        </div>
        <div className="bps-leg-row">
          <span className="dim">Bid</span>
          <span className="mono">{c.short_bid != null ? `$${fmt(c.short_bid)}` : "—"}</span>
        </div>
      </div>

      {/* Risk summary */}
      <div className="bps-risk-grid">
        <div className="bps-risk-cell">
          <div className="dim mono" style={{ fontSize: 10 }}>NET DEBIT</div>
          <div className="mono amber">${fmt(c.net_debit)}<span className="dim">/sh</span></div>
          <div className="mono dim" style={{ fontSize: 11 }}>${fmt(c.net_debit_total)} total</div>
        </div>
        <div className="bps-risk-cell">
          <div className="dim mono" style={{ fontSize: 10 }}>BREAKEVEN</div>
          <div className="mono">${breakeven}</div>
        </div>
        <div className="bps-risk-cell">
          <div className="dim mono" style={{ fontSize: 10 }}>MAX GAIN</div>
          <div className="mono green">${fmt(maxGain, 0)}</div>
          <div className="mono dim" style={{ fontSize: 11 }}>per contract</div>
        </div>
        <div className="bps-risk-cell">
          <div className="dim mono" style={{ fontSize: 10 }}>MAX LOSS</div>
          <div className="mono red">${fmt(maxLoss, 0)}</div>
        </div>
        <div className="bps-risk-cell">
          <div className="dim mono" style={{ fontSize: 10 }}>SPREAD WIDTH</div>
          <div className="mono">${fmt(c.spread_width)}</div>
        </div>
        <div className="bps-risk-cell">
          <div className="dim mono" style={{ fontSize: 10 }}>RISK / REWARD</div>
          <div className="mono">{c.risk_reward != null ? `${c.risk_reward}×` : "—"}</div>
        </div>
      </div>

      {c.trigger && (
        <div className="bps-trigger-note mono dim">
          <TrendingDown size={11} />
          Rejection confirmed {c.trigger.red_candle?.date} · SMA20 ${fmt(c.trigger.sma20)}
        </div>
      )}

      <button
        className="btn btn-red bps-place-btn"
        onClick={() => onPlace(c)}
        disabled={placing}
      >
        {placing ? "Adding…" : "Add to Plan"}
      </button>
    </div>
  )
}

// ── Scan results table ────────────────────────────────────────────────────────
function ScanTable({ candidates, selected, onSelect }) {
  if (candidates.length === 0) {
    return (
      <div className="bps-empty mono dim">
        No candidates matched. Try scanning during market hours, or add tickers to your watchlist and scan those.
      </div>
    )
  }
  return (
    <div className="bps-table-wrap">
      <table className="bps-table">
        <thead>
          <tr>
            <th></th>
            <th>Ticker</th>
            <th>Price</th>
            <th>Expiry</th>
            <th>DTE</th>
            <th>Long Strike</th>
            <th>Short Strike</th>
            <th>Net Debit</th>
            <th>Max Gain</th>
            <th>R/R</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((c, i) => (
            <tr
              key={i}
              className={`bps-row${selected?.ticker === c.ticker ? " bps-row-selected" : ""}`}
              onClick={() => onSelect(c)}
            >
              <td><ChevronRight size={12} className="dim" /></td>
              <td className="mono bold">{c.ticker}</td>
              <td className="mono">${fmt(c.price)}</td>
              <td className="mono dim">{c.expiry}</td>
              <td className="mono">{c.dte ?? "—"}</td>
              <td className="mono">${fmt(c.long_strike)}</td>
              <td className="mono">${fmt(c.short_strike)}</td>
              <td className="mono amber">${fmt(c.net_debit)}</td>
              <td className="mono green">${fmt(c.max_gain_per_contract, 0)}</td>
              <td className="mono">{c.risk_reward != null ? `${c.risk_reward}×` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Watchlist read-only (shared with Screener tab) ────────────────────────────
function WatchlistReadOnly() {
  const tickers = loadScreenerWatchlist()
  return (
    <div className="bps-watchlist">
      <div className="bps-watchlist-chips">
        {tickers.length === 0 ? (
          <span className="mono dim" style={{ fontSize: 12 }}>
            No tickers saved — add them on the <strong>Screener</strong> tab.
          </span>
        ) : (
          tickers.map(t => (
            <span key={t} className="bps-chip">{t}</span>
          ))
        )}
      </div>
      <div className="mono dim" style={{ fontSize: 11, marginTop: 8 }}>
        Manage this list on the Screener tab. Changes appear here automatically.
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function BearPutSpread() {
  const [scanResult, setScanResult] = useState(null)
  const [scanning,   setScanning]   = useState(false)
  const [scanError,  setScanError]  = useState(null)
  const [selected,   setSelected]   = useState(null)
  const [placing,    setPlacing]    = useState(false)
  const [toast,      setToast]      = useState(null)

  const showToast = useCallback((msg, type = "ok") => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }, [])

  async function handleScan(watchlistOnly = false) {
    setScanning(true)
    setScanError(null)
    setSelected(null)
    try {
      const tickers = watchlistOnly ? loadScreenerWatchlist() : null
      const result  = await api.runBPSScan(tickers)
      setScanResult(result)
      if (result.matched === 0) {
        showToast(`No candidates found from ${result.scanned} tickers scanned.`, "error")
      } else {
        showToast(`${result.matched} candidate${result.matched !== 1 ? "s" : ""} found.`)
      }
    } catch (e) {
      setScanError(e.message)
      showToast(e.message, "error")
    } finally {
      setScanning(false)
    }
  }

  async function handlePlace(candidate) {
    setPlacing(true)
    try {
      await api.queueBPSSpread({
        ticker:         candidate.ticker,
        long_contract:  candidate.long_contract,
        short_contract: candidate.short_contract,
        long_strike:    candidate.long_strike,
        short_strike:   candidate.short_strike,
        expiry:         candidate.expiry,
        net_debit:      candidate.net_debit,
        long_ask:       candidate.long_ask,
        short_bid:      candidate.short_bid,
      })
      showToast(`${candidate.ticker} added to plan — bot will place on next cycle.`)
      setSelected(null)
    } catch (e) {
      showToast(e.message, "error")
    } finally {
      setPlacing(false)
    }
  }

  return (
    <div className="bps">

      {toast && (
        <div className={`bps-toast bps-toast-${toast.type}`}>{toast.msg}</div>
      )}

      {/* ── Watchlist (read-only — managed on Screener tab) ─────────────────── */}
      <div className="card">
        <div className="card-title">Watchlist</div>
        <WatchlistReadOnly />
      </div>

      {/* ── Scanner controls ────────────────────────────────────────────────── */}
      <div className="card">
        <div className="bps-scan-controls">
          <div>
            <div className="card-title" style={{ marginBottom: 4 }}>Scanner</div>
            <div className="mono dim" style={{ fontSize: 12 }}>
              Finds bearish stocks trending below SMA20 &amp; SMA50 with a rejection-at-resistance entry trigger.
            </div>
          </div>
          <div className="bps-scan-btns">
            <button
              className="btn btn-ghost"
              onClick={() => handleScan(true)}
              disabled={scanning}
              title="Scan only your Screener watchlist tickers"
            >
              <Search size={13} />
              {scanning ? "Scanning…" : "Scan Watchlist"}
            </button>
            <button
              className="btn btn-red"
              onClick={() => handleScan(false)}
              disabled={scanning}
            >
              <RefreshCw size={13} className={scanning ? "spin" : ""} />
              {scanning ? "Scanning…" : "Scan Universe"}
            </button>
          </div>
        </div>

        {scanError && (
          <div className="bps-scan-error">
            <AlertTriangle size={14} /> {scanError}
          </div>
        )}

        {scanResult && (
          <>
            <div className="bps-scan-meta mono dim">
              {scanResult.matched} candidate{scanResult.matched !== 1 ? "s" : ""} ·
              {scanResult.scanned} tickers scanned ·
              target expiry <strong>{scanResult.target_expiry}</strong>
            </div>

            <div className={`bps-results-wrap${selected ? " bps-results-split" : ""}`}>
              <div className="bps-results-left">
                <ScanTable
                  candidates={scanResult.candidates}
                  selected={selected}
                  onSelect={c => setSelected(prev => prev?.ticker === c.ticker ? null : c)}
                />
                {scanResult.errors?.length > 0 && (
                  <details className="bps-warnings">
                    <summary className="mono dim">{scanResult.errors.length} scan warning(s)</summary>
                    <ul className="bps-warnings-list mono dim">
                      {scanResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  </details>
                )}
              </div>

              {selected && (
                <div className="bps-results-right">
                  <SpreadDetail
                    candidate={selected}
                    onPlace={handlePlace}
                    onClose={() => setSelected(null)}
                    placing={placing}
                  />
                </div>
              )}
            </div>
          </>
        )}
      </div>

    </div>
  )
}
