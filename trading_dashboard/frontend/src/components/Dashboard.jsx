import { useState, useEffect, useRef } from 'react'
import { usePolling } from '../hooks/usePolling.js'
import { api } from '../lib/api.js'
import { Minus, AlertTriangle, Edit2, X, Check, XCircle, Clock, Loader2, ArrowUpRight, ArrowDownRight } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import './Dashboard.css'

// ── Lightweight Charts loader ─────────────────────────────────────────────────
var _lwcPromise = null
function loadLWC() {
  if (_lwcPromise) return _lwcPromise
  _lwcPromise = new Promise(function(resolve) {
    if (window.LightweightCharts) { resolve(window.LightweightCharts); return }
    var s = document.createElement('script')
    s.src = 'https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js'
    s.onload = function() { resolve(window.LightweightCharts) }
    document.head.appendChild(s)
  })
  return _lwcPromise
}

function calcSMA(bars, period) {
  return bars.map(function(_, i) {
    if (i < period - 1) return null
    var sum = 0
    for (var j = i - period + 1; j <= i; j++) sum += bars[j].c
    return sum / period
  })
}

// ── Company name map (same as Screener) ───────────────────────────────────────
var DASH_COMPANY_NAMES = {
  SPY:'S&P 500 ETF',QQQ:'Nasdaq 100 ETF',IWM:'Russell 2000 ETF',DIA:'Dow Jones ETF',
  AAPL:'Apple',MSFT:'Microsoft',GOOGL:'Alphabet',GOOG:'Alphabet',AMZN:'Amazon',
  META:'Meta',TSLA:'Tesla',NVDA:'Nvidia',AVGO:'Broadcom',ORCL:'Oracle',
  NFLX:'Netflix',AMD:'AMD',INTC:'Intel',QCOM:'Qualcomm',CRM:'Salesforce',
  CSCO:'Cisco',IBM:'IBM',NOW:'ServiceNow',DELL:'Dell',CRWD:'CrowdStrike',
  PLTR:'Palantir',HOOD:'Robinhood',SOFI:'SoFi',MARA:'Marathon Digital',
  PYPL:'PayPal',SHOP:'Shopify',UBER:'Uber',ABNB:'Airbnb',DASH:'DoorDash',
  CVNA:'Carvana',BABA:'Alibaba',JPM:'JPMorgan',BAC:'Bank of America',
  V:'Visa',MA:'Mastercard',COF:'Capital One',GS:'Goldman Sachs',
  WMT:'Walmart',COST:'Costco',AMZN:'Amazon',HD:'Home Depot',TGT:'Target',
  NKE:'Nike',MCD:'McDonald\'s',KO:'Coca-Cola',PEP:'PepsiCo',
  XOM:'ExxonMobil',CVX:'Chevron',JNJ:'Johnson & Johnson',
  TMUS:'T-Mobile',T:'AT&T',DIS:'Disney',
}
function getDashCompanyName(sym) { return DASH_COMPANY_NAMES[(sym||'').toUpperCase()] || null }

// ── Timeframe config (mirrors Screener) ───────────────────────────────────────
var DASH_TF_OPTIONS = [
  { label: '1W', value: '1Week', lookback: 1825 },
  { label: '1D', value: '1Day',  lookback: 1825 },
  { label: '4H', value: '4Hour', lookback: 120  },
  { label: '1H', value: '1Hour', lookback: 90   },
]
function dashBarTime(b, intraday) {
  if (!intraday) return b.t.slice(0, 10)
  return Math.floor(new Date(b.t).getTime() / 1000)
}

