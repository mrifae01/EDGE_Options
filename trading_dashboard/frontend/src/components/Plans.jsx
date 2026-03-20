import { useState, useEffect } from 'react'
import { usePolling } from '../hooks/usePolling.js'
import { api } from '../lib/api.js'
import { Plus, Trash2, Edit2, Check, X, RefreshCw, TrendingUp, TrendingDown, Clock, AlertCircle, Zap } from 'lucide-react'
import './Plans.css'

const EMPTY = {
  ticker: '', contract: '', qty: 1, type: 'LONG', sl_stock: '', tp_stock: ''
}

// ── Inline-editable plan row ──────────────────────────────────────────────────
function PlanRow({ plan, onDelete, onSave, disabled }) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState({ ...plan })
  const [busy,    setBusy]    = useState(false)

  function setF(k, v) { setDraft(d => ({ ...d, [k]: v })) }

  async function save() {
    setBusy(true)
    try {
      await onSave(plan.ticker, {
        ...draft,
        qty:      parseInt(draft.qty),
        sl_stock: parseFloat(draft.sl_stock),
        tp_stock: parseFloat(draft.tp_stock),
        ticker:   draft.ticker.toUpperCase(),
        contract: draft.contract.toUpperCase(),
      })
      setEditing(false)
    } finally { setBusy(false) }
  }

  function cancel() { setDraft({ ...plan }); setEditing(false) }

  if (editing) {
    return (
      <tr className="plan-row-editing">
        <td><input value={draft.ticker} onChange={e => setF('ticker', e.target.value)} style={{textTransform:'uppercase',width:64}}/></td>
        <td><input value={draft.contract} onChange={e => setF('contract', e.target.value)} style={{textTransform:'uppercase',width:180,fontSize:11}}/></td>
        <td>
          <select value={draft.type} onChange={e => setF('type', e.target.value)} style={{width:80}}>
            <option value="LONG">LONG</option>
            <option value="SHORT">SHORT</option>
          </select>
        </td>
        <td><input type="number" min="1" value={draft.qty} onChange={e => setF('qty', e.target.value)} style={{width:52}}/></td>
        <td><input type="number" step="0.01" value={draft.sl_stock} onChange={e => setF('sl_stock', e.target.value)} style={{width:80}}/></td>
        <td><input type="number" step="0.01" value={draft.tp_stock} onChange={e => setF('tp_stock', e.target.value)} style={{width:80}}/></td>
        <td>
          <div style={{display:'flex',gap:4}}>
            <button className="btn btn-blue icon-btn" onClick={save} disabled={busy} title="Save"><Check size={13}/></button>
            <button className="btn btn-ghost icon-btn" onClick={cancel} title="Cancel"><X size={13}/></button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr className="plan-row">
      <td><span className="mono">{plan.ticker}</span></td>
      <td><span className="mono dim" style={{fontSize:11}}>{plan.contract}</span></td>
      <td><span className={`badge ${plan.type === 'LONG' ? 'badge-green' : 'badge-red'}`}>{plan.type}</span></td>
      <td className="mono">{plan.qty}</td>
      <td className="mono red">${plan.sl_stock}</td>
      <td className="mono green">${plan.tp_stock}</td>
      <td>
        <div style={{display:'flex',gap:4}}>
          <button className="btn btn-ghost icon-btn" onClick={() => setEditing(true)} disabled={disabled} title="Edit plan">
            <Edit2 size={13}/>
          </button>
          <button className="btn btn-ghost icon-btn" onClick={() => onDelete(plan.ticker)} disabled={disabled} title="Delete plan">
            <Trash2 size={13}/>
          </button>
        </div>
      </td>
    </tr>
  )
}

// ── Market hours helper — called fresh each render, never stale ───────────────
// The old version computed this at module load time so it never updated.
// A plan added after close would incorrectly show "ENTRY MET" for the rest of
// the session. Now we re-evaluate on every render.
function checkMarketOpen() {
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const day   = nowET.getDay()                                  // 0=Sun, 6=Sat
  const mins  = nowET.getHours() * 60 + nowET.getMinutes()
  return day >= 1 && day <= 5 && mins >= 570 && mins < 960     // Mon-Fri 9:30–4:00 ET
}

