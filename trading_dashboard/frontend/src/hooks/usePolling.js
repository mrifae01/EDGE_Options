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
