// Bilibili's Index-Translate family is served from a free, keyless
// OpenAI-compatible endpoint. The base URL and host are fixed so the preset
// cannot be pointed somewhere else by a stale stored value.
export const INDEX_TRANSLATE_BASE_URL = 'https://index-translate.bilibili.com/v1'
export const INDEX_TRANSLATE_ORIGIN = 'https://index-translate.bilibili.com/*'
export const INDEX_TRANSLATE_DEFAULT_MODEL = 'Index-Translate-35B-A3B'

export const INDEX_TRANSLATE_MODEL_IDS = [
  'Index-Translate-35B-A3B',
  'Index-Translate-9B',
  'Index-Translate-2B',
] as const

export type IndexTranslateModel = (typeof INDEX_TRANSLATE_MODEL_IDS)[number]

export function isIndexTranslateModel(value: string): value is IndexTranslateModel {
  return (INDEX_TRANSLATE_MODEL_IDS as readonly string[]).includes(value)
}

export function indexTranslateModelOrDefault(value: string): IndexTranslateModel {
  return isIndexTranslateModel(value) ? value : INDEX_TRANSLATE_DEFAULT_MODEL
}
