import { useState, useEffect, useCallback, useRef } from 'react'
import type { TranslationConfig, UserConfig } from '../../types'
import { detectBrowserLocale } from '../i18n'

const STORAGE_KEY = 'auralang_config'

function detectPreferredTheme(): 'dark' | 'light' {
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

const DEFAULT_CONFIG: UserConfig = {
  targetLanguage: 'es',
  sourceLanguage: 'en',
  uiLanguage: detectBrowserLocale(),
  uiTheme: detectPreferredTheme(),
  asrMode: 'auto',
  voiceVolume: 1,
  // Low by default: original audio is a quiet background under the translation.
  originalVolume: 0.15,
  translation: {
    provider: 'google',
    baseUrl: '',
    model: '',
    apiKey: '',
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function storedString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function storedVolume(value: unknown, fallback: number): number {
  return typeof value === 'number' && value >= 0 && value <= 1 ? value : fallback
}

function storedTranslationConfig(value: unknown, fallback: TranslationConfig): TranslationConfig {
  if (!isRecord(value)) return fallback

  return {
    provider: value.provider === 'openai-compatible' ? 'openai-compatible' : 'google',
    baseUrl: storedString(value.baseUrl, fallback.baseUrl),
    model: storedString(value.model, fallback.model),
    apiKey: storedString(value.apiKey, fallback.apiKey),
  }
}

interface UseUserConfigReturn {
  config: UserConfig
  isLoaded: boolean
  error: string | null
  updateField: <K extends keyof UserConfig>(key: K, value: UserConfig[K]) => void
}

export function useApiConfig(): UseUserConfigReturn {
  const [config, setConfig] = useState<UserConfig>(DEFAULT_CONFIG)
  const [isLoaded, setIsLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isInitialLoad = useRef(true)

  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      if (chrome.runtime.lastError) {
        setError(chrome.runtime.lastError.message ?? 'Failed to load config')
        setIsLoaded(true)
        return
      }
      if (isRecord(result[STORAGE_KEY])) {
        const stored = result[STORAGE_KEY]
        setConfig((prev) => ({
          ...prev,
          targetLanguage: storedString(stored.targetLanguage, prev.targetLanguage),
          sourceLanguage: storedString(stored.sourceLanguage, prev.sourceLanguage),
          uiLanguage: stored.uiLanguage === 'es' ? 'es' : stored.uiLanguage === 'en' ? 'en' : prev.uiLanguage,
          uiTheme: stored.uiTheme === 'light' ? 'light' : stored.uiTheme === 'dark' ? 'dark' : prev.uiTheme,
          asrMode: stored.asrMode === 'light' || stored.asrMode === 'balanced' || stored.asrMode === 'auto'
            ? stored.asrMode
            : prev.asrMode,
          voiceVolume: storedVolume(stored.voiceVolume, prev.voiceVolume),
          originalVolume: storedVolume(stored.originalVolume, prev.originalVolume),
          translation: storedTranslationConfig(stored.translation, prev.translation),
        }))
      }
      setIsLoaded(true)
    })
  }, [])

  useEffect(() => {
    if (!isLoaded || isInitialLoad.current) {
      if (isLoaded) isInitialLoad.current = false
      return
    }

    const timer = setTimeout(() => {
      chrome.storage.local.set({ [STORAGE_KEY]: config }, () => {
        if (chrome.runtime.lastError) {
          setError(chrome.runtime.lastError.message ?? 'Failed to save config')
        } else {
          setError(null)
        }
      })
    }, 300)

    return () => clearTimeout(timer)
  }, [config, isLoaded])

  const updateField = useCallback(
    <K extends keyof UserConfig>(key: K, value: UserConfig[K]) => {
      setConfig((prev) => ({ ...prev, [key]: value }))
    },
    [],
  )

  return { config, isLoaded, error, updateField }
}
