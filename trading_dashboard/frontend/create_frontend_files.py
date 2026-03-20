"""
Run this from your frontend/ directory:
  cd C:\\Users\\mrifa\\OneDrive\\Desktop\\IP\\option_trader_app\\trading_dashboard\\frontend
  python create_frontend_files.py
"""

import os

files = {}

# ── index.css ─────────────────────────────────────────────────────────────────
files["src/index.css"] = """
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg:        #080b0f;
  --bg-1:      #0d1117;
  --bg-2:      #131920;
  --bg-3:      #1a2230;
  --border:    #1f2d3d;
  --border-hi: #2a3f55;
  --green:     #00e676;
  --green-dim: #00c853;
  --green-mute:#0d3320;
  --red:       #ff3d57;
  --red-dim:   #c62a3a;
  --red-mute:  #330d12;
  --amber:     #ffc107;
  --amber-mute:#332800;
  --blue:      #29b6f6;
  --blue-mute: #0d2233;
  --text-1:    #e8edf2;
  --text-2:    #8899aa;
  --text-3:    #4d6070;
  --font-mono: "IBM Plex Mono", monospace;
  --font-body: "DM Sans", sans-serif;
  --font-display: "Bebas Neue", sans-serif;
  --radius:    4px;
  --radius-lg: 8px;
}

html, body, #root {
  height: 100%;
  background: var(--bg);
  color: var(--text-1);
  font-family: var(--font-body);
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: var(--bg-1); }
::-webkit-scrollbar-thumb { background: var(--border-hi); border-radius: 2px; }

.mono { font-family: var(--font-mono); }
.green { color: var(--green); }
.red   { color: var(--red); }
.amber { color: var(--amber); }
.blue  { color: var(--blue); }
.muted { color: var(--text-2); }
.dim   { color: var(--text-3); }

.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 2px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.badge-green { background: var(--green-mute); color: var(--green); border: 1px solid #00e67630; }
.badge-red   { background: var(--red-mute);   color: var(--red);   border: 1px solid #ff3d5730; }
.badge-amber { background: var(--amber-mute); color: var(--amber); border: 1px solid #ffc10730; }
.badge-blue  { background: var(--blue-mute);  color: var(--blue);  border: 1px solid #29b6f630; }
.badge-dim   { background: var(--bg-3); color: var(--text-2); border: 1px solid var(--border); }

button { font-family: var(--font-body); cursor: pointer; border: none; outline: none; }

input, select {
  font-family: var(--font-mono);
  font-size: 13px;
  background: var(--bg-1);
  border: 1px solid var(--border);
  color: var(--text-1);
  border-radius: var(--radius);
  padding: 8px 12px;
  width: 100%;
  outline: none;
  transition: border-color 0.15s;
}
input:focus, select:focus { border-color: var(--blue); }
input::placeholder { color: var(--text-3); }

label {
  display: block;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-3);
  margin-bottom: 6px;
  font-family: var(--font-mono);
}

@keyframes pulse-green {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.4; }
}
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
.fade-in { animation: fadeInUp 0.3s ease forwards; }
""".lstrip()

