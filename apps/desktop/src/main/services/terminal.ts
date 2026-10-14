import { randomUUID } from 'node:crypto'
import type {
  TerminalQuickRunRequest,
  TerminalProfileInfo,
  TerminalResolutionInfo,
  TerminalResolveRequest,
  TerminalSessionCreateRequest,
  TerminalSessionInfo,
  TerminalSessionRefRequest,
  TerminalSessionsResponse,
  TerminalSessionCreateResponse,
  TerminalWriteRequest,
  TerminalResizeRequest,
  TerminalHostFrame,
  TerminalClientFrame
} from '@gitreedesk/shared'
import {
  applyCwdTemplate,
  collectTerminalConfigs,
  detectShellProfiles,
  findExecutable,
  normalizePath,
  planQuickCommand,
  resolveTerminal,
  type CwdContext,
  type DetectShellOptions
} from '@gitreedesk/terminal-core'
import { resolveGitInstallRoot } from '@gitreedesk/git-core'
import type { HostControlEvent, HostControlRequest, PtyCreateRequest } from '../../pty-host/protocol'
import { ServiceError } from './errors'

/** One end of a session data channel; the Electron runtime adapts `MessagePortMain`. */
export interface TerminalPort {
  postMessage(message: unknown): void
  onMessage(listener: (message: unknown) => void): void
  start(): void
  close(): void
}

/** Control channel to the pty host; the Electron runtime adapts `UtilityProcess`. */
export interface TerminalHostChild {
  postMessage(message: HostControlRequest, transfer?: readonly TerminalPort[]): void
  onMessage(listener: (message: HostControlEvent) => void): void
  onExit(listener: (code: number) => void): void
  kill(): void
}

export interface TerminalChannel {
  /** Goes to the pty host in the `attach` transfer list. */
  host: TerminalPort
  /** Stays in the main process and streams frames to the renderer. */
  client: TerminalPort
}

/** Process primitives the service needs; the app supplies the Electron ones. */
export interface TerminalRuntime {
  forkHost(): TerminalHostChild
  createChannel(): TerminalChannel
}

/** The workspace facts a terminal session resolves against. */
export interface TerminalWorkspace {
  resolveInside(path: string): Promise<string>
  currentRoot(): string
  findRepoRootFor(dir: string): string | null
  trustQuery(): { trusted: boolean }
  settingsGetEffective(keyPath: readonly string[]): Promise<{ value: unknown }>
}

export type TerminalServiceEvent =
  | { type: 'frame'; id: string; frame: TerminalHostFrame }
  | { type: 'exited'; id: string; code: number | null }

export interface TerminalServiceOptions {
  workspace: TerminalWorkspace
  runtime: TerminalRuntime
  detectProfiles?: (options: DetectShellOptions) => Promise<TerminalProfileInfo[]>
  gitInstallRoot?: (options: { cwd?: string }) => Promise<string | null>
  platform?: NodeJS.Platform
  env?: Record<string, string | undefined>
  emit?: (event: TerminalServiceEvent) => void
  /** How long a session may take to spawn before create fails; default 10 s. */
  createTimeoutMs?: number
}

interface SessionEntry {
  info: TerminalSessionInfo
  port: TerminalPort | null
}

interface PendingCreate {
  /** Resolves the create; a rejection error settles it as failed. */
  settle: (error?: Error) => void
}

interface StartSessionInput {
  shell: string
  args: readonly string[]
  env: Readonly<Record<string, string>>
  cwd: string
  cols: number
  rows: number
  context: CwdContext
  profileId: string
  profileName: string
  icon: string | null
  color: string | null
  quickName: string | null
}

const DEFAULT_CREATE_TIMEOUT_MS = 10_000

