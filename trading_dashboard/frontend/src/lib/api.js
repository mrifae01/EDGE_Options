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
}