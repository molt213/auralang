const translations = {
  'zh-CN': {
    title: 'AuraLang 已安装',
    subtitle: '将扩展固定到工具栏，即可一键使用实时翻译。',
    step1a: '点击 Chrome 地址栏中的',
    step1b: '图标。',
    step2: '在列表中找到 AuraLang，点击图钉将它固定。',
    hint: '↑ 它位于右上角、搜索栏旁边。',
  },
  es: {
    title: 'AuraLang instalado',
    subtitle: 'Fija la extensión para acceder a la traducción en tiempo real con un clic.',
    step1a: 'Haz clic en el icono de piezas de puzzle',
    step1b: 'en la barra de direcciones de Chrome.',
    step2: 'Busca AuraLang en la lista y haz clic en la chincheta para fijarlo.',
    hint: 'Está arriba a la derecha, junto a la barra de búsqueda.',
  },
  en: {
    title: 'AuraLang installed',
    subtitle: 'Pin the extension to get one-click access to real-time translation.',
    step1a: 'Click the puzzle piece icon',
    step1b: 'in Chrome’s address bar.',
    step2: 'Find AuraLang in the list and click the pin to keep it visible.',
    hint: '↑ It’s in the top right, next to the search bar.',
  },
} as const

type Locale = keyof typeof translations

function resolveLocale(): Locale {
  const browserLanguage = navigator.language.toLowerCase()
  if (
    browserLanguage === 'zh' ||
    browserLanguage.startsWith('zh-cn') ||
    browserLanguage.startsWith('zh-sg') ||
    browserLanguage.includes('-hans')
  ) {
    return 'zh-CN'
  }
  return browserLanguage.startsWith('es') ? 'es' : 'en'
}

function applyTranslations(): void {
  const locale = resolveLocale()
  const dict = translations[locale]
  document.documentElement.lang = locale

  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = el.dataset.i18n as keyof typeof dict | undefined
    if (key && dict[key]) {
      el.textContent = dict[key]
    }
  }
}

applyTranslations()