/** Terminal sessions over a pty host process: resolution, lifecycle and frame routing. */
export class TerminalService {
  readonly #workspace: TerminalWorkspace
  readonly #runtime: TerminalRuntime
  readonly #detect: (options: DetectShellOptions) => Promise<TerminalProfileInfo[]>
  readonly #gitRootOf: (options: { cwd?: string }) => Promise<string | null>
  readonly #platform: NodeJS.Platform
  readonly #env: Record<string, string | undefined>
  readonly #emit: (event: TerminalServiceEvent) => void
  readonly #createTimeoutMs: number
  readonly #sessions = new Map<string, SessionEntry>()
  readonly #pendingCreates = new Map<string, PendingCreate>()
  #detecting: Promise<TerminalProfileInfo[]> | null = null
  #gitRoot: Promise<string | null> | null = null
  #child: TerminalHostChild | null = null
  #disposed = false

  constructor(options: TerminalServiceOptions) {
    this.#workspace = options.workspace
    this.#runtime = options.runtime
    this.#detect = options.detectProfiles ?? detectShellProfiles
    this.#gitRootOf = options.gitInstallRoot ?? ((config) => resolveGitInstallRoot(config))
    this.#platform = options.platform ?? process.platform
    this.#env = options.env ?? process.env
    this.#emit = options.emit ?? ((): void => undefined)
    this.#createTimeoutMs = options.createTimeoutMs ?? DEFAULT_CREATE_TIMEOUT_MS
  }

