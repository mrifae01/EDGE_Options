import { useState, useEffect, useRef } from 'react'
import { api } from '../lib/api.js'
import { TrendingUp, TrendingDown, Minus, RefreshCw, AlertCircle } from 'lucide-react'
import './Overview.css'

// ── Load Lightweight Charts from CDN once ────────────────────────────────────
let _lwcPromise = null
function loadLWC() {
  if (_lwcPromise) return _lwcPromise
  _lwcPromise = new Promise((resolve, reject) => {
    if (window.LightweightCharts) { resolve(window.LightweightCharts); return }
    const s = document.createElement('script')
    s.src = 'https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js'
    s.onload  = () => resolve(window.LightweightCharts)
    s.onerror = reject
    document.head.appendChild(s)
  })
  return _lwcPromise
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function pct(v) { if (v == null) return '—'; return (v > 0 ? '+' : '') + v.toFixed(2) + '%' }
function usd(v) { if (v == null) return '—'; return '$' + parseFloat(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

function computeSMA(bars, n) {
  const out = []
  for (let i = 0; i < bars.length; i++) {
    if (i < n - 1) { out.push(null); continue }
    const slice = bars.slice(i - n + 1, i + 1)
    out.push(parseFloat((slice.reduce((s, b) => s + b.c, 0) / n).toFixed(2)))
  }
  return out
}

// ── Index Chart (replaces SPYChart, accepts symbol prop) ─────────────────────
function IndexChart({ symbol }) {
  const containerRef = useRef(null)
  const chartRef     = useRef(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    let chart, destroyed = false
    setLoading(true)
    setError(null)

    async function init() {
      try {
        const LWC = await loadLWC()

        const end   = new Date()
        const start = new Date(); start.setFullYear(start.getFullYear() - 2)
        const r = await fetch(
          `/api/chart/bars?symbol=${symbol}&start=${start.toISOString().slice(0,10)}&end=${end.toISOString().slice(0,10)}&timeframe=1Day`
        )
        if (!r.ok) throw new Error(`Failed to fetch ${symbol} bars`)
        const bars = await r.json()
        if (!bars.length) throw new Error('No bars returned')

        if (destroyed) return
        setLoading(false)

        const el = containerRef.current
        chart = LWC.createChart(el, {
          width:  el.clientWidth,
          height: el.clientHeight,
          layout:      { background: { color: '#080b0f' }, textColor: '#4d6070' },
          grid:        { vertLines: { color: '#0d1117' }, horzLines: { color: '#0d1117' } },
          crosshair:   { mode: 1 },
          rightPriceScale: { borderColor: '#1f2d3d', scaleMarginTop: 0.08, scaleMarginBottom: 0.22 },
          timeScale:   { borderColor: '#1f2d3d', timeVisible: true, rightOffset: 20 },
        })
        chartRef.current = chart

        const candles = chart.addCandlestickSeries({
          upColor: '#00e676', downColor: '#ff3d57',
          borderUpColor: '#00e676', borderDownColor: '#ff3d57',
          wickUpColor: '#00e67680', wickDownColor: '#ff3d5780',
        })
        const candleData = bars.map(b => ({
          time: b.t.slice(0, 10),
          open: b.o, high: b.h, low: b.l, close: b.c,
        }))
        candles.setData(candleData)

        const volSeries = chart.addHistogramSeries({
          priceFormat: { type: 'volume' },
          priceScaleId: 'vol',
          color: '#29b6f620',
        })
        chart.priceScale('vol').applyOptions({ scaleMarginTop: 0.82, scaleMarginBottom: 0 })
        volSeries.setData(bars.map(b => ({
          time: b.t.slice(0, 10),
          value: b.v,
          color: b.c >= b.o ? '#00e67618' : '#ff3d5718',
        })))

        const closes = bars.map(b => ({ c: b.c }))
        const sma20v  = computeSMA(closes, 20)
        const sma50v  = computeSMA(closes, 50)
        const sma200v = computeSMA(closes, 200)

        ;[
          { values: sma20v,  color: '#29b6f6', width: 1 },
          { values: sma50v,  color: '#ffc107', width: 1 },
          { values: sma200v, color: '#ff3d57', width: 2 },
        ].forEach(({ values, color, width }) => {
          const s = chart.addLineSeries({ color, lineWidth: width, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
          s.setData(values.map((v, i) => v != null ? { time: candleData[i].time, value: v } : null).filter(Boolean))
        })

        const ro = new ResizeObserver(() => {
          if (chart && el) chart.resize(el.clientWidth, el.clientHeight)
        })
        ro.observe(el)
        return () => ro.disconnect()
      } catch (e) {
        if (!destroyed) { setLoading(false); setError(e.message) }
      }
    }

    // Destroy previous chart before reinitialising
    if (chartRef.current) { chartRef.current.remove(); chartRef.current = null }
    init()

    return () => {
      destroyed = true
      if (chartRef.current) { chartRef.current.remove(); chartRef.current = null }
    }
  }, [symbol])   // <-- re-run whenever symbol changes

  const NAMES = { SPY:'S&P 500', QQQ:'Nasdaq 100', IWM:'Russell 2000', DIA:'Dow Jones' }

  return (
    <div className="spy-chart-wrap">
      <div className="chart-legend">
        <span className="legend-item" style={{color:'#29b6f6'}}><span className="legend-line" style={{background:'#29b6f6'}}/> SMA 20</span>
        <span className="legend-item" style={{color:'#ffc107'}}><span className="legend-line" style={{background:'#ffc107'}}/> SMA 50</span>
        <span className="legend-item" style={{color:'#ff3d57'}}><span className="legend-line" style={{background:'#ff3d57'}}/> SMA 200</span>
      </div>
      {loading && (
        <div className="chart-loader">
          <div className="loading-pulse"/>
          <span className="mono dim" style={{fontSize:12}}>Loading {symbol}…</span>
        </div>
      )}
      {error && (
        <div className="chart-loader">
          <AlertCircle size={16} color="var(--red)"/>
          <span className="mono red" style={{fontSize:12}}>{error}</span>
        </div>
      )}
      <div ref={containerRef} className="spy-chart-container" style={{opacity: loading||error ? 0 : 1}}/>
    </div>
  )
}

// ── Sentiment gauge arc ───────────────────────────────────────────────────────
function SentimentGauge({ score, label }) {
  const angle   = (score / 100) * 180
  const rad     = (angle - 180) * (Math.PI / 180)
  const cx = 110, cy = 110, r = 80
  const needleX = cx + r * Math.cos(rad)
  const needleY = cy + r * Math.sin(rad)

  const segments = [
    { from: 0,  to: 20,  color: '#ff3d57' },
    { from: 20, to: 40,  color: '#ff7043' },
    { from: 40, to: 60,  color: '#ffc107' },
    { from: 60, to: 80,  color: '#66bb6a' },
    { from: 80, to: 100, color: '#00e676' },
  ]

  function arcPath(from, to) {
    const a1 = ((from / 100) * 180 - 180) * (Math.PI / 180)
    const a2 = ((to   / 100) * 180 - 180) * (Math.PI / 180)
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1)
    const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2)
    const large = (to - from) > 50 ? 1 : 0
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`
  }

  const scoreColor = score >= 70 ? '#00e676' : score >= 55 ? '#66bb6a' : score >= 45 ? '#ffc107' : score >= 30 ? '#ff7043' : '#ff3d57'

  return (
    <div className="gauge-wrap">
      <svg width={220} height={130} viewBox="0 20 220 130">
        {segments.map((s, i) => (
          <path key={i} d={arcPath(s.from, s.to)}
            stroke={s.color} strokeWidth={16} fill="none" opacity={0.25} strokeLinecap="butt"/>
        ))}
        {segments.map((s, i) => {
          if (score <= s.from) return null
          const to = Math.min(score, s.to)
          return <path key={i} d={arcPath(s.from, to)}
            stroke={s.color} strokeWidth={16} fill="none" strokeLinecap="butt"/>
        })}
        <line x1={cx} y1={cy} x2={needleX} y2={needleY}
          stroke="#e8edf2" strokeWidth={2.5} strokeLinecap="round"/>
        <circle cx={cx} cy={cy} r={5} fill="#e8edf2"/>
        <text x={cx} y={cy + 28} textAnchor="middle"
          style={{fontSize:22,fontWeight:700,fontFamily:"'IBM Plex Mono',monospace",fill:scoreColor}}>
          {score}
        </text>
      </svg>
      <div className="gauge-label" style={{color: scoreColor}}>{label}</div>
      <div className="gauge-sublabels">
        <span className="mono dim" style={{fontSize:10}}>Fear</span>
        <span className="mono dim" style={{fontSize:10}}>Greed</span>
      </div>
    </div>
  )
}

// ── Index tile ────────────────────────────────────────────────────────────────
function IndexTile({ idx, selected, onClick }) {
  const up = idx.chg_pct >= 0
  const Icon = up ? TrendingUp : idx.chg_pct < 0 ? TrendingDown : Minus
  const NAMES = { SPY:'S&P 500', QQQ:'Nasdaq 100', IWM:'Russell 2000', DIA:'Dow Jones' }

  return (
    <div
      className={`index-tile ${up ? 'tile-up' : 'tile-down'} ${selected ? 'tile-selected' : ''}`}
      onClick={onClick}
      title={`Show ${idx.symbol} chart`}
    >
      <div className="index-symbol mono">{idx.symbol}</div>
      <div className="index-name dim">{NAMES[idx.symbol] || idx.symbol}</div>
      <div className="index-price">{usd(idx.price)}</div>
      <div className={`index-chg ${up ? 'green' : 'red'}`}>
        <Icon size={13}/>
        {pct(idx.chg_pct)} ({idx.chg != null ? (up?'+':'')+idx.chg.toFixed(2) : '—'})
      </div>
      {selected && <div className="tile-selected-bar"/>}
    </div>
  )
}

// ── Signal row ────────────────────────────────────────────────────────────────
function SignalRow({ sig }) {
  return (
    <div className="sig-row">
      <span className="mono dim" style={{fontSize:12}}>{sig.label}</span>
      <span className={`mono ${sig.bullish ? 'green' : 'red'}`} style={{fontSize:12}}>{sig.value}</span>
      <span className={`sig-dot ${sig.bullish ? 'dot-bull' : 'dot-bear'}`}/>
    </div>
  )
}

// ── Main Overview component ───────────────────────────────────────────────────
const SYMBOLS = ['SPY','QQQ','IWM','DIA']
const NAMES   = { SPY:'S&P 500', QQQ:'Nasdaq 100', IWM:'Russell 2000', DIA:'Dow Jones' }

export default function Overview() {
  const [data,       setData]       = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const [updated,    setUpdated]    = useState(null)
  const [chartSym,   setChartSym]   = useState('SPY')   // which index to show in chart

  async function load() {
    setLoading(true); setError(null)
    try {
      const d = await api.getOverview()
      setData(d)
      setUpdated(new Date())
    } catch(e) {
      setError(e.message)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    const id = setInterval(() => {
      const h = new Date().getHours()
      if (h >= 9 && h < 16) load()
    }, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [])

  const updatedStr = updated
    ? updated.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', second:'2-digit' })
    : null

  return (
    <div className="overview">

      {/* ── Top row: sentiment + indices ── */}
      <div className="overview-top">

        {/* Sentiment gauge card */}
        <div className="card sentiment-card">
          <div className="card-title-row">
            <div className="card-title" style={{marginBottom:0}}>Market Sentiment</div>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              {updatedStr && <span className="mono dim" style={{fontSize:11}}>Updated {updatedStr}</span>}
              <button className="btn btn-ghost"
                style={{padding:'5px 10px',fontSize:12,display:'flex',alignItems:'center',gap:5}}
                onClick={load} disabled={loading}>
                <RefreshCw size={12} className={loading ? 'spin-anim' : ''}/>
                Refresh
              </button>
            </div>
          </div>

          {loading && !data && (
            <div style={{textAlign:'center',padding:'40px 0'}} className="mono dim">Loading…</div>
          )}
          {error && (
            <div className="mono red" style={{fontSize:12,padding:'12px 0'}}>{error}</div>
          )}
          {data && (
            <div className="sentiment-body">
              <SentimentGauge score={data.score} label={data.sentiment}/>
              <div className="sentiment-signals">
                <div className="mono dim" style={{fontSize:10,letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:8}}>
                  Signal Breakdown
                </div>
                {data.signals.map((s, i) => <SignalRow key={i} sig={s}/>)}
                {data.vol_pct != null && (
                  <div className="sig-row" style={{marginTop:8,paddingTop:8,borderTop:'1px solid var(--border)'}}>
                    <span className="mono dim" style={{fontSize:12}}>Realized Vol (20d ann.)</span>
                    <span className="mono amber" style={{fontSize:12}}>{data.vol_pct}%</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Index tiles — clickable, no SMA card */}
        <div className="indices-grid">
          {data
            ? data.indices.map(idx => (
                <IndexTile
                  key={idx.symbol}
                  idx={idx}
                  selected={chartSym === idx.symbol}
                  onClick={() => setChartSym(idx.symbol)}
                />
              ))
            : SYMBOLS.map(s => (
                <div key={s} className="index-tile tile-loading">
                  <div className="index-symbol mono dim">{s}</div>
                  <div className="mono dim" style={{fontSize:11,marginTop:8}}>Loading…</div>
                </div>
              ))
          }
        </div>
      </div>

      {/* ── Chart — symbol driven by tile selection ── */}
      <div className="card chart-card">
        <div className="card-title">
          {chartSym} — {NAMES[chartSym]} (Daily, 2 Years)
        </div>
        <IndexChart symbol={chartSym}/>
      </div>

    </div>
  )
}