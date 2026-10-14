/** The default strict timeout; a slower provider falls back to the offline draft. */
export const DEFAULT_TIMEOUT_MS = 30_000

export class LlmCancelledError extends Error {
  constructor() {
    super('The generation was cancelled')
    this.name = 'LlmCancelledError'
  }
}

export class LlmTimeoutError extends Error {
  constructor(ms: number) {
    super(`The provider did not answer within ${String(Math.round(ms / 1000))} s`)
    this.name = 'LlmTimeoutError'
  }
}

export class LlmNetworkError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'LlmNetworkError'
  }
}

export class LlmHttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'LlmHttpError'
    this.status = status
  }
}

export interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

export interface StreamChatOptions {
  /** OpenAI-compatible base URL, e.g. `https://host/v1`. */
  baseUrl: string
  model: string
  apiKey: string
  temperature?: number
  messages: readonly ChatMessage[]
  signal?: AbortSignal
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

/** `<base>/chat/completions`; a trailing slash on the base URL is tolerated. */
export function chatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`
}

interface ChatChunk {
  choices?: readonly {
    delta?: { content?: unknown }
    text?: unknown
    message?: { content?: unknown }
  }[]
  error?: { message?: unknown }
}

/**
 * Streams an OpenAI-compatible chat completion, yielding text deltas. The whole
 * request is bounded by a strict timeout; cancelling the caller's signal stops it.
 */
export async function* streamChatCompletion(options: StreamChatOptions): AsyncGenerator<string, void, void> {
  const doFetch = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout])

  let response: Response
  try {
    response = await doFetch(chatCompletionsUrl(options.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        authorization: `Bearer ${options.apiKey}`
      },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        temperature: options.temperature ?? 0.2,
        stream: true
      }),
      signal
    })
  } catch (error) {
    throw translateAbort(error, options.signal, timeout, timeoutMs)
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    const detail = body.trim().length > 0 ? `: ${body.trim().slice(0, 500)}` : ''
    throw new LlmHttpError(response.status, `The provider answered ${String(response.status)}${detail}`)
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/event-stream')) {
    yield* readWholeResponse(response)
    return
  }
  if (response.body === null) return
  try {
    yield* readEventStream(response.body, options)
  } catch (error) {
    throw translateAbort(error, options.signal, timeout, timeoutMs)
  }
}

async function* readWholeResponse(response: Response): AsyncGenerator<string, void, void> {
  let body: ChatChunk
  try {
    body = (await response.json()) as ChatChunk
  } catch (error) {
    throw new LlmNetworkError('The provider returned an unexpected response', error)
  }
  const message = firstString(body.choices?.[0]?.message?.content)
  const text = message ?? firstString(body.choices?.[0]?.text)
  if (text !== null) yield text
}

async function* readEventStream(body: ReadableStream<Uint8Array>, options: StreamChatOptions): AsyncGenerator<string, void, void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        const chunk = parseLine(line, options)
        if (chunk === 'done') return
        if (chunk !== null) yield chunk
        newline = buffer.indexOf('\n')
      }
    }
    const tail = parseLine(buffer, options)
    if (tail !== null && tail !== 'done') yield tail
  } finally {
    reader.releaseLock()
  }
}

function parseLine(rawLine: string, options: StreamChatOptions): string | 'done' | null {
  const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
  if (line.length === 0 || line.startsWith(':')) return null
  if (!line.startsWith('data:')) return null
  const payload = line.slice(5).trim()
  if (payload.length === 0) return null
  if (payload === '[DONE]') return 'done'
  let chunk: ChatChunk
  try {
    chunk = JSON.parse(payload) as ChatChunk
  } catch {
    return null
  }
  if (chunk.error !== undefined) {
    throw new LlmNetworkError(firstString(chunk.error.message) ?? 'The provider reported an error')
  }
  if (options.signal?.aborted === true) throw new LlmCancelledError()
  const content = firstString(chunk.choices?.[0]?.delta?.content)
  if (content !== null) return content
  const text = firstString(chunk.choices?.[0]?.text)
  return text
}

function translateAbort(error: unknown, user: AbortSignal | undefined, timeout: AbortSignal, timeoutMs: number): Error {
  if (
    error instanceof LlmCancelledError ||
    error instanceof LlmTimeoutError ||
    error instanceof LlmHttpError ||
    error instanceof LlmNetworkError
  ) {
    return error
  }
  if (user?.aborted === true) return new LlmCancelledError()
  if (timeout.aborted) return new LlmTimeoutError(timeoutMs)
  return new LlmNetworkError(error instanceof Error ? error.message : String(error), error)
}

function firstString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}
