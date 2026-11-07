import type { TranslationConfig } from '../types'
import {
  INDEX_TRANSLATE_BASE_URL,
  INDEX_TRANSLATE_ORIGIN,
  indexTranslateModelOrDefault,
} from '../constants/indexTranslate'
import { md5Hex } from '../utils/md5'

const TRANSLATE_URL = 'https://translate.googleapis.com/translate_a/single'
const MYMEMORY_URL = 'https://api.mymemory.translated.net/get'
const BAIDU_URL = 'https://fanyi-api.baidu.com/api/trans/vip/translate'

const defaultTranslationConfig: TranslationConfig = {
  provider: 'google',
  baseUrl: '',
  model: '',
  apiKey: '',
  appId: '',
}

// A live caption is one sentence, and a model that answers with a paragraph is
// a prompt problem, not a token-budget one: no `max_tokens` is sent, because a
// reasoning model capped mid-thought would return an empty answer.

// Servers that do not implement streaming usually answer one of these; the
// request is retried without `stream` so they keep working.
const STREAM_UNSUPPORTED_STATUSES = new Set([400, 404, 422])

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: unknown
    }
  }>
}

interface ChatCompletionChunk {
  choices?: Array<{
    delta?: { content?: unknown }
    message?: { content?: unknown }
  }>
}

export interface TranslateTextOptions {
  config?: TranslationConfig
  signal?: AbortSignal
  // Called with the text accumulated so far while the provider streams. Only
  // the OpenAI-compatible provider streams; Google answers in a single body.
  onPartial?: (partialText: string) => void
}

function chatCompletionsUrl(baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '')
  if (!normalizedBaseUrl) {
    throw new Error('externalApiMissingBaseUrl')
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(normalizedBaseUrl)
  } catch {
    throw new Error('externalApiInvalidBaseUrl')
  }

  const isLocalhost = parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1'
  if (parsedUrl.protocol !== 'https:' && !isLocalhost) {
    throw new Error('externalApiInsecureUrl')
  }

  return normalizedBaseUrl.endsWith('/chat/completions')
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}/chat/completions`
}

export function externalApiPermissionOrigin(config: TranslationConfig): string {
  // The Index-Translate preset has a fixed host and no key, so it is valid even
  // before the user has filled in anything.
  if (config.provider === 'index-translate') return INDEX_TRANSLATE_ORIGIN

  if (!config.apiKey.trim()) {
    throw new Error('externalApiMissingKey')
  }
  if (!config.model.trim()) {
    throw new Error('externalApiMissingModel')
  }

  const endpoint = new URL(chatCompletionsUrl(config.baseUrl))
  return `${endpoint.protocol}//${endpoint.hostname}/*`
}

async function translateWithGoogle(
  text: string,
  targetLang: string,
  sourceLang: string,
  signal?: AbortSignal,
): Promise<string> {
  const params = new URLSearchParams({
    client: 'gtx',
    sl: sourceLang,
    tl: targetLang,
    dt: 't',
    q: text,
  })

  const response = await fetch(`${TRANSLATE_URL}?${params.toString()}`, { signal })
  if (!response.ok) throw new Error(`googleTranslationRequestFailed:${response.status}`)

  const data = (await response.json()) as Array<Array<Array<string>>>
  return data[0]?.map((chunk) => chunk[0]).join('') ?? ''
}

interface MyMemoryResponse {
  responseStatus?: unknown
  responseDetails?: unknown
  quotaFinished?: unknown
  responseData?: {
    translatedText?: unknown
  }
}

// MyMemory is a free public API with a daily quota; it reports failures inside a
// 200 body, so both the HTTP status and the payload are checked.
async function translateWithMyMemory(
  text: string,
  targetLang: string,
  sourceLang: string,
  signal?: AbortSignal,
): Promise<string> {
  const params = new URLSearchParams({
    q: text,
    langpair: `${sourceLang}|${targetLang}`,
  })

  const response = await fetch(`${MYMEMORY_URL}?${params.toString()}`, { signal })
  if (!response.ok) throw new Error(`mymemoryRequestFailed:${response.status}`)

  const data = (await response.json()) as MyMemoryResponse
  if (String(data.responseStatus) !== '200') {
    throw new Error(`mymemoryRequestFailed:${String(data.responseStatus ?? 'unknown')}`)
  }
  if (data.quotaFinished === true) throw new Error('mymemoryQuotaExceeded')

  const translated = typeof data.responseData?.translatedText === 'string'
    ? data.responseData.translatedText.trim()
    : ''
  if (!translated) throw new Error('translationFailed')

  return translated
}