  /** Profiles and quick commands that apply to one directory inside the workspace. */
  async resolve(request: TerminalResolveRequest): Promise<TerminalResolutionInfo> {
    this.#assertLive()
    const dir = await this.#workspace.resolveInside(request.dir)
    const workspaceRoot = this.#workspace.currentRoot()
    const [profiles, walk, defaultProfile, trusted] = await Promise.all([
      this.#detectedProfiles(),
      collectTerminalConfigs({ dir, workspaceRoot }),
      this.#defaultProfileSetting(),
      Promise.resolve(this.#workspace.trustQuery().trusted)
    ])
    const resolved = resolveTerminal({
      entries: walk.entries,
      detectedProfiles: profiles,
      settingsDefaultProfile: defaultProfile,
      quickCommandsAllowed: trusted
    })
    return { dir: normalizePath(dir), ...resolved }
  }

  /** Starts an interactive session from one of the resolved profiles. */
  async createSession(
    request: TerminalSessionCreateRequest
  ): Promise<TerminalSessionCreateResponse> {
    const resolution = await this.resolve({ dir: request.dir })
    const profile = resolution.profiles.find((entry) => entry.id === request.profileId)
    if (profile === undefined) {
      throw new ServiceError('unknown-profile', `No terminal profile: ${request.profileId}`)
    }
    const context = this.#cwdContext(resolution.dir)
    const session = await this.#startSession({
      shell: profile.shell,
      args: profile.args,
      env: profile.env,
      cwd: applyCwdTemplate(profile.cwd, context),
      cols: request.cols,
      rows: request.rows,
      context,
      profileId: profile.id,
      profileName: profile.name,
      icon: profile.icon,
      color: profile.color,
      quickName: null
    })
    return { session }
  }

  /** Runs a quick command in a session pinned to its name; never started implicitly. */
  async quickRun(request: TerminalQuickRunRequest): Promise<TerminalSessionCreateResponse> {
    const resolution = await this.resolve({ dir: request.dir })
    const command = resolution.quickCommands.find((entry) => entry.name === request.name)
    if (command === undefined) {
      throw new ServiceError('unknown-command', `No quick command: ${request.name}`)
    }
    const context = this.#cwdContext(resolution.dir)
    const shellProfile = this.#defaultShellProfile(resolution)
    const plan = await planQuickCommand({
      command,
      profile: { shell: shellProfile.shell, args: shellProfile.args },
      context,
      platform: this.#platform,
      resolveExecutable: (name) => findExecutable(name, { platform: this.#platform, env: this.#env })
    })
    const session = await this.#startSession({
      shell: plan.file,
      args: plan.args,
      env: {},
      cwd: plan.cwd,
      cols: request.cols,
      rows: request.rows,
      context,
      profileId: `quick:${command.name}`,
      profileName: command.name,
      icon: null,
      color: null,
      quickName: command.name
    })
    return { session }
  }

  /** Every session this app run started, oldest first; exited ones stay listed. */
  sessions(): TerminalSessionsResponse {
    this.#assertLive()
    return { sessions: [...this.#sessions.values()].map((entry) => entry.info) }
  }

  /**
   * Streams the session to the renderer: replaces any previous attachment and
   * replays the recent output. Called again after a renderer reload.
   */
  attach(request: TerminalSessionRefRequest): null {
    this.#assertLive()
    const entry = this.#requireSession(request.id)
    const child = this.#child
    if (child === null) {
      throw new ServiceError('terminal-unavailable', 'The terminal host is not running')
    }
    const channel = this.#runtime.createChannel()
    channel.client.onMessage((message) => {
      this.#onPortFrame(request.id, message)
    })
    channel.client.start()
    entry.port?.close()
    entry.port = channel.client
    child.postMessage({ t: 'attach', id: request.id }, [channel.host])
    return null
  }

  write(request: TerminalWriteRequest): null {
    const entry = this.#sessions.get(request.id)
    if (entry === undefined || entry.port === null) return null
    entry.port.postMessage({ t: 'input', data: request.data } satisfies TerminalClientFrame)
    return null
  }

  resize(request: TerminalResizeRequest): null {
    const entry = this.#sessions.get(request.id)
    if (entry === undefined || entry.port === null) return null
    const frame: TerminalClientFrame = { t: 'resize', cols: request.cols, rows: request.rows }
    entry.port.postMessage(frame)
    return null
  }

  /** Ends the shell; the session stays listed with its exit code. */
  kill(request: TerminalSessionRefRequest): null {
    this.#assertLive()
    this.#requireSession(request.id)
    this.#child?.postMessage({ t: 'kill', id: request.id })
    return null
  }

  /** Forgets the session entirely; a running shell is killed first. */
  disposeSession(request: TerminalSessionRefRequest): null {
    this.#assertLive()
    const entry = this.#requireSession(request.id)
    this.#sessions.delete(request.id)
    entry.port?.close()
    entry.port = null
    this.#child?.postMessage({ t: 'dispose', id: request.id })
    return null
  }

  /** Kills the host and every session; called when the app quits. */
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    const child = this.#child
    this.#child = null
    const error = new ServiceError('terminal-unavailable', 'The terminal service shut down')
    for (const pending of this.#pendingCreates.values()) pending.settle(error)
    this.#pendingCreates.clear()
    for (const entry of this.#sessions.values()) entry.port?.close()
    this.#sessions.clear()
    if (child !== null) {
      child.postMessage({ t: 'shutdown' })
      child.kill()
    }
  }

  async #startSession(input: StartSessionInput): Promise<TerminalSessionInfo> {
    const id = randomUUID()
    const child = this.#ensureChild()
    const request: PtyCreateRequest = {
      id,
      shell: input.shell,
      args: input.args,
      env: input.env,
      cwd: input.cwd,
      cols: input.cols,
      rows: input.rows,
      workspaceRoot: input.context.workspaceRoot,
      repoRoot: input.context.repoRoot
    }
    await this.#requestCreate(child, request)
    const info: TerminalSessionInfo = {
      id,
      cwd: input.cwd,
      profileId: input.profileId,
      profileName: input.profileName,
      icon: input.icon,
      color: input.color,
      quickName: input.quickName,
      running: true,
      exitCode: null
    }
    this.#sessions.set(id, { info, port: null })
    return info
  }

  #requestCreate(child: TerminalHostChild, request: PtyCreateRequest): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pendingCreates.delete(request.id)
        reject(new ServiceError('terminal-failed', 'The terminal did not start in time'))
      }, this.#createTimeoutMs)
      this.#pendingCreates.set(request.id, {
        settle: (error?: Error) => {
          clearTimeout(timer)
          this.#pendingCreates.delete(request.id)
          if (error === undefined) resolve()
          else reject(error)
        }
      })
      child.postMessage({ t: 'create', ...request })
    })
  }

  #ensureChild(): TerminalHostChild {
    if (this.#child !== null) return this.#child
    const child = this.#runtime.forkHost()
    child.onMessage((message) => {
      this.#onHostEvent(message)
    })
    child.onExit((code) => {
      this.#onHostExit(code)
    })
    this.#child = child
    return child
  }

  #onHostEvent(message: HostControlEvent): void {
    switch (message.t) {
      case 'created':
        this.#pendingCreates.get(message.id)?.settle()
        break
      case 'create-failed':
        this.#pendingCreates
          .get(message.id)
          ?.settle(new ServiceError('terminal-failed', message.message))
        break
      case 'exited': {
        const entry = this.#sessions.get(message.id)
        if (entry === undefined) break
        entry.info = { ...entry.info, running: false, exitCode: message.code }
        this.#emit({ type: 'exited', id: message.id, code: message.code })
        break
      }
    }
  }

  #onHostExit(code: number): void {
    this.#child = null
    if (this.#disposed) return
    const error = new ServiceError('terminal-failed', `The terminal host exited (code ${code})`)
    for (const pending of [...this.#pendingCreates.values()]) pending.settle(error)
    for (const entry of this.#sessions.values()) {
      entry.port?.close()
      entry.port = null
      if (!entry.info.running) continue
      entry.info = { ...entry.info, running: false, exitCode: null }
      this.#emit({ type: 'exited', id: entry.info.id, code: null })
    }
  }

  /** Only data frames are forwarded; exit state travels as the `exited` event. */
  #onPortFrame(id: string, message: unknown): void {
    const frame = message as TerminalHostFrame
    if (frame.t !== 'data') return
    this.#emit({ type: 'frame', id, frame })
  }

  #requireSession(id: string): SessionEntry {
    const entry = this.#sessions.get(id)
    if (entry === undefined) {
      throw new ServiceError('unknown-session', `No terminal session: ${id}`)
    }
    return entry
  }

  /** The profile a plain terminal would start with; used for `shellCommand` quick commands. */
  #defaultShellProfile(resolution: TerminalResolutionInfo): TerminalProfileInfo {
    const byDefault = resolution.profiles.find((entry) => entry.id === resolution.defaultProfile)
    const profile = byDefault ?? resolution.profiles[0]
    if (profile === undefined) {
      throw new ServiceError('no-profiles', 'No shell profile is available')
    }
    return profile
  }

  #cwdContext(dir: string): CwdContext {
    return {
      dir,
      repoRoot: this.#workspace.findRepoRootFor(dir),
      workspaceRoot: this.#workspace.currentRoot()
    }
  }

  #detectedProfiles(): Promise<TerminalProfileInfo[]> {
    this.#detecting ??= this.#detectNow().catch((error: unknown) => {
      this.#detecting = null
      throw error
    })
    return this.#detecting
  }

  async #detectNow(): Promise<TerminalProfileInfo[]> {
    return this.#detect({
      platform: this.#platform,
      env: this.#env,
      gitInstallRoot: await this.#gitInstallRoot()
    })
  }

  #gitInstallRoot(): Promise<string | null> {
    this.#gitRoot ??= this.#gitRootOf({}).catch(() => null)
    return this.#gitRoot
  }

  async #defaultProfileSetting(): Promise<string | null> {
    const { value } = await this.#workspace.settingsGetEffective(['terminal', 'defaultProfile'])
    return typeof value === 'string' && value.length > 0 ? value : null
  }

  #assertLive(): void {
    if (this.#disposed) throw new ServiceError('disposed', 'The terminal service has been disposed')
  }
}