// ── Signal card for one plan ──────────────────────────────────────────────────
function SignalCard({ sig }) {
  const isLong = sig.direction === 'LONG'
  const Icon   = isLong ? TrendingUp : TrendingDown

  if (sig.error) {
    return (
      <div className="signal-card signal-error">
        <div className="signal-ticker">{sig.ticker}</div>
        <div className="mono dim" style={{fontSize:11,marginTop:4,display:'flex',alignItems:'center',gap:4}}>
          <AlertCircle size={11}/> {sig.error}
        </div>
      </div>
    )
  }

  const priceDiff = sig.cur_price != null && sig.signal_level != null
    ? (sig.cur_price - sig.signal_level).toFixed(2)
    : null

  let sigTimeStr = '—'
  if (sig.signal_time) {
    try {
      sigTimeStr = new Date(sig.signal_time).toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York'
      })
    } catch(e) {}
  }

  // Re-evaluate market hours on every render.
  // If the market is closed, nothing can be "triggered" or "ready" — always waiting.
  const isOpen = checkMarketOpen()
  const status = !isOpen
    ? 'waiting'
    : sig.entry_met ? 'triggered'
    : sig.qualified ? 'ready'
    : 'waiting'

  // Badge label also respects market hours
  const badgeLabel = !isOpen
    ? <><Clock size={10}/>&nbsp;MARKET CLOSED</>
    : sig.entry_met
    ? <><Zap size={10}/>&nbsp;ENTRY MET</>
    : sig.qualified
    ? <><Clock size={10}/>&nbsp;WAITING ENTRY</>
    : <><Clock size={10}/>&nbsp;NO SIGNAL</>

  return (
    <div className={`signal-card signal-${status}`}>
      {/* Status + direction row */}
      <div className="signal-status-row">
        <span className={`signal-badge sbadge-${status}`}>{badgeLabel}</span>
        <span className={`mono ${isLong ? 'green' : 'red'}`} style={{fontSize:11,display:'flex',alignItems:'center',gap:3}}>
          <Icon size={11}/> {sig.direction}
        </span>
      </div>

      {/* Ticker */}
      <div className="signal-ticker">{sig.ticker}</div>
      <div className="mono dim" style={{fontSize:10,marginBottom:10,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
        {sig.contract}
      </div>

      {/* Stats grid */}
      <div className="signal-stats">
        <div className="signal-stat">
          <div className="signal-label">Current</div>
          <div className="signal-value mono">{sig.cur_price != null ? `$${sig.cur_price.toFixed(2)}` : '—'}</div>
        </div>
        <div className="signal-stat">
          <div className="signal-label">Signal Level</div>
          <div className={`signal-value mono ${sig.qualified ? (isLong ? 'green' : 'red') : 'dim'}`}>
            {sig.signal_level != null ? `$${sig.signal_level.toFixed(2)}` : '—'}
          </div>
        </div>
        <div className="signal-stat">
          <div className="signal-label">Candle Time</div>
          <div className="signal-value mono dim">{sig.qualified ? sigTimeStr : '—'}</div>
        </div>
        <div className="signal-stat">
          <div className="signal-label">vs Level</div>
          <div className={`signal-value mono ${priceDiff > 0 ? 'green' : priceDiff < 0 ? 'red' : 'dim'}`}>
            {priceDiff != null ? `${priceDiff > 0 ? '+' : ''}$${priceDiff}` : '—'}
          </div>
        </div>
      </div>

      {/* SL / TP / Qty */}
      <div className="signal-sltp">
        <span className="mono red" style={{fontSize:11}}>SL ${sig.sl_stock}</span>
        <span className="mono dim" style={{fontSize:11}}>·</span>
        <span className="mono green" style={{fontSize:11}}>TP ${sig.tp_stock}</span>
        <span className="mono dim" style={{fontSize:11}}>·</span>
        <span className="mono dim" style={{fontSize:11}}>Qty {sig.qty}</span>
      </div>

      {/* Entry instruction — only shown during market hours */}
      {isOpen && sig.entry_met && (
        <div className="signal-entry-box">
          <Zap size={12} style={{flexShrink:0}}/>
          <span>
            Entry condition met — {isLong ? 'price above' : 'price below'} signal.
            Enter {isLong ? 'above' : 'below'} <strong>${sig.signal_level?.toFixed(2)}</strong>
            {' '}(now <strong>${sig.cur_price?.toFixed(2)}</strong>)
          </span>
        </div>
      )}
      {isOpen && sig.qualified && !sig.entry_met && (
        <div className="signal-wait-box">
          <Clock size={12} style={{flexShrink:0}}/>
          <span>
            Signal at {sigTimeStr} — waiting for price to {isLong ? 'break above' : 'break below'} <strong>${sig.signal_level?.toFixed(2)}</strong>
          </span>
        </div>
      )}
      {(!isOpen || !sig.qualified) && !(isOpen && sig.entry_met) && (
        <div className="signal-none-box">
          <Clock size={12} style={{flexShrink:0}}/>
          <span>
            {!isOpen
              ? 'Market closed — signal will be evaluated at next open'
              : `No qualified ${isLong ? 'green' : 'red'} 5-min candle yet today`}
          </span>
        </div>
      )}
    </div>
  )
}

// ── Main Plans component ──────────────────────────────────────────────────────
export default function Plans() {
  const { data, refetch } = usePolling(() => api.getPlans(), 10000)
  const plans = data?.plans ?? []

  const [form,        setForm]        = useState(EMPTY)
  const [busy,        setBusy]        = useState(false)
  const [msg,         setMsg]         = useState(null)
  const [signals,     setSignals]     = useState(null)
  const [sigLoad,     setSigLoad]     = useState(false)
  const [sigErr,      setSigErr]      = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)

  function set(field, value) { setForm(f => ({ ...f, [field]: value })) }

  async function loadSignals() {
    setSigLoad(true); setSigErr(null)
    try {
      const d = await api.getSignals()
      setSignals(d.signals || [])
      setLastRefresh(new Date())
    } catch(e) {
      setSigErr(e.message)
    } finally { setSigLoad(false) }
  }

  useEffect(() => {
    if (plans.length > 0) loadSignals()
  }, [plans.length])

  useEffect(() => {
    if (plans.length === 0) return
    const id = setInterval(() => {
      if (checkMarketOpen()) loadSignals()
    }, 60000)
    return () => clearInterval(id)
  }, [plans.length])

  async function handleAdd(e) {
    e.preventDefault(); setMsg(null)
    if (!form.ticker || !form.contract || !form.sl_stock || !form.tp_stock) {
      setMsg({ type: 'error', text: 'All fields are required.' }); return
    }
    setBusy(true)
    try {
      const newPlan = {
        ...form,
        ticker:   form.ticker.toUpperCase(),
        contract: form.contract.toUpperCase(),
        qty:      parseInt(form.qty),
        sl_stock: parseFloat(form.sl_stock),
        tp_stock: parseFloat(form.tp_stock),
      }
      await api.savePlans([...plans, newPlan])
      setForm(EMPTY)
      setMsg({ type: 'ok', text: `Plan added for ${newPlan.ticker}.` })
      await refetch()
    } catch(e) {
      setMsg({ type: 'error', text: e.message })
    } finally { setBusy(false) }
  }

  async function handleSave(originalTicker, updated) {
    setBusy(true); setMsg(null)
    try {
      const newPlans = plans.map(p =>
        p.ticker.toUpperCase() === originalTicker.toUpperCase() ? updated : p
      )
      await api.savePlans(newPlans)
      setMsg({ type: 'ok', text: `Updated ${updated.ticker}.` })
      await refetch()
    } catch(e) {
      setMsg({ type: 'error', text: e.message })
    } finally { setBusy(false) }
  }

  async function handleDelete(ticker) {
    setBusy(true); setMsg(null)
    try {
      await api.deletePlan(ticker)
      setMsg({ type: 'ok', text: `Deleted ${ticker}.` })
      await refetch()
    } catch(e) {
      setMsg({ type: 'error', text: e.message })
    } finally { setBusy(false) }
  }

  const refreshStr = lastRefresh
    ? lastRefresh.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })
    : null

  return (
    <div className="plans">

      {/* ── Signal Monitor ── */}
      {plans.length > 0 && (
        <div className="card">
          <div className="card-title-row">
            <div className="card-title" style={{marginBottom:0}}>Signal Monitor</div>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              {refreshStr && <span className="mono dim" style={{fontSize:11}}>Updated {refreshStr}</span>}
              <button
                className="btn btn-ghost"
                style={{padding:'5px 10px',fontSize:12,display:'flex',alignItems:'center',gap:5}}
                onClick={loadSignals}
                disabled={sigLoad}
              >
                <RefreshCw size={12} className={sigLoad ? 'spin' : ''}/>
                Refresh
              </button>
            </div>
          </div>
          <p className="mono dim" style={{fontSize:11,margin:'6px 0 14px',lineHeight:1.6}}>
            Detects the first qualified 5-min candle for each plan and whether the stock price has crossed the entry level.
            Auto-refreshes every 60s during market hours (9:30–4:00 ET).
          </p>
          {sigErr && <div className="mono red" style={{fontSize:12,marginBottom:12}}>{sigErr}</div>}
          {sigLoad && !signals && (
            <div className="mono dim" style={{textAlign:'center',padding:'24px 0',fontSize:12}}>
              Loading signals…
            </div>
          )}
          {signals && (
            <div className="signal-grid-outer">
              {signals.map(sig => <SignalCard key={sig.ticker} sig={sig}/>)}
            </div>
          )}
        </div>
      )}

      {/* ── Active Plans Table ── */}
      <div className="card">
        <div className="card-title">Active Plans ({plans.length})</div>
        {plans.length === 0 ? (
          <div className="mono dim" style={{ padding: '20px 0', textAlign: 'center' }}>
            No plans configured yet.
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ticker</th><th>Contract</th><th>Direction</th>
                  <th>Qty</th><th>Stop Loss</th><th>Take Profit</th><th></th>
                </tr>
              </thead>
              <tbody>
                {plans.map(p => (
                  <PlanRow key={p.ticker} plan={p}
                    onDelete={handleDelete} onSave={handleSave} disabled={busy}/>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {msg && (
          <div className={`form-msg mono ${msg.type === 'ok' ? 'green' : 'red'}`} style={{marginTop:12}}>
            {msg.text}
          </div>
        )}
      </div>

      {/* ── Add Plan Form ── */}
      <div className="card">
        <div className="card-title">Add New Plan</div>
        <form className="plan-form" onSubmit={handleAdd}>
          <div className="form-row">
            <div className="form-group">
              <label>Ticker</label>
              <input placeholder="AAPL" value={form.ticker}
                onChange={e => set('ticker', e.target.value)} style={{textTransform:'uppercase'}}/>
            </div>
            <div className="form-group form-group-wide">
              <label>OCC Contract Symbol</label>
              <input placeholder="AAPL260220C00200000" value={form.contract}
                onChange={e => set('contract', e.target.value)} style={{textTransform:'uppercase'}}/>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Direction</label>
              <select value={form.type} onChange={e => set('type', e.target.value)}>
                <option value="LONG">LONG</option>
                <option value="SHORT">SHORT</option>
              </select>
            </div>
            <div className="form-group">
              <label>Quantity</label>
              <input type="number" min="1" value={form.qty} onChange={e => set('qty', e.target.value)}/>
            </div>
            <div className="form-group">
              <label>Stop Loss (stock $)</label>
              <input type="number" step="0.01" placeholder="185.00" value={form.sl_stock}
                onChange={e => set('sl_stock', e.target.value)}/>
            </div>
            <div className="form-group">
              <label>Take Profit (stock $)</label>
              <input type="number" step="0.01" placeholder="210.00" value={form.tp_stock}
                onChange={e => set('tp_stock', e.target.value)}/>
            </div>
          </div>
          <button type="submit" className="btn btn-blue" disabled={busy}>
            <Plus size={14}/> Add Plan
          </button>
        </form>
      </div>

      <div className="hint mono dim">
        <strong>Note:</strong> Plans cannot be modified while the bot is running. Stop the bot first.
      </div>
    </div>
  )
}