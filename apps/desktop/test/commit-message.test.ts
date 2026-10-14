import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CommitMessageDoneEvent } from '@gitreedesk/shared'
import { runGitOrThrow } from '@gitreedesk/git-core'
import {
  CommitMessageService,
  type CommitMessageServiceEvent
} from '../src/main/services/commit-message'
import { SecretsStore, type SecretCodec } from '../src/main/services/secrets'

const IDENTITY = ['-c', 'user.name=GitTreeDesk Test', '-c', 'user.email=test@gitreedesk.invalid']

const fakeCodec: SecretCodec = {
  available: true,
  encrypt: (text) => Buffer.from(text, 'utf8').toString('base64'),
  decrypt: (token) => Buffer.from(token, 'base64').toString('utf8')
}

const sessionCodec: SecretCodec = {
  available: false,
  encrypt: () => {
    throw new Error('no OS encryption')
  },
  decrypt: () => {
    throw new Error('no OS encryption')
  }
}

let dirs: string[] = []
let services: CommitMessageService[] = []
let servers: Server[] = []

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

// Aborted fetches can outlive the test by a moment on Windows; deleting the
// directory fails with EBUSY until the sockets are gone.
async function removeDir(dir: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true })
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      const retriable = code === 'EBUSY' || code === 'EPERM' || code === 'ENOTEMPTY'
      if (!retriable || attempt >= 9) throw error
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }
}

afterEach(async () => {
  for (const server of servers) {
    server.closeAllConnections()
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()))
  }
  servers = []
  for (const service of services) service.dispose()
  services = []
  const pending = dirs
  dirs = []
  for (const dir of pending) await removeDir(dir)
})

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await runGitOrThrow([...IDENTITY, ...args], { cwd })
  return result.stdout
}

async function initRepo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await git(dir, ['init', '-q', '-b', 'main'])
  await git(dir, ['config', 'user.name', 'GitTreeDesk Test'])
  await git(dir, ['config', 'user.email', 'test@gitreedesk.invalid'])
  await git(dir, ['commit', '-q', '--allow-empty', '-m', 'init'])
}

/** A repository with one staged addition; the offline draft reads `add readme`. */
async function stagedRepo(): Promise<string> {
  const root = await tempDir('gtd-cmsg-root-')
  const repo = join(root, 'api-server')
  await initRepo(repo)
  await writeFile(join(repo, 'README.md'), '# hello\n')
  await git(repo, ['add', 'README.md'])
  return repo
}

async function writeLlmSettings(userDataDir: string, baseUrl: string): Promise<void> {
  await writeFile(
    join(userDataDir, 'settings.json'),
    JSON.stringify({
      commitMessage: {
        provider: 'openai-compatible',
        baseUrl: `${baseUrl}/v1`,
        model: 'acme-mini',
        temperature: 0.5
      }
    })
  )
}

interface LlmRequest {
  method: string
  url: string
  authorization: string | undefined
  body: Record<string, unknown>
}

type LlmResponder = (request: LlmRequest, response: ServerResponse) => void

interface LlmServer {
  baseUrl: string
  requests: LlmRequest[]
}

function startLlmServer(responder: LlmResponder): Promise<LlmServer> {
  const requests: LlmRequest[] = []
  const server = createServer((incoming, response) => {
    const parts: Buffer[] = []
    incoming.on('data', (part: Buffer) => parts.push(part))
    incoming.on('end', () => {
      let body: Record<string, unknown> = {}
      try {
        body = JSON.parse(Buffer.concat(parts).toString('utf8')) as Record<string, unknown>
      } catch {
        body = {}
      }
      const request: LlmRequest = {
        method: incoming.method ?? '',
        url: incoming.url ?? '',
        authorization: incoming.headers.authorization,
        body
      }
      requests.push(request)
      responder(request, response)
    })
  })
  servers.push(server)
  return new Promise((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolvePromise({ baseUrl: `http://127.0.0.1:${String(port)}`, requests })
    })
  })
}