// Baidu uses its own codes for several languages; the rest pass through.
const BAIDU_LANGUAGE_CODES: Record<string, string> = {
  ja: 'jp',
  ko: 'kor',
  fr: 'fra',
  es: 'spa',
  vi: 'vie',
  ms: 'may',
  ro: 'rom',
  da: 'dan',
  fi: 'fin',
  sv: 'swe',
  bg: 'bul',
  et: 'est',
  lt: 'lit',
  lv: 'lav',
  sl: 'slo',
  uk: 'ukr',
  fa: 'per',
}

function baiduLanguage(code: string): string {
  return BAIDU_LANGUAGE_CODES[code] ?? code
}

interface BaiduResponse {
  error_code?: unknown
  trans_result?: Array<{ dst?: unknown }>
}

// Baidu's general API: appid + secret, signed with MD5(appid + q + salt + key).
// The secret never leaves the device in plaintext — only its hash is sent.
async function translateWithBaidu(
  text: string,
  targetLang: string,
  sourceLang: string,
  config: TranslationConfig,
  signal?: AbortSignal,
): Promise<string> {
  const appId = (config.appId ?? '').trim()
  const secret = (config.apiKey ?? '').trim()
  if (!appId) throw new Error('baiduMissingAppId')
  if (!secret) throw new Error('baiduMissingKey')

  const salt = String(Date.now())
  const params = new URLSearchParams({
    q: text,
    from: baiduLanguage(sourceLang),
    to: baiduLanguage(targetLang),
    appid: appId,
    salt,
    sign: md5Hex(appId + text + salt + secret),
  })

  let response: Response
  try {
    response = await fetch(`${BAIDU_URL}?${params.toString()}`, { signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    // A missing host permission (CORS block) and a dead network look identical
    // here; both mean the request never reached Baidu.
    throw new Error('baiduNetworkFailed', { cause: error })
  }
  if (!response.ok) throw new Error(`baiduRequestFailed:${response.status}`)

  let data: BaiduResponse
  try {
    data = (await response.json()) as BaiduResponse
  } catch (error) {
    throw new Error('baiduInvalidResponse', { cause: error })
  }

  if (data.error_code !== undefined && data.error_code !== null) {
    throw new Error(`baiduRequestFailed:${String(data.error_code)}`)
  }

  const translated = Array.isArray(data.trans_result)
    ? data.trans_result
      .map((entry) => (typeof entry.dst === 'string' ? entry.dst : ''))
      .join('\n')
      .trim()
    : ''
  if (!translated) throw new Error('translationFailed')

  return translated
}

function translationInstructions(sourceLang: string, targetLang: string): string {
  return [
    'You are a real-time translation engine for live captions.',
    `Translate from ${sourceLang} to ${targetLang}.`,
    'Return only the translation. Preserve names, numbers, and the speaker\'s intent.',
    'Do not add notes, quotation marks, explanations, or speaker labels.',
    // Speech recognition occasionally emits an unexpected character or word; a
    // model that stops to comment on the input breaks the live captions.
    'The input comes from speech recognition and may contain errors or unexpected characters — translate what is there literally, and never comment on the input or ask questions.',
  ].join(' ')
}

// The preset overrides whatever is stored: switching providers must not send a
// Baidu secret (or an old endpoint) to Bilibili. The endpoint accepts any
// Authorization value, so the placeholder keeps the shared request path intact.
function indexTranslateConfig(config: TranslationConfig): TranslationConfig {
  return {
    ...config,
    baseUrl: INDEX_TRANSLATE_BASE_URL,
    model: indexTranslateModelOrDefault(config.model),
    apiKey: 'none',
    appId: '',
  }
}

function contentOfChunk(chunk: ChatCompletionChunk): string {
  const choice = chunk.choices?.[0]
  const content = choice?.delta?.content ?? choice?.message?.content
  return typeof content === 'string' ? content : ''
}

// SSE framing: one JSON object per `data:` line, ended by `data: [DONE]`. A
// malformed event is skipped rather than killing an otherwise good stream.
async function readChatCompletionStream(
  response: Response,
  onPartial: (partialText: string) => void,
): Promise<string> {
  const body = response.body
  if (!body) return ''

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffered = ''
  let accumulated = ''
  let finished = false

  const consumeLine = (line: string): void => {
    if (!line.startsWith('data:')) return
    const payload = line.slice(5).trim()
    if (payload === '[DONE]') {
      finished = true
      return
    }

    let chunk: ChatCompletionChunk
    try {
      chunk = JSON.parse(payload) as ChatCompletionChunk
    } catch {
      return
    }

    const content = contentOfChunk(chunk)
    if (!content) return
    accumulated += content
    onPartial(accumulated)
  }

  while (!finished) {
    const { done, value } = await reader.read()
    if (done) break
    buffered += decoder.decode(value, { stream: true })

    let newlineIndex = buffered.indexOf('\n')
    while (newlineIndex !== -1 && !finished) {
      consumeLine(buffered.slice(0, newlineIndex).trim())
      buffered = buffered.slice(newlineIndex + 1)
      newlineIndex = buffered.indexOf('\n')
    }
  }

  // A server that closes without a trailing newline still sends its last event.
  if (!finished) consumeLine(buffered.trim())
  await reader.cancel().catch(() => undefined)

  return accumulated
}

function parseChatCompletion(data: unknown): string {
  const content = (data as ChatCompletionResponse).choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('externalApiMissingTranslation')
  }

  return content.trim()
}

async function translateWithOpenAiCompatibleApi(
  text: string,
  targetLang: string,
  sourceLang: string,
  config: TranslationConfig,
  signal?: AbortSignal,
  onPartial?: (partialText: string) => void,
): Promise<string> {
  externalApiPermissionOrigin(config)

  const request = (stream: boolean): Promise<Response> =>
    fetch(chatCompletionsUrl(config.baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model.trim(),
        temperature: 0.2,
        // Deliberately no max_tokens: providers disagree on whether it also
        // caps a reasoning model's thinking, and one that spends the whole
        // budget thinking answers with no caption at all.
        messages: [
          { role: 'system', content: translationInstructions(sourceLang, targetLang) },
          { role: 'user', content: text },
        ],
        ...(stream ? { stream: true } : {}),
      }),
      signal,
    })

  if (onPartial) {
    const response = await request(true)

    if (response.ok) {
      const isEventStream = (response.headers.get('content-type') ?? '').includes('text/event-stream')
      if (isEventStream && response.body) {
        const streamed = await readChatCompletionStream(response, onPartial)
        if (streamed.trim()) return streamed.trim()
        // A provider can accept `stream` and still send nothing usable (a
        // gateway that only answers `[DONE]`, a model that never left its
        // reasoning). The plain request below is the path that worked before
        // streaming existed, so it gets the next say.
      } else {
        try {
          return parseChatCompletion(await response.json())
        } catch (error) {
          // A body that is neither readable SSE nor valid JSON is a provider
          // that does not really stream; anything else is a real answer.
          if (error instanceof Error && error.message === 'externalApiMissingTranslation') throw error
        }
      }
    } else if (!STREAM_UNSUPPORTED_STATUSES.has(response.status)) {
      throw new Error(`externalApiRequestFailed:${response.status}`)
    }
  }

  const plain = await request(false)
  if (!plain.ok) throw new Error(`externalApiRequestFailed:${plain.status}`)
  return parseChatCompletion(await plain.json())
}

