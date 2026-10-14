import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  TerminalProfileInfo,
  TerminalResolutionInfo,
  TerminalSessionInfo
} from '@gitreedesk/shared'
import type { DetectShellOptions } from '@gitreedesk/terminal-core'
import type {
  HostControlEvent,
  HostControlRequest
} from '../src/pty-host/protocol'
import { ServiceError } from '../src/main/services/errors'
import {
  TerminalService,
  type TerminalChannel,
  type TerminalHostChild,
  type TerminalPort,
  type TerminalRuntime,
  type TerminalServiceEvent,
  type TerminalWorkspace
} from '../src/main/services/terminal'

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class FakePort implements TerminalPort {
  readonly sent: unknown[] = []
  closed = false
  started = false
  #listeners: ((message: unknown) => void)[] = []

  postMessage(message: unknown): void {
    this.sent.push(message)
  }

  onMessage(listener: (message: unknown) => void): void {
    this.#listeners.push(listener)
  }

  start(): void {
    this.started = true
  }

  close(): void {
    this.closed = true
  }

  deliver(message: unknown): void {
    for (const listener of this.#listeners) listener(message)
  }
}

type CreateMessage = Extract<HostControlRequest, { t: 'create' }>

class FakeHostChild implements TerminalHostChild {
  readonly messages: { message: HostControlRequest; transfer: readonly TerminalPort[] }[] = []
  killed = false
  #onMessage: ((message: HostControlEvent) => void) | null = null
  #onExit: ((code: number) => void) | null = null

  postMessage(message: HostControlRequest, transfer?: readonly TerminalPort[]): void {
    this.messages.push({ message, transfer: transfer ?? [] })
  }

  onMessage(listener: (message: HostControlEvent) => void): void {
    this.#onMessage = listener
  }

  onExit(listener: (code: number) => void): void {
    this.#onExit = listener
  }

  kill(): void {
    this.killed = true
  }

  emit(message: HostControlEvent): void {
    this.#onMessage?.(message)
  }

  emitExit(code: number): void {
    this.#onExit?.(code)
  }

  creates(): CreateMessage[] {
    return this.messages
      .map((entry) => entry.message)
      .filter((message): message is CreateMessage => message.t === 'create')
  }

  ofType(t: HostControlRequest['t']): HostControlRequest[] {
    return this.messages.map((entry) => entry.message).filter((message) => message.t === t)
  }
}

class FakeRuntime implements TerminalRuntime {
  readonly children: FakeHostChild[] = []
  readonly channels: { host: FakePort; client: FakePort }[] = []

  forkHost(): FakeHostChild {
    const child = new FakeHostChild()
    this.children.push(child)
    return child
  }

  createChannel(): TerminalChannel {
    const channel = { host: new FakePort(), client: new FakePort() }
    this.channels.push(channel)
    return channel
  }

  get lastChannel(): { host: FakePort; client: FakePort } {
    return this.channels[this.channels.length - 1] as { host: FakePort; client: FakePort }
  }
}

interface WorkspaceOptions {
  root: string
  repoRoot?: string | null
  trusted?: boolean
  defaultProfile?: string | null
  outside?: boolean
}

function fakeWorkspace(options: WorkspaceOptions): TerminalWorkspace {
  return {
    resolveInside: async (path) => {
      if (options.outside === true) {
        throw new ServiceError('outside-workspace', `Path is outside the workspace: ${path}`)
      }
      return path.replace(/\\/g, '/')
    },
    currentRoot: () => options.root.replace(/\\/g, '/'),
    findRepoRootFor: () => (options.repoRoot === undefined ? null : options.repoRoot),
    trustQuery: () => ({ trusted: options.trusted ?? true }),
    settingsGetEffective: async () => ({ value: options.defaultProfile ?? undefined })
  }
}

const detectedProfile: TerminalProfileInfo = {
  id: 'pwsh',
  name: 'PowerShell 7',
  shell: 'pwsh',
  args: ['-NoLogo'],
  env: {},
  cwd: null,
  icon: null,
  color: null,
  origin: 'detected'
}

interface Harness {
  service: TerminalService
  runtime: FakeRuntime
  events: TerminalServiceEvent[]
  detectCalls: DetectShellOptions[]
}

function harness(options: {
  workspace: TerminalWorkspace
  detect?: TerminalProfileInfo[]
  platform?: NodeJS.Platform
  env?: Record<string, string | undefined>
  gitInstallRoot?: string | null
  createTimeoutMs?: number
}): Harness {
  const runtime = new FakeRuntime()
  const events: TerminalServiceEvent[] = []
  const detectCalls: DetectShellOptions[] = []
  const service = new TerminalService({
    workspace: options.workspace,
    runtime,
    detectProfiles: async (detectOptions) => {
      detectCalls.push(detectOptions)
      return options.detect ?? [detectedProfile]
    },
    gitInstallRoot: async () => options.gitInstallRoot ?? null,
    platform: options.platform ?? 'linux',
    env: options.env ?? {},
    createTimeoutMs: options.createTimeoutMs ?? 5_000,
    emit: (event) => events.push(event)
  })
  return { service, runtime, events, detectCalls }
}

async function expectServiceError(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason
  )
  expect(error).toBeInstanceOf(ServiceError)
  expect((error as ServiceError).code).toBe(code)
}

