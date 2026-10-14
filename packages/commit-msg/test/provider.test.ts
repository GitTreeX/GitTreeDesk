import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import {
  chatCompletionsUrl,
  DEFAULT_TIMEOUT_MS,
  LlmCancelledError,
  LlmHttpError,
  LlmNetworkError,
  LlmTimeoutError,
  streamChatCompletion,
  type ChatMessage,
  type StreamChatOptions
} from '../src/provider'

const MESSAGES: ChatMessage[] = [{ role: 'user', content: 'Describe the change' }]

function options(overrides: Partial<StreamChatOptions> = {}): StreamChatOptions {
  return { baseUrl: 'http://provider.test/v1', model: 'gpt-x', apiKey: 'secret', messages: MESSAGES, ...overrides }
}

async function collect(generator: AsyncGenerator<string, void, void>): Promise<string> {
  const chunks: string[] = []
  for await (const chunk of generator) chunks.push(chunk)
  return chunks.join('')
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected the promise to reject')
}

function sse(...chunks: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    }
  })
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}

function stubFetch(response: Response): typeof fetch {
  return async () => response
}

const hangingFetch: typeof fetch = (_input, init) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
  })

describe('chatCompletionsUrl', () => {
  it('joins the base URL and endpoint, tolerating a trailing slash', () => {
    expect(chatCompletionsUrl('https://api.example.com/v1')).toBe('https://api.example.com/v1/chat/completions')
    expect(chatCompletionsUrl('https://api.example.com/v1/')).toBe('https://api.example.com/v1/chat/completions')
  })
})

describe('streamChatCompletion', () => {
  it('streams SSE deltas and stops at [DONE]', async () => {
    const fetchImpl = stubFetch(
      sse(
        'data: {"choices":[{"delta":{"content":"feat"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":": add login"}}]}\n\n',
        'data: [DONE]\n\n',
        'data: {"choices":[{"delta":{"content":"IGNORED"}}]}\n\n'
      )
    )
    expect(await collect(streamChatCompletion(options({ fetchImpl })))).toBe('feat: add login')
  })

  it('reads a whole JSON response when the provider does not stream', async () => {
    const fetchImpl = stubFetch(jsonResponse({ choices: [{ message: { content: 'fix: handle empty state' } }] }))
    expect(await collect(streamChatCompletion(options({ fetchImpl })))).toBe('fix: handle empty state')
  })

  it('accepts the legacy completions text field', async () => {
    const fetchImpl = stubFetch(jsonResponse({ choices: [{ text: 'chore: bump deps' }] }))
    expect(await collect(streamChatCompletion(options({ fetchImpl })))).toBe('chore: bump deps')
  })

  it('surfaces HTTP failures with their status', async () => {
    const fetchImpl = stubFetch(new Response('invalid api key', { status: 401 }))
    const error = await rejectionOf(collect(streamChatCompletion(options({ fetchImpl }))))
    expect(error).toBeInstanceOf(LlmHttpError)
    expect((error as LlmHttpError).status).toBe(401)
    expect((error as LlmHttpError).message).toContain('invalid api key')
  })

  it('wraps in-stream error payloads', async () => {
    const fetchImpl = stubFetch(sse('data: {"error":{"message":"rate limited"}}\n\n'))
    const error = await rejectionOf(collect(streamChatCompletion(options({ fetchImpl }))))
    expect(error).toBeInstanceOf(LlmNetworkError)
    expect((error as LlmNetworkError).message).toBe('rate limited')
  })

  it('maps transport failures to network errors', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new TypeError('fetch failed')
    }
    const error = await rejectionOf(collect(streamChatCompletion(options({ fetchImpl }))))
    expect(error).toBeInstanceOf(LlmNetworkError)
    expect((error as LlmNetworkError).message).toBe('fetch failed')
  })

  it('times out a hanging provider', async () => {
    const error = await rejectionOf(
      collect(streamChatCompletion(options({ fetchImpl: hangingFetch, timeoutMs: 25 })))
    )
    expect(error).toBeInstanceOf(LlmTimeoutError)
  })

  it('cancels on the caller signal before the timeout', async () => {
    const controller = new AbortController()
    const pending = collect(
      streamChatCompletion(options({ fetchImpl: hangingFetch, signal: controller.signal }))
    )
    controller.abort()
    expect(await rejectionOf(pending)).toBeInstanceOf(LlmCancelledError)
  })

  it('sends an OpenAI-compatible request over a real socket', async () => {
    const requests: { method?: string; url?: string; authorization?: string; body: string }[] = []
    const server = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8')
      })
      request.on('end', () => {
        requests.push({ method: request.method, url: request.url, authorization: request.headers.authorization, body })
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.write('data: {"choices":[{"delta":{"content":"feat"}}]}\n\n')
        response.write('data: {"choices":[{"delta":{"content":": wire up"}}]}\n\n')
        response.end('data: [DONE]\n\n')
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    try {
      const output = await collect(
        streamChatCompletion(options({ baseUrl: `http://127.0.0.1:${String(port)}/v1/` }))
      )
      expect(output).toBe('feat: wire up')
      expect(requests).toHaveLength(1)
      const sent = requests[0]
      expect(sent?.method).toBe('POST')
      expect(sent?.url).toBe('/v1/chat/completions')
      expect(sent?.authorization).toBe('Bearer secret')
      const payload = JSON.parse(sent?.body ?? '{}') as {
        model?: string
        stream?: boolean
        temperature?: number
        messages?: unknown
      }
      expect(payload.model).toBe('gpt-x')
      expect(payload.stream).toBe(true)
      expect(payload.temperature).toBe(0.2)
      expect(payload.messages).toEqual(MESSAGES)
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('exposes the strict default timeout', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(30_000)
  })
})
