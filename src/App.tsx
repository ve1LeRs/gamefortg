import { useCallback, useEffect, useState } from 'react'
import { StorePage } from './components/StorePage'
import { LibraryPage } from './components/LibraryPage'
import { ProfilePage } from './components/ProfilePage'
import { GameShell } from './components/GameShell'
import { TabNav, type Tab } from './components/TabNav'
import { useTelegram } from './hooks/useTelegram'
import type { GameId } from './data/games'
import { getGame } from './data/games'

const PLAYS_KEY = 'gamefort-plays'

function loadPlays(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(PLAYS_KEY) ?? '{}')
  } catch {
    return {}
  }
}

export default function App() {
  const { user, haptic } = useTelegram()
  const [tab, setTab] = useState<Tab>('store')
  const [activeGame, setActiveGame] = useState<GameId | null>(null)
  const [plays, setPlays] = useState<Record<string, number>>(loadPlays)

  useEffect(() => {
    localStorage.setItem(PLAYS_KEY, JSON.stringify(plays))
  }, [plays])

  const play = useCallback(
    (id: string) => {
      if (!getGame(id)) return
      setActiveGame(id as GameId)
      setPlays((p) => ({ ...p, [id]: (p[id] ?? 0) + 1 }))
      haptic('medium')
    },
    [haptic],
  )

  const back = () => {
    setActiveGame(null)
    haptic('light')
  }

  if (activeGame) {
    return (
      <div className="app-shell">
        <main className="app-main game-mode">
          <GameShell gameId={activeGame} onBack={back} onHaptic={haptic} />
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