// ── Stock chart panel ─────────────────────────────────────────────────────────
function PositionChart({ symbol, onClose }) {
  var tf_s = useState('1Day');  var tf = tf_s[0]; var setTf = tf_s[1]
  var ds   = useState(null);    var bars    = ds[0]; var setBars    = ds[1]
  var ls   = useState(true);    var loading = ls[0]; var setLoading = ls[1]
  var es   = useState(null);    var error   = es[0]; var setError   = es[1]
  var rdy  = useState(false);   var lwcOk   = rdy[0]; var setLwcOk  = rdy[1]
  var containerRef = useRef(null)
  var chartRef     = useRef(null)

  var intraday = tf === '4Hour' || tf === '1Hour'

  useEffect(function() {
    loadLWC().then(function() { setLwcOk(true) })
  }, [])

  useEffect(function() {
    setLoading(true); setError(null); setBars(null)
    var opt = DASH_TF_OPTIONS.find(function(o) { return o.value === tf }) || DASH_TF_OPTIONS[1]
    fetch('/api/chart/bars?symbol=' + encodeURIComponent(symbol)
        + '&timeframe=' + encodeURIComponent(tf)
        + '&lookback_days=' + opt.lookback)
      .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
      .then(function(data) {
        if (!data || !data.length) throw new Error('No data for ' + symbol)
        setBars(data); setLoading(false)
      })
      .catch(function(e) { setError(e.message); setLoading(false) })
  }, [symbol, tf])

  useEffect(function() {
    if (!lwcOk || !bars || !containerRef.current) return
    var LWC = window.LightweightCharts
    if (chartRef.current) { chartRef.current.remove(); chartRef.current = null }

    var chart = LWC.createChart(containerRef.current, {
      width:  containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      layout: {
        background: { type: 'solid', color: '#080b0f' },
        textColor:  '#64748b',
        fontSize:   11,
        fontFamily: 'monospace',
      },
      grid: {
        vertLines: { color: '#0f172a' },
        horzLines: { color: '#0f172a' },
      },
      crosshair: {
        mode: LWC.CrosshairMode.Normal,
        vertLine: { color: '#334155', labelBackgroundColor: '#1e293b' },
        horzLine: { color: '#334155', labelBackgroundColor: '#1e293b' },
      },
      rightPriceScale: {
        borderColor:  '#1e293b',
        scaleMargins: { top: 0.06, bottom: 0.28 },
      },
      timeScale: {
        borderColor:    '#1e293b',
        timeVisible:    intraday,
        secondsVisible: false,
        rightOffset:    60,
        barSpacing:     intraday ? 6 : 8,
        minBarSpacing:  2,
      },
    })

    var ro = new ResizeObserver(function(entries) {
      if (chartRef.current && entries[0]) {
        var r = entries[0].contentRect
        chartRef.current.resize(r.width, r.height)
      }
    })
    ro.observe(containerRef.current)

    var candles = chart.addCandlestickSeries({
      upColor: '#26a69a', downColor: '#ef5350',
      borderUpColor: '#26a69a', borderDownColor: '#ef5350',
      wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    })
    var volume = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol' })
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })

    if (!intraday) {
      var sma10v  = calcSMA(bars, 10)
      var sma20v  = calcSMA(bars, 20)
      var sma200v = calcSMA(bars, 200)
      var sma10s  = chart.addLineSeries({ color: '#29b6f6', lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: '10' })
      var sma20s  = chart.addLineSeries({ color: '#66bb6a', lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: '20' })
      var sma200s = chart.addLineSeries({ color: '#ef5350', lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: '200' })
      sma10s.setData( bars.map(function(b,i){ return sma10v[i]  != null ? { time: dashBarTime(b,false), value: sma10v[i]  } : null }).filter(Boolean))
      sma20s.setData( bars.map(function(b,i){ return sma20v[i]  != null ? { time: dashBarTime(b,false), value: sma20v[i]  } : null }).filter(Boolean))
      sma200s.setData(bars.map(function(b,i){ return sma200v[i] != null ? { time: dashBarTime(b,false), value: sma200v[i] } : null }).filter(Boolean))
    }

    candles.setData(bars.map(function(b) {
      return { time: dashBarTime(b, intraday), open: b.o, high: b.h, low: b.l, close: b.c }
    }))
    volume.setData(bars.map(function(b) {
      return { time: dashBarTime(b, intraday), value: b.v, color: b.c >= b.o ? '#26a69a30' : '#ef535030' }
    }))

    setTimeout(function() {
      if (chartRef.current) chartRef.current.timeScale().scrollToPosition(30, false)
    }, 0)

    chartRef.current = chart
    return function() { ro.disconnect(); if (chartRef.current) { chartRef.current.remove(); chartRef.current = null } }
  }, [bars, lwcOk])

  var tfLabel = (DASH_TF_OPTIONS.find(function(o){ return o.value === tf }) || {}).label || '1D'
  var companyName = getDashCompanyName(symbol)

  return (
    <div className="pos-chart-wrap">
      <div className="pos-chart-hd">
        <div className="tv-chart-title">
          <span className="mono" style={{fontSize:16,fontWeight:700,letterSpacing:'0.06em'}}>{symbol}</span>
          {companyName && (
            <span className="mono dim" style={{fontSize:13}}>({companyName})</span>
          )}
          <span className="mono dim" style={{fontSize:12}}>{tfLabel} · scroll to zoom · drag to pan</span>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <div className="tf-row">
            {DASH_TF_OPTIONS.map(function(o) {
              return (
                <button key={o.value}
                  className={'tf-btn' + (tf === o.value ? ' tf-btn-on' : '')}
                  onClick={function(){ setTf(o.value) }}
                >{o.label}</button>
              )
            })}
          </div>
          {!intraday && (
            <div className="sma-legend-row">
              <span style={{color:'#29b6f6'}}>━ SMA 10</span>
              <span style={{color:'#66bb6a'}}>━ SMA 20</span>
              <span style={{color:'#ef5350'}}>━━ SMA 200</span>
            </div>
          )}
          <button className="btn btn-ghost tv-close-btn" onClick={onClose}><X size={13}/> Close</button>
        </div>
      </div>
      <div className="pos-chart-body">
        {(loading || !lwcOk) && (
          <div className="chart-loading">
            <Loader2 size={20} className="spin" style={{color:'var(--blue)'}}/>
            <span className="mono dim" style={{fontSize:12}}>
              {!lwcOk ? 'Loading chart engine...' : 'Fetching ' + symbol + ' ' + tfLabel + '...'}
            </span>
          </div>
        )}
        {error && (
          <div className="chart-loading">
            <AlertTriangle size={16} color="#ef5350"/>
            <span className="mono" style={{color:'#ef5350',fontSize:12}}>{error}</span>
          </div>
        )}
        <div ref={containerRef}
          style={{width:'100%',height:'100%',display:(bars&&lwcOk&&!loading)?'block':'none'}}/>
      </div>
    </div>
  )
}