# ── App.css ───────────────────────────────────────────────────────────────────
files["src/App.css"] = """
.app { display: flex; height: 100vh; overflow: hidden; }

.sidebar {
  width: 200px; min-width: 200px;
  background: var(--bg-1);
  border-right: 1px solid var(--border);
  display: flex; flex-direction: column;
  position: relative; z-index: 10;
}

.sidebar-logo { padding: 28px 20px 24px; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; }
.logo-text { font-family: var(--font-display); font-size: 36px; letter-spacing: 0.12em; color: var(--text-1); line-height: 1; }
.logo-sub  { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.3em; color: var(--text-3); text-transform: uppercase; }

.sidebar-nav { flex: 1; display: flex; flex-direction: column; padding: 16px 12px; gap: 2px; }

.nav-item {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 12px; border-radius: var(--radius);
  background: transparent; color: var(--text-3);
  font-size: 13px; font-family: var(--font-body);
  transition: all 0.15s; text-align: left; width: 100%;
}
.nav-item:hover  { background: var(--bg-2); color: var(--text-2); }
.nav-item.active { background: var(--bg-3); color: var(--text-1); font-weight: 500; }
.nav-item.active svg { color: var(--green); }

.sidebar-footer { padding: 16px 12px; border-top: 1px solid var(--border); }

.main { flex: 1; display: flex; flex-direction: column; overflow: hidden; background: var(--bg); }

.main-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 20px 32px 16px; border-bottom: 1px solid var(--border); flex-shrink: 0;
}
.page-title { font-family: var(--font-display); font-size: 28px; letter-spacing: 0.08em; color: var(--text-1); font-weight: 400; }
.header-date { font-size: 12px; }

.main-content { flex: 1; overflow-y: auto; padding: 28px 32px; }

.card { background: var(--bg-1); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 20px 24px; margin-bottom: 16px; }
.card-title { font-family: var(--font-mono); font-size: 11px; font-weight: 500; letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-3); margin-bottom: 16px; }

.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
.grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }

.btn { display: inline-flex; align-items: center; gap: 8px; padding: 9px 18px; border-radius: var(--radius); font-size: 13px; font-weight: 500; transition: all 0.15s; font-family: var(--font-body); }
.btn-green { background: var(--green-mute); color: var(--green); border: 1px solid #00e67640; }
.btn-green:hover { background: #0d4427; }
.btn-red   { background: var(--red-mute);   color: var(--red);   border: 1px solid #ff3d5740; }
.btn-red:hover   { background: #4d1020; }
.btn-ghost { background: var(--bg-2); color: var(--text-2); border: 1px solid var(--border); }
.btn-ghost:hover { background: var(--bg-3); color: var(--text-1); }
.btn-blue  { background: var(--blue-mute);  color: var(--blue);  border: 1px solid #29b6f640; }
.btn-blue:hover  { background: #0d2e45; }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }

.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th { font-family: var(--font-mono); font-size: 10px; font-weight: 500; letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-3); text-align: left; padding: 0 12px 10px; border-bottom: 1px solid var(--border); }
td { padding: 12px; border-bottom: 1px solid var(--border); font-size: 13px; vertical-align: middle; }
tr:last-child td { border-bottom: none; }
tr:hover td { background: var(--bg-2); }
""".lstrip()

# ── App.jsx ───────────────────────────────────────────────────────────────────
files["src/App.jsx"] = """
import { useState } from "react"
import { Activity, BarChart2, List, Settings, Terminal } from "lucide-react"
import Dashboard from "./components/Dashboard.jsx"
import Plans from "./components/Plans.jsx"
import History from "./components/History.jsx"
import Logs from "./components/Logs.jsx"
import SettingsPanel from "./components/SettingsPanel.jsx"
import StatusBar from "./components/StatusBar.jsx"
import "./App.css"

const TABS = [
  { id: "dashboard", label: "Dashboard", Icon: Activity },
  { id: "plans",     label: "Plans",     Icon: List },
  { id: "history",   label: "History",   Icon: BarChart2 },
  { id: "logs",      label: "Logs",      Icon: Terminal },
  { id: "settings",  label: "Settings",  Icon: Settings },
]

export default function App() {
  const [tab, setTab] = useState("dashboard")
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <span className="logo-text">EDGE</span>
          <span className="logo-sub">OPTIONS</span>
        </div>
        <nav className="sidebar-nav">
          {TABS.map(({ id, label, Icon }) => (
            <button key={id} className={"nav-item" + (tab === id ? " active" : "")} onClick={() => setTab(id)}>
              <Icon size={16} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer"><StatusBar /></div>
      </aside>
      <main className="main">
        <div className="main-header">
          <h1 className="page-title">{TABS.find(t => t.id === tab)?.label}</h1>
          <div className="header-date mono dim">
            {new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
          </div>
        </div>
        <div className="main-content fade-in" key={tab}>
          {tab === "dashboard" && <Dashboard />}
          {tab === "plans"     && <Plans />}
          {tab === "history"   && <History />}
          {tab === "logs"      && <Logs />}
          {tab === "settings"  && <SettingsPanel />}
        </div>
      </main>
    </div>
  )
}
""".lstrip()

# ── main.jsx ──────────────────────────────────────────────────────────────────
files["src/main.jsx"] = """
import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App.jsx"
import "./index.css"

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode><App /></React.StrictMode>
)
""".lstrip()

