type TgSafeArea = { top: number; bottom: number; left: number; right: number }

export type TelegramWebApp = {
  ready: () => void
  expand: () => void
  close: () => void
  version: string
  platform: string
  isExpanded?: boolean
  isFullscreen?: boolean
  isVersionAtLeast: (version: string) => boolean
  setHeaderColor: (color: string) => void
  setBackgroundColor: (color: string) => void
  setBottomBarColor?: (color: string) => void
  disableVerticalSwipes?: () => void
  requestFullscreen?: () => void
  exitFullscreen?: () => void
  onEvent: (event: string, cb: (...args: unknown[]) => void) => void
  offEvent?: (event: string, cb: (...args: unknown[]) => void) => void
  BackButton?: {
    show: () => void
    hide: () => void
    onClick: (cb: () => void) => void
    offClick: (cb: () => void) => void
    isVisible: boolean
  }
  HapticFeedback?: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void
  }
  initDataUnsafe?: {
    user?: {
      id: number
      first_name: string
      last_name?: string
      username?: string
      photo_url?: string
    }
  }
  safeAreaInset?: TgSafeArea
  contentSafeAreaInset?: TgSafeArea
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp }
  }
}

const THEME = {
  header: '#071018',
  bg: '#071018',
  bottom: '#071018',
} as const

export function getWebApp(): TelegramWebApp | null {
  return window.Telegram?.WebApp ?? null
}

export function requestAppFullscreen(wa = getWebApp()): boolean {
  if (!wa) return false
  try {
    wa.expand()
  } catch {
    /* noop */
  }
  if (wa.isFullscreen) return true
  if (!wa.requestFullscreen) return false
  try {
    if (typeof wa.isVersionAtLeast === 'function' && !wa.isVersionAtLeast('8.0')) {
      return false
    }
    wa.requestFullscreen()
    return true
  } catch {
    return false
  }
}

export function applyTelegramChrome(wa = getWebApp()) {
  if (!wa) return

  try {
    wa.ready()
  } catch {
    /* noop */
  }
  try {
    wa.expand()
  } catch {
    /* noop */
  }

  try {
    wa.setHeaderColor(THEME.header)
  } catch {
    /* noop */
  }
  try {
    wa.setBackgroundColor(THEME.bg)
  } catch {
    /* noop */
  }
  try {
    wa.setBottomBarColor?.(THEME.bottom)
  } catch {
    /* noop */
  }
  try {
    wa.disableVerticalSwipes?.()
  } catch {
    /* noop */
  }

  requestAppFullscreen(wa)

  // Retry a few times — some clients accept fullscreen only after viewport settles
  ;[120, 400, 1000].forEach((ms) => {
    window.setTimeout(() => requestAppFullscreen(wa), ms)
  })

  document.body.classList.add('tg-webapp')

  const syncFullscreenClass = () => {
    document.body.classList.toggle('tg-fullscreen', !!wa.isFullscreen)
    document.body.classList.toggle('tg-expanded', !!wa.isExpanded || !!wa.isFullscreen)
  }
  syncFullscreenClass()

  const root = document.documentElement
  const syncSafeArea = () => {
    const safe = wa.safeAreaInset
    const content = wa.contentSafeAreaInset
    if (safe) {
      root.style.setProperty('--tg-safe-top', `${safe.top}px`)
      root.style.setProperty('--tg-safe-bottom', `${safe.bottom}px`)
      root.style.setProperty('--tg-safe-left', `${safe.left}px`)
      root.style.setProperty('--tg-safe-right', `${safe.right}px`)
    }
    if (content) {
      root.style.setProperty('--tg-content-top', `${content.top}px`)
      root.style.setProperty('--tg-content-bottom', `${content.bottom}px`)
    }
    // Floating «Закрыть» sits over the WebView; if Telegram reports 0,
    // still keep a floor so the store hero never slides under it.
    const reported = Math.max(safe?.top ?? 0, content?.top ?? 0)
    const chromeFloor = wa.isFullscreen || wa.isExpanded ? 72 : 16
    root.style.setProperty('--tg-chrome-top', `${Math.max(reported, chromeFloor)}px`)
  }
  syncSafeArea()

  wa.onEvent('fullscreenChanged', () => {
    syncFullscreenClass()
    syncSafeArea()
  })
  wa.onEvent('fullscreenFailed', () => {
    // Keep expanded max-height even if immersive fullscreen is denied
    try {
      wa.expand()
    } catch {
      /* noop */
    }
    syncFullscreenClass()
  })
  wa.onEvent('safeAreaChanged', syncSafeArea)
  wa.onEvent('contentSafeAreaChanged', syncSafeArea)
  wa.onEvent('viewportChanged', () => {
    requestAppFullscreen(wa)
    syncFullscreenClass()
    syncSafeArea()
  })

  // First user gesture often unlocks fullscreen on iOS/Android Telegram
  const onFirstGesture = () => {
    requestAppFullscreen(wa)
    window.removeEventListener('touchstart', onFirstGesture)
    window.removeEventListener('pointerdown', onFirstGesture)
    window.removeEventListener('click', onFirstGesture)
  }
  window.addEventListener('touchstart', onFirstGesture, { once: true, passive: true })
  window.addEventListener('pointerdown', onFirstGesture, { once: true })
  window.addEventListener('click', onFirstGesture, { once: true })
}
