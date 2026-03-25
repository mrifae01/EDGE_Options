import { useState } from "react"
import { usePolling } from "../hooks/usePolling.js"
import { api } from "../lib/api.js"
import {
  TrendingUp, TrendingDown, Layers, Clock, Trash2, AlertTriangle,
  CheckCircle2, XCircle, MinusCircle, Timer
} from "lucide-react"
import "./History.css"

// ── Formatters ─────────────────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return "—"
  const d = new Date(iso + "T00:00:00")
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })
}
function fmtExpiry(iso) {
  if (!iso) return "—"
  const d = new Date(iso + "T00:00:00")
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

// ── Status badge ───────────────────────────────────────────────────────────────
function StatusBadge({ status, exitReason }) {
  if (status === "open") {
    return <span className="hist-badge hist-badge-blue"><Timer size={10}/> Open</span>
  }
  if (status === "pending") {
    return <span className="hist-badge hist-badge-amber"><Clock size={10}/> Pending</span>
  }
  if (status === "closed") {
    const label = exitReason
      ? exitReason.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
      : "Closed"
    const isGood = ["tp", "take_profit", "partial_tp"].includes(exitReason)
    const isBad  = ["sl", "stop_loss", "hard_stop"].includes(exitReason)
    return (
      <span className={`hist-badge ${isGood ? "hist-badge-green" : isBad ? "hist-badge-red" : "hist-badge-dim"}`}>
        {isGood ? <CheckCircle2 size={10}/> : isBad ? <XCircle size={10}/> : <MinusCircle size={10}/>}
        {label}
      </span>
    )
  }
  return null
}

// ── Spread row ─────────────────────────────────────────────────────────────────
function SpreadRow({ spread }) {
  const isBull = spread.strategy === "bull_call_spread"

  return (
    <div className="hist-row hist-row-spread">
      <div className="hist-row-left">
        <span className={`hist-strategy-badge ${isBull ? "hist-bull" : "hist-bear"}`}>
          {isBull ? <TrendingUp size={10}/> : <TrendingDown size={10}/>}
          {isBull ? "Bull Call" : "Bear Put"} Spread
        </span>
        <span className="hist-ticker">{spread.ticker}</span>
        <span className="hist-meta mono">
          ${spread.long_strike != null ? Number(spread.long_strike).toFixed(2) : "—"}
          <span className="hist-arrow"> → </span>
          ${spread.short_strike != null ? Number(spread.short_strike).toFixed(2) : "—"}
        </span>
        <span className="hist-meta dim">Exp {fmtExpiry(spread.expiry)}</span>
      </div>
      <div className="hist-row-right">
        <div className="hist-chips">
          <span className="hist-chip">
            <span className="dim">Debit</span>
            <span className="mono">{spread.net_debit != null ? "$" + Number(spread.net_debit).toFixed(2) : "—"}</span>
          </span>
          <span className="hist-chip">
            <span className="dim">Qty</span>
            <span className="mono">{spread.qty ?? "—"}</span>
          </span>
          {spread.debit_paid != null && (
            <span className="hist-chip">
              <span className="dim">Cost</span>
              <span className="mono">${Number(spread.debit_paid).toFixed(0)}</span>
            </span>
          )}
        </div>
        <StatusBadge status={spread.status} exitReason={spread.exit_reason}/>
      </div>
    </div>
  )
}

// ── Single-leg row ─────────────────────────────────────────────────────────────
function SingleRow({ entry }) {
  return (
    <div className="hist-row hist-row-single">
      <div className="hist-row-left">
        <span className="hist-strategy-badge hist-single">
          <Layers size={10}/> Single Leg
        </span>
        <span className="hist-ticker">{entry.ticker}</span>
        {entry.contract && (
          <span className="hist-meta mono dim" style={{ fontSize: 11 }}>{entry.contract}</span>
        )}
      </div>
      <div className="hist-row-right">
        <div className="hist-chips">
          <span className="hist-chip">
            <span className="dim">Qty</span>
            <span className="mono">{entry.original_qty ?? "—"}</span>
          </span>
          {entry.took_partial && (
            <span className="hist-chip hist-chip-green">
              <CheckCircle2 size={10}/>
              Partial TP
              <span className="mono">({entry.partial_qty_sold} sold)</span>
            </span>
          )}
          {entry.sl_stock != null && (
            <span className="hist-chip">
              <span className="dim">SL</span>
              <span className="mono red">${Number(entry.sl_stock).toFixed(2)}</span>
            </span>
          )}
          {entry.tp_stock != null && (
            <span className="hist-chip">
              <span className="dim">TP</span>
              <span className="mono green">${Number(entry.tp_stock).toFixed(2)}</span>
            </span>
          )}
          {entry.entry_avg_price != null && (
            <span className="hist-chip">
              <span className="dim">Entry</span>
              <span className="mono">${Number(entry.entry_avg_price).toFixed(2)}</span>
            </span>
          )}
          {entry.peak_plpc != null && (
            <span className={`hist-chip ${entry.peak_plpc >= 0 ? "hist-chip-green" : "hist-chip-red"}`}>
              <span className="dim">Peak</span>
              <span className="mono">
                {(entry.peak_plpc >= 0 ? "+" : "") + (entry.peak_plpc * 100).toFixed(1) + "%"}
              </span>
            </span>
          )}
        </div>
        {entry.exit_reason && (
          <StatusBadge status="closed" exitReason={entry.exit_reason}/>
        )}
      </div>
    </div>
  )
}

// ── Day section ────────────────────────────────────────────────────────────────
function DaySection({ day, filter }) {
  const singles = filter === "spreads" ? [] : day.single_leg
  const spreads  = filter === "single"  ? [] : day.spreads
  if (singles.length + spreads.length === 0) return null

  return (
    <div className="hist-day">
      <div className="hist-day-header">
        <span className="hist-day-date">{fmtDate(day.date)}</span>
        <span className="mono dim" style={{ fontSize: 11 }}>
          {singles.length + spreads.length} entr{(singles.length + spreads.length) === 1 ? "y" : "ies"}
        </span>
      </div>
      <div className="hist-day-rows">
        {spreads.map(s => <SpreadRow key={s.id || (s.ticker + s.expiry + s.strategy)} spread={s}/>)}
        {singles.map((e, i) => <SingleRow key={e.ticker + i} entry={e}/>)}
      </div>
    </div>
  )
}

// ── Stats bar ──────────────────────────────────────────────────────────────────
function StatsBar({ stats, history }) {
  const allSpreads    = history.flatMap(d => d.spreads)
  const openSpreads   = allSpreads.filter(s => s.status === "open" || s.status === "pending").length
  const closedSpreads = allSpreads.filter(s => s.status === "closed").length
  const totalCost     = allSpreads
    .filter(s => s.debit_paid != null)
    .reduce((sum, s) => sum + s.debit_paid, 0)
  const tradingDays   = history.filter(d => d.single_leg.length + d.spreads.length > 0).length

  return (
    <div className="hist-stats">
      <div className="hist-stat">
        <span className="hist-stat-label">Total Entries</span>
        <span className="hist-stat-value">{stats.total_entries}</span>
      </div>
      <div className="hist-stat-divider"/>
      <div className="hist-stat">
        <span className="hist-stat-label">Single-Leg</span>
        <span className="hist-stat-value">{stats.total_single_leg}</span>
      </div>
      <div className="hist-stat-divider"/>
      <div className="hist-stat">
        <span className="hist-stat-label">Spreads</span>
        <span className="hist-stat-value">{stats.total_spreads}</span>
        <div className="hist-stat-subs">
          {openSpreads > 0 && <span className="hist-stat-sub blue">{openSpreads} open</span>}
          {closedSpreads > 0 && <span className="hist-stat-sub dim">{closedSpreads} closed</span>}
        </div>
      </div>
      <div className="hist-stat-divider"/>
      <div className="hist-stat">
        <span className="hist-stat-label">Trading Days</span>
        <span className="hist-stat-value">{tradingDays}</span>
      </div>
      {totalCost > 0 && (
        <>
          <div className="hist-stat-divider"/>
          <div className="hist-stat">
            <span className="hist-stat-label">Capital Deployed</span>
            <span className="hist-stat-value">${totalCost.toFixed(0)}</span>
            <span className="hist-stat-sub dim">spreads only</span>
          </div>
        </>
      )}
    </div>
  )
}

// ── Clear button with confirm flow ─────────────────────────────────────────────
function ClearButton({ onCleared }) {
  const [phase, setPhase] = useState("idle") // idle | warn | clearing
  const [error, setError] = useState(null)

  async function handleConfirm() {
    setPhase("clearing")
    setError(null)
    try {
      await api.clearHistory()
      onCleared()
      setPhase("idle")
    } catch (e) {
      setError(e.message)
      setPhase("warn")
    }
  }

  if (phase === "idle") {
    return (
      <button className="btn btn-ghost hist-clear-btn" onClick={() => setPhase("warn")}>
        <Trash2 size={13}/> Clear History
      </button>
    )
  }

  return (
    <div className="hist-confirm-row">
      <AlertTriangle size={14} style={{ color: "var(--amber)", flexShrink: 0 }}/>
      <span className="mono" style={{ fontSize: 12, color: "var(--amber)" }}>
        This cannot be undone.
      </span>
      <button className="btn-danger" onClick={handleConfirm} disabled={phase === "clearing"}>
        {phase === "clearing" ? "Clearing…" : "Confirm Delete"}
      </button>
      <button
        className="btn btn-ghost"
        style={{ fontSize: 12, padding: "5px 10px" }}
        onClick={() => { setPhase("idle"); setError(null) }}
      >
        Cancel
      </button>
      {error && <span className="mono red" style={{ fontSize: 11 }}>{error}</span>}
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────────
export default function History() {
  const [filter, setFilter] = useState("all") // all | spreads | single
  const { data, loading, refetch: refresh } = usePolling(() => api.getHistory(), 30000)

  const history = data?.history ?? []
  const stats   = data?.stats   ?? { total_entries: 0, total_single_leg: 0, total_spreads: 0 }

  const visibleDays = history.filter(d => {
    if (filter === "spreads") return d.spreads.length > 0
    if (filter === "single")  return d.single_leg.length > 0
    return d.single_leg.length + d.spreads.length > 0
  })

  if (loading && !data) {
    return <div className="mono dim" style={{ padding: 40 }}>Loading history…</div>
  }

  return (
    <div className="hist">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="hist-header">
        <div className="hist-header-left">
          <h2 className="hist-title">Trade History</h2>
          <div className="hist-filter-row">
            {[
              { key: "all",     label: "All" },
              { key: "spreads", label: "Spreads" },
              { key: "single",  label: "Single-Leg" },
            ].map(f => (
              <button
                key={f.key}
                className={"hist-filter-btn" + (filter === f.key ? " hist-filter-btn-on" : "")}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <ClearButton onCleared={refresh}/>
      </div>

      {/* ── Stats ───────────────────────────────────────────────────────────── */}
      {history.length > 0 && <StatsBar stats={stats} history={history}/>}

      {/* ── Timeline ────────────────────────────────────────────────────────── */}
      {visibleDays.length === 0 ? (
        <div className="card">
          <div className="mono dim" style={{ padding: "28px 0", textAlign: "center" }}>
            {history.length === 0
              ? "No trade history yet."
              : "No entries match the selected filter."}
          </div>
        </div>
      ) : (
        <div className="hist-timeline">
          {visibleDays.map(d => (
            <DaySection key={d.date} day={d} filter={filter}/>
          ))}
        </div>
      )}

    </div>
  )
}