# ── lib/api.js ────────────────────────────────────────────────────────────────
files["src/lib/api.js"] = """
const BASE = "/api"

async function req(method, path, body) {
  const opts = { method, headers: { "Content-Type": "application/json" } }
  if (body !== undefined) opts.body = JSON.stringify(body)
  const res = await fetch(`${BASE}${path}`, opts)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || res.statusText)
  }
  return res.json()
}

export const api = {
  getStatus:    ()        => req("GET",    "/status"),
  startBot:     ()        => req("POST",   "/bot/start"),
  stopBot:      ()        => req("POST",   "/bot/stop"),
  getLogs:      (n = 200) => req("GET",    `/bot/logs?lines=${n}`),
  getPositions: ()        => req("GET",    "/positions"),
  getHistory:   ()        => req("GET",    "/history"),
  getPlans:     ()        => req("GET",    "/plans"),
  savePlans:    (plans)   => req("POST",   "/plans", plans),
  deletePlan:   (ticker)  => req("DELETE", `/plans/${ticker}`),
  getSettings:  ()        => req("GET",    "/settings"),
  saveSettings: (s)       => req("POST",   "/settings", s),
}
""".lstrip()

# ── hooks/usePolling.js ───────────────────────────────────────────────────────
files["src/hooks/usePolling.js"] = """
import { useState, useEffect, useCallback, useRef } from "react"

export function usePolling(fetchFn, intervalMs = 5000, deps = []) {
  const [data, setData]       = useState(null)
  const [error, setError]     = useState(null)
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)

  const fetch_ = useCallback(async () => {
    try {
      const result = await fetchFn()
      if (mountedRef.current) { setData(result); setError(null) }
    } catch (e) {
      if (mountedRef.current) setError(e.message)
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, deps) // eslint-disable-line

  useEffect(() => {
    mountedRef.current = true
    fetch_()
    const id = setInterval(fetch_, intervalMs)
    return () => { mountedRef.current = false; clearInterval(id) }
  }, [fetch_, intervalMs])

  return { data, error, loading, refetch: fetch_ }
}
""".lstrip()

# ── components/StatusBar.jsx ──────────────────────────────────────────────────
files["src/components/StatusBar.jsx"] = """
import { useState } from "react"
import { api } from "../lib/api.js"
import { usePolling } from "../hooks/usePolling.js"
import { Power, PowerOff } from "lucide-react"
import "./StatusBar.css"

export default function StatusBar() {
  const [busy, setBusy] = useState(false)
  const [msg,  setMsg]  = useState("")
  const { data, refetch } = usePolling(() => api.getStatus(), 4000)
  const running = data?.bot_running ?? false

  async function toggle() {
    setBusy(true); setMsg("")
    try {
      running ? await api.stopBot() : await api.startBot()
      setMsg(running ? "Stopped." : "Started.")
      await refetch()
    } catch(e) { setMsg(e.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="statusbar">
      <div className="status-indicator">
        <span className={"dot " + (running ? "dot-live" : "dot-off")} />
        <span className="status-label mono">{running ? "BOT LIVE" : "BOT IDLE"}</span>
      </div>
      {data && (
        <div className="status-meta mono dim">
          {data.traded_today?.length > 0 ? data.traded_today.length + " ticker(s) traded" : "No trades today"}
        </div>
      )}
      <button className={"btn " + (running ? "btn-red" : "btn-green") + " status-btn"} onClick={toggle} disabled={busy}>
        {running ? <><PowerOff size={13}/> Stop</> : <><Power size={13}/> Start</>}
      </button>
      {msg && <div className="status-msg mono">{msg}</div>}
    </div>
  )
}
""".lstrip()

# ── components/StatusBar.css ──────────────────────────────────────────────────
files["src/components/StatusBar.css"] = """
.statusbar { display: flex; flex-direction: column; gap: 8px; }
.status-indicator { display: flex; align-items: center; gap: 8px; }
.dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.dot-live { background: var(--green); box-shadow: 0 0 6px var(--green); animation: pulse-green 2s infinite; }
.dot-off  { background: var(--text-3); }
.status-label { font-size: 11px; font-weight: 600; letter-spacing: 0.1em; }
.status-meta  { font-size: 10px; line-height: 1.4; }
.status-btn   { width: 100%; justify-content: center; font-size: 12px; padding: 8px; }
.status-msg   { font-size: 10px; color: var(--amber); line-height: 1.4; }
""".lstrip()