async function waitForCreate(
  runtime: FakeRuntime,
  childIndex = 0
): Promise<{ child: FakeHostChild; create: CreateMessage }> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const child = runtime.children[childIndex]
    const create = child?.creates()[0]
    if (child !== undefined && create !== undefined) return { child, create }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('no create request reached the host')
}

async function startSession(
  service: TerminalService,
  runtime: FakeRuntime,
  request: { dir: string; profileId: string; cols?: number; rows?: number }
): Promise<TerminalSessionInfo> {
  const pending = service.createSession({
    dir: request.dir,
    profileId: request.profileId,
    cols: request.cols ?? 80,
    rows: request.rows ?? 24
  })
  const { child, create } = await waitForCreate(runtime)
  child.emit({ t: 'created', id: create.id })
  const { session } = await pending
  return session
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const CONFIG = JSON.stringify({
  defaultProfile: 'dev',
  profiles: [
    { name: 'dev', shell: 'pwsh', args: ['-NoLogo'], env: { NODE_ENV: 'development' } }
  ],
  quickCommands: [
    { name: 'pnpm dev', command: 'pnpm', args: ['dev'], cwd: '{repoRoot}' },
    { name: 'make', command: 'make', args: ['all'], shellCommand: true }
  ]
})

let dirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gtd-terminal-'))
  dirs.push(dir)
  return dir
}

async function workspaceWithConfig(): Promise<{ dir: string; posix: string }> {
  const dir = await tempDir()
  await mkdir(join(dir, '.gitreedesk'), { recursive: true })
  await writeFile(join(dir, '.gitreedesk', 'terminal.json'), CONFIG, 'utf8')
  return { dir, posix: dir.replace(/\\/g, '/') }
}

