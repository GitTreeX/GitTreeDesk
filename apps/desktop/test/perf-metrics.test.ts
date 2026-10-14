import { beforeEach, describe, expect, it } from 'vitest'
import {
  perfSnapshot,
  recordOp,
  recordScan,
  recordStatusRead,
  recordWarm,
  resetPerfMetrics
} from '../src/main/perf-metrics'

beforeEach(() => {
  resetPerfMetrics()
})

describe('perf metrics', () => {
  it('starts empty', () => {
    const snapshot = perfSnapshot()
    expect(snapshot.scan).toEqual({ lastMs: null, lastRepos: 0, at: null })
    expect(snapshot.status).toEqual({
      samples: 0,
      p50: null,
      p95: null,
      lastMs: null,
      skips: { count: 0, avgMs: null }
    })
    expect(snapshot.warm).toBeNull()
    expect(snapshot.ops).toEqual([])
  })

  it('computes percentiles over full reads and counts skips separately', () => {
    for (const ms of [10, 20, 30, 40]) recordStatusRead(ms, false)
    recordStatusRead(2, true)
    recordStatusRead(4, true)

    const { status } = perfSnapshot()
    expect(status.samples).toBe(4)
    expect(status.p50).toBe(20)
    expect(status.p95).toBe(40)
    expect(status.lastMs).toBe(40)
    expect(status.skips).toEqual({ count: 2, avgMs: 3 })
  })

  it('keeps bounded windows', () => {
    for (let i = 0; i < 300; i += 1) recordStatusRead(i, false)
    for (let i = 0; i < 60; i += 1) recordOp(`git:op${String(i)}`, i, true)

    const snapshot = perfSnapshot()
    expect(snapshot.status.samples).toBe(200)
    expect(snapshot.ops).toHaveLength(12)
    expect(snapshot.ops[11]?.channel).toBe('git:op59')
  })

  it('records scan, warm and operations with rounded values', () => {
    recordScan(1234.56, 55)
    recordWarm(4200.4)
    recordOp('git:fetch', 87.654, true)
    recordOp('git:push', 12.1, false)

    const snapshot = perfSnapshot()
    expect(snapshot.scan.lastMs).toBe(1234.6)
    expect(snapshot.scan.lastRepos).toBe(55)
    expect(snapshot.scan.at).not.toBeNull()
    expect(snapshot.warm?.ms).toBe(4200.4)
    expect(snapshot.ops).toEqual([
      { channel: 'git:fetch', ms: 87.7, ok: true, at: expect.any(Number) },
      { channel: 'git:push', ms: 12.1, ok: false, at: expect.any(Number) }
    ])
  })

  it('resets every window', () => {
    recordStatusRead(10, false)
    recordStatusRead(1, true)
    recordOp('git:fetch', 5, true)
    recordScan(5, 1)
    recordWarm(5)

    resetPerfMetrics()

    const snapshot = perfSnapshot()
    expect(snapshot.status.samples).toBe(0)
    expect(snapshot.status.skips.count).toBe(0)
    expect(snapshot.ops).toEqual([])
    expect(snapshot.scan.at).toBeNull()
    expect(snapshot.warm).toBeNull()
  })
})
