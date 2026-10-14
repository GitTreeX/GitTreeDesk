import { randomUUID } from 'node:crypto'
import type {
  CommitDraftRequest,
  CommitDraftResponse,
  CommitDraftVariant,
  CommitMessageDoneEvent,
  CommitMessageKeyStatusResponse,
  CommitMessageOutputEvent
} from '@gitreedesk/shared'
import {
  buildDrafts,
  buildPrompt,
  detectConvention,
  discoverCommitlint,
  LlmCancelledError,
  LlmNetworkError,
  LlmTimeoutError,
  streamChatCompletion,
  type ConventionProfile,
  type DraftResult,
  type StagedSummary
} from '@gitreedesk/commit-msg'
import { logCommits, readStagedSummary, resolveCommitTemplate } from '@gitreedesk/git-core'
import { SettingsStore } from '@gitreedesk/store'
import { ServiceError } from './errors'
import { API_KEY_SECRET, type SecretsStore } from './secrets'

export type CommitMessageServiceEvent =
  | { type: 'output'; payload: CommitMessageOutputEvent }
  | { type: 'done'; payload: CommitMessageDoneEvent }

export interface CommitMessageServiceOptions {
  userDataDir: string
  secrets: SecretsStore
  /** Working-tree path for a checkout; throws for unknown git dirs. */
  resolveRepoPath: (gitDir: string) => string
  /** Home directory for `~/.gitmessage` discovery; the OS default when omitted. */
  homeDir?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
  emit?: (event: CommitMessageServiceEvent) => void
}

interface LlmConfig {
  host: string
  baseUrl: string
  model: string
  temperature: number | undefined
  apiKey: string
}

interface Generation {
  gitDir: string
  generationId: string
  controller: AbortController
  summary: StagedSummary
  profile: ConventionProfile
  offline: DraftResult
  config: LlmConfig
}

const RECENT_SUBJECTS = 100

/** Offline commit-message drafts plus streaming LLM generation for the commit box. */
export class CommitMessageService {
  readonly #settings: SettingsStore
  readonly #secrets: SecretsStore
  readonly #resolveRepoPath: (gitDir: string) => string
  readonly #homeDir: string | undefined
  readonly #timeoutMs: number | undefined
  readonly #fetchImpl: typeof fetch | undefined
  readonly #emit: (event: CommitMessageServiceEvent) => void
  readonly #generations = new Map<string, Generation>()

  constructor(options: CommitMessageServiceOptions) {
    this.#settings = new SettingsStore({ userDataDir: options.userDataDir })
    this.#secrets = options.secrets
    this.#resolveRepoPath = options.resolveRepoPath
    this.#homeDir = options.homeDir
    this.#timeoutMs = options.timeoutMs
    this.#fetchImpl = options.fetchImpl
    this.#emit = options.emit ?? ((): void => undefined)
  }

  /**
   * Offline drafts, or a started LLM generation. An unapproved host returns the
   * offline drafts plus the host to confirm; a configured-but-incomplete
   * provider is refused so the settings can be fixed first.
   */
  async generate(request: CommitDraftRequest): Promise<CommitDraftResponse> {
    const repoPath = this.#resolveRepoPath(request.gitDir)
    const summary = await readStagedSummary(repoPath)
    if (summary.files.length === 0) {
      throw new ServiceError('nothing-staged', 'Nothing is staged to describe')
    }
    const profile = await this.#detectProfile(repoPath)
    const offline = buildDrafts({ summary, profile })

    const config = await this.#llmConfig()
    if (config === null) {
      return offlineResponse(offline, null)
    }
    if (!(await this.#isHostApproved(config.host))) {
      return offlineResponse(offline, { host: config.host, approved: false })
    }
    const generation = this.#start(request.gitDir, summary, profile, offline, config)
    return {
      source: 'llm',
      generationId: generation.generationId,
      drafts: [],
      weak: false,
      llm: { host: config.host, approved: true }
    }
  }

  /** Stops a running generation; the stream ends with a `cancelled` event. */
  cancel(generationId: string): null {
    for (const generation of this.#generations.values()) {
      if (generation.generationId === generationId) {
        generation.controller.abort()
        break
      }
    }
    return null
  }

  /** Remembers a host the user approved sending the staged diff to. */
  async approveHost(host: string): Promise<null> {
    const raw = await this.#settings.getUser(['commitMessage', 'approvedHosts'])
    const hosts = Array.isArray(raw)
      ? raw.filter((entry): entry is string => typeof entry === 'string')
      : []
    if (!hosts.includes(host)) {
      await this.#settings.setUser(['commitMessage', 'approvedHosts'], [...hosts, host])
    }
    return null
  }

  async setKey(key: string): Promise<CommitMessageKeyStatusResponse> {
    return await this.#secrets.set(API_KEY_SECRET, key)
  }

  async removeKey(): Promise<CommitMessageKeyStatusResponse> {
    return await this.#secrets.remove(API_KEY_SECRET)
  }

  async keyStatus(): Promise<CommitMessageKeyStatusResponse> {
    return await this.#secrets.status(API_KEY_SECRET)
  }

  /** Aborts every running generation; called during app shutdown. */
  dispose(): void {
    for (const generation of this.#generations.values()) generation.controller.abort()
    this.#generations.clear()
  }

  async #llmConfig(): Promise<LlmConfig | null> {
    const provider = await this.#settings.getUser(['commitMessage', 'provider'])
    if (provider !== 'openai-compatible') return null
    const baseUrl = await this.#settings.getUser(['commitMessage', 'baseUrl'])
    const model = await this.#settings.getUser(['commitMessage', 'model'])
    const host = hostOf(baseUrl)
    if (host === null || typeof model !== 'string' || model.trim().length === 0) {
      throw new ServiceError(
        'llm-not-configured',
        'The commit message provider is not configured; set the provider, base URL and model in Settings.'
      )
    }
    const apiKey = await this.#secrets.get(API_KEY_SECRET)
    if (apiKey === null) {
      throw new ServiceError(
        'llm-not-configured',
        'No API key is stored for the commit message provider; add one in Settings.'
      )
    }
    const temperature = await this.#settings.getUser(['commitMessage', 'temperature'])
    return {
      host,
      baseUrl: (baseUrl as string).trim(),
      model: model.trim(),
      temperature: typeof temperature === 'number' ? temperature : undefined,
      apiKey
    }
  }

  async #isHostApproved(host: string): Promise<boolean> {
    const raw = await this.#settings.getUser(['commitMessage', 'approvedHosts'])
    return Array.isArray(raw) && raw.includes(host)
  }