function pct(v) {
  if (v == null) return '—'
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`
}
function plClass(v) {
  if (v == null) return 'muted'
  return v > 0 ? 'green' : v < 0 ? 'red' : 'muted'
}
function StatCard({ label, value, sub, accent }) {
  return (
    <div className="stat-card" style={{ '--accent': accent }}>
      <div className="stat-label">{label}</div>
      <div className="stat-value mono">{value}</div>
      {sub && <div className="stat-sub mono dim">{sub}</div>}
    </div>
  )
}

// ── Edit panel ────────────────────────────────────────────────────────────────
function EditPanel({ pos, onSave, onClose, onClosePosition }) {
  const [sl,         setSl]         = useState(pos.sl_stock != null ? String(pos.sl_stock) : '')
  const [tp,         setTp]         = useState(pos.tp_stock != null ? String(pos.tp_stock) : '')
  const [msg,        setMsg]        = useState(null)
  const [busy,       setBusy]       = useState(false)
  const [confirming, setConfirming] = useState(false)

  async function save() {
    if (!sl || parseFloat(sl) <= 0) { setMsg({ err: true, text: 'Stop Loss is required' }); return }
    if (!tp || parseFloat(tp) <= 0) { setMsg({ err: true, text: 'Take Profit is required' }); return }
    setBusy(true); setMsg(null)
    try {
      var slVal = parseFloat(sl)
      var tpVal = parseFloat(tp)
      lsWriteSlTp(pos.contract, slVal, tpVal)  // persist immediately — survives poll resets
      await api.updatePosition(pos.ticker, { sl_stock: slVal, tp_stock: tpVal })
      setMsg({ err: false, text: 'Saved.' })
      onSave({ ...pos, sl_stock: slVal, tp_stock: tpVal })
    } catch(e) {
      setMsg({ err: true, text: e.message })
    } finally { setBusy(false) }
  }

  async function doClose() {
    setBusy(true); setMsg(null)
    try {
      const result = await api.closePosition(pos.ticker)
      setMsg({ err: false, text: result.queued ? 'Market closed — queued for next open.' : 'Position closed.' })
      onClosePosition(pos.ticker, pos.contract, result.queued)
    } catch(e) {
      setMsg({ err: true, text: e.message })
      setBusy(false)
    }
  }

  return (
    <div className="pos-edit-panel">
      <div className="pos-edit-row">
        <div className="pos-edit-field">
          <label>Stop Loss (stock $)</label>
          <input type="number" step="0.01" placeholder="e.g. 185.00"
            value={sl} onChange={e => setSl(e.target.value)}/>
        </div>
        <div className="pos-edit-field">
          <label>Take Profit (stock $)</label>
          <input type="number" step="0.01" placeholder="e.g. 210.00"
            value={tp} onChange={e => setTp(e.target.value)}/>
        </div>
        <div className="pos-edit-actions">
          <button className="btn btn-blue" style={{fontSize:12,padding:'6px 14px'}} onClick={save} disabled={busy}>
            <Check size={12}/> Save
          </button>
          <button className="btn btn-ghost" style={{fontSize:12,padding:'6px 14px'}} onClick={onClose}>
            <X size={12}/> Cancel
          </button>
        </div>
      </div>

      <div className="pos-edit-close-row">
        {!confirming ? (
          <button className="btn btn-danger" style={{fontSize:12,padding:'6px 14px'}} onClick={() => setConfirming(true)} disabled={busy}>
            <XCircle size={12}/> Close Position
          </button>
        ) : (
          <div className="pos-close-confirm">
            <span className="mono dim" style={{fontSize:12}}>Sell at market — are you sure?</span>
            <button className="btn btn-danger" style={{fontSize:12,padding:'6px 14px'}} onClick={doClose} disabled={busy}>
              {busy ? 'Closing…' : 'Confirm'}
            </button>
            <button className="btn btn-ghost" style={{fontSize:12,padding:'6px 10px'}} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        )}
      </div>

      {msg && <div className={`pos-edit-msg mono ${msg.err ? 'red' : 'green'}`}>{msg.text}</div>}
    </div>
  )
}

// ── OCC symbol helpers ────────────────────────────────────────────────────────
function parseOCCStrike(contract) {
  const m = contract && contract.match(/[A-Z]+\d{6}[CP](\d{8})$/)
  return m ? parseInt(m[1], 10) / 1000 : null
}
function parseOCCExpiry(contract) {
  const m = contract && contract.match(/[A-Z]+(\d{2})(\d{2})(\d{2})[CP]/)
  if (!m) return null
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[parseInt(m[2],10)-1]} ${parseInt(m[3],10)}, 20${m[1]}`
}