# ── components/Dashboard.jsx ──────────────────────────────────────────────────
files["src/components/Dashboard.jsx"] = """
import { usePolling } from "../hooks/usePolling.js"
import { api } from "../lib/api.js"
import { Minus, AlertTriangle } from "lucide-react"
import { AreaChart, Area, ResponsiveContainer, ReferenceLine } from "recharts"
import "./Dashboard.css"

function pct(v) {
  if (v == null) return "---"
  return (v >= 0 ? "+" : "") + (v * 100).toFixed(2) + "%"
}
function plClass(v) {
  if (v == null) return "muted"
  return v > 0 ? "green" : v < 0 ? "red" : "muted"
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div className="stat-card" style={{ "--accent": accent }}>
      <div className="stat-label">{label}</div>
      <div className="stat-value mono">{value}</div>
      {sub && <div className="stat-sub mono dim">{sub}</div>}
    </div>
  )
}

function PositionCard({ pos }) {
  const plpc  = pos.last_plpc
  const peak  = pos.peak_plpc
  const trail = pos.took_partial && peak != null ? peak - 0.20 : null
  const color = plpc != null && plpc >= 0 ? "#00e676" : "#ff3d57"

  const sparkData = peak != null
    ? [{ p: 0 }, { p: peak * 40 }, { p: peak * 70 }, { p: peak * 100 }, { p: (plpc ?? 0) * 100 }]
    : []

  return (
    <div className={"position-card " + (plpc != null && plpc < 0 ? "pos-red" : "pos-green")}>
      <div className="pos-header">
        <div>
          <div className="pos-ticker">{pos.ticker}</div>
          <div className="pos-contract mono dim">{pos.contract}</div>
        </div>
        <div className="pos-badges">
          <span className={"badge " + (pos.status === "carry" ? "badge-amber" : "badge-blue")}>
            {pos.status === "carry" ? "CARRY" : "ACTIVE"}
          </span>
          {pos.took_partial && <span className="badge badge-green">PARTIAL</span>}
        </div>
      </div>

      <div className="pos-pl">
        <span className={"pos-pl-value mono " + plClass(plpc)}>{pct(plpc)}</span>
        <span className="pos-pl-label dim mono">P/L</span>
      </div>

      {sparkData.length > 0 && (
        <div className="pos-sparkline">
          <ResponsiveContainer width="100%" height={48}>
            <AreaChart data={sparkData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={"grad-" + pos.ticker} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={color} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="p" stroke={color} strokeWidth={1.5}
                fill={"url(#grad-" + pos.ticker + ")"} dot={false} />
              {trail != null && (
                <ReferenceLine y={trail * 100} stroke="#ffc107" strokeDasharray="3 3" strokeWidth={1} />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="pos-details">
        <div className="pos-detail">
          <span className="dim mono">QTY</span>
          <span className="mono">{pos.current_qty} <span className="dim">/ {pos.original_qty}</span></span>
        </div>
        <div className="pos-detail">
          <span className="dim mono">ENTRY</span>
          <span className="mono">{pos.entry_avg_price != null ? "$" + pos.entry_avg_price.toFixed(2) : "---"}</span>
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
            <span className={"mono " + plClass(trail)}>{pct(trail)}</span>
          </div>
        )}
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { data: statusData } = usePolling(() => api.getStatus(), 5000)
  const { data: posData, loading, error } = usePolling(() => api.getPositions(), 8000)

  const positions = posData?.positions ?? []
  const withPl    = positions.filter(p => p.last_plpc != null)
  const avgPl     = withPl.length > 0 ? withPl.reduce((s, p) => s + p.last_plpc, 0) / withPl.length : null

  return (
    <div className="dashboard">
      <div className="grid-4" style={{ marginBottom: 24 }}>
        <StatCard label="Open Positions"
          value={positions.length}
          sub={positions.filter(p => p.status === "active").length + " active / " + positions.filter(p => p.status === "carry").length + " carry"}
          accent="var(--blue)" />
        <StatCard label="Avg P/L"
          value={avgPl != null ? pct(avgPl) : "---"}
          accent={avgPl != null && avgPl >= 0 ? "var(--green)" : "var(--red)"} />
        <StatCard label="Traded Today"
          value={statusData?.traded_today?.length ?? 0}
          sub={statusData?.traded_today?.join(", ") || "none"}
          accent="var(--amber)" />
        <StatCard label="Bot Status"
          value={statusData?.bot_running ? "LIVE" : "IDLE"}
          sub={statusData?.bot_running ? "PID " + statusData.pid : "stopped"}
          accent={statusData?.bot_running ? "var(--green)" : "var(--text-3)"} />
      </div>

      {loading && <div className="mono dim" style={{ padding: "40px 0", textAlign: "center" }}>Loading positions...</div>}
      {error && (
        <div className="card" style={{ borderColor: "var(--red-dim)", display: "flex", gap: 10, alignItems: "center" }}>
          <AlertTriangle size={16} color="var(--red)" />
          <span className="mono" style={{ color: "var(--red)" }}>{error}</span>
        </div>
      )}
      {!loading && positions.length === 0 && (
        <div className="empty-state">
          <Minus size={32} color="var(--text-3)" />
          <p className="mono dim">No open positions</p>
          <p className="dim" style={{ fontSize: 12 }}>Configure plans and start the bot to begin trading</p>
        </div>
      )}
      {positions.length > 0 && (
        <div className="positions-grid">
          {positions.map(pos => <PositionCard key={pos.ticker} pos={pos} />)}
        </div>
      )}
    </div>
  )
}
""".lstrip()

