/** @jest-environment node */

import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { translateText } from './translationService'
import type { TranslationConfig } from '../types'

const TRANSLATE_URL = 'https://translate.googleapis.com/translate_a/single'
const CHAT_COMPLETIONS_URL = 'https://api.example.test/v1/chat/completions'

const externalApiConfig = {
  provider: 'openai-compatible',
  apiKey: 'test-api-key',
  baseUrl: 'https://api.example.test/v1',
  model: 'translation-model',
} satisfies TranslationConfig

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
      request.headers.get('authorization') !== 'Bearer test-api-key' ||
      requestBody.model !== 'translation-model' ||
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
afterEach(() => server.resetHandlers())
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
      translateText('Hello world', 'es', 'en', externalApiConfig),
    ).resolves.toBe('Hola mundo')
  })

  it('When the external API key is missing, Then it stops before sending a request', async () => {
    const missingKeyConfig = { ...externalApiConfig, apiKey: '' }

    await expect(
      translateText('Hello world', 'es', 'en', missingKeyConfig),
    ).rejects.toThrow('externalApiMissingKey')
  })
})
