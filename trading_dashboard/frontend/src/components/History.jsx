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
