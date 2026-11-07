import type { FinalTranslationConfig, TranslationConfig } from '../types'
import {
  INDEX_TRANSLATE_BASE_URL,
  indexTranslateModelOrDefault,
} from '../constants/indexTranslate'

// The main service is used for provisional captions; the optional external API
// takes over only for the settled, final translation. Keeping the two roles
// separate means a free service that is slow or unreachable cannot take the
// final LLM translation down with it.
export function resolveFinalTranslationConfig(
  translation: TranslationConfig,
  // Optional at runtime: a panel left open across an extension reload can send
  // a payload from before this field existed.
  finalTranslation: FinalTranslationConfig | undefined,
): TranslationConfig {
  if (!finalTranslation?.enabled) return translation
  if (
    translation.provider === 'openai-compatible'
    || translation.provider === 'index-translate'
  ) {
    return translation
  }

  if (finalTranslation.provider === 'index-translate') {
    return {
      provider: 'index-translate',
      baseUrl: INDEX_TRANSLATE_BASE_URL,
      model: indexTranslateModelOrDefault(finalTranslation.model),
      apiKey: '',
      appId: '',
    }
  }

  return {
    provider: 'openai-compatible',
    baseUrl: finalTranslation.baseUrl ?? '',
    model: finalTranslation.model ?? '',
    apiKey: finalTranslation.apiKey ?? '',
    appId: '',
  }
}
