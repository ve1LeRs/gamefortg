import { useCallback, useEffect, useState } from 'react'
import { StorePage } from './components/StorePage'
import { ProfilePage } from './components/ProfilePage'
import { SettingsPage } from './components/SettingsPage'
import { GameShell } from './components/GameShell'
import { TabNav, type Tab } from './components/TabNav'
import { useTelegram } from './hooks/useTelegram'
import { getWebApp } from './lib/telegram'
import type { GameId } from './data/games'
import { getGame } from './data/games'
import { applySettingsToDom, loadSettings, syncWakeLock } from './lib/settings'

const PLAYS_KEY = 'gamefortg-plays'

function loadPlays(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(PLAYS_KEY) ?? '{}')
  } catch {
    return {}
  }
}

export default function App() {
  const { user, haptic, enterFullscreen } = useTelegram()
  const [tab, setTab] = useState<Tab>('store')
  const [activeGame, setActiveGame] = useState<GameId | null>(null)
  const [plays, setPlays] = useState<Record<string, number>>(loadPlays)
  const [durakRoomCode, setDurakRoomCode] = useState<string | null>(null)
  const [chessRoomCode, setChessRoomCode] = useState<string | null>(null)
  const [checkersRoomCode, setCheckersRoomCode] = useState<string | null>(null)

  useEffect(() => {
    applySettingsToDom(loadSettings())
  }, [])

  useEffect(() => {
    localStorage.setItem(PLAYS_KEY, JSON.stringify(plays))
  }, [plays])

  useEffect(() => {
    void syncWakeLock(!!activeGame)
    return () => {
      void syncWakeLock(false)
    }
  }, [activeGame])

  useEffect(() => {
    const fromTg = getWebApp()?.initDataUnsafe?.start_param
    const params = new URLSearchParams(window.location.search)
    const fromQuery =
      params.get('durakRoom') ||
      params.get('chessRoom') ||
      params.get('checkersRoom') ||
      params.get('tgWebAppStartParam')
    const raw = fromTg || fromQuery
    if (!raw) return
    const s = String(raw)
    const chess = s.match(/(?:^|[_\-])chess[_-]?([A-Za-z0-9]{4,8})$/i)
    const checkers = s.match(/(?:^|[_\-])checkers[_-]?([A-Za-z0-9]{4,8})$/i)
    const durak = s.match(/(?:^|[_\-])durak[_-]?([A-Za-z0-9]{4,8})$/i)
    if (chess?.[1]) {
      setChessRoomCode(chess[1].toUpperCase())
      setActiveGame('chess')
      enterFullscreen()
      return
    }
    if (checkers?.[1]) {
      setCheckersRoomCode(checkers[1].toUpperCase())
      setActiveGame('checkers')
      enterFullscreen()
      return
    }
    const m = durak || s.match(/^([A-Za-z0-9]{4,8})$/)
    const code = m?.[1]?.toUpperCase()
    if (!code) return
    setDurakRoomCode(code)
    setActiveGame('durak')
    enterFullscreen()
  }, [enterFullscreen])

  const play = useCallback(
    (id: string) => {
      if (!getGame(id)) return
      enterFullscreen()
      if (id !== 'durak') setDurakRoomCode(null)
      if (id !== 'chess') setChessRoomCode(null)
      if (id !== 'checkers') setCheckersRoomCode(null)
      setActiveGame(id as GameId)
      setPlays((p) => ({ ...p, [id]: (p[id] ?? 0) + 1 }))
      haptic('medium')
    },
    [haptic, enterFullscreen],
  )

  const back = useCallback(() => {
    setActiveGame(null)
    setDurakRoomCode(null)
    setChessRoomCode(null)
    setCheckersRoomCode(null)
    haptic('light')
  }, [haptic])

  // Lobby: Telegram must show «Закрыть», not «Назад».
  useEffect(() => {
    if (activeGame) return
    const wa = getWebApp()
    const btn = wa?.BackButton
    if (!btn) return

    let alive = true
    const hideBack = () => {
      if (!alive) return
      try {
        btn.hide()
      } catch {
        /* noop */
      }
    }

    hideBack()
    const timers = [0, 80, 250, 600, 1200].map((ms) => window.setTimeout(hideBack, ms))
    wa.onEvent('fullscreenChanged', hideBack)
    wa.onEvent('viewportChanged', hideBack)

    return () => {
      alive = false
      timers.forEach((id) => window.clearTimeout(id))
      wa.offEvent?.('fullscreenChanged', hideBack)
      wa.offEvent?.('viewportChanged', hideBack)
    }
  }, [activeGame])

  if (activeGame) {
    return (
      <div className="app-shell">
        <main className="app-main game-mode">
          <GameShell
            gameId={activeGame}
            onBack={back}
            onHaptic={haptic}
            durakRoomCode={activeGame === 'durak' ? durakRoomCode : null}
            chessRoomCode={activeGame === 'chess' ? chessRoomCode : null}
            checkersRoomCode={activeGame === 'checkers' ? checkersRoomCode : null}
          />
        </main>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <main className="app-main">
        {tab === 'store' && <StorePage user={user} onPlay={play} />}
        {tab === 'settings' && <SettingsPage onHaptic={haptic} />}
        {tab === 'profile' && <ProfilePage user={user} plays={plays} />}
      </main>
      <TabNav
        active={tab}
        onChange={(t) => {
          setTab(t)
          haptic('light')
        }}
      />
    </div>
  )
}
