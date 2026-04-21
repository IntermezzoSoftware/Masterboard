import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'

type SettingsValues = Record<string, string>

interface UseSettingsResult {
  values: SettingsValues
  setValue: (key: string, val: string) => Promise<void>
  loading: boolean
}

export function useSettings(keys: string[]): UseSettingsResult {
  const [values, setValues] = useState<SettingsValues>({})
  const [loading, setLoading] = useState(true)

  // Stable dependency: only re-fetch if the set of keys actually changes
  const keysJson = useMemo(() => JSON.stringify([...keys].sort()), [keys]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const parsedKeys: string[] = JSON.parse(keysJson)
    if (parsedKeys.length === 0) { setLoading(false); return }

    let cancelled = false
    setLoading(true)
    Promise.all(parsedKeys.map(k => api.getSetting(k).catch(() => '')))
      .then(results => {
        if (cancelled) return
        const map: SettingsValues = {}
        parsedKeys.forEach((k, i) => { map[k] = results[i] })
        setValues(map)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [keysJson])

  // Use a ref so the returned setValue is stable across renders
  const valuesRef = useRef(values)
  valuesRef.current = values

  const setValue = useCallback(async (key: string, val: string) => {
    setValues(prev => ({ ...prev, [key]: val }))
    try {
      await api.setSetting(key, val)
    } catch (e) {
      console.error(`Failed to persist setting "${key}":`, e)
    }
  }, [])

  return { values, setValue, loading }
}
