import { useCallback, useEffect, useState } from 'react'
import { StorePage } from './components/StorePage'
import { LibraryPage } from './components/LibraryPage'
import { ProfilePage } from './components/ProfilePage'
import { GameShell } from './components/GameShell'
import { TabNav, type Tab } from './components/TabNav'
import { useTelegram } from './hooks/useTelegram'
import { getWebApp } from './lib/telegram'
import type { GameId } from './data/games'
import { getGame } from './data/games'

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

  useEffect(() => {
    localStorage.setItem(PLAYS_KEY, JSON.stringify(plays))
  }, [plays])

  useEffect(() => {
    const fromTg = getWebApp()?.initDataUnsafe?.start_param
    const params = new URLSearchParams(window.location.search)
    const fromQuery = params.get('durakRoom') || params.get('tgWebAppStartParam')
    const raw = fromTg || fromQuery
    if (!raw) return
    const m = String(raw).match(/(?:^|[_\-])durak[_-]?([A-Za-z0-9]{4,8})$/i) || String(raw).match(/^([A-Za-z0-9]{4,8})$/)
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
      setActiveGame(id as GameId)
      setPlays((p) => ({ ...p, [id]: (p[id] ?? 0) + 1 }))
      haptic('medium')
    },
    [haptic, enterFullscreen],
  )

  const back = () => {
    setActiveGame(null)
    setDurakRoomCode(null)
    haptic('light')
  }

  if (activeGame) {
    return (
      <div className="app-shell">
        <main className="app-main game-mode">
          <GameShell
            gameId={activeGame}
            onBack={back}
            onHaptic={haptic}
            durakRoomCode={activeGame === 'durak' ? durakRoomCode : null}
          />
        </main>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <main className="app-main">
        {tab === 'store' && <StorePage user={user} onPlay={play} />}
        {tab === 'library' && <LibraryPage onPlay={play} />}
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