// ── Spread Pair Card ──────────────────────────────────────────────────────────
function SpreadPairCard({ longLeg, shortLeg, onCloseSpread, onSelect, selected }) {
  const [confirming, setConfirming] = useState(false)
  const [busy,       setBusy]       = useState(false)
  const [msg,        setMsg]        = useState(null)

  const anchor = longLeg ?? shortLeg
  const isBull = anchor.strategy_label === 'bull_call_spread'
  const ticker     = anchor.ticker
  const stockPrice = longLeg?.stock_price ?? shortLeg?.stock_price
  const spreadId   = anchor.spread_id
  const expiry     = parseOCCExpiry(anchor.contract)

  // Derive correct long/short display legs from strike prices, not the backend tag.
  // Bull call spread: long = lower strike call, short = higher strike call.
  // Bear put spread:  long = higher strike put, short = lower strike put.
  // This guards against swapped leg labels in the state file.
  const strikeA = longLeg  ? parseOCCStrike(longLeg.contract)  : null
  const strikeB = shortLeg ? parseOCCStrike(shortLeg.contract) : null
  const legsSwapped = longLeg && shortLeg && strikeA != null && strikeB != null && (
    isBull ? strikeA > strikeB   // bull: long should be lower
           : strikeA < strikeB   // bear: long should be higher
  )
  const displayLong  = legsSwapped ? shortLeg : longLeg
  const displayShort = legsSwapped ? longLeg  : shortLeg
  const longStrike  = displayLong  ? parseOCCStrike(displayLong.contract)  : null
  const shortStrike = displayShort ? parseOCCStrike(displayShort.contract) : null
  const longPlpc    = displayLong?.last_plpc
  const shortPlpc   = displayShort?.last_plpc

  // ── Live spread P/L (same formula the bot uses for exit logic) ────────────
  // Uses unrealized_pl (dollars) from each leg — Alpaca reports this correctly
  // as positive-when-profitable for both long and short positions, unlike
  // last_plpc which is null for short legs (cost_basis is negative for shorts).
  // spread_pl_pct = (long_upl + short_upl) / (net_debit * 100 * qty)
  const spreadPl = (() => {
    const longUpl  = displayLong?.unrealized_pl
    const shortUpl = displayShort?.unrealized_pl
    if (longUpl == null || shortUpl == null) return null
    const longEntry  = displayLong?.entry_avg_price
    const shortEntry = displayShort?.entry_avg_price
    if (longEntry == null || shortEntry == null) return null
    const netDebit = longEntry - shortEntry
    if (netDebit <= 0) return null
    const qty     = displayLong?.current_qty ?? 1
    const dollars = longUpl + shortUpl
    return {
      pct:     dollars / (netDebit * 100 * qty),
      dollars: Math.round(dollars),
    }
  })()

  // ── Scenario math ─────────────────────────────────────────────────────────
  const scenarios = (() => {
    if (!displayLong || !displayShort || longStrike == null || shortStrike == null) return null
    const longEntry  = displayLong.entry_avg_price
    const shortEntry = displayShort.entry_avg_price
    if (longEntry == null || shortEntry == null) return null
    const qty         = displayLong.current_qty ?? 1
    const netDebit    = longEntry - shortEntry
    const spreadWidth = Math.abs(longStrike - shortStrike)
    const maxGain     = Math.round((spreadWidth - netDebit) * 100 * qty)
    const maxLoss     = Math.round(netDebit * 100 * qty)
    const breakeven   = isBull ? longStrike + netDebit : longStrike - netDebit
    const lowerStrike  = isBull ? longStrike  : shortStrike
    const higherStrike = isBull ? shortStrike : longStrike

    const fp = p => `$${p % 1 === 0 ? p.toFixed(0) : p.toFixed(2)}`
    const fm = v => v === 0 ? '$0' : v > 0 ? `+$${v.toLocaleString()}` : `-$${Math.abs(v).toLocaleString()}`

    const rows = isBull ? [
      { label: 'Best case',  dot: 'green',  range: `Above ${fp(higherStrike)}`,                          pl: fm(maxGain),               plClass: 'green' },
      { label: 'Good',       dot: 'green',  range: `${fp(breakeven)} – ${fp(higherStrike)}`,             pl: `+$1 to ${fm(maxGain)}`,   plClass: 'green' },
      { label: 'Breakeven',  dot: 'muted',  range: `~${fp(breakeven)}`,                                  pl: '$0',                      plClass: 'muted' },
      { label: 'Bad',        dot: 'amber',  range: `${fp(lowerStrike)} – ${fp(breakeven)}`,              pl: `-$1 to ${fm(-maxLoss)}`,  plClass: 'red'   },
      { label: 'Worst case', dot: 'red',    range: `Below ${fp(lowerStrike)}`,                           pl: fm(-maxLoss),              plClass: 'red'   },
    ] : [
      { label: 'Best case',  dot: 'green',  range: `Below ${fp(lowerStrike)}`,                           pl: fm(maxGain),               plClass: 'green' },
      { label: 'Good',       dot: 'green',  range: `${fp(lowerStrike)} – ${fp(breakeven)}`,              pl: `+$1 to ${fm(maxGain)}`,   plClass: 'green' },
      { label: 'Breakeven',  dot: 'muted',  range: `~${fp(breakeven)}`,                                  pl: '$0',                      plClass: 'muted' },
      { label: 'Bad',        dot: 'amber',  range: `${fp(breakeven)} – ${fp(higherStrike)}`,             pl: `-$1 to ${fm(-maxLoss)}`,  plClass: 'red'   },
      { label: 'Worst case', dot: 'red',    range: `Above ${fp(higherStrike)}`,                          pl: fm(-maxLoss),              plClass: 'red'   },
    ]
    return { rows, maxGain, maxLoss, netDebit, breakeven, qty }
  })()

  async function doClose() {
    setBusy(true); setMsg(null)
    try {
      const closeFn = isBull ? api.closeBCSPosition : api.closeBPSPosition
      const result  = await closeFn(spreadId)
      setMsg({ err: false, text: result.queued ? 'Queued for next open.' : 'Spread closed.' })
      onCloseSpread(spreadId, result.queued)
    } catch(e) {
      setMsg({ err: true, text: e.message })
      setBusy(false)
    }
  }

  return (
    <div
      className={`spread-pair-card ${isBull ? 'spread-bull' : 'spread-bear'}${selected ? ' pos-selected' : ''}`}
      onClick={e => {
        if (!e.target.closest('.spread-close-row') && !e.target.closest('.spread-confirm')) {
          onSelect(ticker)
        }
      }}
      style={{ cursor: 'pointer' }}
    >
      {/* ── Header ── */}
      <div className="spread-pair-header">
        <div>
          <div className="pos-ticker">{ticker}</div>
          {expiry && <div className="mono dim" style={{ fontSize: 11, marginTop: 2 }}>exp {expiry}</div>}
        </div>
        <span className={`badge ${isBull ? 'badge-purple' : 'badge-red'}`} style={{ display:'flex', alignItems:'center', gap:4 }}>
          {isBull ? <ArrowUpRight size={11}/> : <ArrowDownRight size={11}/>}
          {isBull ? 'BULL CALL SPREAD' : 'BEAR PUT SPREAD'}
        </span>
      </div>

      {/* ── Top info strip: stock price + legs ── */}
      <div className="spread-top-strip">

        {/* Stock price */}
        <div className="spread-stock-col">
          <span className="dim mono" style={{ fontSize: 9, letterSpacing:'0.12em' }}>CURRENT PRICE</span>
          <span className="mono" style={{ fontSize: 26, fontWeight: 700, color: 'var(--text-1)', lineHeight: 1.1 }}>
            {stockPrice != null ? `$${stockPrice.toFixed(2)}` : '—'}
          </span>
          {spreadPl != null ? (
            <div style={{ marginTop: 8 }}>
              <div className="mono dim" style={{ fontSize: 9, letterSpacing:'0.12em' }}>SPREAD P/L</div>
              <div style={{ display:'flex', alignItems:'baseline', gap: 8, marginTop: 2 }}>
                <span className={`mono ${plClass(spreadPl.pct)}`} style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>
                  {spreadPl.pct >= 0 ? '+' : ''}{(spreadPl.pct * 100).toFixed(1)}%
                </span>
                <span className={`mono ${plClass(spreadPl.pct)}`} style={{ fontSize: 12 }}>
                  {spreadPl.dollars >= 0 ? '+' : '-'}${Math.abs(spreadPl.dollars).toLocaleString()}
                </span>
              </div>
            </div>
          ) : null}
        </div>

        {/* Legs */}
        <div className="spread-legs-row">
          <div className="spread-leg">
            <div className={`spread-leg-badge ${isBull ? 'spread-leg-long-badge' : 'spread-leg-short-badge'}`}>{isBull ? 'BUY · LONG' : 'BUY · SHORT'}</div>
            <div className="spread-leg-strike mono">
              {longStrike != null ? `$${longStrike % 1 === 0 ? longStrike.toFixed(0) : longStrike.toFixed(2)}` : '—'}
            </div>
            <div className="dim mono" style={{ fontSize: 9, letterSpacing:'0.1em' }}>STRIKE</div>
            {displayLong && <div className="mono dim" style={{ fontSize: 9, marginTop: 5, wordBreak:'break-all' }}>{displayLong.contract}</div>}
          </div>

          <div className="spread-legs-divider"/>

          <div className="spread-leg">
            <div className={`spread-leg-badge ${isBull ? 'spread-leg-short-badge' : 'spread-leg-long-badge'}`}>{isBull ? 'SELL · SHORT' : 'SELL · LONG'}</div>
            {displayShort ? (
              <>
                <div className="spread-leg-strike mono">
                  {shortStrike != null ? `$${shortStrike % 1 === 0 ? shortStrike.toFixed(0) : shortStrike.toFixed(2)}` : '—'}
                </div>
                <div className="dim mono" style={{ fontSize: 9, letterSpacing:'0.1em' }}>STRIKE</div>
                <div className="mono dim" style={{ fontSize: 9, marginTop: 5, wordBreak:'break-all' }}>{displayShort.contract}</div>
              </>
            ) : (
              <div className="mono dim" style={{ fontSize: 11, marginTop: 8 }}>pending…</div>
            )}
          </div>
        </div>
      </div>

      {/* ── Scenarios table ── */}
      {scenarios ? (
        <div className="spread-scenarios">
          <div className="spread-scenarios-head">
            <span>SCENARIO</span>
            <span>{ticker} AT EXPIRY</span>
            <span>P&amp;L</span>
          </div>
          {scenarios.rows.map((row, i) => (
            <div key={i} className={`spread-scenario-row spread-scenario-${row.dot}`}>
              <span className="spread-scenario-label">
                <span className={`spread-dot spread-dot-${row.dot}`}/>
                {row.label}
              </span>
              <span className="mono">{row.range}</span>
              <span className={`mono ${row.plClass}`}>{row.pl}</span>
            </div>
          ))}
          <div className="spread-scenarios-footer">
            <span>Net debit <strong>${scenarios.netDebit.toFixed(2)}</strong>/share</span>
            <span>Max gain <strong className="green">+${scenarios.maxGain.toLocaleString()}</strong></span>
            <span>Max loss <strong className="red">-${scenarios.maxLoss.toLocaleString()}</strong></span>
            <span>Qty <strong>{scenarios.qty}</strong></span>
          </div>
        </div>
      ) : (
        <div className="mono dim" style={{ fontSize: 11, padding: '8px 0' }}>
          {displayLong && displayShort
            ? 'Entry prices not yet available — scenarios will appear once both legs fill.'
            : 'Waiting for both legs to be placed…'}
        </div>
      )}

      {/* ── Close ── */}
      <div className="spread-close-row">
        {!confirming ? (
          <button className="btn btn-danger" style={{ fontSize: 12, padding: '6px 14px' }}
            onClick={e => { e.stopPropagation(); setConfirming(true) }} disabled={busy}>
            <XCircle size={12}/> Close Spread
          </button>
        ) : (
          <div className="spread-confirm">
            <span className="mono dim" style={{ fontSize: 12 }}>Close both legs — sure?</span>
            <button className="btn btn-danger" style={{ fontSize: 12, padding: '6px 14px' }}
              onClick={e => { e.stopPropagation(); doClose() }} disabled={busy}>
              {busy ? 'Closing…' : 'Confirm'}
            </button>
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 10px' }}
              onClick={e => { e.stopPropagation(); setConfirming(false) }}>
              Cancel
            </button>
          </div>
        )}
      </div>

      {msg && <div className={`pos-edit-msg mono ${msg.err ? 'red' : 'green'}`}>{msg.text}</div>}
    </div>
  )
}

