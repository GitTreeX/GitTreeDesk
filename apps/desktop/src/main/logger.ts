import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { LogLevelValue } from '@gitreedesk/shared'

const LEVEL_RANK: Record<LogLevelValue, number> = { error: 0, warn: 1, info: 2, debug: 3 }
const MAX_LOG_BYTES = 2 * 1024 * 1024

export interface FileLogger {
  /** Absolute path of the log file. */
  file(): string
  setLevel(level: LogLevelValue): void
  dispose(): void
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`
  try {
    const json = JSON.stringify(value)
    if (json !== undefined) return json
  } catch {
    // falls through to String()
  }
  return String(value)
}

/**
 * Mirrors main-process console output into `<userData>/logs/main.log` at or above
 * the configured level, keeping the console itself untouched. The file rolls once
 * at 2 MB to `main.log.1`.
 */
export function installFileLogger(userDataDir: string, initialLevel: LogLevelValue = 'info'): FileLogger {
  const dir = join(userDataDir, 'logs')
  const file = join(dir, 'main.log')
  let level: LogLevelValue = initialLevel

  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    // console-only logging still works
  }

  const original = {
    error: console.error.bind(console),
    warn: console.warn.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console)
  }

  const append = (target: LogLevelValue, args: unknown[]): void => {
    if (LEVEL_RANK[target] > LEVEL_RANK[level]) return
    try {
      const stats = statSync(file, { throwIfNoEntry: false })
      if (stats !== undefined && stats.size >= MAX_LOG_BYTES) renameSync(file, `${file}.1`)
    } catch {
      // rotation is best effort
    }
    try {
      const stamp = new Date().toISOString()
      appendFileSync(file, `${stamp} [${target}] ${args.map(formatValue).join(' ')}\n`)
    } catch {
      // logging must never throw
    }
  }

  console.error = (...args: unknown[]) => {
    original.error(...args)
    append('error', args)
  }
  console.warn = (...args: unknown[]) => {
    original.warn(...args)
    append('warn', args)
  }
  console.info = (...args: unknown[]) => {
    original.info(...args)
    append('info', args)
  }
  console.debug = (...args: unknown[]) => {
    original.debug(...args)
    append('debug', args)
  }

  return {
    file: () => file,
    setLevel: (next) => {
      level = next
    },
    dispose: () => {
      console.error = original.error
      console.warn = original.warn
      console.info = original.info
      console.debug = original.debug
    }
  }
}
