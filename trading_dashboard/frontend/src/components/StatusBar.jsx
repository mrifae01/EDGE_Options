import { useState } from "react"
import { api } from "../lib/api.js"
import { usePolling } from "../hooks/usePolling.js"
import { Power, PowerOff, AlertTriangle, Info } from "lucide-react"
import "./StatusBar.css"

export default function StatusBar() {
  const [busy, setBusy] = useState(false)
  const [msg,  setMsg]  = useState("")
  const [msgType, setMsgType] = useState("warn") // "warn" | "ok" | "error"

  const { data, refetch } = usePolling(() => api.getStatus(), 4000)
  const running = data?.bot_running ?? false
  const warning = data?.market_warning ?? null
  const carry   = data?.carry_count ?? 0

  async function toggle() {
    setBusy(true); setMsg("")
    try {
      if (running) {
        await api.stopBot()
        setMsg("Bot stopped.")
        setMsgType("ok")
      } else {
        const res = await api.startBot()
        if (res.warning) {
          setMsg(res.warning)
          setMsgType("warn")
        } else {
          setMsg("Bot started.")
          setMsgType("ok")
        }
      }
      await refetch()
    } catch(e) {
      setMsg(e.message)
      setMsgType("error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="statusbar">
      <div className="status-indicator">
        <span className={"dot " + (running ? "dot-live" : "dot-off")} />
        <span className="status-label mono">{running ? "BOT LIVE" : "BOT IDLE"}</span>
      </div>

      {data && (
        <div className="status-meta mono dim">
          {data.traded_today?.length > 0
            ? data.traded_today.length + " traded today"
            : "No trades today"}
          {carry > 0 && <span className="carry-tag"> · {carry} carry</span>}
        </div>
      )}

      {/* Market closed warning — shown when bot is idle */}
      {!running && warning && (
        <div className="market-warning">
          <AlertTriangle size={11} />
          <span>{warning}</span>
        </div>
      )}

      <button
        className={"btn " + (running ? "btn-red" : "btn-green") + " status-btn"}
        onClick={toggle}
        disabled={busy}
      >
        {running
          ? <><PowerOff size={13}/> Stop Bot</>
          : <><Power size={13}/> Start Bot</>
        }
      </button>

      {msg && (
        <div className={"status-msg mono status-msg-" + msgType}>
          {msgType === "warn" && <Info size={10} />}
          <span>{msg}</span>
        </div>
      )}
    </div>
  )
}