import { useState, useCallback, useEffect, useRef } from "react"
import { api } from "../lib/api.js"
import { Search, X, RefreshCw, TrendingUp, AlertTriangle, ChevronRight, Loader2 } from "lucide-react"
import "./BullCallSpread.css"

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

// ── Chart helpers (mirrors Screener) ─────────────────────────────────────────
var _bcsLwcPromise = null
function bcsLoadLWC() {
  if (_bcsLwcPromise) return _bcsLwcPromise
  _bcsLwcPromise = new Promise(function(resolve) {
    if (window.LightweightCharts) { resolve(window.LightweightCharts); return }
    var s = document.createElement("script")
    s.src = "https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js"
    s.onload = function() { resolve(window.LightweightCharts) }
    document.head.appendChild(s)
  })
  return _bcsLwcPromise
}
function bcsCalcSMA(bars, period) {
  return bars.map(function(_, i) {
    if (i < period - 1) return null
    var sum = 0
    for (var j = i - period + 1; j <= i; j++) sum += bars[j].c
    return sum / period
  })
}
var BCS_TF_OPTIONS = [
  { label: "1W", value: "1Week", lookback: 1825 },
  { label: "1D", value: "1Day",  lookback: 1825 },
  { label: "4H", value: "4Hour", lookback: 120  },
  { label: "1H", value: "1Hour", lookback: 90   },
]
function bcsBarTime(b, intraday) {
  if (!intraday) return b.t.slice(0, 10)
  return Math.floor(new Date(b.t).getTime() / 1000)
}