export async function translateText(
  text: string,
  targetLang: string,
  sourceLang: string,
  options: TranslateTextOptions = {},
): Promise<string> {
  if (!text.trim()) return ''

  const { config = defaultTranslationConfig, signal, onPartial } = options
  if (config.provider === 'openai-compatible') {
    return translateWithOpenAiCompatibleApi(text, targetLang, sourceLang, config, signal, onPartial)
  }
  if (config.provider === 'index-translate') {
    try {
      return await translateWithOpenAiCompatibleApi(
        text,
        targetLang,
        sourceLang,
        indexTranslateConfig(config),
        signal,
        onPartial,
      )
    } catch (error) {
      // fetch reports a DNS/CORS/offline failure as a TypeError, not an
      // HTTP status; surface it as a readable message like Baidu's.
      if (error instanceof TypeError) {
        throw new Error('indexTranslateNetworkFailed', { cause: error })
      }
      if (error instanceof Error && error.message.startsWith('externalApiRequestFailed:')) {
        throw new Error(
          error.message.replace('externalApiRequestFailed', 'indexTranslateRequestFailed'),
          { cause: error },
        )
      }
      throw error
    }
  }
  if (config.provider === 'mymemory') {
    return translateWithMyMemory(text, targetLang, sourceLang, signal)
  }
  if (config.provider === 'baidu') {
    return translateWithBaidu(text, targetLang, sourceLang, config, signal)
  }
  return translateWithGoogle(text, targetLang, sourceLang, signal)
}
