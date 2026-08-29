import type { TranslationConfig } from '../types'

const TRANSLATE_URL = 'https://translate.googleapis.com/translate_a/single'

const defaultTranslationConfig: TranslationConfig = {
  provider: 'google',
  baseUrl: '',
  model: '',
  apiKey: '',
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: unknown
    }
  }>
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

function translationInstructions(sourceLang: string, targetLang: string): string {
  return [
    'You are a real-time translation engine for live captions.',
    `Translate from ${sourceLang} to ${targetLang}.`,
    'Return only the translation. Preserve names, numbers, and the speaker\'s intent.',
    'Do not add notes, quotation marks, explanations, or speaker labels.',
  ].join(' ')
}

async function translateWithOpenAiCompatibleApi(
  text: string,
  targetLang: string,
  sourceLang: string,
  config: TranslationConfig,
  signal?: AbortSignal,
): Promise<string> {
  externalApiPermissionOrigin(config)

  const response = await fetch(chatCompletionsUrl(config.baseUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model.trim(),
      temperature: 0.2,
      messages: [
        { role: 'system', content: translationInstructions(sourceLang, targetLang) },
        { role: 'user', content: text },
      ],
    }),
    signal,
  })

  if (!response.ok) throw new Error(`externalApiRequestFailed:${response.status}`)

  const data = (await response.json()) as ChatCompletionResponse
  const translation = data.choices?.[0]?.message?.content
  if (typeof translation !== 'string' || !translation.trim()) {
    throw new Error('externalApiMissingTranslation')
  }

  return translation.trim()
}

export async function translateText(
  text: string,
  targetLang: string,
  sourceLang: string,
  config: TranslationConfig = defaultTranslationConfig,
  signal?: AbortSignal,
): Promise<string> {
  if (!text.trim()) return ''

  return config.provider === 'openai-compatible'
    ? translateWithOpenAiCompatibleApi(text, targetLang, sourceLang, config, signal)
    : translateWithGoogle(text, targetLang, sourceLang, signal)
}