afterEach(async () => {
  for (const dir of dirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
  dirs = []
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TerminalService.resolve', () => {
  it('merges detected profiles with terminal.json for the target directory', async () => {
    const { posix } = await workspaceWithConfig()
    const { service } = harness({ workspace: fakeWorkspace({ root: posix, repoRoot: posix }) })

    const resolution: TerminalResolutionInfo = await service.resolve({ dir: posix })

    expect(resolution.dir).toBe(posix)
    expect(resolution.defaultProfile).toBe('dev')
    expect(resolution.profiles.map((profile) => profile.id)).toEqual(['pwsh', 'dev'])
    expect(resolution.profiles.find((profile) => profile.id === 'dev')?.origin).toBe('config')
    expect(resolution.quickCommands.map((command) => command.name)).toEqual(['pnpm dev', 'make'])
  })

  it('drops quick commands entirely in an untrusted workspace', async () => {
    const { posix } = await workspaceWithConfig()
    const { service } = harness({
      workspace: fakeWorkspace({ root: posix, trusted: false })
    })

    const resolution = await service.resolve({ dir: posix })

    expect(resolution.quickCommands).toEqual([])
    expect(resolution.profiles.map((profile) => profile.id)).toContain('dev')
  })

  it('falls back to the settings default profile when no file sets one', async () => {
    const dir = await tempDir()
    const posix = dir.replace(/\\/g, '/')
    const { service } = harness({
      workspace: fakeWorkspace({ root: posix, defaultProfile: 'pwsh' })
    })

    const resolution = await service.resolve({ dir: posix })

    expect(resolution.defaultProfile).toBe('pwsh')
  })

  it('passes the git install root into shell detection and caches detection', async () => {
    const dir = await tempDir()
    const posix = dir.replace(/\\/g, '/')
    const { service, detectCalls } = harness({
      workspace: fakeWorkspace({ root: posix }),
      gitInstallRoot: 'C:/Program Files/Git'
    })

    await service.resolve({ dir: posix })
    await service.resolve({ dir: posix })

    expect(detectCalls).toHaveLength(1)
    expect(detectCalls[0]?.gitInstallRoot).toBe('C:/Program Files/Git')
  })

  it('rejects directories outside the workspace', async () => {
    const dir = await tempDir()
    const { service } = harness({
      workspace: fakeWorkspace({ root: dir.replace(/\\/g, '/'), outside: true })
    })

    await expectServiceError(service.resolve({ dir: '/elsewhere' }), 'outside-workspace')
  })
})

describe('TerminalService.createSession', () => {
  it('starts the resolved profile with its env and cwd template', async () => {
    const { posix } = await workspaceWithConfig()
    const { service, runtime } = harness({
      workspace: fakeWorkspace({ root: posix, repoRoot: posix })
    })

    const pending = service.createSession({ dir: posix, profileId: 'dev', cols: 100, rows: 30 })
    const { child, create } = await waitForCreate(runtime)
    expect(create).toMatchObject({
      shell: 'pwsh',
      args: ['-NoLogo'],
      env: { NODE_ENV: 'development' },
      cwd: posix,
      cols: 100,
      rows: 30,
      workspaceRoot: posix,
      repoRoot: posix
    })
    child.emit({ t: 'created', id: create.id })

    const { session } = await pending
    expect(session).toMatchObject({
      id: create.id,
      cwd: posix,
      profileId: 'dev',
      profileName: 'dev',
      quickName: null,
      running: true,
      exitCode: null
    })
    expect(service.sessions().sessions).toEqual([session])
  })

  it('applies the profile cwd template against the repo root', async () => {
    const dir = await tempDir()
    const posix = dir.replace(/\\/g, '/')
    await mkdir(join(dir, '.gitreedesk'), { recursive: true })
    await writeFile(
      join(dir, '.gitreedesk', 'terminal.json'),
      JSON.stringify({
        profiles: [{ name: 'repo', shell: 'pwsh', cwd: '{repoRoot}', args: [] }]
      }),
      'utf8'
    )
    const { service, runtime } = harness({
      workspace: fakeWorkspace({ root: posix, repoRoot: `${posix}/work` })
    })

    const pending = service.createSession({ dir: posix, profileId: 'repo', cols: 80, rows: 24 })
    const { child, create } = await waitForCreate(runtime)
    child.emit({ t: 'created', id: create.id })
    await pending

    expect(create.cwd).toBe(`${posix}/work`)
  })

  it('fails with unknown-profile for a profile the resolution does not offer', async () => {
    const { posix } = await workspaceWithConfig()
    const { service, runtime } = harness({ workspace: fakeWorkspace({ root: posix }) })

    await expectServiceError(
      service.createSession({ dir: posix, profileId: 'nope', cols: 80, rows: 24 }),
      'unknown-profile'
    )
    expect(runtime.children).toHaveLength(0)
  })

  it('surfaces a spawn failure from the host and lists no session', async () => {
    const { posix } = await workspaceWithConfig()
    const { service, runtime } = harness({ workspace: fakeWorkspace({ root: posix }) })

    const pending = service.createSession({ dir: posix, profileId: 'dev', cols: 80, rows: 24 })
    const { child, create } = await waitForCreate(runtime)
    child.emit({ t: 'create-failed', id: create.id, message: 'File not found: pwsh' })

    await expectServiceError(pending, 'terminal-failed')
    expect(service.sessions().sessions).toEqual([])
  })

  it('fails when the host never confirms the session', async () => {
    const { posix } = await workspaceWithConfig()
    const { service } = harness({
      workspace: fakeWorkspace({ root: posix }),
      createTimeoutMs: 25
    })

    await expectServiceError(
      service.createSession({ dir: posix, profileId: 'dev', cols: 80, rows: 24 }),
      'terminal-failed'
    )
  })
})

describe('TerminalService.quickRun', () => {
  it('runs an argv quick command in the repo root', async () => {
    const { posix } = await workspaceWithConfig()
    const { service, runtime } = harness({
      workspace: fakeWorkspace({ root: posix, repoRoot: `${posix}/work` })
    })

    const pending = service.quickRun({ dir: posix, name: 'pnpm dev', cols: 80, rows: 24 })
    const { child, create } = await waitForCreate(runtime)
    expect(create).toMatchObject({ shell: 'pnpm', args: ['dev'], cwd: `${posix}/work` })
    child.emit({ t: 'created', id: create.id })

    const { session } = await pending
    expect(session.profileName).toBe('pnpm dev')
    expect(session.quickName).toBe('pnpm dev')
  })

  it('runs a shellCommand quick command through the default profile shell', async () => {
    const { posix } = await workspaceWithConfig()
    const { service, runtime } = harness({ workspace: fakeWorkspace({ root: posix }) })

    const pending = service.quickRun({ dir: posix, name: 'make', cols: 80, rows: 24 })
    const { child, create } = await waitForCreate(runtime)
    expect(create.shell).toBe('pwsh')
    expect(create.args).toEqual(['-NoLogo', '-c', 'make all'])
    child.emit({ t: 'created', id: create.id })
    await pending
  })

  it('wraps a Windows batch command through cmd.exe', async () => {
    const dir = await tempDir()
    const posix = dir.replace(/\\/g, '/')
    await mkdir(join(dir, '.gitreedesk'), { recursive: true })
    await writeFile(
      join(dir, '.gitreedesk', 'terminal.json'),
      JSON.stringify({ quickCommands: [{ name: 'tool', command: 'tool.cmd' }] }),
      'utf8'
    )
    await writeFile(join(dir, 'tool.cmd'), '@echo off\r\n', 'utf8')
    const { service, runtime } = harness({
      workspace: fakeWorkspace({ root: posix }),
      platform: 'win32',
      env: { PATH: dir }
    })

    const pending = service.quickRun({ dir: posix, name: 'tool', cols: 80, rows: 24 })
    const { child, create } = await waitForCreate(runtime)
    expect(create.shell).toBe('cmd.exe')
    expect(create.args).toEqual([
      '/d',
      '/s',
      '/c',
      `${win32.join(dir, 'tool.cmd')}`
    ])
    child.emit({ t: 'created', id: create.id })
    await pending
  })

  it('refuses quick commands in an untrusted workspace', async () => {
    const { posix } = await workspaceWithConfig()
    const { service, runtime } = harness({
      workspace: fakeWorkspace({ root: posix, trusted: false })
    })

    await expectServiceError(
      service.quickRun({ dir: posix, name: 'pnpm dev', cols: 80, rows: 24 }),
      'unknown-command'
    )
    expect(runtime.children).toHaveLength(0)
  })
})

describe('TerminalService attach and streaming', () => {
  it('attaches a channel and forwards data frames only', async () => {
    const { posix } = await workspaceWithConfig()
    const { service, runtime, events } = harness({ workspace: fakeWorkspace({ root: posix }) })
    const session = await startSession(service, runtime, { dir: posix, profileId: 'dev' })
    const child = runtime.children[0] as FakeHostChild

    expect(service.attach({ id: session.id })).toBeNull()

    const attach = child.ofType('attach')[0]
    expect(attach).toEqual({ t: 'attach', id: session.id })
    const transfer = child.messages.find((entry) => entry.message.t === 'attach')?.transfer ?? []
    expect(transfer).toHaveLength(1)
    const channel = runtime.lastChannel
    expect(transfer[0]).toBe(channel.host)
    expect(channel.client.started).toBe(true)

    const bytes = new Uint8Array([104, 105])
    channel.client.deliver({ t: 'data', data: bytes })
    channel.client.deliver({ t: 'exit', code: 0 })

    expect(events).toEqual([{ type: 'frame', id: session.id, frame: { t: 'data', data: bytes } }])
  })

  it('replaces the previous attachment on re-attach', async () => {
    const { posix } = await workspaceWithConfig()
    const { service, runtime } = harness({ workspace: fakeWorkspace({ root: posix }) })
    const session = await startSession(service, runtime, { dir: posix, profileId: 'dev' })

    service.attach({ id: session.id })
    const first = runtime.lastChannel
    service.attach({ id: session.id })
    const second = runtime.lastChannel

    expect(first.client.closed).toBe(true)
    expect(second.client.closed).toBe(false)
    expect(runtime.channels).toHaveLength(2)
  })

  it('routes input and resize to the attached port and ignores unknown ids', async () => {
    const { posix } = await workspaceWithConfig()
    const { service, runtime } = harness({ workspace: fakeWorkspace({ root: posix }) })
    const session = await startSession(service, runtime, { dir: posix, profileId: 'dev' })

    service.write({ id: session.id, data: 'ls\r' })
    service.resize({ id: session.id, cols: 90, rows: 20 })
    expect(runtime.channels).toHaveLength(0)

    service.attach({ id: session.id })
    service.write({ id: session.id, data: 'ls\r' })
    service.resize({ id: session.id, cols: 90, rows: 20 })
    service.write({ id: 'missing', data: 'x' })
    service.resize({ id: 'missing', cols: 90, rows: 20 })

    expect(runtime.lastChannel.client.sent).toEqual([
      { t: 'input', data: 'ls\r' },
      { t: 'resize', cols: 90, rows: 20 }
    ])
  })

  it('rejects attach for unknown sessions and a missing host', async () => {
    const { posix } = await workspaceWithConfig()
    const { service, runtime } = harness({ workspace: fakeWorkspace({ root: posix }) })
    const session = await startSession(service, runtime, { dir: posix, profileId: 'dev' })
    service.attach({ id: session.id })

    expect(() => service.attach({ id: 'missing' })).toThrowError(/No terminal session/)
    runtime.children[0]?.emitExit(1)
    expect(() => service.attach({ id: session.id })).toThrowError(/not running/)
  })
})

describe('TerminalService lifecycle', () => {
  it('marks the session exited when the shell ends', async () => {
    const { posix } = await workspaceWithConfig()
    const { service, runtime, events } = harness({ workspace: fakeWorkspace({ root: posix }) })
    const session = await startSession(service, runtime, { dir: posix, profileId: 'dev' })

    runtime.children[0]?.emit({ t: 'exited', id: session.id, code: 7 })

    expect(service.sessions().sessions[0]).toMatchObject({ running: false, exitCode: 7 })
    expect(events).toContainEqual({ type: 'exited', id: session.id, code: 7 })
  })

  it('kills the shell without forgetting the session', async () => {
    const { posix } = await workspaceWithConfig()
    const { service, runtime } = harness({ workspace: fakeWorkspace({ root: posix }) })
    const session = await startSession(service, runtime, { dir: posix, profileId: 'dev' })

    expect(service.kill({ id: session.id })).toBeNull()
    expect(runtime.children[0]?.ofType('kill')).toEqual([{ t: 'kill', id: session.id }])
    expect(service.sessions().sessions).toHaveLength(1)
  })

  it('disposes a session: host notified, port closed, id forgotten', async () => {
    const { posix } = await workspaceWithConfig()
    const { service, runtime } = harness({ workspace: fakeWorkspace({ root: posix }) })
    const session = await startSession(service, runtime, { dir: posix, profileId: 'dev' })
    service.attach({ id: session.id })
    const channel = runtime.lastChannel

    expect(service.disposeSession({ id: session.id })).toBeNull()

    expect(runtime.children[0]?.ofType('dispose')).toEqual([{ t: 'dispose', id: session.id }])
    expect(channel.client.closed).toBe(true)
    expect(service.sessions().sessions).toEqual([])
  })

  it('marks every session dead when the host exits and reforkes on the next create', async () => {
    const { posix } = await workspaceWithConfig()
    const { service, runtime, events } = harness({ workspace: fakeWorkspace({ root: posix }) })
    const session = await startSession(service, runtime, { dir: posix, profileId: 'dev' })
    service.attach({ id: session.id })

    runtime.children[0]?.emitExit(3)

    expect(service.sessions().sessions[0]).toMatchObject({ running: false, exitCode: null })
    expect(events).toContainEqual({ type: 'exited', id: session.id, code: null })
    expect(runtime.lastChannel.client.closed).toBe(true)

    const next = service.createSession({ dir: posix, profileId: 'dev', cols: 80, rows: 24 })
    const { child, create } = await waitForCreate(runtime, 1)
    expect(runtime.children).toHaveLength(2)
    child.emit({ t: 'created', id: create.id })
    await next
  })

  it('shuts the host down on dispose and rejects further calls', async () => {
    const { posix } = await workspaceWithConfig()
    const { service, runtime } = harness({ workspace: fakeWorkspace({ root: posix }) })
    await startSession(service, runtime, { dir: posix, profileId: 'dev' })

    service.dispose()

    const child = runtime.children[0] as FakeHostChild
    expect(child.ofType('shutdown')).toEqual([{ t: 'shutdown' }])
    expect(child.killed).toBe(true)
    expect(() => service.sessions()).toThrowError(/disposed/)
  })
})
