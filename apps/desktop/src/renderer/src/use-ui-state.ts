import { useEffect, useRef, useState } from 'react'
import { api } from './api'

/**
 * React state mirrored into the main-process ui-state store. The stored value is
 * loaded once on mount; writes happen in the setter (never in an effect), so a
 * load completing after the first render can never clobber a fresh value.
 */
export function useUiState<T>(
  key: string,
  fallback: T,
  sanitize?: (stored: unknown) => T | null
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(fallback)
  const hydrated = useRef(false)

  useEffect(() => {
    let live = true
    hydrated.current = false
    void (async () => {
      try {
        const { value: stored } = await api.invoke('ui-state:get', { key })
        if (!live) return
        const next = sanitize === undefined ? (stored as T | null) : sanitize(stored)
        if (next !== null && next !== undefined) setValue(next)
      } catch (error) {
        console.error(`[ui-state] loading ${key} failed`, error)
      } finally {
        if (live) hydrated.current = true
      }
    })()
    return () => {
      live = false
    }
  }, [key])

  const update = (next: T): void => {
    setValue(next)
    if (!hydrated.current) return
    void api.invoke('ui-state:set', { key, value: next }).catch((error: unknown) => {
      console.error(`[ui-state] persisting ${key} failed`, error)
    })
  }

  return [value, update]
}
