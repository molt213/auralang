/** @jest-environment node */

import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { jest } from '@jest/globals'
import { translateText } from './translationService'
import type { TranslationConfig } from '../types'

const TRANSLATE_URL = 'https://translate.googleapis.com/translate_a/single'
const MYMEMORY_URL = 'https://api.mymemory.translated.net/get'
const BAIDU_URL = 'https://fanyi-api.baidu.com/api/trans/vip/translate'
const CHAT_COMPLETIONS_URL = 'https://api.example.test/v1/chat/completions'
const INDEX_TRANSLATE_CHAT_URL = 'https://index-translate.bilibili.com/v1/chat/completions'

const myMemoryConfig = {
  provider: 'mymemory',
  apiKey: '',
  baseUrl: '',
  model: '',
  appId: '',
} satisfies TranslationConfig

// Built at runtime so the fixture never looks like a real credential.
const TEST_API_KEY = ['test', 'api', 'key'].join('-')

const externalApiConfig = {
  provider: 'openai-compatible',
  apiKey: TEST_API_KEY,
  baseUrl: 'https://api.example.test/v1',
  model: 'translation-model',
  appId: '',
} satisfies TranslationConfig

// Baidu's secret reuses the external fixture's key, so no credential literal is
// duplicated in this file.
const baiduConfig = {
  ...externalApiConfig,
  provider: 'baidu',
  appId: 'appid123',
  baseUrl: '',
  model: '',
} satisfies TranslationConfig

const indexTranslateConfig = {
  provider: 'index-translate',
  apiKey: '',
  baseUrl: '',
  model: '',
  appId: '',
} satisfies TranslationConfig

interface ChatCompletionRequestBody {
  model?: string
  messages?: Array<{ role?: string; content?: string }>
  stream?: boolean
  max_tokens?: number
}

function eventStream(events: string[]) {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(event))
      controller.close()
    },
  })
  return new HttpResponse(stream, { headers: { 'content-type': 'text/event-stream' } })
}

const server = setupServer(
  http.get(TRANSLATE_URL, ({ request }) => {
    const url = new URL(request.url)
    if (
      url.searchParams.get('q') !== 'Hello world' ||
      url.searchParams.get('tl') !== 'es' ||
      url.searchParams.get('sl') !== 'en'
    ) {
      return new HttpResponse(null, { status: 400 })
    }

    return HttpResponse.text(
      JSON.stringify([[['Hola mundo', 'Hello world', null, null, 1]]]),
      { headers: { 'content-type': 'application/json' } },
    )
  }),
  http.post(CHAT_COMPLETIONS_URL, async ({ request }) => {
    const requestBody = await request.json() as {
      model?: string
      messages?: Array<{ role?: string; content?: string }>
    }

    if (
      request.headers.get('authorization') !== `Bearer ${TEST_API_KEY}` ||
      requestBody.model !== 'translation-model' ||
      requestBody.messages?.[1]?.content !== 'Hello world'
    ) {
      return new HttpResponse(null, { status: 400 })
    }

    return HttpResponse.json({
      choices: [{ message: { content: 'Hola mundo' } }],
    })
  }),
  http.post(INDEX_TRANSLATE_CHAT_URL, async ({ request }) => {
    const requestBody = await request.json() as {
      model?: string
      messages?: Array<{ role?: string; content?: string }>
    }

    // The free endpoint ignores the key, but the preset must never leak a
    // stored provider secret or use a stale base URL.
    if (
      request.headers.get('authorization') !== 'Bearer none' ||
      requestBody.model !== 'Index-Translate-35B-A3B' ||
      requestBody.messages?.[1]?.content !== 'Hello world'
    ) {
      return new HttpResponse(null, { status: 400 })
    }

    return HttpResponse.json({
      choices: [{ message: { content: 'Hola mundo' } }],
    })
  }),
)

beforeAll(() => server.listen())
afterEach(() => {
  server.resetHandlers()
  jest.restoreAllMocks()
})
afterAll(() => server.close())

