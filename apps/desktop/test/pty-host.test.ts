import { describe, expect, it } from 'vitest'
import type { TerminalClientFrame, TerminalHostFrame } from '@gitreedesk/shared'
import { PtyHost, type PtyProcess, type SessionPort } from '../src/pty-host/host'
import type { HostControlEvent, PtyCreateRequest } from '../src/pty-host/protocol'

class FakePty implements PtyProcess {
  written: string[] = []
  resizes: Array<[number, number]> = []
  killed = false
  private dataListener: ((data: string) => void) | null = null
  private exitListener: ((event: { exitCode: number }) => void) | null = null

  onData(listener: (data: string) => void): void {
    this.dataListener = listener
  }

  onExit(listener: (event: { exitCode: number }) => void): void {
    this.exitListener = listener
  }

  write(data: string): void {
    this.written.push(data)
  }

  resize(cols: number, rows: number): void {
    this.resizes.push([cols, rows])
  }

  kill(): void {
    this.killed = true
  }

  emitData(data: string): void {
    this.dataListener?.(data)
  }

  emitExit(code: number): void {
    this.exitListener?.({ exitCode: code })
  }
}

class FakePort implements SessionPort {
  frames: TerminalHostFrame[] = []
  closed = false
  private messageHandler: ((frame: TerminalClientFrame) => void) | null = null
  private closeHandler: (() => void) | null = null

  post(frame: TerminalHostFrame): void {
    this.frames.push(frame)
  }

  onMessage(handler: (frame: TerminalClientFrame) => void): void {
    this.messageHandler = handler
  }

  onClose(handler: () => void): void {
    this.closeHandler = handler
  }

  close(): void {
    this.closed = true
    this.closeHandler?.()
  }

  send(frame: TerminalClientFrame): void {
    this.messageHandler?.(frame)
  }

  text(): string {
    const decoder = new TextDecoder()
    return this.frames
      .filter((frame): frame is { t: 'data'; data: Uint8Array } => frame.t === 'data')
      .map((frame) => decoder.decode(frame.data))
      .join('')
  }
}

interface Harness {
  host: PtyHost
  events: HostControlEvent[]
  ptys: Map<string, FakePty>
  spawnCalls: Array<{ shell: string; args: readonly string[]; env: Record<string, string>; cwd: string }>
}

function harness(options: { replayBytes?: number; failSpawn?: boolean } = {}): Harness {
  const events: HostControlEvent[] = []
  const ptys = new Map<string, FakePty>()
  const spawnCalls: Harness['spawnCalls'] = []
  const host = new PtyHost({
    spawn: (spawnOptions) => {
      spawnCalls.push({
        shell: spawnOptions.shell,
        args: spawnOptions.args,
        env: spawnOptions.env,
        cwd: spawnOptions.cwd
      })
      if (options.failSpawn === true) throw new Error('spawn failed')
      let pty = ptys.get(spawnOptions.shell)
      if (pty === undefined) {
        pty = new FakePty()
        ptys.set(spawnOptions.shell, pty)
      }
      return pty
    },
    onEvent: (event) => events.push(event),
    replayBytes: options.replayBytes
  })
  return { host, events, ptys, spawnCalls }
}

function request(overrides: Partial<PtyCreateRequest> = {}): PtyCreateRequest {
  return {
    id: 's1',
    shell: 'sh',
    args: ['-l'],
    env: { TERM: 'xterm-256color' },
    cwd: '/ws',
    cols: 80,
    rows: 24,
    workspaceRoot: '/ws',
    repoRoot: null,
    ...overrides
  }
}

