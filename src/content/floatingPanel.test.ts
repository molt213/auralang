import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'

import {
  FLOATING_PANEL_FRAME_ID,
  FLOATING_PANEL_HOST_ID,
  installFloatingPanel,
} from './floatingPanel'

type StorageGet = (
  key: string,
  callback: (result: Record<string, unknown>) => void,
) => void
type StorageSet = (items: Record<string, unknown>) => void

const storageGet = jest.fn<StorageGet>()
const storageSet = jest.fn<StorageSet>()
const getUrl = jest.fn((path: string) => path === 'src/popup/index.html' ? 'about:blank' : '')

const messages: Record<string, string> = {
  floatingPanelTitle: 'AuraLang',
  floatingPanelMinimize: 'Minimize panel',
  floatingPanelExpand: 'Expand panel',
  floatingPanelClose: 'Close panel',
}

function mockContentChrome(): void {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      i18n: {
        getMessage: (key: string) => messages[key] ?? '',
      },
      runtime: {
        getURL: getUrl,
        lastError: undefined,
      },
      storage: {
        local: {
          get: storageGet,
          set: storageSet,
        },
      },
    },
  })
}

function panelHost(): HTMLElement | null {
  return document.getElementById(FLOATING_PANEL_HOST_ID)
}

function panelShadow(): ShadowRoot {
  const host = panelHost()
  if (!host?.shadowRoot) throw new Error('The floating panel was not installed')
  return host.shadowRoot
}

function clickButton(label: string): void {
  const button = panelShadow().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!button) throw new Error(`The "${label}" button was not found`)
  button.click()
}

beforeEach(() => {
  storageGet.mockReset()
  storageSet.mockReset()
  getUrl.mockClear()
  storageGet.mockImplementation((_key, callback) => callback({}))
  mockContentChrome()
})

afterEach(() => {
  const host = panelHost() as (HTMLElement & { __auralangPanelDispose?: () => void }) | null
  host?.__auralangPanelDispose?.()
  document.body.replaceChildren()
  Reflect.deleteProperty(globalThis, 'chrome')
})

describe('Given a page where the AuraLang icon was clicked', () => {
  it('When the floating panel is installed, Then it loads the panel UI in an iframe', () => {
    installFloatingPanel()

    const host = panelHost()
    expect(host).not.toBeNull()
    expect(getUrl).toHaveBeenCalledWith('src/popup/index.html')
    expect(panelShadow().querySelector(`#${FLOATING_PANEL_FRAME_ID}`)).not.toBeNull()
    expect(panelShadow().querySelector('.bar')?.textContent).toContain('AuraLang')
  })

  it('When the icon is clicked again, Then the existing panel is closed instead of stacked', () => {
    installFloatingPanel()
    const firstHost = panelHost()

    installFloatingPanel()

    expect(firstHost?.isConnected).toBe(false)
    expect(panelHost()).toBeNull()
  })

  it('When the close button is clicked, Then the panel leaves the page', () => {
    installFloatingPanel()

    clickButton('Close panel')

    expect(panelHost()).toBeNull()
  })

  it('When the minimize button is clicked, Then the panel collapses to its title bar and can expand again', () => {
    installFloatingPanel()
    const host = panelHost()

    clickButton('Minimize panel')
    expect(host?.style.height).toBe('34px')
    expect(panelShadow().querySelector('.frame')?.classList.contains('is-collapsed')).toBe(true)

    clickButton('Expand panel')
    expect(host?.style.height).not.toBe('32px')
    expect(panelShadow().querySelector('.frame')?.classList.contains('is-collapsed')).toBe(false)
  })
})

describe('Given a panel position saved from an earlier session', () => {
  it('When the panel opens, Then it restores that position and size', () => {
    storageGet.mockImplementation((_key, callback) => {
      callback({
        auralang_floating_panel_geometry: {
          left: 40,
          top: 50,
          width: 340,
          height: 500,
          collapsed: false,
        },
      })
    })

    installFloatingPanel()

    const host = panelHost()
    expect(host?.style.left).toBe('40px')
    expect(host?.style.top).toBe('50px')
    expect(host?.style.width).toBe('340px')
    expect(host?.style.height).toBe('500px')
  })

  it('When the saved panel was minimized, Then it opens minimized', () => {
    storageGet.mockImplementation((_key, callback) => {
      callback({
        auralang_floating_panel_geometry: {
          left: 40,
          top: 50,
          width: 340,
          height: 500,
          collapsed: true,
        },
      })
    })

    installFloatingPanel()

    expect(panelHost()?.style.height).toBe('34px')
    expect(panelShadow().querySelector('.frame')?.classList.contains('is-collapsed')).toBe(true)
  })
})
