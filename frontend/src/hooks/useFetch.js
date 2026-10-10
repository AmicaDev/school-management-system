import { useCallback, useEffect, useState } from 'react'
import { api, errorMessage } from '../services/api'

/** GET with loading / error / retry. Pass null url to skip. */
export function useFetch(url, params) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(!!url)
  const [error, setError] = useState('')
  const key = url ? url + JSON.stringify(params || {}) : ''
  const load = useCallback(() => {
    if (!url) { setData(null); setLoading(false); return Promise.resolve() }
    setLoading(true); setError('')
    return api.get(url, { params }).then((r) => setData(r.data)).catch((e) => setError(errorMessage(e))).finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  useEffect(() => { load() }, [load])
  return { data, loading, error, reload: load, setData }
}