/** Streams the chunks as SSE deltas; `hold` keeps the response open instead of finishing. */
function sseResponder(chunks: readonly string[], hold?: () => void): LlmResponder {
  return (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const chunk of chunks) {
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`)
    }
    if (hold === undefined) {
      response.write('data: [DONE]\n\n')
      response.end()
    } else {
      hold()
    }
  }
}

interface Harness {
  service: CommitMessageService
  events: CommitMessageServiceEvent[]
  done: () => Promise<CommitMessageDoneEvent>
}

async function harness(options: {
  repo: string
  userDataDir: string
  homeDir: string
  timeoutMs?: number
  codec?: SecretCodec
}): Promise<Harness> {
  const events: CommitMessageServiceEvent[] = []
  const service = new CommitMessageService({
    userDataDir: options.userDataDir,
    secrets: new SecretsStore({
      userDataDir: options.userDataDir,
      codec: options.codec ?? fakeCodec
    }),
    resolveRepoPath: () => options.repo,
    homeDir: options.homeDir,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    emit: (event) => {
      events.push(event)
    }
  })
  services.push(service)
  const done = async (): Promise<CommitMessageDoneEvent> => {
    await vi.waitFor(() => {
      expect(events.some((event) => event.type === 'done')).toBe(true)
    })
    const found = events.find((event) => event.type === 'done')
    if (found === undefined || found.type !== 'done') throw new Error('no done event')
    return found.payload
  }
  return { service, events, done }
}

async function setupRepo(): Promise<{ repo: string; gitDir: string }> {
  const repo = await stagedRepo()
  return { repo, gitDir: join(repo, '.git') }
}

describe('CommitMessageService offline mode', () => {
  it('drafts a staged change-set without any provider configured', async () => {
    const { repo, gitDir } = await setupRepo()
    const userDataDir = await tempDir('gtd-cmsg-data-')
    const homeDir = await tempDir('gtd-cmsg-home-')
    const h = await harness({ repo, userDataDir, homeDir })

    const response = await h.service.generate({ gitDir })
    expect(response).toEqual({
      source: 'offline',
      generationId: null,
      drafts: [{ message: 'add readme', primary: true }],
      weak: true,
      llm: null
    })
  })

  it('refuses to draft when nothing is staged', async () => {
    const root = await tempDir('gtd-cmsg-root-')
    const repo = join(root, 'api-server')
    await initRepo(repo)
    const userDataDir = await tempDir('gtd-cmsg-data-')
    const homeDir = await tempDir('gtd-cmsg-home-')
    const h = await harness({ repo, userDataDir, homeDir })

    await expect(h.service.generate({ gitDir: join(repo, '.git') })).rejects.toMatchObject({
      code: 'nothing-staged'
    })
  })

  it('asks for host approval before sending the staged diff', async () => {
    const { repo, gitDir } = await setupRepo()
    const userDataDir = await tempDir('gtd-cmsg-data-')
    const homeDir = await tempDir('gtd-cmsg-home-')
    const server = await startLlmServer(sseResponder(['unused']))
    await writeLlmSettings(userDataDir, server.baseUrl)
    const h = await harness({ repo, userDataDir, homeDir })
    await h.service.setKey('sk-acme')

    const response = await h.service.generate({ gitDir })
    expect(response.source).toBe('offline')
    expect(response.llm).toEqual({ host: '127.0.0.1', approved: false })
    expect(response.drafts).toEqual([{ message: 'add readme', primary: true }])
    expect(server.requests).toHaveLength(0)
  })

  it('refuses generation when the provider settings or the key are missing', async () => {
    const { repo, gitDir } = await setupRepo()
    const homeDir = await tempDir('gtd-cmsg-home-')

    const noKeyDir = await tempDir('gtd-cmsg-data-')
    const server = await startLlmServer(sseResponder(['unused']))
    await writeLlmSettings(noKeyDir, server.baseUrl)
    const noKey = await harness({ repo, userDataDir: noKeyDir, homeDir })
    await expect(noKey.service.generate({ gitDir })).rejects.toMatchObject({
      code: 'llm-not-configured'
    })

    const noUrlDir = await tempDir('gtd-cmsg-data-')
    await writeFile(
      join(noUrlDir, 'settings.json'),
      JSON.stringify({ commitMessage: { provider: 'openai-compatible' } })
    )
    const noUrl = await harness({ repo, userDataDir: noUrlDir, homeDir })
    await noUrl.service.setKey('sk-acme')
    await expect(noUrl.service.generate({ gitDir })).rejects.toMatchObject({
      code: 'llm-not-configured'
    })
  })
})

describe('CommitMessageService LLM mode', () => {
  it('streams an approved generation and completes with the trimmed message', async () => {
    const { repo, gitDir } = await setupRepo()
    const userDataDir = await tempDir('gtd-cmsg-data-')
    const homeDir = await tempDir('gtd-cmsg-home-')
    const server = await startLlmServer(sseResponder(['feat: ', 'add readme', '\n']))
    await writeLlmSettings(userDataDir, server.baseUrl)
    const h = await harness({ repo, userDataDir, homeDir })
    await h.service.setKey('sk-acme')
    await h.service.approveHost('127.0.0.1')

    const response = await h.service.generate({ gitDir })
    expect(response.source).toBe('llm')
    expect(response.generationId).toBeTypeOf('string')
    expect(response.drafts).toEqual([])
    expect(response.llm).toEqual({ host: '127.0.0.1', approved: true })

    const doneEvent = await h.done()
    expect(doneEvent).toMatchObject({
      status: 'complete',
      message: 'feat: add readme',
      generationId: response.generationId,
      gitDir
    })

    const streamed = h.events.flatMap((event) => (event.type === 'output' ? [event.payload] : []))
    expect(streamed.map((event) => event.chunk).join('')).toBe('feat: add readme\n')
    expect(
      streamed.every(
        (event) => event.gitDir === gitDir && event.generationId === response.generationId
      )
    ).toBe(true)

    // The approval is persisted for future sessions.
    const settings = JSON.parse(await readFile(join(userDataDir, 'settings.json'), 'utf8'))
    expect(settings.commitMessage.approvedHosts).toEqual(['127.0.0.1'])

    expect(server.requests).toHaveLength(1)
    const request = server.requests[0]
    expect(request?.method).toBe('POST')
    expect(request?.url).toBe('/v1/chat/completions')
    expect(request?.authorization).toBe('Bearer sk-acme')
    expect(request?.body).toMatchObject({ model: 'acme-mini', stream: true, temperature: 0.5 })
    const messages = request?.body['messages'] as { role: string; content: string }[]
    expect(messages[0]?.role).toBe('system')
    expect(messages[0]?.content).toContain('commit message')
    expect(messages[0]?.content).toContain('No strict prefix convention was detected')
    expect(messages[1]?.content).toContain('Staged files:')
    expect(messages[1]?.content).toContain('README.md')
  })

  it('falls back to the offline drafts when the provider times out', async () => {
    const { repo, gitDir } = await setupRepo()
    const userDataDir = await tempDir('gtd-cmsg-data-')
    const homeDir = await tempDir('gtd-cmsg-home-')
    const server = await startLlmServer(() => undefined)
    await writeLlmSettings(userDataDir, server.baseUrl)
    const h = await harness({ repo, userDataDir, homeDir, timeoutMs: 300 })
    await h.service.setKey('sk-acme')
    await h.service.approveHost('127.0.0.1')

    const response = await h.service.generate({ gitDir })
    expect(response.source).toBe('llm')

    const doneEvent = await h.done()
    expect(doneEvent).toMatchObject({ status: 'fallback', reason: 'timeout', weak: true })
    expect(doneEvent.drafts).toEqual([{ message: 'add readme', primary: true }])
  })

  it('falls back to the offline drafts on a network failure', async () => {
    const { repo, gitDir } = await setupRepo()
    const userDataDir = await tempDir('gtd-cmsg-data-')
    const homeDir = await tempDir('gtd-cmsg-home-')
    const server = await startLlmServer((_request, response) => {
      response.destroy()
    })
    await writeLlmSettings(userDataDir, server.baseUrl)
    const h = await harness({ repo, userDataDir, homeDir })
    await h.service.setKey('sk-acme')
    await h.service.approveHost('127.0.0.1')

    await h.service.generate({ gitDir })
    const doneEvent = await h.done()
    expect(doneEvent).toMatchObject({ status: 'fallback', reason: 'network' })
    expect(doneEvent.drafts).toEqual([{ message: 'add readme', primary: true }])
  })

  it('reports a provider HTTP failure without falling back', async () => {
    const { repo, gitDir } = await setupRepo()
    const userDataDir = await tempDir('gtd-cmsg-data-')
    const homeDir = await tempDir('gtd-cmsg-home-')
    const server = await startLlmServer((_request, response) => {
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'bad key' } }))
    })
    await writeLlmSettings(userDataDir, server.baseUrl)
    const h = await harness({ repo, userDataDir, homeDir })
    await h.service.setKey('sk-wrong')
    await h.service.approveHost('127.0.0.1')

    await h.service.generate({ gitDir })
    const doneEvent = await h.done()
    expect(doneEvent.status).toBe('failed')
    expect(doneEvent.error).toContain('401')
    expect(doneEvent.drafts).toBeUndefined()
  })

  it('cancels a running generation', async () => {
    const { repo, gitDir } = await setupRepo()
    const userDataDir = await tempDir('gtd-cmsg-data-')
    const homeDir = await tempDir('gtd-cmsg-home-')
    const server = await startLlmServer(sseResponder(['partial '], () => undefined))
    await writeLlmSettings(userDataDir, server.baseUrl)
    const h = await harness({ repo, userDataDir, homeDir })
    await h.service.setKey('sk-acme')
    await h.service.approveHost('127.0.0.1')

    const response = await h.service.generate({ gitDir })
    await vi.waitFor(() => {
      expect(h.events.some((event) => event.type === 'output')).toBe(true)
    })
    h.service.cancel(response.generationId ?? '')

    const doneEvent = await h.done()
    expect(doneEvent).toMatchObject({ status: 'cancelled', generationId: response.generationId })
  })
})

describe('CommitMessageService key management', () => {
  it('tracks and clears the stored provider key', async () => {
    const { repo } = await setupRepo()
    const userDataDir = await tempDir('gtd-cmsg-data-')
    const homeDir = await tempDir('gtd-cmsg-home-')
    const h = await harness({ repo, userDataDir, homeDir })

    await expect(h.service.keyStatus()).resolves.toEqual({ stored: false, encrypted: true })
    await expect(h.service.setKey('sk-acme')).resolves.toEqual({ stored: true, encrypted: true })
    await expect(h.service.keyStatus()).resolves.toEqual({ stored: true, encrypted: true })
    await expect(h.service.removeKey()).resolves.toEqual({ stored: false, encrypted: true })
    await expect(h.service.keyStatus()).resolves.toEqual({ stored: false, encrypted: true })
  })

  it('marks keys as session-only when the platform offers no encryption', async () => {
    const { repo } = await setupRepo()
    const userDataDir = await tempDir('gtd-cmsg-data-')
    const homeDir = await tempDir('gtd-cmsg-home-')
    const h = await harness({ repo, userDataDir, homeDir, codec: sessionCodec })

    await expect(h.service.setKey('sk-session')).resolves.toEqual({
      stored: true,
      encrypted: false
    })
    await expect(h.service.keyStatus()).resolves.toEqual({ stored: true, encrypted: false })
  })
})
