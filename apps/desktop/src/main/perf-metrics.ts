import type { PerfOpSample, PerfStats } from '@gitreedesk/shared'

const READ_CAP = 200
const OP_CAP = 40
const OPS_RETURNED = 12

let readSamples: number[] = []
let skipCount = 0
let skipTotalMs = 0
let lastReadMs: number | null = null
let scan: PerfStats['scan'] = { lastMs: null, lastRepos: 0, at: null }
let warm: PerfStats['warm'] = null
let ops: PerfOpSample[] = []

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/** Nearest-rank percentile over an ascending sample list. */
function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return round1(sorted[index] ?? 0)
}

export function recordStatusRead(ms: number, skipped: boolean): void {
  if (skipped) {
    skipCount += 1
    skipTotalMs += ms
    return
  }
  readSamples.push(ms)
  if (readSamples.length > READ_CAP) readSamples = readSamples.slice(-READ_CAP)
  lastReadMs = ms
}

export function recordScan(ms: number, repos: number): void {
  scan = { lastMs: round1(ms), lastRepos: repos, at: Date.now() }
}

export function recordWarm(ms: number): void {
  warm = { ms: round1(ms), at: Date.now() }
}

export function recordOp(channel: string, ms: number, ok: boolean): void {
  ops.push({ channel, ms: round1(ms), ok, at: Date.now() })
  if (ops.length > OP_CAP) ops = ops.slice(-OP_CAP)
}

export function perfSnapshot(): Omit<PerfStats, 'watchers'> {
  const sorted = [...readSamples].sort((a, b) => a - b)
  return {
    scan: { ...scan },
    status: {
      samples: sorted.length,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      lastMs: lastReadMs === null ? null : round1(lastReadMs),
      skips: { count: skipCount, avgMs: skipCount === 0 ? null : round1(skipTotalMs / skipCount) }
    },
    warm: warm === null ? null : { ...warm },
    ops: ops.slice(-OPS_RETURNED)
  }
}

export function resetPerfMetrics(): void {
  readSamples = []
  skipCount = 0
  skipTotalMs = 0
  lastReadMs = null
  scan = { lastMs: null, lastRepos: 0, at: null }
  warm = null
  ops = []
}