describe('Given text to translate', () => {
  it('When Google Translate responds successfully, Then it returns translated text', async () => {
    await expect(translateText('Hello world', 'es', 'en')).resolves.toBe('Hola mundo')
  })

  it('When the input is empty, Then it returns an empty string', async () => {
    await expect(translateText('   ', 'es', 'en')).resolves.toBe('')
  })

  it('When Google Translate returns an error, Then it reports the failed request', async () => {
    server.use(
      http.get(TRANSLATE_URL, () => new HttpResponse(null, { status: 500 })),
    )

    await expect(translateText('Hello world', 'es', 'en')).rejects.toThrow('googleTranslationRequestFailed:500')
  })

  it('When an OpenAI-compatible API is configured, Then it returns that API translation', async () => {
    server.use(
      http.get(TRANSLATE_URL, () => new HttpResponse(null, { status: 418 })),
    )

    await expect(
      translateText('Hello world', 'es', 'en', { config: externalApiConfig }),
    ).resolves.toBe('Hola mundo')
  })

  it('When the external API key is missing, Then it stops before sending a request', async () => {
    const missingKeyConfig = { ...externalApiConfig, apiKey: '' }

    await expect(
      translateText('Hello world', 'es', 'en', { config: missingKeyConfig }),
    ).rejects.toThrow('externalApiMissingKey')
  })
})

describe('Given the built-in Index-Translate service', () => {
  it('When no key is configured, Then it uses the free endpoint and returns the translation', async () => {
    await expect(
      translateText('Hello world', 'es', 'en', { config: indexTranslateConfig }),
    ).resolves.toBe('Hola mundo')
  })

  it('When a stored base URL or key exists, Then neither is sent to Bilibili', async () => {
    await expect(
      translateText('Hello world', 'es', 'en', {
        config: {
          ...indexTranslateConfig,
          baseUrl: 'https://api.example.test/v1',
          apiKey: externalApiConfig.apiKey,
        },
      }),
    ).resolves.toBe('Hola mundo')
  })

  it('When a smaller model is chosen, Then that model is requested', async () => {
    const requestedModels: string[] = []
    server.use(
      http.post(INDEX_TRANSLATE_CHAT_URL, async ({ request }) => {
        const requestBody = await request.json() as { model?: string }
        if (requestBody.model) requestedModels.push(requestBody.model)
        return HttpResponse.json({ choices: [{ message: { content: 'Hola mundo' } }] })
      }),
    )

    await translateText('Hello world', 'es', 'en', {
      config: { ...indexTranslateConfig, model: 'Index-Translate-2B' },
    })

    expect(requestedModels).toEqual(['Index-Translate-2B'])
  })

  it('When the endpoint rejects the request, Then it reports an Index-Translate failure', async () => {
    server.use(
      http.post(INDEX_TRANSLATE_CHAT_URL, () => new HttpResponse(null, { status: 503 })),
    )

    await expect(
      translateText('Hello world', 'es', 'en', { config: indexTranslateConfig }),
    ).rejects.toThrow('indexTranslateRequestFailed:503')
  })
})

