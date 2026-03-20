import { usePolling } from '../hooks/usePolling.js'
import { api } from '../lib/api.js'
import { TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import './Dashboard.css'

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

function PositionCard({ pos }) {
  const plpc      = pos.last_plpc
  const peak      = pos.peak_plpc
  const trail     = pos.took_partial && peak != null ? peak - 0.20 : null
  const isPartial = pos.took_partial

  // Simple mock sparkline data based on plpc for visual interest
  // In production, you'd store time-series P/L per position
  const sparkData = peak != null ? [
    { p: 0 },
    { p: (peak * 0.4 * 100) },
    { p: (peak * 0.7 * 100) },
    { p: (peak * 100) },
    { p: (plpc ?? 0) * 100 },
  ] : []

  return (
    <div className={`position-card ${plpc != null && plpc < 0 ? 'pos-red' : 'pos-green'}`}>
      <div className="pos-header">
        <div>
          <div className="pos-ticker">{pos.ticker}</div>
          <div className="pos-contract mono dim">{pos.contract}</div>
        </div>
        <div className="pos-badges">
          <span className={`badge ${pos.status === 'carry' ? 'badge-amber' : 'badge-blue'}`}>
            {pos.status === 'carry' ? 'CARRY' : 'ACTIVE'}
          </span>
          {isPartial && <span className="badge badge-green">PARTIAL ✓</span>}
        </div>
      </div>

      <div className="pos-pl">
        <span className={`pos-pl-value mono ${plClass(plpc)}`}>
          {pct(plpc)}
        </span>
        <span className="pos-pl-label dim mono">P/L</span>
      </div>

      {sparkData.length > 0 && (
        <div className="pos-sparkline">
          <ResponsiveContainer width="100%" height={48}>
            <AreaChart data={sparkData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`grad-${pos.ticker}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={plpc >= 0 ? '#00e676' : '#ff3d57'} stopOpacity={0.3}/>
                  <stop offset="95%" stopColor={plpc >= 0 ? '#00e676' : '#ff3d57'} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="p"
                stroke={plpc >= 0 ? '#00e676' : '#ff3d57'}
                strokeWidth={1.5}
                fill={`url(#grad-${pos.ticker})`}
                dot={false}
              />
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
          <span className="mono">{pos.entry_avg_price != null ? `$${pos.entry_avg_price.toFixed(2)}` : '—'}</span>
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
    </div>
  )
}

export default function Dashboard() {
  const { data: statusData } = usePolling(() => api.getStatus(), 5000)
  const { data: posData, loading, error } = usePolling(() => api.getPositions(), 8000)

  const positions = posData?.positions ?? []
  const active    = positions.filter(p => p.status === 'active')
  const carry     = positions.filter(p => p.status === 'carry')

  const avgPl = positions.length > 0
    ? positions.reduce((s, p) => s + (p.last_plpc ?? 0), 0) / positions.filter(p => p.last_plpc != null).length
    : null

  return (
    <div className="dashboard">
      {/* Summary stats */}
      <div className="grid-4" style={{ marginBottom: 24 }}>
        <StatCard
          label="Open Positions"
          value={positions.length}
          sub={`${active.length} active · ${carry.length} carry`}
          accent="var(--blue)"
        />
        <StatCard
          label="Avg P/L"
          value={avgPl != null ? pct(avgPl) : '—'}
          accent={avgPl != null && avgPl >= 0 ? 'var(--green)' : 'var(--red)'}
        />
        <StatCard
          label="Traded Today"
          value={statusData?.traded_today?.length ?? 0}
          sub={statusData?.traded_today?.join(', ') || 'none'}
          accent="var(--amber)"
        />
        <StatCard
          label="Bot Status"
          value={statusData?.bot_running ? 'LIVE' : 'IDLE'}
          sub={statusData?.bot_running ? `PID ${statusData.pid}` : 'stopped'}
          accent={statusData?.bot_running ? 'var(--green)' : 'var(--text-3)'}
        />
      </div>

      {/* Positions */}
      {loading && <div className="mono dim" style={{ padding: '40px 0', textAlign: 'center' }}>Loading positions...</div>}
      {error   && (
        <div className="card" style={{ borderColor: 'var(--red-dim)', display: 'flex', gap: 10, alignItems: 'center' }}>
          <AlertTriangle size={16} color="var(--red)" />
          <span className="mono" style={{ color: 'var(--red)' }}>{error}</span>
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
          {positions.map(pos => (
            <PositionCard key={pos.ticker} pos={pos} />
          ))}
        </div>
      )}
    </div>
  )
}
