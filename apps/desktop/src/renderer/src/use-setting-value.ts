import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'

/**
 * Effective value of a user-scope setting, kept in sync with settings.json
 * edits made by hand. `sanitize` returns `null` for values it does not accept.
 */
export function useSettingValue<T>(
  keyPath: readonly string[],
  fallback: T,
  sanitize: (stored: unknown) => T | null
): [T, (next: T) => void] {
  const key = keyPath.join('.')
  const [value, setValue] = useState<T>(fallback)
  const pathRef = useRef(keyPath)
  pathRef.current = keyPath

  useEffect(() => {
    let live = true
    const load = (): void => {
      void api.invoke('settings:getEffective', { keyPath: [...pathRef.current] }).then(
        ({ value: stored }) => {
          if (!live) return
          const next = sanitize(stored)
          if (next !== null) setValue(next)
        },
        () => undefined
      )
    }
    load()
    const stop = api.on('settings:changed', (change) => {
      if (change.keyPath.join('.') === key) load()
    })
    return () => {
      live = false
      stop()
    }
  }, [key, sanitize])

  const update = useCallback(
    (next: T): void => {
      setValue(next)
      void api
        .invoke('settings:set', { scope: 'user', keyPath: [...pathRef.current], value: next })
        .catch((error: unknown) => {
          console.error(`[settings] writing ${key} failed`, error)
        })
    },
    [key]
  )

  return [value, update]
}
