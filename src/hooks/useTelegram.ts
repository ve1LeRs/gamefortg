import { useEffect, useState } from 'react'
import { applyTelegramChrome, getWebApp, requestAppFullscreen } from '../lib/telegram'

export type TgUser = {
  id: number
  firstName: string
  lastName?: string
  username?: string
  photoUrl?: string
}

export function useTelegram() {
  const [ready, setReady] = useState(false)
  const [user, setUser] = useState<TgUser | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    const wa = getWebApp()
    try {
      applyTelegramChrome(wa)
      const u = wa?.initDataUnsafe?.user
      if (u) {
        setUser({
          id: u.id,
          firstName: u.first_name,
          lastName: u.last_name,
          username: u.username,
          photoUrl: u.photo_url,
        })
      }
      setIsFullscreen(!!wa?.isFullscreen)
      wa?.onEvent('fullscreenChanged', () => {
        setIsFullscreen(!!getWebApp()?.isFullscreen)
      })
    } catch {
      // Outside Telegram — fine for local preview
    }
    setReady(true)
  }, [])

  const haptic = (type: 'light' | 'medium' | 'success' | 'error' = 'light') => {
    try {
      const hf = getWebApp()?.HapticFeedback
      if (!hf) return
      if (type === 'success' || type === 'error') {
        hf.notificationOccurred(type)
      } else {
        hf.impactOccurred(type === 'medium' ? 'medium' : 'light')
      }
    } catch {
      /* noop */
    }
  }

  const close = () => {
    try {
      getWebApp()?.close()
    } catch {
      /* noop */
    }
  }

  const enterFullscreen = () => {
    const ok = requestAppFullscreen()
    setIsFullscreen(!!getWebApp()?.isFullscreen)
    return ok
  }

  return {
    ready,
    user,
    haptic,
    close,
    enterFullscreen,
    isFullscreen,
    webApp: getWebApp(),
  }
}
