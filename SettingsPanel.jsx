import { useState, useEffect } from 'react'
import { api } from '../lib/api.js'
import { Save } from 'lucide-react'
import './SettingsPanel.css'

const DEFAULTS = {
  tp_pct: 0.25,
  hard_stop_pct: 0.50,
  trail_offset: 0.20,
  gap_limit: 0.03,
  poll_seconds: 60,
}

function SettingRow({ label, description, children }) {
  return (
    <div className="setting-row">
      <div className="setting-info">
        <div className="setting-label">{label}</div>
        <div className="setting-desc dim">{description}</div>
      </div>
      <div className="setting-input">
        {children}
      </div>
    </div>
  )
}

export default function SettingsPanel() {
  const [settings, setSettings] = useState(DEFAULTS)
  const [busy, setBusy]         = useState(false)
  const [msg, setMsg]           = useState(null)

  useEffect(() => {
    api.getSettings().then(s => setSettings(s)).catch(() => {})
  }, [])

  function set(key, value) {
    setSettings(s => ({ ...s, [key]: parseFloat(value) || value }))
  }

  async function handleSave() {
    setBusy(true)
    setMsg(null)
    try {
      await api.saveSettings(settings)
      setMsg({ type: 'ok', text: 'Settings saved.' })
    } catch(e) {
      setMsg({ type: 'error', text: e.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings">
      <div className="card">
        <div className="card-title">Strategy Parameters</div>

        <div className="settings-note mono dim">
          Changes take effect the next time the bot starts. Restart the bot to apply.
        </div>

        <div className="settings-list">
          <SettingRow
            label="Partial Take Profit"
            description="Sell half position when option P/L reaches this level"
          >
            <div className="input-with-unit">
              <input
                type="number" step="0.01" min="0.01" max="5"
                value={(settings.tp_pct * 100).toFixed(0)}
                onChange={e => set('tp_pct', parseFloat(e.target.value) / 100)}
              />
              <span className="unit mono dim">%</span>
            </div>
            <div className="setting-current mono">
              Currently: <span className="green">+{(settings.tp_pct * 100).toFixed(0)}%</span>
            </div>
          </SettingRow>

          <SettingRow
            label="Hard Stop Loss"
            description="Close entire position if option P/L falls to this level (always active)"
          >
            <div className="input-with-unit">
              <input
                type="number" step="0.01" min="0.01" max="1"
                value={(settings.hard_stop_pct * 100).toFixed(0)}
                onChange={e => set('hard_stop_pct', parseFloat(e.target.value) / 100)}
              />
              <span className="unit mono dim">%</span>
            </div>
            <div className="setting-current mono">
              Currently: <span className="red">-{(settings.hard_stop_pct * 100).toFixed(0)}%</span>
            </div>
          </SettingRow>

          <SettingRow
            label="Trailing Stop Offset"
            description="After partial, trailing stop sits this far below peak P/L"
          >
            <div className="input-with-unit">
              <input
                type="number" step="0.01" min="0.01" max="1"
                value={(settings.trail_offset * 100).toFixed(0)}
                onChange={e => set('trail_offset', parseFloat(e.target.value) / 100)}
              />
              <span className="unit mono dim">%</span>
            </div>
            <div className="setting-current mono">
              Currently: <span className="amber">{(settings.trail_offset * 100).toFixed(0)}% behind peak</span>
            </div>
          </SettingRow>

          <SettingRow
            label="Gap Filter"
            description="Skip ticker if overnight gap exceeds this threshold"
          >
            <div className="input-with-unit">
              <input
                type="number" step="0.01" min="0.01" max="0.2"
                value={(settings.gap_limit * 100).toFixed(0)}
                onChange={e => set('gap_limit', parseFloat(e.target.value) / 100)}
              />
              <span className="unit mono dim">%</span>
            </div>
            <div className="setting-current mono">
              Currently: <span className="blue">{(settings.gap_limit * 100).toFixed(0)}%</span>
            </div>
          </SettingRow>

          <SettingRow
            label="Poll Interval"
            description="How often the bot checks prices and manages positions"
          >
            <div className="input-with-unit">
              <input
                type="number" step="5" min="10" max="300"
                value={settings.poll_seconds}
                onChange={e => set('poll_seconds', parseInt(e.target.value))}
              />
              <span className="unit mono dim">sec</span>
            </div>
            <div className="setting-current mono">
              Currently: <span className="blue">{settings.poll_seconds}s</span>
            </div>
          </SettingRow>
        </div>

        {msg && (
          <div className={`form-msg mono ${msg.type === 'ok' ? 'green' : 'red'}`} style={{ marginTop: 16 }}>
            {msg.text}
          </div>
        )}

        <button
          className="btn btn-blue"
          style={{ marginTop: 20 }}
          onClick={handleSave}
          disabled={busy}
        >
          <Save size={14} /> Save Settings
        </button>
      </div>

      <div className="card">
        <div className="card-title">How Parameters Interact</div>
        <div className="param-explainer mono dim">
          <div className="param-flow">
            <span className="green">+{(settings.tp_pct * 100).toFixed(0)}%</span>
            <span className="arrow">→</span>
            <span>Sell half, arm trailing stop</span>
          </div>
          <div className="param-flow">
            <span className="amber">Peak × 1 − {(settings.trail_offset * 100).toFixed(0)}%</span>
            <span className="arrow">→</span>
            <span>Trailing stop level (rises with peak, never falls)</span>
          </div>
          <div className="param-flow">
            <span className="red">-{(settings.hard_stop_pct * 100).toFixed(0)}%</span>
            <span className="arrow">→</span>
            <span>Hard stop, closes everything immediately</span>
          </div>
        </div>
      </div>
    </div>
  )
}