  async #detectProfile(repoPath: string): Promise<ConventionProfile> {
    const [commitlint, template, history] = await Promise.all([
      discoverCommitlint(repoPath),
      resolveCommitTemplate(repoPath, this.#homeDir === undefined ? {} : { home: this.#homeDir }),
      logCommits({ repoPath, maxCount: RECENT_SUBJECTS })
    ])
    const subjects = history.commits
      .filter((commit) => commit.parents.length < 2)
      .map((commit) => commit.subject)
    return detectConvention({ commitlint, template, subjects })
  }

  #start(
    gitDir: string,
    summary: StagedSummary,
    profile: ConventionProfile,
    offline: DraftResult,
    config: LlmConfig
  ): Generation {
    this.#generations.get(gitDir)?.controller.abort()
    const generation: Generation = {
      gitDir,
      generationId: randomUUID(),
      controller: new AbortController(),
      summary,
      profile,
      offline,
      config
    }
    this.#generations.set(gitDir, generation)
    void this.#run(generation)
    return generation
  }

  async #run(generation: Generation): Promise<void> {
    let text = ''
    try {
      const prompt = buildPrompt({ summary: generation.summary, profile: generation.profile })
      for await (const chunk of streamChatCompletion({
        baseUrl: generation.config.baseUrl,
        model: generation.config.model,
        apiKey: generation.config.apiKey,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user }
        ],
        signal: generation.controller.signal,
        ...(generation.config.temperature === undefined
          ? {}
          : { temperature: generation.config.temperature }),
        ...(this.#timeoutMs === undefined ? {} : { timeoutMs: this.#timeoutMs }),
        ...(this.#fetchImpl === undefined ? {} : { fetchImpl: this.#fetchImpl })
      })) {
        text += chunk
        this.#emit({
          type: 'output',
          payload: { gitDir: generation.gitDir, generationId: generation.generationId, chunk }
        })
      }
      const message = text.trim()
      if (message.length === 0) throw new LlmNetworkError('The provider returned an empty message')
      this.#finish(generation, { status: 'complete', message })
    } catch (error) {
      this.#finish(generation, classifyFailure(error, generation.offline))
    }
  }

  #finish(
    generation: Generation,
    outcome: Omit<CommitMessageDoneEvent, 'gitDir' | 'generationId'>
  ): void {
    if (this.#generations.get(generation.gitDir)?.generationId === generation.generationId) {
      this.#generations.delete(generation.gitDir)
    }
    this.#emit({
      type: 'done',
      payload: {
        gitDir: generation.gitDir,
        generationId: generation.generationId,
        ...outcome
      }
    })
  }
}

function offlineResponse(
  offline: DraftResult,
  llm: CommitDraftResponse['llm']
): CommitDraftResponse {
  return {
    source: 'offline',
    generationId: null,
    drafts: toVariants(offline),
    weak: offline.weak,
    llm
  }
}

function toVariants(result: DraftResult): CommitDraftVariant[] {
  return result.variants.map((variant) => ({ message: variant.message, primary: variant.primary }))
}

/** Timeout and network failures fall back to the offline drafts; the rest fail. */
function classifyFailure(
  error: unknown,
  offline: DraftResult
): Omit<CommitMessageDoneEvent, 'gitDir' | 'generationId'> {
  if (error instanceof LlmCancelledError) return { status: 'cancelled' }
  if (error instanceof LlmTimeoutError) {
    return { status: 'fallback', reason: 'timeout', drafts: toVariants(offline), weak: offline.weak }
  }
  if (error instanceof LlmNetworkError) {
    return { status: 'fallback', reason: 'network', drafts: toVariants(offline), weak: offline.weak }
  }
  return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
}

function hostOf(baseUrl: unknown): string | null {
  if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) return null
  try {
    const url = new URL(baseUrl)
    return url.hostname.length > 0 ? url.hostname : null
  } catch {
    return null
  }
}
