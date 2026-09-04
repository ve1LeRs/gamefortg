import { useEffect, useState } from 'react'
import WebApp from '@twa-dev/sdk'

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

  useEffect(() => {
    try {
      WebApp.ready()
      WebApp.expand()
      WebApp.setHeaderColor('#071018')
      WebApp.setBackgroundColor('#071018')
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
        WebApp.HapticFeedback.impactOccurred(type)
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
