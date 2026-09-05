import { useEffect, useState } from 'react'
import WebApp from '@twa-dev/sdk'

export type TgUser = {
  id: number
  firstName: string
  lastName?: string
  username?: string
  photoUrl?: string
}

const THEME = {
  header: '#071018',
  bg: '#071018',
  bottom: '#071018',
} as const

type WebAppExtra = {
  setBottomBarColor?: (color: string) => void
  disableVerticalSwipes?: () => void
  requestFullscreen?: () => void
  isFullscreen?: boolean
  safeAreaInset?: { top: number; bottom: number; left: number; right: number }
  contentSafeAreaInset?: { top: number; bottom: number; left: number; right: number }
  onEvent?: (event: string, cb: () => void) => void
}

function applyTelegramChrome() {
  const wa = WebApp as typeof WebApp & WebAppExtra

  WebApp.ready()
  WebApp.expand()

  try {
    WebApp.setHeaderColor(THEME.header)
  } catch {
    /* older clients */
  }
  try {
    WebApp.setBackgroundColor(THEME.bg)
  } catch {
    /* older clients */
  }
  try {
    wa.setBottomBarColor?.(THEME.bottom)
  } catch {
    /* older clients */
  }
  try {
    wa.disableVerticalSwipes?.()
  } catch {
    /* older clients */
  }

  // True fullscreen (Bot API 8+ / recent Telegram clients)
  try {
    if (!wa.isFullscreen) {
      wa.requestFullscreen?.()
    }
  } catch {
    /* expand() already applied */
  }

  document.body.classList.add('tg-expanded')
  const syncFullscreenClass = () => {
    document.body.classList.toggle('tg-fullscreen', !!wa.isFullscreen)
  }
  syncFullscreenClass()
  wa.onEvent?.('fullscreenChanged', syncFullscreenClass)

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
  }

  syncSafeArea()
  wa.onEvent?.('safeAreaChanged', syncSafeArea)
  wa.onEvent?.('contentSafeAreaChanged', syncSafeArea)
  wa.onEvent?.('fullscreenChanged', syncSafeArea)
}

export function useTelegram() {
  const [ready, setReady] = useState(false)
  const [user, setUser] = useState<TgUser | null>(null)

  useEffect(() => {
    try {
      applyTelegramChrome()
      const u = WebApp.initDataUnsafe?.user
      if (u) {
        setUser({
          id: u.id,
          firstName: u.first_name,
          lastName: u.last_name,
          username: u.username,
          photoUrl: u.photo_url,
        })
      }
    } catch {
      // Outside Telegram — fine for local preview
    }
    setReady(true)
  }, [])

  const haptic = (type: 'light' | 'medium' | 'success' | 'error' = 'light') => {
    try {
      if (type === 'success' || type === 'error') {
        WebApp.HapticFeedback.notificationOccurred(type)
      } else {
        WebApp.HapticFeedback.impactOccurred(type === 'medium' ? 'medium' : 'light')
      }
    } catch {
      /* noop */
    }
  }

  const close = () => {
    try {
      WebApp.close()
    } catch {
      /* noop */
    }
  }

  return { ready, user, haptic, close, webApp: WebApp }
}
