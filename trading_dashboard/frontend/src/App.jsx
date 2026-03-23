import { useState } from 'react'
import { Activity, BarChart2, Globe, List, MessageSquare, Search, Settings, Terminal, TrendingUp, TrendingDown } from 'lucide-react'
import Dashboard from './components/Dashboard.jsx'
import Plans from './components/Plans.jsx'
import History from './components/History.jsx'
import Logs from './components/Logs.jsx'
import SettingsPanel from './components/SettingsPanel.jsx'
import Overview from './components/Overview.jsx'
import Eddy from './components/Eddy.jsx'
import Screener from './components/Screener.jsx'
import BullCallSpread from './components/BullCallSpread.jsx'
import BearPutSpread from './components/BearPutSpread.jsx'
import StatusBar from './components/StatusBar.jsx'
import './App.css'

function SpreadsTab() {
  const [mode, setMode] = useState('bull')
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button
          onClick={() => setMode('bull')}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 16px', borderRadius: 'var(--radius)',
            fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600,
            letterSpacing: '0.06em', cursor: 'pointer', border: '1px solid',
            background: mode === 'bull' ? 'var(--green-mute)' : 'transparent',
            color:      mode === 'bull' ? 'var(--green)'      : 'var(--text-3)',
            borderColor:mode === 'bull' ? 'var(--green-dim)'  : 'var(--border)',
            transition: 'all 0.15s',
          }}
        >
          <TrendingUp size={13} /> BULL SPREAD
        </button>
        <button
          onClick={() => setMode('bear')}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 16px', borderRadius: 'var(--radius)',
            fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600,
            letterSpacing: '0.06em', cursor: 'pointer', border: '1px solid',
            background: mode === 'bear' ? 'var(--red-mute)'  : 'transparent',
            color:      mode === 'bear' ? 'var(--red)'       : 'var(--text-3)',
            borderColor:mode === 'bear' ? 'var(--red-dim)'   : 'var(--border)',
            transition: 'all 0.15s',
          }}
        >
          <TrendingDown size={13} /> BEAR SPREAD
        </button>
      </div>
      {mode === 'bull' ? <BullCallSpread /> : <BearPutSpread />}
    </div>
  )
}

const TABS = [
  { id: 'overview',  label: 'Overview',   Icon: Globe },
  { id: 'dashboard', label: 'Dashboard',  Icon: Activity },
  { id: 'plans',     label: 'Plans',      Icon: List },
  { id: 'screener',  label: 'Screener',   Icon: Search },
  { id: 'spreads',   label: 'Spreads',    Icon: TrendingUp },
  { id: 'history',   label: 'History',    Icon: BarChart2 },
  { id: 'logs',      label: 'Logs',       Icon: Terminal },
  { id: 'eddy',      label: 'Eddy',       Icon: MessageSquare },
  { id: 'settings',  label: 'Settings',   Icon: Settings },
]

export default function App() {
  const [tab, setTab] = useState('dashboard')

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <span className="logo-text">EDGE</span>
          <span className="logo-sub">OPTIONS</span>
        </div>

        <nav className="sidebar-nav">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={`nav-item ${tab === id ? 'active' : ''}`}
              onClick={() => setTab(id)}
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <StatusBar />
        </div>
      </aside>

      <main className="main">
        <div className="main-header">
          <h1 className="page-title">
            {TABS.find(t => t.id === tab)?.label}
          </h1>
          <div className="header-date mono dim">
            {new Date().toLocaleDateString('en-US', {
              weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
            })}
          </div>
        </div>

        <div className="main-content fade-in" key={tab}>
          {tab === 'overview'  && <Overview />}
          {tab === 'dashboard' && <Dashboard />}
          {tab === 'plans'     && <Plans />}
          {tab === 'screener'  && <Screener />}
          {tab === 'spreads'   && <SpreadsTab />}
          {tab === 'history'   && <History />}
          {tab === 'logs'      && <Logs />}
          {tab === 'settings'  && <SettingsPanel />}
          {tab === 'eddy'      && <Eddy />}
        </div>
      </main>
    </div>
  )
}