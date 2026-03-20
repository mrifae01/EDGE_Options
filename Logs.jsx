import { useEffect, useRef } from 'react'
import { usePolling } from '../hooks/usePolling.js'
import { api } from '../lib/api.js'
import './Logs.css'

function colorLine(line) {
  if (line.includes('ENTRY'))       return 'log-entry'
  if (line.includes('TP hit'))      return 'log-tp'
  if (line.includes('HARD STOP'))   return 'log-stop'
  if (line.includes('Trailing stop'))return 'log-stop'
  if (line.includes('STOCK SL'))    return 'log-stop'
  if (line.includes('STOCK TP'))    return 'log-tp'
  if (line.includes('ABORT'))       return 'log-warn'
  if (line.includes('GAP'))         return 'log-warn'
  if (line.includes('WAIT'))        return 'log-dim'
  if (line.includes('ERROR') || line.includes('failed')) return 'log-error'
  if (line.includes('BOOT'))        return 'log-boot'
  if (line.includes('Carry'))       return 'log-carry'
  return 'log-default'
}

export default function Logs() {
  const { data, loading } = usePolling(() => api.getLogs(300), 5000)
  const bottomRef = useRef(null)
  const lines = data?.logs ?? []

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  return (
    <div className="logs-wrap">
      <div className="logs-header mono dim">
        <span>BOT LOG</span>
        <span>{lines.length} lines</span>
      </div>
      <div className="logs-terminal">
        {loading && <div className="log-line log-dim">Loading...</div>}
        {lines.length === 0 && !loading && (
          <div className="log-line log-dim">No log output yet. Start the bot to see activity.</div>
        )}
        {lines.map((line, i) => (
          <div key={i} className={`log-line ${colorLine(line)}`}>
            <span className="log-idx dim">{String(i + 1).padStart(4, ' ')}</span>
            <span>{line}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