# ── components/Dashboard.css ──────────────────────────────────────────────────
files["src/components/Dashboard.css"] = """
.stat-card { background: var(--bg-1); border: 1px solid var(--border); border-top: 2px solid var(--accent); border-radius: var(--radius-lg); padding: 18px 20px; }
.stat-label { font-family: var(--font-mono); font-size: 10px; font-weight: 500; letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-3); margin-bottom: 8px; }
.stat-value { font-size: 26px; font-weight: 500; color: var(--text-1); line-height: 1.1; }
.stat-sub   { font-size: 11px; margin-top: 4px; }
.positions-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px; }
.position-card { background: var(--bg-1); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 20px; transition: border-color 0.2s; }
.position-card:hover { border-color: var(--border-hi); }
.pos-green { border-left: 3px solid var(--green); }
.pos-red   { border-left: 3px solid var(--red); }
.pos-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
.pos-ticker   { font-family: var(--font-display); font-size: 28px; letter-spacing: 0.06em; line-height: 1; }
.pos-contract { font-size: 11px; margin-top: 2px; }
.pos-badges   { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.pos-pl       { display: flex; align-items: baseline; gap: 8px; margin-bottom: 12px; }
.pos-pl-value { font-size: 32px; font-weight: 600; letter-spacing: -0.02em; line-height: 1; }
.pos-pl-label { font-size: 11px; letter-spacing: 0.08em; }
.pos-sparkline { margin: 12px 0; border-radius: 4px; overflow: hidden; }
.pos-details  { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); }
.pos-detail   { display: flex; flex-direction: column; gap: 2px; }
.pos-detail .dim  { font-size: 10px; letter-spacing: 0.1em; }
.pos-detail .mono { font-size: 13px; }
.empty-state { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 80px 0; text-align: center; }
.empty-state p { max-width: 280px; }
""".lstrip()