describe('PtyHost', () => {
  it('creates a session and reports it', () => {
    const { host, events, spawnCalls } = harness()
    host.create(request())

    expect(events).toEqual([{ t: 'created', id: 's1' }])
    expect(spawnCalls[0]).toMatchObject({ shell: 'sh', args: ['-l'], cwd: '/ws' })
  })

  it('reports spawn failures instead of throwing', () => {
    const { host, events } = harness({ failSpawn: true })
    host.create(request())

    expect(events).toEqual([{ t: 'create-failed', id: 's1', message: 'spawn failed' }])
  })

  it('rejects a duplicate session id', () => {
    const { host, events } = harness()
    host.create(request())
    host.create(request())

    expect(events).toEqual([
      { t: 'created', id: 's1' },
      { t: 'create-failed', id: 's1', message: 'session already exists' }
    ])
  })

  it('replays buffered output on attach, then streams live', () => {
    const { host, ptys } = harness()
    host.create(request())
    const pty = ptys.get('sh')
    pty?.emitData('early output ')

    const port = new FakePort()
    host.attach('s1', port)
    expect(port.text()).toBe('early output ')

    pty?.emitData('live')
    expect(port.text()).toBe('early output live')
  })

  it('caps the replay buffer at the configured size', () => {
    const { host, ptys } = harness({ replayBytes: 8 })
    host.create(request())
    const pty = ptys.get('sh')
    pty?.emitData('0123456789')
    pty?.emitData('ABCDEF')

    const port = new FakePort()
    host.attach('s1', port)
    expect(port.text()).toBe('89ABCDEF')
  })

  it('writes input and applies resizes', () => {
    const { host, ptys } = harness()
    host.create(request())
    const port = new FakePort()
    host.attach('s1', port)

    port.send({ t: 'input', data: 'ls\r' })
    port.send({ t: 'resize', cols: 120, rows: 40 })
    port.send({ t: 'resize', cols: 0, rows: 0 })

    const pty = ptys.get('sh')
    expect(pty?.written).toEqual(['ls\r'])
    expect(pty?.resizes).toEqual([[120, 40]])
  })

  it('stops delivering input after exit but keeps the transcript', () => {
    const { host, events, ptys } = harness()
    host.create(request())
    const port = new FakePort()
    host.attach('s1', port)

    ptys.get('sh')?.emitData('done\r\n')
    ptys.get('sh')?.emitExit(0)

    expect(events).toContainEqual({ t: 'exited', id: 's1', code: 0 })
    expect(port.frames.at(-1)).toEqual({ t: 'exit', code: 0 })

    port.send({ t: 'input', data: 'x' })
    expect(ptys.get('sh')?.written).toEqual([])
  })

  it('replays the transcript and the exit to a late attachment', () => {
    const { host, ptys } = harness()
    host.create(request())
    ptys.get('sh')?.emitData('bye')
    ptys.get('sh')?.emitExit(3)

    const port = new FakePort()
    host.attach('s1', port)
    expect(port.text()).toBe('bye')
    expect(port.frames.at(-1)).toEqual({ t: 'exit', code: 3 })
  })

  it('closes the port of an unknown session', () => {
    const { host } = harness()
    const port = new FakePort()
    host.attach('missing', port)
    expect(port.closed).toBe(true)
  })

  it('replaces an existing attachment', () => {
    const { host, ptys } = harness()
    host.create(request())
    const first = new FakePort()
    const second = new FakePort()
    host.attach('s1', first)
    host.attach('s1', second)

    expect(first.closed).toBe(true)
    ptys.get('sh')?.emitData('x')
    expect(second.text()).toBe('x')
    expect(first.text()).toBe('')
  })

  it('detaches a closed port without losing the buffer', () => {
    const { host, ptys } = harness()
    host.create(request())
    const port = new FakePort()
    host.attach('s1', port)
    port.close()

    ptys.get('sh')?.emitData('after close')
    const next = new FakePort()
    host.attach('s1', next)
    expect(next.text()).toBe('after close')
  })

  it('kills the process on kill and dispose', () => {
    const { host, ptys } = harness()
    host.create(request())
    host.kill('s1')
    expect(ptys.get('sh')?.killed).toBe(true)

    const port = new FakePort()
    host.attach('s1', port)
    host.dispose('s1')
    expect(port.closed).toBe(true)

    const orphan = new FakePort()
    host.attach('s1', orphan)
    expect(orphan.closed).toBe(true)
  })

  it('kills every session on shutdown', () => {
    const { host, ptys } = harness()
    host.create(request({ id: 'one', shell: 'sh' }))
    host.create(request({ id: 'two', shell: 'bash' }))
    host.shutdown()

    expect(ptys.get('sh')?.killed).toBe(true)
    expect(ptys.get('bash')?.killed).toBe(true)
  })
})