// ── Position card ─────────────────────────────────────────────────────────────
function PositionCard({ pos, onUpdate, onClosePosition, onSelect, selected }) {
  const [editing, setEditing] = useState(false)

  const plpc      = pos.last_plpc
  const peak      = pos.peak_plpc
  const trail     = pos.took_partial && peak != null ? peak - 0.20 : null
  const isPartial = pos.took_partial

  const sparkData = peak != null ? [
    { p: 0 },
    { p: peak * 0.4 * 100 },
    { p: peak * 0.7 * 100 },
    { p: peak * 100 },
    { p: (plpc ?? 0) * 100 },
  ] : []

  return (
    <div className={`position-card ${plpc != null && plpc < 0 ? 'pos-red' : 'pos-green'}${selected ? ' pos-selected' : ''}`} onClick={function(e) { if (!e.target.closest('.pos-edit-panel') && !e.target.closest('.pos-edit-btn')) onSelect(pos.ticker) }} style={{cursor:'pointer'}}>
      <div className="pos-header">
        <div>
          <div className="pos-ticker">{pos.ticker}</div>
          <div className="pos-contract mono dim">{pos.contract}</div>
          {pos.spread_pair && (
            <div className="pos-contract mono dim" style={{ fontSize: 10, marginTop: 1 }}>
              pair: {pos.spread_pair}
            </div>
          )}
        </div>
        <div style={{display:'flex', alignItems:'flex-start', gap:8}}>
          <div className="pos-badges">
            <span className={`badge ${pos.status === 'carry' ? 'badge-amber' : 'badge-blue'}`}>
              {pos.status === 'carry' ? 'CARRY' : 'ACTIVE'}
            </span>
            {pos.strategy_label === 'bull_call_spread' && (
              <span className="badge badge-purple">
                BULL SPREAD {pos.spread_leg === 'short' ? '· SHORT LEG' : ''}
              </span>
            )}
            {pos.strategy_label === 'bear_put_spread' && (
              <span className="badge badge-red">
                BEAR SPREAD {pos.spread_leg === 'short' ? '· SHORT LEG' : ''}
              </span>
            )}
            {isPartial && <span className="badge badge-green">PARTIAL ✓</span>}
          </div>
          <button
            className={`btn btn-ghost icon-btn pos-edit-btn${editing ? ' pos-edit-btn-on' : ''}`}
            onClick={() => setEditing(v => !v)}
            title="Edit position"
          ><Edit2 size={13}/></button>
        </div>
      </div>

      <div className="pos-pl">
        <span className={`pos-pl-value mono ${plClass(plpc)}`}>{pct(plpc)}</span>
        <span className="pos-pl-label dim mono">P/L</span>
      </div>

      {sparkData.length > 0 && (
        <div className="pos-sparkline">
          <ResponsiveContainer width="100%" height={48}>
            <AreaChart data={sparkData} margin={{ top:4, right:0, left:0, bottom:0 }}>
              <defs>
                <linearGradient id={`grad-${pos.ticker}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={plpc >= 0 ? '#00e676' : '#ff3d57'} stopOpacity={0.3}/>
                  <stop offset="95%" stopColor={plpc >= 0 ? '#00e676' : '#ff3d57'} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="p"
                stroke={plpc >= 0 ? '#00e676' : '#ff3d57'} strokeWidth={1.5}
                fill={`url(#grad-${pos.ticker})`} dot={false}/>
              {trail != null && (
                <ReferenceLine y={trail * 100} stroke="#ffc107" strokeDasharray="3 3" strokeWidth={1}/>
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Stock price / SL / TP bar ── */}
      <div className="pos-levels">
        <div className="pos-level">
          <span className="dim mono">STOCK</span>
          <span className="mono">{pos.stock_price != null ? `$${pos.stock_price.toFixed(2)}` : '—'}</span>
        </div>
        <div className="pos-level-divider"/>
        <div className="pos-level">
          <span className="dim mono">SL</span>
          <span className="mono red">{pos.sl_stock != null ? `$${pos.sl_stock}` : '—'}</span>
        </div>
        <div className="pos-level-divider"/>
        <div className="pos-level">
          <span className="dim mono">TP</span>
          <span className="mono green">{pos.tp_stock != null ? `$${pos.tp_stock}` : '—'}</span>
          {pos.took_partial && (
            <span className="partial-badge">½ taken</span>
          )}
        </div>
      </div>

      <div className="pos-details">
        <div className="pos-detail">
          <span className="dim mono">QTY</span>
          <span className="mono">{pos.current_qty} <span className="dim">/ {pos.original_qty}</span></span>
        </div>
        <div className="pos-detail">
          <span className="dim mono">ENTRY</span>
          <span className="mono">{pos.entry_avg_price != null ? `$${pos.entry_avg_price.toFixed(2)}` : '—'}</span>
        </div>
        <div className="pos-detail">
          <span className="dim mono">PARTIAL TP</span>
          {pos.took_partial
            ? <span className="mono amber">Taken ({pos.partial_qty_sold ?? '?'} sold)</span>
            : <span className="mono dim">Not taken</span>
          }
        </div>
        {peak != null && (
          <div className="pos-detail">
            <span className="dim mono">PEAK</span>
            <span className="mono green">{pct(peak)}</span>
          </div>
        )}
        {trail != null && (
          <div className="pos-detail">
            <span className="dim mono">TRAIL STOP</span>
            <span className={`mono ${plClass(trail)}`}>{pct(trail)}</span>
          </div>
        )}
      </div>

      {editing && (
        <EditPanel
          pos={pos}
          onSave={updated => { onUpdate(updated); setEditing(false) }}
          onClose={() => setEditing(false)}
          onClosePosition={(ticker, contract, queued) => { onClosePosition(ticker, contract, queued); setEditing(false) }}
        />
      )}
    </div>
  )
}

// ── Close queue banner ────────────────────────────────────────────────────────
function CloseQueueBanner({ queue, onCancel }) {
  if (!queue || queue.length === 0) return null
  return (
    <div className="close-queue-banner">
      <Clock size={14} style={{color:'var(--amber)', flexShrink:0}}/>
      <span className="mono" style={{fontSize:12, color:'var(--amber)'}}>
        Queued to close at next market open:
      </span>
      {queue.map(q => (
        <span key={q.ticker} className="queue-tag">
          <span className="mono">{q.ticker}</span>
          <button className="queue-cancel-btn" onClick={() => onCancel(q.ticker)} title="Cancel">
            <X size={10}/>
          </button>
        </span>
      ))}
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
// ── SL/TP localStorage helpers ────────────────────────────────────────────
// Keyed by CONTRACT symbol (e.g. ORCL250321C00160000), not ticker.
// This prevents stale values from old trades bleeding into new positions.
var LS_SLTP_KEY = 'dashboard_pos_sltp_v2'
function lsReadSlTp() {
  try { return JSON.parse(localStorage.getItem(LS_SLTP_KEY) || '{}') } catch(e) { return {} }
}
function lsWriteSlTp(contract, sl, tp) {
  try {
    var map = lsReadSlTp()
    map[contract] = { sl_stock: sl, tp_stock: tp }
    localStorage.setItem(LS_SLTP_KEY, JSON.stringify(map))
  } catch(e) {}
}
function lsRemoveSlTp(contract) {
  try {
    var map = lsReadSlTp()
    delete map[contract]
    localStorage.setItem(LS_SLTP_KEY, JSON.stringify(map))
  } catch(e) {}
}
function mergeSlTp(positions) {
  var map = lsReadSlTp()
  if (!Object.keys(map).length) return positions
  return positions.map(function(p) {
    var saved = map[p.contract]
    if (!saved) return p
    return Object.assign({}, p, {
      sl_stock: saved.sl_stock != null ? saved.sl_stock : p.sl_stock,
      tp_stock: saved.tp_stock != null ? saved.tp_stock : p.tp_stock,
    })
  })
}

export default function Dashboard() {
  const { data: statusData }                             = usePolling(() => api.getStatus(),    5000)
  const { data: posData, loading, error }                = usePolling(() => api.getPositions(), 8000)
  const [localPositions, setLocalPositions]              = useState(null)
  const [closeQueue,     setCloseQueue]                  = useState([])
  const [chartTicker,    setChartTicker]                 = useState(null)

  // On mount, if posData is already populated (cached by hook), apply merge immediately
  useEffect(function() {
    if (posData?.positions) {
      setLocalPositions(mergeSlTp(posData.positions))
    }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // Sync every time poll data arrives — localStorage always wins for SL/TP
  useEffect(function() {
    if (!posData?.positions) return
    posData.positions.forEach(function(p) {
      if (!p.contract) return
      var map = lsReadSlTp()
      var saved = map[p.contract]
      var apiHasSl = p.sl_stock != null
      var apiHasTp = p.tp_stock != null
      if ((apiHasSl || apiHasTp) && !saved) {
        lsWriteSlTp(p.contract, p.sl_stock, p.tp_stock)
      }
    })
    setLocalPositions(mergeSlTp(posData.positions))
  }, [posData])

  async function loadQueue() {
    try { const d = await api.getCloseQueue(); setCloseQueue(d.queue || []) } catch(e) {}
  }
  useEffect(() => { loadQueue() }, [])

  const positions = localPositions ?? posData?.positions ?? []
  const active    = positions.filter(p => p.status === 'active')
  const carry     = positions.filter(p => p.status === 'carry')

  // Group spread pairs; everything else renders normally
  const spreadPositions  = positions.filter(p => p.spread_id)
  const regularPositions = positions.filter(p => !p.spread_id)
  const spreadGroups     = {}
  spreadPositions.forEach(p => {
    if (!spreadGroups[p.spread_id]) spreadGroups[p.spread_id] = {}
    spreadGroups[p.spread_id][p.spread_leg] = p
  })

  // Avg P/L: use spread-level P/L for spreads, last_plpc for regular positions
  const avgPl = (() => {
    const values = []
    Object.values(spreadGroups).forEach(group => {
      const legA = group.long ?? group.short
      const legB = group.long && group.short ? (legA === group.long ? group.short : group.long) : null
      if (!legA || !legB) return
      const uplA = legA.unrealized_pl, uplB = legB.unrealized_pl
      if (uplA == null || uplB == null) return
      const entryA = legA.entry_avg_price, entryB = legB.entry_avg_price
      if (entryA == null || entryB == null) return
      const netDebit = Math.abs(entryA - entryB)
      if (netDebit <= 0) return
      const qty = legA.current_qty ?? legB.current_qty ?? 1
      values.push((uplA + uplB) / (netDebit * 100 * qty))
    })
    regularPositions.forEach(p => {
      if (p.last_plpc != null) values.push(p.last_plpc)
    })
    return values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : null
  })()

  function handleUpdate(updated) {
    // Persist SL/TP to localStorage so it survives polls and page reloads
    if (updated.sl_stock != null || updated.tp_stock != null) {
      lsWriteSlTp(updated.contract, updated.sl_stock, updated.tp_stock)
    }
    setLocalPositions(function(prev) {
      var base = prev || []
      return base.map(function(p) { return p.contract === updated.contract ? updated : p })
    })
  }

  function handleClosePosition(ticker, contract, queued) {
    if (!queued) {
      setLocalPositions(prev => prev.filter(p => p.contract !== contract))
      lsRemoveSlTp(contract)  // clear persisted SL/TP for closed position
    }
    loadQueue()
  }

  function handleCloseSpread(spreadId, queued) {
    if (!queued) {
      setLocalPositions(prev => prev.filter(p => p.spread_id !== spreadId))
    }
    loadQueue()
  }

  async function cancelQueued(ticker) {
    try { const d = await api.removeFromQueue(ticker); setCloseQueue(d.queue || []) } catch(e) {}
  }

  return (
    <div className="dashboard">

      <CloseQueueBanner queue={closeQueue} onCancel={cancelQueued}/>

      <div className="grid-5" style={{ marginBottom: 24 }}>
        <StatCard label="Account Value"
          value={statusData?.account?.portfolio_value != null
            ? '$' + Number(statusData.account.portfolio_value).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})
            : '—'}
          sub={statusData?.account?.buying_power != null
            ? 'BP $' + Number(statusData.account.buying_power).toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: 0})
            : ''}
          accent="var(--blue)"/>
        <StatCard label="Open Positions" value={positions.length}
          sub={`${active.length} active · ${carry.length} carry`} accent="var(--blue)"/>
        <StatCard label="Avg P/L" value={avgPl != null ? pct(avgPl) : '—'}
          accent={avgPl != null && avgPl >= 0 ? 'var(--green)' : 'var(--red)'}/>
        <StatCard label="Traded Today" value={statusData?.traded_today?.length ?? 0}
          sub={statusData?.traded_today?.join(', ') || 'none'} accent="var(--amber)"/>
        <StatCard label="Bot Status" value={statusData?.bot_running ? 'LIVE' : 'IDLE'}
          sub={statusData?.bot_running ? `PID ${statusData.pid}` : 'stopped'}
          accent={statusData?.bot_running ? 'var(--green)' : 'var(--text-3)'}/>
      </div>

      {loading && !localPositions && (
        <div className="mono dim" style={{ padding:'40px 0', textAlign:'center' }}>Loading positions...</div>
      )}
      {error && (
        <div className="card" style={{ borderColor:'var(--red-dim)', display:'flex', gap:10, alignItems:'center' }}>
          <AlertTriangle size={16} color="var(--red)"/>
          <span className="mono" style={{ color:'var(--red)' }}>{error}</span>
        </div>
      )}
      {!loading && positions.length === 0 && (
        <div className="empty-state">
          <Minus size={32} color="var(--text-3)"/>
          <p className="mono dim">No open positions</p>
          <p className="dim" style={{ fontSize:12 }}>Configure plans and start the bot to begin trading</p>
        </div>
      )}

      {positions.length > 0 && (
        <div className="positions-grid">
          {Object.entries(spreadGroups).map(([id, group]) => (
            <SpreadPairCard key={id}
              longLeg={group.long}
              shortLeg={group.short}
              onCloseSpread={handleCloseSpread}
              selected={chartTicker === (group.long?.ticker ?? group.short?.ticker)}
              onSelect={ticker => setChartTicker(cur => cur === ticker ? null : ticker)}
            />
          ))}
          {regularPositions.map(pos => (
            <PositionCard key={pos.ticker} pos={pos}
              onUpdate={handleUpdate}
              onClosePosition={handleClosePosition}
              selected={chartTicker === pos.ticker}
              onSelect={function(ticker) { setChartTicker(function(cur) { return cur === ticker ? null : ticker }) }}
            />
          ))}
        </div>
      )}

      {chartTicker && (
        <PositionChart
          symbol={chartTicker}
          onClose={function() { setChartTicker(null) }}
        />
      )}
    </div>
  )
}