# ── components/Plans.jsx ──────────────────────────────────────────────────────
files["src/components/Plans.jsx"] = """
import { useState } from "react"
import { usePolling } from "../hooks/usePolling.js"
import { api } from "../lib/api.js"
import { Plus, Trash2 } from "lucide-react"
import "./Plans.css"

const EMPTY = { ticker: "", contract: "", qty: 1, type: "LONG", sl_stock: "", tp_stock: "" }

export default function Plans() {
  const { data, refetch } = usePolling(() => api.getPlans(), 10000)
  const plans = data?.plans ?? []
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [msg,  setMsg]  = useState(null)

  function set(field, value) { setForm(f => ({ ...f, [field]: value })) }

  async function handleAdd(e) {
    e.preventDefault(); setMsg(null)
    if (!form.ticker || !form.contract || !form.sl_stock || !form.tp_stock) {
      setMsg({ type: "error", text: "All fields are required." }); return
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
      await api.savePlans([...plans, newPlan])
      setForm(EMPTY)
      setMsg({ type: "ok", text: "Plan added for " + newPlan.ticker + "." })
      await refetch()
    } catch(e) { setMsg({ type: "error", text: e.message }) }
    finally { setBusy(false) }
  }

  async function handleDelete(ticker) {
    setBusy(true); setMsg(null)
    try {
      await api.deletePlan(ticker)
      setMsg({ type: "ok", text: "Deleted " + ticker + "." })
      await refetch()
    } catch(e) { setMsg({ type: "error", text: e.message }) }
    finally { setBusy(false) }
  }

  return (
    <div className="plans">
      <div className="card">
        <div className="card-title">Active Plans ({plans.length})</div>
        {plans.length === 0
          ? <div className="mono dim" style={{ padding: "20px 0", textAlign: "center" }}>No plans yet.</div>
          : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Ticker</th><th>Contract</th><th>Direction</th><th>Qty</th><th>Stop Loss</th><th>Take Profit</th><th></th></tr></thead>
                <tbody>
                  {plans.map(p => (
                    <tr key={p.ticker}>
                      <td className="mono">{p.ticker}</td>
                      <td className="mono dim" style={{ fontSize: 11 }}>{p.contract}</td>
                      <td><span className={"badge " + (p.type === "LONG" ? "badge-green" : "badge-red")}>{p.type}</span></td>
                      <td className="mono">{p.qty}</td>
                      <td className="mono red">${p.sl_stock}</td>
                      <td className="mono green">${p.tp_stock}</td>
                      <td><button className="btn btn-ghost icon-btn" onClick={() => handleDelete(p.ticker)} disabled={busy}><Trash2 size={13} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </div>

      <div className="card">
        <div className="card-title">Add New Plan</div>
        <form className="plan-form" onSubmit={handleAdd}>
          <div className="form-row">
            <div className="form-group">
              <label>Ticker</label>
              <input placeholder="AAPL" value={form.ticker} onChange={e => set("ticker", e.target.value)} style={{ textTransform: "uppercase" }} />
            </div>
            <div className="form-group form-group-wide">
              <label>OCC Contract Symbol</label>
              <input placeholder="AAPL260220C00200000" value={form.contract} onChange={e => set("contract", e.target.value)} style={{ textTransform: "uppercase" }} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Direction</label>
              <select value={form.type} onChange={e => set("type", e.target.value)}>
                <option value="LONG">LONG</option>
                <option value="SHORT">SHORT</option>
              </select>
            </div>
            <div className="form-group">
              <label>Quantity</label>
              <input type="number" min="1" value={form.qty} onChange={e => set("qty", e.target.value)} />
            </div>
            <div className="form-group">
              <label>Stop Loss (stock $)</label>
              <input type="number" step="0.01" placeholder="185.00" value={form.sl_stock} onChange={e => set("sl_stock", e.target.value)} />
            </div>
            <div className="form-group">
              <label>Take Profit (stock $)</label>
              <input type="number" step="0.01" placeholder="210.00" value={form.tp_stock} onChange={e => set("tp_stock", e.target.value)} />
            </div>
          </div>
          {msg && <div className={"form-msg mono " + (msg.type === "ok" ? "green" : "red")}>{msg.text}</div>}
          <button type="submit" className="btn btn-blue" disabled={busy}><Plus size={14} /> Add Plan</button>
        </form>
      </div>
      <div className="hint mono dim">Note: Stop the bot before modifying plans.</div>
    </div>
  )
}
""".lstrip()

# ── components/Plans.css ──────────────────────────────────────────────────────
files["src/components/Plans.css"] = """
.plan-form { display: flex; flex-direction: column; gap: 16px; }
.form-row  { display: flex; gap: 16px; flex-wrap: wrap; }
.form-group { display: flex; flex-direction: column; min-width: 140px; flex: 1; }
.form-group-wide { flex: 2; }
.form-msg { font-size: 12px; padding: 6px 0; }
.icon-btn { padding: 6px 8px; }
.hint { font-size: 11px; padding: 12px 0 0; }
""".lstrip()