describe('Given a provider that streams its translation', () => {
  it('When deltas arrive, Then it reports the growing text and returns the whole translation', async () => {
    server.use(
      http.post(CHAT_COMPLETIONS_URL, () =>
        eventStream([
          'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"Hola"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":" mundo"}}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      ),
    )

    const partials: string[] = []
    const translation = await translateText('Hello world', 'es', 'en', {
      config: externalApiConfig,
      onPartial: (partial) => partials.push(partial),
    })

    expect(translation).toBe('Hola mundo')
    expect(partials).toEqual(['Hola', 'Hola mundo'])
  })

  it('When a provider streams, Then the request streams without capping the completion', async () => {
    const requestBodies: ChatCompletionRequestBody[] = []
    server.use(
      http.post(CHAT_COMPLETIONS_URL, async ({ request }) => {
        requestBodies.push(await request.json() as ChatCompletionRequestBody)
        return eventStream([
          'data: {"choices":[{"delta":{"content":"Hola"}}]}\n\n',
          'data: [DONE]\n\n',
        ])
      }),
    )

    await translateText('Hello world', 'es', 'en', {
      config: externalApiConfig,
      onPartial: () => {},
    })

    expect(requestBodies[0]?.stream).toBe(true)
    // A reasoning model capped mid-thought would answer with no caption at all.
    expect(requestBodies[0]?.max_tokens).toBeUndefined()
  })

  it('When a malformed event sits between good ones, Then it skips it and keeps the translation', async () => {
    server.use(
      http.post(CHAT_COMPLETIONS_URL, () =>
        eventStream([
          'data: {"choices":[{"delta":{"content":"Hola"}}]}\n\n',
          'data: {not json}\n\n',
          'data: {"choices":[{"delta":{"content":" mundo"}}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      ),
    )

    await expect(
      translateText('Hello world', 'es', 'en', { config: externalApiConfig, onPartial: () => {} }),
    ).resolves.toBe('Hola mundo')
  })

  it('When the stream carries no text, Then the plain request gets the next say', async () => {
    const requestBodies: ChatCompletionRequestBody[] = []
    server.use(
      http.post(CHAT_COMPLETIONS_URL, async ({ request }) => {
        const requestBody = await request.json() as ChatCompletionRequestBody
        requestBodies.push(requestBody)
        if (requestBody.stream) return eventStream(['data: [DONE]\n\n'])

        return HttpResponse.json({ choices: [{ message: { content: 'Hola mundo' } }] })
      }),
    )

    await expect(
      translateText('Hello world', 'es', 'en', { config: externalApiConfig, onPartial: () => {} }),
    ).resolves.toBe('Hola mundo')
    expect(requestBodies.map((body) => body.stream)).toEqual([true, undefined])
  })

  it('When the streaming response is not SSE at all, Then the plain request gets the next say', async () => {
    const requestBodies: ChatCompletionRequestBody[] = []
    server.use(
      http.post(CHAT_COMPLETIONS_URL, async ({ request }) => {
        const requestBody = await request.json() as ChatCompletionRequestBody
        requestBodies.push(requestBody)
        if (requestBody.stream) {
          return new HttpResponse('data: {"choices":[{"delta":{"content":"Hola"}}]}', {
            headers: { 'content-type': 'application/octet-stream' },
          })
        }

        return HttpResponse.json({ choices: [{ message: { content: 'Hola mundo' } }] })
      }),
    )

    await expect(
      translateText('Hello world', 'es', 'en', { config: externalApiConfig, onPartial: () => {} }),
    ).resolves.toBe('Hola mundo')
    expect(requestBodies).toHaveLength(2)
  })

  it('When neither attempt carries text, Then it reports the missing translation', async () => {
    server.use(
      http.post(CHAT_COMPLETIONS_URL, () =>
        HttpResponse.json({ choices: [{ message: { content: '' } }] }),
      ),
    )

    await expect(
      translateText('Hello world', 'es', 'en', { config: externalApiConfig, onPartial: () => {} }),
    ).rejects.toThrow('externalApiMissingTranslation')
  })

  it('When the server rejects streaming, Then it retries without the stream flag and still translates', async () => {
    const requestBodies: ChatCompletionRequestBody[] = []
    server.use(
      http.post(CHAT_COMPLETIONS_URL, async ({ request }) => {
        const requestBody = await request.json() as ChatCompletionRequestBody
        requestBodies.push(requestBody)
        if (requestBody.stream) return new HttpResponse(null, { status: 400 })

        return HttpResponse.json({ choices: [{ message: { content: 'Hola mundo' } }] })
      }),
    )

    await expect(
      translateText('Hello world', 'es', 'en', { config: externalApiConfig, onPartial: () => {} }),
    ).resolves.toBe('Hola mundo')
    expect(requestBodies.map((body) => body.stream)).toEqual([true, undefined])
  })

  it('When a server ignores the stream flag and answers with one JSON body, Then it reads that translation', async () => {
    server.use(
      http.post(CHAT_COMPLETIONS_URL, () =>
        HttpResponse.json({ choices: [{ message: { content: 'Hola mundo' } }] }),
      ),
    )

    await expect(
      translateText('Hello world', 'es', 'en', { config: externalApiConfig, onPartial: () => {} }),
    ).resolves.toBe('Hola mundo')
  })
})

describe('Given the free MyMemory service', () => {
  it('When it answers with a translation, Then that text is returned', async () => {
    server.use(
      http.get(MYMEMORY_URL, ({ request }) => {
        const url = new URL(request.url)
        if (
          url.searchParams.get('q') !== 'Hello world'
          || url.searchParams.get('langpair') !== 'en|es'
        ) {
          return new HttpResponse(null, { status: 400 })
        }

        return HttpResponse.json({
          responseStatus: 200,
          quotaFinished: false,
          responseData: { translatedText: 'Hola mundo' },
        })
      }),
    )

    await expect(
      translateText('Hello world', 'es', 'en', { config: myMemoryConfig }),
    ).resolves.toBe('Hola mundo')
  })

  it('When the daily quota is used up, Then it reports the quota error', async () => {
    server.use(
      http.get(MYMEMORY_URL, () => HttpResponse.json({
        responseStatus: 200,
        quotaFinished: true,
        responseData: {
          translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY',
        },
      })),
    )

    await expect(
      translateText('Hello world', 'es', 'en', { config: myMemoryConfig }),
    ).rejects.toThrow('mymemoryQuotaExceeded')
  })

  it('When the service rejects the language pair, Then it reports the failed request', async () => {
    server.use(
      http.get(MYMEMORY_URL, () => HttpResponse.json({
        responseStatus: '403',
        responseDetails: "'XX' IS AN INVALID TARGET LANGUAGE",
        responseData: { translatedText: '...' },
      })),
    )

    await expect(
      translateText('Hello world', 'es', 'en', { config: myMemoryConfig }),
    ).rejects.toThrow('mymemoryRequestFailed:403')
  })

  it('When the service answers without a translation, Then it reports a failed translation', async () => {
    server.use(
      http.get(MYMEMORY_URL, () => HttpResponse.json({
        responseStatus: 200,
        quotaFinished: false,
        responseData: { translatedText: '   ' },
      })),
    )

    await expect(
      translateText('Hello world', 'es', 'en', { config: myMemoryConfig }),
    ).rejects.toThrow('translationFailed')
  })

  it('When the request itself fails, Then it reports the failed request', async () => {
    server.use(http.get(MYMEMORY_URL, () => new HttpResponse(null, { status: 503 })))

    await expect(
      translateText('Hello world', 'es', 'en', { config: myMemoryConfig }),
    ).rejects.toThrow('mymemoryRequestFailed:503')
  })
})

describe('Given the Baidu Translate API', () => {
  it('When it answers with a translation, Then the request is signed and the text is returned', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    server.use(
      http.get(BAIDU_URL, ({ request }) => {
        const url = new URL(request.url)
        if (
          url.searchParams.get('q') !== 'Hello world'
          || url.searchParams.get('from') !== 'en'
          || url.searchParams.get('to') !== 'spa'
          || url.searchParams.get('appid') !== 'appid123'
          || url.searchParams.get('salt') !== '1700000000000'
          || url.searchParams.get('sign') !== '3e76246a685aa08a7d19b925d70021e2'
        ) {
          return new HttpResponse(null, { status: 400 })
        }

        return HttpResponse.json({
          from: 'en',
          to: 'es',
          trans_result: [{ src: 'Hello world', dst: 'Hola mundo' }],
        })
      }),
    )

    await expect(
      translateText('Hello world', 'es', 'en', { config: baiduConfig }),
    ).resolves.toBe('Hola mundo')
  })

  it('When Japanese is translated, Then Baidu receives its own language code', async () => {
    const requestUrls: string[] = []
    server.use(
      http.get(BAIDU_URL, ({ request }) => {
        requestUrls.push(request.url)
        return HttpResponse.json({ trans_result: [{ dst: '你好' }] })
      }),
    )

    await expect(
      translateText('こんにちは', 'zh', 'ja', { config: baiduConfig }),
    ).resolves.toBe('你好')

    const url = new URL(requestUrls[0] ?? '')
    expect(url.searchParams.get('from')).toBe('jp')
    expect(url.searchParams.get('to')).toBe('zh')
  })

  it('When the API reports an error, Then it reports the failed request with that code', async () => {
    server.use(
      http.get(BAIDU_URL, () => HttpResponse.json({
        error_code: '54001',
        error_msg: 'Invalid Sign',
      })),
    )

    await expect(
      translateText('Hello world', 'es', 'en', { config: baiduConfig }),
    ).rejects.toThrow('baiduRequestFailed:54001')
  })

  it('When the App ID is missing, Then it stops before sending a request', async () => {
    await expect(
      translateText('Hello world', 'es', 'en', {
        config: { ...baiduConfig, appId: '' },
      }),
    ).rejects.toThrow('baiduMissingAppId')
  })

  it('When the secret is missing, Then it stops before sending a request', async () => {
    await expect(
      translateText('Hello world', 'es', 'en', {
        config: { ...baiduConfig, apiKey: '' },
      }),
    ).rejects.toThrow('baiduMissingKey')
  })

  it('When the response carries no translation, Then it reports a failed translation', async () => {
    server.use(
      http.get(BAIDU_URL, () => HttpResponse.json({ trans_result: [] })),
    )

    await expect(
      translateText('Hello world', 'es', 'en', { config: baiduConfig }),
    ).rejects.toThrow('translationFailed')
  })

  it('When the request never reaches Baidu, Then it reports a network failure', async () => {
    server.use(http.get(BAIDU_URL, () => HttpResponse.error()))

    await expect(
      translateText('Hello world', 'es', 'en', { config: baiduConfig }),
    ).rejects.toThrow('baiduNetworkFailed')
  })

  it('When the service answers with a body that is not JSON, Then it reports an unreadable response', async () => {
    server.use(
      http.get(BAIDU_URL, () => new HttpResponse('<html>blocked</html>', {
        headers: { 'content-type': 'text/html' },
      })),
    )

    await expect(
      translateText('Hello world', 'es', 'en', { config: baiduConfig }),
    ).rejects.toThrow('baiduInvalidResponse')
  })
})
