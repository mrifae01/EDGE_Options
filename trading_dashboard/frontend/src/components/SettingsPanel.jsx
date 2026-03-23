import { useState, useEffect } from "react"
import { api } from "../lib/api.js"
import { Save } from "lucide-react"
import "./SettingsPanel.css"

const DEFAULTS = { tp_pct: 0.25, hard_stop_pct: 0.50, trail_offset: 0.20, gap_limit: 0.03, poll_seconds: 60 }

const BCS_DEFAULTS = {
  enabled:           true,
  universe:          "usa",
  price_min:         50,
  price_max:         200,
  spread_width_pct:  0.075,
  dte_min:           30,
  dte_max:           45,
  prefer_monthly:    true,
  max_debit_pct:     0.02,
  qty:               1,
  profit_target_pct: 0.50,
  stop_loss_pct:     0.50,
  time_stop_dte:     21,
  poll_seconds:      300,
}

const BPS_DEFAULTS = {
  enabled:           true,
  universe:          "usa",
  price_min:         50,
  price_max:         200,
  spread_width_pct:  0.075,
  dte_min:           30,
  dte_max:           45,
  prefer_monthly:    true,
  max_debit_pct:     0.02,
  qty:               1,
  profit_target_pct: 0.50,
  stop_loss_pct:     0.50,
  time_stop_dte:     21,
  poll_seconds:      300,
}

function SettingRow({ label, description, children }) {
  return (
    <div className="setting-row">
      <div className="setting-info">
        <div className="setting-label">{label}</div>
        <div className="setting-desc dim">{description}</div>
      </div>
      <div className="setting-input">{children}</div>
    </div>
  )
}