function BCSStockChart({ symbol, onClose }) {
  var tf_s = useState("1Day"); var tf = tf_s[0]; var setTf = tf_s[1]
  var ds   = useState(null);   var bars    = ds[0]; var setBars    = ds[1]
  var ls   = useState(true);   var loading = ls[0]; var setLoading = ls[1]
  var es   = useState(null);   var error   = es[0]; var setError   = es[1]
  var rdy  = useState(false);  var lwcOk   = rdy[0]; var setLwcOk  = rdy[1]
  var containerRef = useRef(null)
  var chartRef     = useRef(null)
  var intraday = tf === "4Hour" || tf === "1Hour"

  useEffect(function() { bcsLoadLWC().then(function() { setLwcOk(true) }) }, [])

  useEffect(function() {
    setLoading(true); setError(null); setBars(null)
    var opt = BCS_TF_OPTIONS.find(function(o){ return o.value === tf }) || BCS_TF_OPTIONS[1]
    fetch("/api/chart/bars?symbol=" + encodeURIComponent(symbol) + "&timeframe=" + encodeURIComponent(tf) + "&lookback_days=" + opt.lookback)
      .then(function(r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json() })
      .then(function(data) { if (!data || !data.length) throw new Error("No data for " + symbol); setBars(data); setLoading(false) })
      .catch(function(e) { setError(e.message); setLoading(false) })
  }, [symbol, tf])

  useEffect(function() {
    if (!lwcOk || !bars || !containerRef.current) return
    var LWC = window.LightweightCharts
    if (chartRef.current) { chartRef.current.remove(); chartRef.current = null }
    var chart = LWC.createChart(containerRef.current, {
      width: containerRef.current.clientWidth, height: containerRef.current.clientHeight,
      layout: { background: { type: "solid", color: "#080b0f" }, textColor: "#64748b", fontSize: 11, fontFamily: "monospace" },
      grid: { vertLines: { color: "#0f172a" }, horzLines: { color: "#0f172a" } },
      crosshair: { mode: LWC.CrosshairMode.Normal, vertLine: { color: "#334155", labelBackgroundColor: "#1e293b" }, horzLine: { color: "#334155", labelBackgroundColor: "#1e293b" } },
      rightPriceScale: { borderColor: "#1e293b", scaleMargins: { top: 0.06, bottom: 0.28 } },
      timeScale: { borderColor: "#1e293b", timeVisible: intraday, secondsVisible: false, rightOffset: 60, barSpacing: intraday ? 6 : 8, minBarSpacing: 2 },
    })
    var ro = new ResizeObserver(function(entries) { if (chartRef.current && entries[0]) { var r = entries[0].contentRect; chartRef.current.resize(r.width, r.height) } })
    ro.observe(containerRef.current)
    var candles = chart.addCandlestickSeries({ upColor: "#26a69a", downColor: "#ef5350", borderUpColor: "#26a69a", borderDownColor: "#ef5350", wickUpColor: "#26a69a", wickDownColor: "#ef5350" })
    var volume  = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol" })
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
    if (!intraday) {
      var sma10v  = bcsCalcSMA(bars, 10); var sma20v = bcsCalcSMA(bars, 20); var sma200v = bcsCalcSMA(bars, 200)
      var sma10s  = chart.addLineSeries({ color: "#29b6f6", lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: "10" })
      var sma20s  = chart.addLineSeries({ color: "#66bb6a", lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: "20" })
      var sma200s = chart.addLineSeries({ color: "#ef5350", lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: "200" })
      sma10s.setData( bars.map(function(b,i){ return sma10v[i]  != null ? { time: bcsBarTime(b,false), value: sma10v[i]  } : null }).filter(Boolean))
      sma20s.setData( bars.map(function(b,i){ return sma20v[i]  != null ? { time: bcsBarTime(b,false), value: sma20v[i]  } : null }).filter(Boolean))
      sma200s.setData(bars.map(function(b,i){ return sma200v[i] != null ? { time: bcsBarTime(b,false), value: sma200v[i] } : null }).filter(Boolean))
    }
    candles.setData(bars.map(function(b) { return { time: bcsBarTime(b, intraday), open: b.o, high: b.h, low: b.l, close: b.c } }))
    volume.setData( bars.map(function(b) { return { time: bcsBarTime(b, intraday), value: b.v, color: b.c >= b.o ? "#26a69a30" : "#ef535030" } }))
    setTimeout(function() { if (chartRef.current) chartRef.current.timeScale().scrollToPosition(30, false) }, 0)
    chartRef.current = chart
    return function() { ro.disconnect(); if (chartRef.current) { chartRef.current.remove(); chartRef.current = null } }
  }, [bars, lwcOk])

  var tfLabel = (BCS_TF_OPTIONS.find(function(o){ return o.value === tf }) || {}).label || "1D"
  return (
    <div className="bcs-chart-panel">
      <div className="bcs-chart-hd">
        <div className="bcs-chart-title">
          <span className="mono" style={{fontSize:16,fontWeight:700,letterSpacing:"0.06em"}}>{symbol}</span>
          <span className="mono dim" style={{fontSize:12}}>{tfLabel} · scroll to zoom · drag to pan</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div className="bcs-tf-row">
            {BCS_TF_OPTIONS.map(function(o) {
              return <button key={o.value} className={"bcs-tf-btn" + (tf === o.value ? " bcs-tf-btn-on" : "")} onClick={function(){ setTf(o.value) }}>{o.label}</button>
            })}
          </div>
          {!intraday && (
            <div className="bcs-sma-legend">
              <span style={{color:"#29b6f6"}}>━ 10</span>
              <span style={{color:"#66bb6a"}}>━ 20</span>
              <span style={{color:"#ef5350"}}>━━ 200</span>
            </div>
          )}
          <button className="btn btn-ghost" style={{fontSize:12,padding:"5px 12px",display:"flex",alignItems:"center",gap:5}} onClick={onClose}><X size={13}/> Close</button>
        </div>
      </div>
      <div className="bcs-chart-body">
        {(loading || !lwcOk) && (
          <div className="bcs-chart-loading">
            <Loader2 size={20} className="spin" style={{color:"var(--blue)"}}/>
            <span className="mono dim" style={{fontSize:12}}>{!lwcOk ? "Loading chart engine..." : "Fetching " + symbol + "..."}</span>
          </div>
        )}
        {error && <div className="bcs-chart-loading"><AlertTriangle size={16} color="#ef5350"/><span className="mono" style={{color:"#ef5350",fontSize:12}}>{error}</span></div>}
        <div ref={containerRef} style={{width:"100%",height:"100%",display:(bars&&lwcOk&&!loading)?"block":"none"}}/>
      </div>
    </div>
  )
}

