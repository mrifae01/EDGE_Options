import { useState } from 'react'
import { usePolling } from '../hooks/usePolling.js'
import { api } from '../lib/api.js'
import { Plus, Trash2, Save } from 'lucide-react'
import './Plans.css'

const EMPTY = {
  ticker: '', contract: '', qty: 1, type: 'LONG', sl_stock: '', tp_stock: ''
}

function PlanRow({ plan, onDelete, disabled }) {
  return (
    <tr>
      <td><span className="mono">{plan.ticker}</span></td>
      <td><span className="mono dim" style={{ fontSize: 11 }}>{plan.contract}</span></td>
      <td><span className={`badge ${plan.type === 'LONG' ? 'badge-green' : 'badge-red'}`}>{plan.type}</span></td>
      <td className="mono">{plan.qty}</td>
      <td className="mono red">${plan.sl_stock}</td>
      <td className="mono green">${plan.tp_stock}</td>
      <td>
        <button
          className="btn btn-ghost icon-btn"
          onClick={() => onDelete(plan.ticker)}
          disabled={disabled}
          title="Delete plan"
        >
          <Trash2 size={13} />
        </button>
      </td>
    </tr>
  )
}

export default function Plans() {
  const { data, refetch } = usePolling(() => api.getPlans(), 10000)
  const plans = data?.plans ?? []

  const [form, setForm]   = useState(EMPTY)
  const [busy, setBusy]   = useState(false)
  const [msg, setMsg]     = useState(null)

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function handleAdd(e) {
    e.preventDefault()
    setMsg(null)
    if (!form.ticker || !form.contract || !form.sl_stock || !form.tp_stock) {
      setMsg({ type: 'error', text: 'All fields are required.' })
      return
    }
    setBusy(true)
    try {
      const newPlan = {
        ...form,
        ticker: form.ticker.toUpperCase(),
        contract: form.contract.toUpperCase(),
        qty: parseInt(form.qty),
        sl_stock: parseFloat(form.sl_stock),
        tp_stock: parseFloat(form.tp_stock),
      }
      const updated = [...plans, newPlan]
      await api.savePlans(updated)
      setForm(EMPTY)
      setMsg({ type: 'ok', text: `Plan added for ${newPlan.ticker}.` })
      await refetch()
    } catch(e) {
      setMsg({ type: 'error', text: e.message })
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(ticker) {
    setBusy(true)
    setMsg(null)
    try {
      await api.deletePlan(ticker)
      setMsg({ type: 'ok', text: `Deleted ${ticker}.` })
      await refetch()
    } catch(e) {
      setMsg({ type: 'error', text: e.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="plans">
      {/* Existing plans table */}
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
                  <th>Ticker</th>
                  <th>Contract</th>
                  <th>Direction</th>
                  <th>Qty</th>
                  <th>Stop Loss</th>
                  <th>Take Profit</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {plans.map(p => (
                  <PlanRow
                    key={p.ticker}
                    plan={p}
                    onDelete={handleDelete}
                    disabled={busy}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add plan form */}
      <div className="card">
        <div className="card-title">Add New Plan</div>
        <form className="plan-form" onSubmit={handleAdd}>
          <div className="form-row">
            <div className="form-group">
              <label>Ticker</label>
              <input
                placeholder="AAPL"
                value={form.ticker}
                onChange={e => set('ticker', e.target.value)}
                style={{ textTransform: 'uppercase' }}
              />
            </div>
            <div className="form-group form-group-wide">
              <label>OCC Contract Symbol</label>
              <input
                placeholder="AAPL260220C00200000"
                value={form.contract}
                onChange={e => set('contract', e.target.value)}
                style={{ textTransform: 'uppercase' }}
              />
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
              <label>Quantity (contracts)</label>
              <input
                type="number" min="1"
                value={form.qty}
                onChange={e => set('qty', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Stop Loss (stock $)</label>
              <input
                type="number" step="0.01" placeholder="185.00"
                value={form.sl_stock}
                onChange={e => set('sl_stock', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Take Profit (stock $)</label>
              <input
                type="number" step="0.01" placeholder="210.00"
                value={form.tp_stock}
                onChange={e => set('tp_stock', e.target.value)}
              />
            </div>
          </div>

          {msg && (
            <div className={`form-msg mono ${msg.type === 'ok' ? 'green' : 'red'}`}>
              {msg.text}
            </div>
          )}

          <button type="submit" className="btn btn-blue" disabled={busy}>
            <Plus size={14} /> Add Plan
          </button>
        </form>
      </div>

      <div className="hint mono dim">
        <strong>Note:</strong> Plans cannot be modified while the bot is running. Stop the bot first.
      </div>
    </div>
  )
}