// ── Main bot settings ─────────────────────────────────────────────────────────
export default function SettingsPanel() {
  const [settings, setSettings] = useState(DEFAULTS)
  const [busy, setBusy] = useState(false)
  const [msg,  setMsg]  = useState(null)

  // ── BCS settings state ──────────────────────────────────────────────────────
  const [bcs,     setBcs]     = useState(BCS_DEFAULTS)
  const [bcsBusy, setBcsBusy] = useState(false)
  const [bcsMsg,  setBcsMsg]  = useState(null)

  // ── BPS settings state ──────────────────────────────────────────────────────
  const [bps,     setBps]     = useState(BPS_DEFAULTS)
  const [bpsBusy, setBpsBusy] = useState(false)
  const [bpsMsg,  setBpsMsg]  = useState(null)

  useEffect(() => {
    api.getSettings().then(s => setSettings(s)).catch(() => {})
    api.getBCSSettings().then(s => setBcs(s)).catch(() => {})
    api.getBPSSettings().then(s => setBps(s)).catch(() => {})
  }, [])

  function set(key, value) { setSettings(s => ({ ...s, [key]: parseFloat(value) || value })) }
  function setBcsField(key, value) { setBcs(s => ({ ...s, [key]: value })) }
  function setBpsField(key, value) { setBps(s => ({ ...s, [key]: value })) }

  async function handleSave() {
    setBusy(true); setMsg(null)
    try { await api.saveSettings(settings); setMsg({ type: "ok", text: "Settings saved." }) }
    catch(e) { setMsg({ type: "error", text: e.message }) }
    finally { setBusy(false) }
  }

  async function handleSaveBcs() {
    setBcsBusy(true); setBcsMsg(null)
    try {
      await api.saveBCSSettings(bcs)
      setBcsMsg({ type: "ok", text: "Bull call spread settings saved." })
    } catch(e) {
      setBcsMsg({ type: "error", text: e.message })
    } finally {
      setBcsBusy(false)
    }
  }

  async function handleSaveBps() {
    setBpsBusy(true); setBpsMsg(null)
    try {
      await api.saveBPSSettings(bps)
      setBpsMsg({ type: "ok", text: "Bear put spread settings saved." })
    } catch(e) {
      setBpsMsg({ type: "error", text: e.message })
    } finally {
      setBpsBusy(false)
    }
  }

  return (
    <div className="settings">

      {/* ── Existing main-bot settings card ─────────────────────────────────── */}
      <div className="card">
        <div className="card-title">Strategy Parameters</div>
        <div className="settings-note mono dim">Changes take effect the next time the bot starts.</div>
        <div className="settings-list">
          <SettingRow label="Partial Take Profit" description="Sell half when option P/L reaches this level">
            <div className="input-with-unit">
              <input type="number" step="1" min="1" value={(settings.tp_pct * 100).toFixed(0)} onChange={e => set("tp_pct", parseFloat(e.target.value) / 100)} />
              <span className="unit mono dim">%</span>
            </div>
            <div className="setting-current mono">Currently: <span className="green">+{(settings.tp_pct * 100).toFixed(0)}%</span></div>
          </SettingRow>
          <SettingRow label="Hard Stop Loss" description="Close position if option P/L falls to this level (always active)">
            <div className="input-with-unit">
              <input type="number" step="1" min="1" value={(settings.hard_stop_pct * 100).toFixed(0)} onChange={e => set("hard_stop_pct", parseFloat(e.target.value) / 100)} />
              <span className="unit mono dim">%</span>
            </div>
            <div className="setting-current mono">Currently: <span className="red">-{(settings.hard_stop_pct * 100).toFixed(0)}%</span></div>
          </SettingRow>
          <SettingRow label="Trailing Stop Offset" description="After partial, trailing stop sits this far below peak P/L">
            <div className="input-with-unit">
              <input type="number" step="1" min="1" value={(settings.trail_offset * 100).toFixed(0)} onChange={e => set("trail_offset", parseFloat(e.target.value) / 100)} />
              <span className="unit mono dim">%</span>
            </div>
            <div className="setting-current mono">Currently: <span className="amber">{(settings.trail_offset * 100).toFixed(0)}% behind peak</span></div>
          </SettingRow>
          <SettingRow label="Gap Filter" description="Skip ticker if it gaps against the trade direction">
            <div className="input-with-unit">
              <input type="number" step="1" min="1" value={(settings.gap_limit * 100).toFixed(0)} onChange={e => set("gap_limit", parseFloat(e.target.value) / 100)} />
              <span className="unit mono dim">%</span>
            </div>
            <div className="setting-current mono">Currently: <span className="blue">{(settings.gap_limit * 100).toFixed(0)}%</span></div>
          </SettingRow>
          <SettingRow label="Poll Interval" description="How often the bot checks prices">
            <div className="input-with-unit">
              <input type="number" step="5" min="10" value={settings.poll_seconds} onChange={e => set("poll_seconds", parseInt(e.target.value))} />
              <span className="unit mono dim">sec</span>
            </div>
            <div className="setting-current mono">Currently: <span className="blue">{settings.poll_seconds}s</span></div>
          </SettingRow>
        </div>
        {msg && <div className={"form-msg mono " + (msg.type === "ok" ? "green" : "red")} style={{ marginTop: 16 }}>{msg.text}</div>}
        <button className="btn btn-blue" style={{ marginTop: 20 }} onClick={handleSave} disabled={busy}>
          <Save size={14} /> Save Settings
        </button>
      </div>

      <div className="card">
        <div className="card-title">How Parameters Interact</div>
        <div className="param-explainer mono dim">
          <div className="param-flow"><span className="green">+{(settings.tp_pct*100).toFixed(0)}%</span><span className="arrow">-&gt;</span><span>Sell half, arm trailing stop</span></div>
          <div className="param-flow"><span className="amber">Peak - {(settings.trail_offset*100).toFixed(0)}%</span><span className="arrow">-&gt;</span><span>Trailing stop level (rises with peak, never falls)</span></div>
          <div className="param-flow"><span className="red">-{(settings.hard_stop_pct*100).toFixed(0)}%</span><span className="arrow">-&gt;</span><span>Hard stop, closes everything immediately</span></div>
        </div>
      </div>

      {/* ── Bull Call Spread settings card ──────────────────────────────────── */}
      <div className="card">
        <div className="card-title">Bull Call Spread Parameters</div>
        <div className="settings-note mono dim">
          These settings apply to the Spreads strategy bot (Settings → Spreads tab).
          Changes take effect on the next bot cycle.
        </div>

        <div className="settings-list">

          {/* Enable toggle */}
          <SettingRow label="Strategy Enabled" description="Master switch — disables all scanning and entry when off">
            <div className="input-with-unit">
              <select
                value={bcs.enabled ? "1" : "0"}
                onChange={e => setBcsField("enabled", e.target.value === "1")}
                style={{ width: 110 }}
              >
                <option value="1">Enabled</option>
                <option value="0">Disabled</option>
              </select>
            </div>
            <div className="setting-current mono">
              Currently: <span className={bcs.enabled ? "green" : "red"}>{bcs.enabled ? "On" : "Off"}</span>
            </div>
          </SettingRow>

          {/* Universe */}
          <SettingRow label="Scan Universe" description="Which stock list to scan for entry candidates">
            <div className="input-with-unit">
              <select
                value={bcs.universe}
                onChange={e => setBcsField("universe", e.target.value)}
                style={{ width: 110 }}
              >
                <option value="usa">USA (broad)</option>
                <option value="sp500">S&amp;P 500</option>
                <option value="mag7">Mag 7</option>
                <option value="growth">Growth</option>
                <option value="etfs">ETFs</option>
              </select>
            </div>
            <div className="setting-current mono">Currently: <span className="blue">{bcs.universe}</span></div>
          </SettingRow>

          {/* Price range */}
          <SettingRow label="Stock Price Range" description="Only scan stocks with share price inside this band">
            <div className="input-with-unit">
              <span className="unit mono dim">$</span>
              <input type="number" step="5" min="1" style={{ width: 70 }}
                value={bcs.price_min}
                onChange={e => setBcsField("price_min", parseFloat(e.target.value))} />
              <span className="unit mono dim">to $</span>
              <input type="number" step="5" min="1" style={{ width: 70 }}
                value={bcs.price_max}
                onChange={e => setBcsField("price_max", parseFloat(e.target.value))} />
            </div>
            <div className="setting-current mono">
              Currently: <span className="blue">${bcs.price_min} – ${bcs.price_max}</span>
            </div>
          </SettingRow>

          {/* Spread width */}
          <SettingRow
            label="Spread Width %"
            description="Short strike placed this % above the current stock price (e.g. 7.5% on a $100 stock → ~$107.50 short strike)"
          >
            <div className="input-with-unit">
              <input type="number" step="0.5" min="1" max="25"
                value={(bcs.spread_width_pct * 100).toFixed(1)}
                onChange={e => setBcsField("spread_width_pct", parseFloat(e.target.value) / 100)} />
              <span className="unit mono dim">%</span>
            </div>
            <div className="setting-current mono">
              Currently: <span className="blue">{(bcs.spread_width_pct * 100).toFixed(1)}%</span>
            </div>
          </SettingRow>

          {/* DTE range */}
          <SettingRow label="DTE Range" description="Only use expirations with days-to-expiry inside this window">
            <div className="input-with-unit">
              <input type="number" step="1" min="7" max="90" style={{ width: 64 }}
                value={bcs.dte_min}
                onChange={e => setBcsField("dte_min", parseInt(e.target.value))} />
              <span className="unit mono dim">to</span>
              <input type="number" step="1" min="7" max="120" style={{ width: 64 }}
                value={bcs.dte_max}
                onChange={e => setBcsField("dte_max", parseInt(e.target.value))} />
              <span className="unit mono dim">days</span>
            </div>
            <div className="setting-current mono">
              Currently: <span className="blue">{bcs.dte_min}–{bcs.dte_max} DTE</span>
            </div>
          </SettingRow>

          {/* Prefer monthly */}
          <SettingRow label="Prefer Monthly Expirations" description="Target the 3rd-Friday monthly expiry; falls back to weekly when none fits the DTE window">
            <div className="input-with-unit">
              <select
                value={bcs.prefer_monthly ? "1" : "0"}
                onChange={e => setBcsField("prefer_monthly", e.target.value === "1")}
                style={{ width: 110 }}
              >
                <option value="1">Monthly</option>
                <option value="0">Any</option>
              </select>
            </div>
            <div className="setting-current mono">
              Currently: <span className="blue">{bcs.prefer_monthly ? "Monthly preferred" : "Any expiry"}</span>
            </div>
          </SettingRow>

          {/* Max debit % */}
          <SettingRow
            label="Max Debit (% of Portfolio)"
            description="Skip the trade if the total premium paid would exceed this % of account portfolio value"
          >
            <div className="input-with-unit">
              <input type="number" step="0.1" min="0.1" max="10"
                value={(bcs.max_debit_pct * 100).toFixed(1)}
                onChange={e => setBcsField("max_debit_pct", parseFloat(e.target.value) / 100)} />
              <span className="unit mono dim">%</span>
            </div>
            <div className="setting-current mono">
              Currently: <span className="blue">{(bcs.max_debit_pct * 100).toFixed(1)}%</span>
            </div>
          </SettingRow>

          {/* Contracts per spread */}
          <SettingRow label="Contracts per Spread" description="Number of spread contracts to open per entry signal">
            <div className="input-with-unit">
              <input type="number" step="1" min="1" max="50" style={{ width: 80 }}
                value={bcs.qty}
                onChange={e => setBcsField("qty", parseInt(e.target.value))} />
              <span className="unit mono dim">contracts</span>
            </div>
            <div className="setting-current mono">Currently: <span className="blue">{bcs.qty}</span></div>
          </SettingRow>

          {/* Profit target */}
          <SettingRow
            label="Profit Target"
            description="Close the spread when it gains this % of the original debit paid"
          >
            <div className="input-with-unit">
              <input type="number" step="5" min="10" max="100"
                value={(bcs.profit_target_pct * 100).toFixed(0)}
                onChange={e => setBcsField("profit_target_pct", parseFloat(e.target.value) / 100)} />
              <span className="unit mono dim">%</span>
            </div>
            <div className="setting-current mono">
              Currently: <span className="green">+{(bcs.profit_target_pct * 100).toFixed(0)}% of debit</span>
            </div>
          </SettingRow>

          {/* Stop loss */}
          <SettingRow
            label="Stop Loss"
            description="Close the spread when it loses this % of the original debit paid"
          >
            <div className="input-with-unit">
              <input type="number" step="5" min="10" max="100"
                value={(bcs.stop_loss_pct * 100).toFixed(0)}
                onChange={e => setBcsField("stop_loss_pct", parseFloat(e.target.value) / 100)} />
              <span className="unit mono dim">%</span>
            </div>
            <div className="setting-current mono">
              Currently: <span className="red">-{(bcs.stop_loss_pct * 100).toFixed(0)}% of debit</span>
            </div>
          </SettingRow>

          {/* Time stop DTE */}
          <SettingRow
            label="Time Stop (DTE)"
            description="Close the spread when days-to-expiry reaches or falls below this number, regardless of P/L"
          >
            <div className="input-with-unit">
              <input type="number" step="1" min="1" max="30"
                value={bcs.time_stop_dte}
                onChange={e => setBcsField("time_stop_dte", parseInt(e.target.value))} />
              <span className="unit mono dim">days</span>
            </div>
            <div className="setting-current mono">
              Currently: <span className="amber">{bcs.time_stop_dte} DTE</span>
            </div>
          </SettingRow>

          {/* Poll interval */}
          <SettingRow label="BCS Poll Interval" description="How often the spread bot checks for entries and exits">
            <div className="input-with-unit">
              <input type="number" step="30" min="60"
                value={bcs.poll_seconds}
                onChange={e => setBcsField("poll_seconds", parseInt(e.target.value))} />
              <span className="unit mono dim">sec</span>
            </div>
            <div className="setting-current mono">Currently: <span className="blue">{bcs.poll_seconds}s</span></div>
          </SettingRow>

        </div>

        {bcsMsg && (
          <div className={"form-msg mono " + (bcsMsg.type === "ok" ? "green" : "red")} style={{ marginTop: 16 }}>
            {bcsMsg.text}
          </div>
        )}
        <button className="btn btn-blue" style={{ marginTop: 20 }} onClick={handleSaveBcs} disabled={bcsBusy}>
          <Save size={14} /> Save BCS Settings
        </button>
      </div>

      {/* ── BCS exit-rule summary ────────────────────────────────────────────── */}
      <div className="card">
        <div className="card-title">Bull Call Spread Exit Rules</div>
        <div className="param-explainer mono dim">
          <div className="param-flow">
            <span className="green">+{(bcs.profit_target_pct * 100).toFixed(0)}% of debit</span>
            <span className="arrow">-&gt;</span>
            <span>Close spread — profit target hit</span>
          </div>
          <div className="param-flow">
            <span className="red">-{(bcs.stop_loss_pct * 100).toFixed(0)}% of debit</span>
            <span className="arrow">-&gt;</span>
            <span>Close spread — stop loss hit</span>
          </div>
          <div className="param-flow">
            <span className="amber">{bcs.time_stop_dte} DTE</span>
            <span className="arrow">-&gt;</span>
            <span>Close spread — time stop (avoid gamma risk)</span>
          </div>
        </div>
      </div>

      {/* ── Bear Put Spread settings card ───────────────────────────────────── */}
      <div className="card">
        <div className="card-title">Bear Put Spread Parameters</div>
        <div className="settings-note mono dim">
          These settings apply to the Bear Put Spread strategy (Spreads tab → Bear mode).
          Changes take effect on the next bot cycle.
        </div>

        <div className="settings-list">

          {/* Enable toggle */}
          <SettingRow label="Strategy Enabled" description="Master switch — disables all scanning and entry when off">
            <div className="input-with-unit">
              <select
                value={bps.enabled ? "1" : "0"}
                onChange={e => setBpsField("enabled", e.target.value === "1")}
                style={{ width: 110 }}
              >
                <option value="1">Enabled</option>
                <option value="0">Disabled</option>
              </select>
            </div>
            <div className="setting-current mono">
              Currently: <span className={bps.enabled ? "green" : "red"}>{bps.enabled ? "On" : "Off"}</span>
            </div>
          </SettingRow>

          {/* Universe */}
          <SettingRow label="Scan Universe" description="Which stock list to scan for entry candidates">
            <div className="input-with-unit">
              <select
                value={bps.universe}
                onChange={e => setBpsField("universe", e.target.value)}
                style={{ width: 110 }}
              >
                <option value="usa">USA (broad)</option>
                <option value="sp500">S&amp;P 500</option>
                <option value="mag7">Mag 7</option>
                <option value="growth">Growth</option>
                <option value="etfs">ETFs</option>
              </select>
            </div>
            <div className="setting-current mono">Currently: <span className="blue">{bps.universe}</span></div>
          </SettingRow>

          {/* Price range */}
          <SettingRow label="Stock Price Range" description="Only scan stocks with share price inside this band">
            <div className="input-with-unit">
              <span className="unit mono dim">$</span>
              <input type="number" step="5" min="1" style={{ width: 70 }}
                value={bps.price_min}
                onChange={e => setBpsField("price_min", parseFloat(e.target.value))} />
              <span className="unit mono dim">to $</span>
              <input type="number" step="5" min="1" style={{ width: 70 }}
                value={bps.price_max}
                onChange={e => setBpsField("price_max", parseFloat(e.target.value))} />
            </div>
            <div className="setting-current mono">
              Currently: <span className="blue">${bps.price_min} – ${bps.price_max}</span>
            </div>
          </SettingRow>

          {/* Spread width */}
          <SettingRow
            label="Spread Width %"
            description="Short strike placed this % below the current stock price (e.g. 7.5% on a $100 stock → ~$92.50 short strike)"
          >
            <div className="input-with-unit">
              <input type="number" step="0.5" min="1" max="25"
                value={(bps.spread_width_pct * 100).toFixed(1)}
                onChange={e => setBpsField("spread_width_pct", parseFloat(e.target.value) / 100)} />
              <span className="unit mono dim">%</span>
            </div>
            <div className="setting-current mono">
              Currently: <span className="blue">{(bps.spread_width_pct * 100).toFixed(1)}%</span>
            </div>
          </SettingRow>

          {/* DTE range */}
          <SettingRow label="DTE Range" description="Only use expirations with days-to-expiry inside this window">
            <div className="input-with-unit">
              <input type="number" step="1" min="7" max="90" style={{ width: 64 }}
                value={bps.dte_min}
                onChange={e => setBpsField("dte_min", parseInt(e.target.value))} />
              <span className="unit mono dim">to</span>
              <input type="number" step="1" min="7" max="120" style={{ width: 64 }}
                value={bps.dte_max}
                onChange={e => setBpsField("dte_max", parseInt(e.target.value))} />
              <span className="unit mono dim">days</span>
            </div>
            <div className="setting-current mono">
              Currently: <span className="blue">{bps.dte_min}–{bps.dte_max} DTE</span>
            </div>
          </SettingRow>

          {/* Prefer monthly */}
          <SettingRow label="Prefer Monthly Expirations" description="Target the 3rd-Friday monthly expiry; falls back to weekly when none fits the DTE window">
            <div className="input-with-unit">
              <select
                value={bps.prefer_monthly ? "1" : "0"}
                onChange={e => setBpsField("prefer_monthly", e.target.value === "1")}
                style={{ width: 110 }}
              >
                <option value="1">Monthly</option>
                <option value="0">Any</option>
              </select>
            </div>
            <div className="setting-current mono">
              Currently: <span className="blue">{bps.prefer_monthly ? "Monthly preferred" : "Any expiry"}</span>
            </div>
          </SettingRow>

          {/* Max debit % */}
          <SettingRow
            label="Max Debit (% of Portfolio)"
            description="Skip the trade if the total premium paid would exceed this % of account portfolio value"
          >
            <div className="input-with-unit">
              <input type="number" step="0.1" min="0.1" max="10"
                value={(bps.max_debit_pct * 100).toFixed(1)}
                onChange={e => setBpsField("max_debit_pct", parseFloat(e.target.value) / 100)} />
              <span className="unit mono dim">%</span>
            </div>
            <div className="setting-current mono">
              Currently: <span className="blue">{(bps.max_debit_pct * 100).toFixed(1)}%</span>
            </div>
          </SettingRow>

          {/* Contracts per spread */}
          <SettingRow label="Contracts per Spread" description="Number of spread contracts to open per entry signal">
            <div className="input-with-unit">
              <input type="number" step="1" min="1" max="50" style={{ width: 80 }}
                value={bps.qty}
                onChange={e => setBpsField("qty", parseInt(e.target.value))} />
              <span className="unit mono dim">contracts</span>
            </div>
            <div className="setting-current mono">Currently: <span className="blue">{bps.qty}</span></div>
          </SettingRow>

          {/* Profit target */}
          <SettingRow
            label="Profit Target"
            description="Close the spread when it gains this % of the original debit paid"
          >
            <div className="input-with-unit">
              <input type="number" step="5" min="10" max="100"
                value={(bps.profit_target_pct * 100).toFixed(0)}
                onChange={e => setBpsField("profit_target_pct", parseFloat(e.target.value) / 100)} />
              <span className="unit mono dim">%</span>
            </div>
            <div className="setting-current mono">
              Currently: <span className="green">+{(bps.profit_target_pct * 100).toFixed(0)}% of debit</span>
            </div>
          </SettingRow>

          {/* Stop loss */}
          <SettingRow
            label="Stop Loss"
            description="Close the spread when it loses this % of the original debit paid"
          >
            <div className="input-with-unit">
              <input type="number" step="5" min="10" max="100"
                value={(bps.stop_loss_pct * 100).toFixed(0)}
                onChange={e => setBpsField("stop_loss_pct", parseFloat(e.target.value) / 100)} />
              <span className="unit mono dim">%</span>
            </div>
            <div className="setting-current mono">
              Currently: <span className="red">-{(bps.stop_loss_pct * 100).toFixed(0)}% of debit</span>
            </div>
          </SettingRow>

          {/* Time stop DTE */}
          <SettingRow
            label="Time Stop (DTE)"
            description="Close the spread when days-to-expiry reaches or falls below this number, regardless of P/L"
          >
            <div className="input-with-unit">
              <input type="number" step="1" min="1" max="30"
                value={bps.time_stop_dte}
                onChange={e => setBpsField("time_stop_dte", parseInt(e.target.value))} />
              <span className="unit mono dim">days</span>
            </div>
            <div className="setting-current mono">
              Currently: <span className="amber">{bps.time_stop_dte} DTE</span>
            </div>
          </SettingRow>

          {/* Poll interval */}
          <SettingRow label="BPS Poll Interval" description="How often the spread bot checks for entries and exits">
            <div className="input-with-unit">
              <input type="number" step="30" min="60"
                value={bps.poll_seconds}
                onChange={e => setBpsField("poll_seconds", parseInt(e.target.value))} />
              <span className="unit mono dim">sec</span>
            </div>
            <div className="setting-current mono">Currently: <span className="blue">{bps.poll_seconds}s</span></div>
          </SettingRow>

        </div>

        {bpsMsg && (
          <div className={"form-msg mono " + (bpsMsg.type === "ok" ? "green" : "red")} style={{ marginTop: 16 }}>
            {bpsMsg.text}
          </div>
        )}
        <button className="btn btn-blue" style={{ marginTop: 20 }} onClick={handleSaveBps} disabled={bpsBusy}>
          <Save size={14} /> Save BPS Settings
        </button>
      </div>

      {/* ── BPS exit-rule summary ────────────────────────────────────────────── */}
      <div className="card">
        <div className="card-title">Bear Put Spread Exit Rules</div>
        <div className="param-explainer mono dim">
          <div className="param-flow">
            <span className="green">+{(bps.profit_target_pct * 100).toFixed(0)}% of debit</span>
            <span className="arrow">-&gt;</span>
            <span>Close spread — profit target hit</span>
          </div>
          <div className="param-flow">
            <span className="red">-{(bps.stop_loss_pct * 100).toFixed(0)}% of debit</span>
            <span className="arrow">-&gt;</span>
            <span>Close spread — stop loss hit</span>
          </div>
          <div className="param-flow">
            <span className="amber">{bps.time_stop_dte} DTE</span>
            <span className="arrow">-&gt;</span>
            <span>Close spread — time stop (avoid gamma risk)</span>
          </div>
        </div>
      </div>

    </div>
  )
}