# ── components/History.jsx ────────────────────────────────────────────────────
files["src/components/History.jsx"] = """
import { usePolling } from "../hooks/usePolling.js"
import { api } from "../lib/api.js"
import "./History.css"

function pct(v) {
  if (v == null) return "---"
  return (v >= 0 ? "+" : "") + (v * 100).toFixed(2) + "%"
}

export default function History() {
  const { data, loading } = usePolling(() => api.getHistory(), 30000)
  const history = data?.history ?? []

  if (loading) return <div className="mono dim" style={{ padding: 40 }}>Loading...</div>
  if (history.length === 0) return (
    <div className="card">
      <div className="mono dim" style={{ padding: "20px 0", textAlign: "center" }}>No trade history yet.</div>
    </div>
  )

  return (
    <div className="history">
      {history.map(day => (
        <div key={day.date} className="card">
          <div className="history-day-header">
            <span className="mono history-date">{day.date}</span>
            <span className="mono dim" style={{ fontSize: 11 }}>{day.traded_tickers.length} ticker(s)</span>
          </div>
          {Object.keys(day.tickers).length === 0
            ? <div className="mono dim" style={{ fontSize: 12 }}>No records.</div>
            : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Ticker</th><th>Contract</th><th>Qty</th><th>Partial</th><th>Sold</th><th>Peak P/L</th><th>Entry Px</th></tr></thead>
                  <tbody>
                    {Object.entries(day.tickers).map(([ticker, info]) => (
                      <tr key={ticker}>
                        <td className="mono">{ticker}</td>
                        <td className="mono dim" style={{ fontSize: 11 }}>{info.contract || "---"}</td>
                        <td className="mono">{info.original_qty ?? "---"}</td>
                        <td><span className={"badge " + (info.took_partial ? "badge-green" : "badge-dim")}>{info.took_partial ? "YES" : "NO"}</span></td>
                        <td className="mono">{info.partial_qty_sold ?? 0}</td>
                        <td className={"mono " + (info.peak_plpc >= 0 ? "green" : "red")}>{pct(info.peak_plpc)}</td>
                        <td className="mono">{info.entry_avg_price != null ? "$" + parseFloat(info.entry_avg_price).toFixed(2) : "---"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </div>
      ))}
    </div>
  )
}
""".lstrip()

# ── components/History.css ────────────────────────────────────────────────────
files["src/components/History.css"] = """
.history-day-header { display: flex; align-items: center; gap: 16px; margin-bottom: 14px; }
.history-date { font-size: 15px; font-weight: 500; color: var(--text-1); }
""".lstrip()

# ── components/Logs.jsx ───────────────────────────────────────────────────────
files["src/components/Logs.jsx"] = """
import { useEffect, useRef } from "react"
import { usePolling } from "../hooks/usePolling.js"
import { api } from "../lib/api.js"
import "./Logs.css"

function colorLine(line) {
  if (line.includes("ENTRY"))         return "log-entry"
  if (line.includes("TP hit"))        return "log-tp"
  if (line.includes("HARD STOP"))     return "log-stop"
  if (line.includes("Trailing stop")) return "log-stop"
  if (line.includes("STOCK SL"))      return "log-stop"
  if (line.includes("STOCK TP"))      return "log-tp"
  if (line.includes("ABORT"))         return "log-warn"
  if (line.includes("GAP"))           return "log-warn"
  if (line.includes("WAIT"))          return "log-dim"
  if (line.includes("ERROR") || line.includes("failed")) return "log-error"
  if (line.includes("BOOT"))          return "log-boot"
  return "log-default"
}

export default function Logs() {
  const { data, loading } = usePolling(() => api.getLogs(300), 5000)
  const bottomRef = useRef(null)
  const lines = data?.logs ?? []

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }) }, [lines])

  return (
    <div className="logs-wrap">
      <div className="logs-header mono dim"><span>BOT LOG</span><span>{lines.length} lines</span></div>
      <div className="logs-terminal">
        {loading && <div className="log-line log-dim">Loading...</div>}
        {lines.length === 0 && !loading && <div className="log-line log-dim">No output yet. Start the bot to see activity.</div>}
        {lines.map((line, i) => (
          <div key={i} className={"log-line " + colorLine(line)}>
            <span className="log-idx dim">{String(i + 1).padStart(4, " ")}</span>
            <span>{line}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
""".lstrip()

