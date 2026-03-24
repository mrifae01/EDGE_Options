const BASE = '/api'

async function req(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body !== undefined) opts.body = JSON.stringify(body)
  const res = await fetch(`${BASE}${path}`, opts)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || res.statusText)
  }
  return res.json()
}

export const api = {
  getStatus:         ()        => req('GET',    '/status'),
  startBot:          ()        => req('POST',   '/bot/start'),
  stopBot:           ()        => req('POST',   '/bot/stop'),
  getLogs:           (n = 200) => req('GET',    `/bot/logs?lines=${n}`),
  getPositions:      ()        => req('GET',    '/positions'),
  getHistory:        ()        => req('GET',    '/history'),
  getPlans:          ()        => req('GET',    '/plans'),
  savePlans:         (plans)   => req('POST',   '/plans', plans),
  deletePlan:        (ticker)  => req('DELETE', `/plans/${ticker}`),
  getSignals:        ()        => req('GET',    '/plans/signals'),
  getSettings:       ()        => req('GET',    '/settings'),
  saveSettings:      (s)       => req('POST',   '/settings', s),
  recordPLSnapshot:  ()        => req('POST',   '/pl-snapshot'),
  getPLHistory:      ()        => req('GET',    '/pl-history'),
  getOverview:       ()        => req('GET',    '/overview'),
  updatePosition:    (ticker, body) => req('PATCH',  `/positions/${ticker}`, body),
  closePosition:     (ticker)       => req('POST',   `/positions/${ticker}/close`),
  getCloseQueue:     ()             => req('GET',    '/close-queue'),
  removeFromQueue:   (ticker)       => req('DELETE', `/close-queue/${ticker}`),
  getStrategies:     ()                    => req('GET',    '/strategies'),
  createStrategy:    (body)                => req('POST',   '/strategies', body),
  updateStrategy:    (id, body)            => req('PATCH',  `/strategies/${id}`, body),
  deleteStrategy:    (id)                  => req('DELETE', `/strategies/${id}`),
  runStrategy:       (id)                  => req('POST',   `/strategies/${id}/run`),

  // ── Bull Call Spread ──────────────────────────────────────────────────────
  getBCSSettings:      ()               => req('GET',    '/bcs/settings'),
  saveBCSSettings:     (s)              => req('POST',   '/bcs/settings', s),
  runBCSScan:          (tickers = null) => req('POST',   '/bcs/scan', tickers ? { tickers } : undefined),
  getBCSPositions:     ()               => req('GET',    '/bcs/positions'),
  monitorBCSPositions: ()               => req('POST',   '/bcs/monitor'),
  queueBCSSpread:      (body)           => req('POST',   '/bcs/queue', body),
  placeBCSSpread:      (body)           => req('POST',   '/bcs/place', body),
  closeBCSPosition:    (id)             => req('DELETE', `/bcs/positions/${id}`),

  // ── Bear Put Spread ───────────────────────────────────────────────────────
  getBPSSettings:      ()               => req('GET',    '/bps/settings'),
  saveBPSSettings:     (s)              => req('POST',   '/bps/settings', s),
  runBPSScan:          (tickers = null) => req('POST',   '/bps/scan', tickers ? { tickers } : undefined),
  getBPSPositions:     ()               => req('GET',    '/bps/positions'),
  monitorBPSPositions: ()               => req('POST',   '/bps/monitor'),
  queueBPSSpread:      (body)           => req('POST',   '/bps/queue', body),
  placeBPSSpread:      (body)           => req('POST',   '/bps/place', body),
  closeBPSPosition:    (id)             => req('DELETE', `/bps/positions/${id}`),
}