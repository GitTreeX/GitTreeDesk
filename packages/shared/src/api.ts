import type { GitVersionInfo } from './git'
import type { EventChannel, EventMap, InvokeChannel, InvokeMap } from './ipc'

export type Platform =
  | 'aix'
  | 'android'
  | 'darwin'
  | 'freebsd'
  | 'haiku'
  | 'linux'
  | 'openbsd'
  | 'sunos'
  | 'win32'
  | 'cygwin'
  | 'netbsd'

export interface RuntimeVersions {
  electron: string
  chrome: string
  node: string
}

export interface AppInfo {
  platform: Platform
  versions: RuntimeVersions
  /** `null` when no git binary responded. */
  gitVersion: GitVersionInfo | null
}

export interface IpcErrorInfo {
  /** Stable machine-readable code, e.g. `invalid-request`, `not-open`. */
  code: string
  message: string
  /** Raw git output for the troubleshooting drawer, when available. */
  details?: string
}

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: IpcErrorInfo }

/** Thrown by {@link gtdApiFromTransport} when an invoke fails. */
export class GtdIpcError extends Error {
  readonly code: string
  /** Raw git output for the troubleshooting drawer; empty when unavailable. */
  readonly details: string

  constructor(code: string, message: string, details?: string) {
    super(message)
    this.name = 'GtdIpcError'
    this.code = code
    this.details = details ?? ''
  }
}

type InvokeArgs<K extends InvokeChannel> = InvokeMap[K]['request'] extends undefined
  ? []
  : [request: InvokeMap[K]['request']]

/**
 * The raw bridge exposed by the preload script. It only moves structured-cloneable
 * data: results travel as {@link IpcResult} envelopes, because crossing the
 * context bridge drops custom properties from thrown errors.
 */
export interface GtdTransport {
  readonly platform: Platform
  readonly versions: RuntimeVersions
  invokeRaw<K extends InvokeChannel>(
    channel: K,
    request: InvokeMap[K]['request']
  ): Promise<IpcResult<InvokeMap[K]['response']>>
  /** Subscribes to a broadcast event; returns the unsubscribe function. */
  on<K extends EventChannel>(channel: K, listener: (payload: EventMap[K]) => void): () => void
  /** Resolves the absolute path of a dropped `File`; empty string when unavailable. */
  getPathForFile(file: unknown): string
}

/** The API the renderer works with: invokes reject with a {@link GtdIpcError}. */
export interface GtdApi {
  readonly platform: Platform
  readonly versions: RuntimeVersions
  invoke<K extends InvokeChannel>(channel: K, ...args: InvokeArgs<K>): Promise<InvokeMap[K]['response']>
  /** Subscribes to a broadcast event; returns the unsubscribe function. */
  on<K extends EventChannel>(channel: K, listener: (payload: EventMap[K]) => void): () => void
  /** Resolves the absolute path of a dropped `File`; empty string when unavailable. */
  getPathForFile(file: unknown): string
}

/**
 * Rebuilds the throwing API from the transport. Call it in the renderer world:
 * the error is constructed there, so `instanceof GtdIpcError` and its `code`
 * survive (they would not across the context bridge).
 */
export function gtdApiFromTransport(transport: GtdTransport): GtdApi {
  const invoke = (async (channel: InvokeChannel, request: unknown): Promise<unknown> => {
    const result = await transport.invokeRaw(channel as never, request as never)
    if (!result.ok) {
      throw new GtdIpcError(result.error.code, result.error.message, result.error.details)
    }
    return result.value
  }) as GtdApi['invoke']

  return {
    platform: transport.platform,
    versions: transport.versions,
    invoke,
    on: transport.on,
    getPathForFile: (file) => transport.getPathForFile(file)
  }
}