// ── Spread detail side-panel ──────────────────────────────────────────────────
function SpreadDetail({ candidate, onPlace, onClose, placing }) {
  if (!candidate) return null
  const c = candidate

  const maxGain  = c.max_gain_per_contract
  const maxLoss  = c.max_loss_per_contract
  const breakeven = c.long_strike != null && c.net_debit != null
    ? (c.long_strike + c.net_debit).toFixed(2)
    : "—"

  return (
    <div className="bcs-detail">
      <div className="bcs-detail-header">
        <div>
          <div className="bcs-detail-ticker">{c.ticker}</div>
          <div className="mono dim" style={{ fontSize: 12 }}>Bull Call Spread · {c.expiry}</div>
        </div>
        <button className="btn btn-ghost icon-btn" onClick={onClose}><X size={14} /></button>
      </div>

      <div className="bcs-detail-price">
        <span className="mono dim">Stock&nbsp;</span>
        <span className="mono">${fmt(c.price)}</span>
        {c.dte != null && <span className="bcs-dte-chip">{c.dte} DTE</span>}
      </div>

      {/* Long leg */}
      <div className="bcs-leg bcs-leg-long">
        <div className="bcs-leg-label">BUY (long)</div>
        <div className="bcs-leg-contract mono">{c.long_contract}</div>
        <div className="bcs-leg-row">
          <span className="dim">Strike</span>
          <span className="mono">${fmt(c.long_strike)}</span>
        </div>
        <div className="bcs-leg-row">
          <span className="dim">Ask</span>
          <span className="mono">{c.long_ask != null ? `$${fmt(c.long_ask)}` : "—"}</span>
        </div>
        {c.long_delta != null && (
          <div className="bcs-leg-row">
            <span className="dim">Delta</span>
            <span className="mono">{c.long_delta.toFixed(2)}</span>
          </div>
        )}
        {c.long_iv != null && (
          <div className="bcs-leg-row">
            <span className="dim">IV</span>
            <span className="mono">{(c.long_iv * 100).toFixed(1)}%</span>
          </div>
        )}
      </div>

      {/* Short leg */}
      <div className="bcs-leg bcs-leg-short">
        <div className="bcs-leg-label">SELL (short)</div>
        <div className="bcs-leg-contract mono">{c.short_contract}</div>
        <div className="bcs-leg-row">
          <span className="dim">Strike</span>
          <span className="mono">${fmt(c.short_strike)}</span>
        </div>
        <div className="bcs-leg-row">
          <span className="dim">Bid</span>
          <span className="mono">{c.short_bid != null ? `$${fmt(c.short_bid)}` : "—"}</span>
        </div>
      </div>

      {/* Risk summary */}
      <div className="bcs-risk-grid">
        <div className="bcs-risk-cell">
          <div className="dim mono" style={{ fontSize: 10 }}>NET DEBIT</div>
          <div className="mono amber">${fmt(c.net_debit)}<span className="dim">/sh</span></div>
          <div className="mono dim" style={{ fontSize: 11 }}>${fmt(c.net_debit_total)} total</div>
        </div>
        <div className="bcs-risk-cell">
          <div className="dim mono" style={{ fontSize: 10 }}>BREAKEVEN</div>
          <div className="mono">${breakeven}</div>
        </div>
        <div className="bcs-risk-cell">
          <div className="dim mono" style={{ fontSize: 10 }}>MAX GAIN</div>
          <div className="mono green">${fmt(maxGain, 0)}</div>
          <div className="mono dim" style={{ fontSize: 11 }}>per contract</div>
        </div>
        <div className="bcs-risk-cell">
          <div className="dim mono" style={{ fontSize: 10 }}>MAX LOSS</div>
          <div className="mono red">${fmt(maxLoss, 0)}</div>
        </div>
        <div className="bcs-risk-cell">
          <div className="dim mono" style={{ fontSize: 10 }}>SPREAD WIDTH</div>
          <div className="mono">${fmt(c.spread_width)}</div>
        </div>
        <div className="bcs-risk-cell">
          <div className="dim mono" style={{ fontSize: 10 }}>RISK / REWARD</div>
          <div className="mono">{c.risk_reward != null ? `${c.risk_reward}×` : "—"}</div>
        </div>
      </div>

      {c.trigger && (
        <div className="bcs-trigger-note mono dim">
          <TrendingUp size={11} />
          Bounce confirmed {c.trigger.green_candle?.date} · SMA20 ${fmt(c.trigger.sma20)}
        </div>
      )}

      <button
        className="btn btn-blue bcs-place-btn"
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
      <div className="bcs-empty mono dim">
        No candidates matched. Try scanning during market hours, or add tickers to your watchlist and scan those.
      </div>
    )
  }
  return (
    <div className="bcs-table-wrap">
      <table className="bcs-table">
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
              className={`bcs-row${selected?.ticker === c.ticker ? " bcs-row-selected" : ""}`}
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

// ── Watchlist read-only display (tickers come from Screener tab localStorage) ──
function WatchlistReadOnly() {
  const tickers = loadScreenerWatchlist()
  return (
    <div className="bcs-watchlist">
      <div className="bcs-watchlist-chips">
        {tickers.length === 0 ? (
          <span className="mono dim" style={{ fontSize: 12 }}>
            No tickers saved — add them on the <strong>Screener</strong> tab.
          </span>
        ) : (
          tickers.map(t => (
            <span key={t} className="bcs-chip">{t}</span>
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
export default function BullCallSpread() {
  const [scanResult,   setScanResult]  = useState(null)
  const [scanning,     setScanning]    = useState(false)
  const [scanError,    setScanError]   = useState(null)
  const [selected,     setSelected]    = useState(null)
  const [chartSymbol,  setChartSymbol] = useState(null)
  const [placing,      setPlacing]     = useState(false)
  const [toast,        setToast]       = useState(null)

  const showToast = useCallback((msg, type = "ok") => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }, [])

  async function handleScan(watchlistOnly = false) {
    setScanning(true)
    setScanError(null)
    setSelected(null)
    setChartSymbol(null)
    try {
      const tickers = watchlistOnly ? loadScreenerWatchlist() : null
      const result = await api.runBCSScan(tickers)
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
      await api.queueBCSSpread({
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
    <div className="bcs">

      {toast && (
        <div className={`bcs-toast bcs-toast-${toast.type}`}>{toast.msg}</div>
      )}

      {/* ── Watchlist (read-only — managed on Screener tab) ─────────────────── */}
      <div className="card">
        <div className="card-title">Watchlist</div>
        <WatchlistReadOnly />
      </div>

      {/* ── Scanner controls ────────────────────────────────────────────────── */}
      <div className="card">
        <div className="bcs-scan-controls">
          <div>
            <div className="card-title" style={{ marginBottom: 4 }}>Scanner</div>
            <div className="mono dim" style={{ fontSize: 12 }}>
              Finds bullish stocks trending above SMA20 &amp; SMA50 with a pullback-bounce entry trigger.
            </div>
          </div>
          <div className="bcs-scan-btns">
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
              className="btn btn-blue"
              onClick={() => handleScan(false)}
              disabled={scanning}
            >
              <RefreshCw size={13} className={scanning ? "spin" : ""} />
              {scanning ? "Scanning…" : "Scan Universe"}
            </button>
          </div>
        </div>

        {scanError && (
          <div className="bcs-scan-error">
            <AlertTriangle size={14} /> {scanError}
          </div>
        )}

        {scanResult && (
          <>
            <div className="bcs-scan-meta mono dim">
              {scanResult.matched} candidate{scanResult.matched !== 1 ? "s" : ""} ·
              {scanResult.scanned} tickers scanned ·
              target expiry <strong>{scanResult.target_expiry}</strong>
            </div>

            {/* Two-column layout when detail panel open */}
            <div className={`bcs-results-wrap${selected ? " bcs-results-split" : ""}`}>
              <div className="bcs-results-left">
                <ScanTable
                  candidates={scanResult.candidates}
                  selected={selected}
                  onSelect={c => {
                    const deselect = selected?.ticker === c.ticker
                    setSelected(deselect ? null : c)
                    setChartSymbol(deselect ? null : c.ticker)
                  }}
                />
                {scanResult.errors?.length > 0 && (
                  <details className="bcs-warnings">
                    <summary className="mono dim">{scanResult.errors.length} scan warning(s)</summary>
                    <ul className="bcs-warnings-list mono dim">
                      {scanResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  </details>
                )}
              </div>

              {selected && (
                <div className="bcs-results-right">
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

      {chartSymbol && (
        <BCSStockChart
          symbol={chartSymbol}
          onClose={() => setChartSymbol(null)}
        />
      )}

    </div>
  )
}