# ── components/Logs.css ───────────────────────────────────────────────────────
files["src/components/Logs.css"] = """
.logs-wrap { display: flex; flex-direction: column; height: calc(100vh - 140px); }
.logs-header { display: flex; justify-content: space-between; font-size: 11px; letter-spacing: 0.1em; padding: 0 0 10px; }
.logs-terminal { flex: 1; background: var(--bg-1); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px; overflow-y: auto; font-family: var(--font-mono); font-size: 12px; line-height: 1.7; }
.log-line    { display: flex; gap: 16px; white-space: pre-wrap; word-break: break-all; }
.log-idx     { min-width: 36px; user-select: none; opacity: 0.4; }
.log-default { color: var(--text-2); }
.log-entry   { color: var(--blue); }
.log-tp      { color: var(--green); }
.log-stop    { color: var(--red); }
.log-warn    { color: var(--amber); }
.log-error   { color: var(--red); font-weight: 600; }
.log-dim     { color: var(--text-3); }
.log-boot    { color: var(--blue); opacity: 0.7; }
""".lstrip()

# ── components/SettingsPanel.jsx ──────────────────────────────────────────────
files["src/components/SettingsPanel.jsx"] = """
import { useState, useEffect } from "react"
import { api } from "../lib/api.js"
import { Save } from "lucide-react"
import "./SettingsPanel.css"

const DEFAULTS = { tp_pct: 0.25, hard_stop_pct: 0.50, trail_offset: 0.20, gap_limit: 0.03, poll_seconds: 60 }

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

export default function SettingsPanel() {
  const [settings, setSettings] = useState(DEFAULTS)
  const [busy, setBusy] = useState(false)
  const [msg,  setMsg]  = useState(null)

  useEffect(() => { api.getSettings().then(s => setSettings(s)).catch(() => {}) }, [])

  function set(key, value) { setSettings(s => ({ ...s, [key]: parseFloat(value) || value })) }

  async function handleSave() {
    setBusy(true); setMsg(null)
    try { await api.saveSettings(settings); setMsg({ type: "ok", text: "Settings saved." }) }
    catch(e) { setMsg({ type: "error", text: e.message }) }
    finally { setBusy(false) }
  }

  return (
    <div className="settings">
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
          <SettingRow label="Gap Filter" description="Skip ticker if overnight gap exceeds this threshold">
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
    </div>
  )
}
""".lstrip()

# ── components/SettingsPanel.css ──────────────────────────────────────────────
files["src/components/SettingsPanel.css"] = """
.settings-note { font-size: 11px; margin-bottom: 20px; padding: 10px 12px; background: var(--amber-mute); border: 1px solid #ffc10720; border-radius: var(--radius); color: var(--amber); }
.settings-list { display: flex; flex-direction: column; }
.setting-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; padding: 18px 0; border-bottom: 1px solid var(--border); }
.setting-row:last-child { border-bottom: none; }
.setting-info  { flex: 1; }
.setting-label { font-size: 14px; font-weight: 500; color: var(--text-1); margin-bottom: 4px; }
.setting-desc  { font-size: 12px; line-height: 1.5; }
.setting-input { display: flex; flex-direction: column; gap: 6px; min-width: 160px; align-items: flex-end; }
.input-with-unit { display: flex; align-items: center; gap: 8px; width: 100%; }
.input-with-unit input { width: 100px; text-align: right; }
.unit { font-size: 13px; min-width: 24px; }
.setting-current { font-size: 11px; color: var(--text-3); }
.param-explainer { display: flex; flex-direction: column; gap: 12px; font-size: 12px; }
.param-flow { display: flex; align-items: center; gap: 12px; }
.arrow { color: var(--text-3); font-size: 16px; }
""".lstrip()

# ── Write all files ───────────────────────────────────────────────────────────
for path, content in files.items():
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"  created: {path}")

print("\nAll files created! Now run: npm run dev")
