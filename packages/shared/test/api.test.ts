import { describe, expect, it, vi } from 'vitest'
import { GtdIpcError, gtdApiFromTransport, type GtdTransport } from '../src/api'

function transport(overrides: Partial<GtdTransport> = {}): GtdTransport {
  return {
    platform: 'win32',
    versions: { electron: '1', chrome: '2', node: '3' },
    invokeRaw: (async () => ({ ok: true, value: null })) as never,
    on: vi.fn(() => () => undefined) as never,
    ...overrides
  }
}

describe('gtdApiFromTransport', () => {
  it('resolves with the envelope value and exposes runtime facts', async () => {
    const api = gtdApiFromTransport(
      transport({ invokeRaw: (async () => ({ ok: true, value: { workspaces: [] } })) as never })
    )

    await expect(api.invoke('workspace:recent')).resolves.toEqual({ workspaces: [] })
    expect(api.platform).toBe('win32')
    expect(api.versions.node).toBe('3')
  })

  it('throws a GtdIpcError that keeps the code and message', async () => {
    const api = gtdApiFromTransport(
      transport({
        invokeRaw: (async () => ({
          ok: false,
          error: { code: 'not-open', message: 'No workspace is open' }
        })) as never
      })
    )

    const error = await api.invoke('trust:query').catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(GtdIpcError)
    expect(error).toMatchObject({ code: 'not-open', message: 'No workspace is open' })
  })

  it('passes the request through and forwards subscriptions', async () => {
    const invokeRaw = vi.fn(async () => ({ ok: true, value: { keys: [] } }))
    const unsubscribe = (): void => undefined
    const on = vi.fn(() => unsubscribe)
    const api = gtdApiFromTransport(
      transport({ invokeRaw: invokeRaw as never, on: on as never })
    )

    await api.invoke('ui-state:keys', { prefix: 'explorer' })
    expect(invokeRaw).toHaveBeenCalledWith('ui-state:keys', { prefix: 'explorer' })

    const listener = (): void => undefined
    expect(api.on('settings:changed', listener)).toBe(unsubscribe)
    expect(on).toHaveBeenCalledWith('settings:changed', listener)
  })
})
