import type { TerminalClientFrame, TerminalHostFrame } from '@gitreedesk/shared'
import type { HostControlEvent, PtyCreateRequest } from './protocol'

/** The slice of node-pty's `IPty` the host uses. */
export interface PtyProcess {
  onData(listener: (data: string) => void): void
  onExit(listener: (event: { exitCode: number }) => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

export type PtySpawn = (options: {
  shell: string
  args: readonly string[]
  env: Record<string, string>
  cwd: string
  cols: number
  rows: number
}) => PtyProcess

/** One end of a session data channel; the Electron entry adapts `MessagePortMain` to this. */
export interface SessionPort {
  post(frame: TerminalHostFrame): void
  onMessage(handler: (frame: TerminalClientFrame) => void): void
  onClose(handler: () => void): void
  close(): void
}

/** Bytes of recent output replayed to a fresh attachment (renderer reloads). */
export const DEFAULT_REPLAY_BYTES = 512 * 1024

interface Session {
  process: PtyProcess | null
  port: SessionPort | null
  chunks: Uint8Array[]
  bytes: number
  running: boolean
  exitCode: number | null
}

export interface PtyHostOptions {
  spawn: PtySpawn
  onEvent: (event: HostControlEvent) => void
  replayBytes?: number
  encode?: (text: string) => Uint8Array
}

/** Owns pty sessions: spawn, stream, replay and teardown. Lives in the pty host process. */
export class PtyHost {
  private readonly spawn: PtySpawn
  private readonly onEvent: (event: HostControlEvent) => void
  private readonly replayBytes: number
  private readonly encode: (text: string) => Uint8Array
  private readonly sessions = new Map<string, Session>()

  constructor(options: PtyHostOptions) {
    this.spawn = options.spawn
    this.onEvent = options.onEvent
    this.replayBytes = options.replayBytes ?? DEFAULT_REPLAY_BYTES
    this.encode = options.encode ?? ((text) => new TextEncoder().encode(text))
  }

  create(request: PtyCreateRequest): void {
    if (this.sessions.has(request.id)) {
      this.onEvent({ t: 'create-failed', id: request.id, message: 'session already exists' })
      return
    }

    let process: PtyProcess
    try {
      process = this.spawn({
        shell: request.shell,
        args: request.args,
        env: { ...request.env },
        cwd: request.cwd,
        cols: Math.max(2, request.cols),
        rows: Math.max(1, request.rows)
      })
    } catch (error) {
      this.onEvent({
        t: 'create-failed',
        id: request.id,
        message: error instanceof Error ? error.message : String(error)
      })
      return
    }

    const session: Session = { process, port: null, chunks: [], bytes: 0, running: true, exitCode: null }
    this.sessions.set(request.id, session)
    process.onData((data) => {
      this.pushOutput(session, data)
    })
    process.onExit((event) => {
      this.registerExit(request.id, session, event.exitCode)
    })
    this.onEvent({ t: 'created', id: request.id })
  }

  attach(id: string, port: SessionPort): void {
    const session = this.sessions.get(id)
    if (session === undefined) {
      port.close()
      return
    }

    session.port?.close()
    session.port = port
    port.onMessage((frame) => {
      this.handleClientFrame(session, frame)
    })
    port.onClose(() => {
      if (session.port === port) session.port = null
    })

    const replay = this.collectReplay(session)
    if (replay !== null) port.post({ t: 'data', data: replay })
    if (!session.running) port.post({ t: 'exit', code: session.exitCode })
  }

  kill(id: string): void {
    this.sessions.get(id)?.process?.kill()
  }

  dispose(id: string): void {
    const session = this.sessions.get(id)
    if (session === undefined) return
    session.process?.kill()
    session.port?.close()
    this.sessions.delete(id)
  }

  shutdown(): void {
    for (const session of this.sessions.values()) {
      session.process?.kill()
      session.port?.close()
    }
    this.sessions.clear()
  }

  private handleClientFrame(session: Session, frame: TerminalClientFrame): void {
    const process = session.process
    if (process === null) return
    if (frame.t === 'input') {
      process.write(frame.data)
      return
    }
    if (frame.cols > 0 && frame.rows > 0) {
      process.resize(frame.cols, frame.rows)
    }
  }

  private pushOutput(session: Session, data: string): void {
    const chunk = this.encode(data)
    session.chunks.push(chunk)
    session.bytes += chunk.byteLength
    while (session.bytes > this.replayBytes && session.chunks.length > 0) {
      const first = session.chunks[0] as Uint8Array
      const excess = session.bytes - this.replayBytes
      if (first.byteLength <= excess) {
        session.chunks.shift()
        session.bytes -= first.byteLength
      } else {
        session.chunks[0] = first.subarray(excess)
        session.bytes -= excess
      }
    }
    session.port?.post({ t: 'data', data: chunk })
  }

  private registerExit(id: string, session: Session, code: number | null): void {
    session.running = false
    session.exitCode = code
    session.process = null
    session.port?.post({ t: 'exit', code })
    this.onEvent({ t: 'exited', id, code })
  }

  private collectReplay(session: Session): Uint8Array | null {
    if (session.bytes === 0) return null
    const data = new Uint8Array(session.bytes)
    let offset = 0
    for (const chunk of session.chunks) {
      data.set(chunk, offset)
      offset += chunk.byteLength
    }
    return data
  }
}
