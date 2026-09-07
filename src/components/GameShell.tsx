import { useEffect, useRef, useState } from 'react'
import { getGame, type GameId } from '../data/games'
import { getWebApp } from '../lib/telegram'
import { PokerGame } from '../games/PokerGame'
import { DurakGame } from '../games/DurakGame'
import { DurakOnline } from '../games/durak/DurakOnline'
import { ChessGame } from '../games/ChessGame'
import { CheckersGame } from '../games/CheckersGame'
import { SolitaireGame } from '../games/SolitaireGame'

type DurakMode = 'pick' | 'bot' | 'online'

export function GameShell({
  gameId,
  onBack,
  onHaptic,
  durakRoomCode,
}: {
  gameId: GameId
  onBack: () => void
  onHaptic?: (t?: 'light' | 'medium' | 'success' | 'error') => void
  durakRoomCode?: string | null
}) {
  const meta = getGame(gameId)
  const immersive = gameId === 'durak' || gameId === 'poker'
  const isBoardGame = gameId === 'chess' || gameId === 'checkers' || gameId === 'solitaire'
  const [durakMode, setDurakMode] = useState<DurakMode>(durakRoomCode ? 'online' : 'pick')
  const inTelegram = typeof document !== 'undefined' && document.body.classList.contains('tg-webapp')
  const onBackRef = useRef(onBack)
  const durakModeRef = useRef(durakMode)
  const gameIdRef = useRef(gameId)

  useEffect(() => {
    onBackRef.current = onBack
  }, [onBack])
  useEffect(() => {
    durakModeRef.current = durakMode
  }, [durakMode])
  useEffect(() => {
    gameIdRef.current = gameId
  }, [gameId])

  useEffect(() => {
    if (durakRoomCode) setDurakMode('online')
  }, [durakRoomCode])

  // Poker prefers landscape, but must NOT lock orientation — locking freezes
  // the current (often portrait) orientation and the table never flips.
  useEffect(() => {
    if (gameId !== 'poker') return
    const wa = getWebApp()
    try {
      wa?.unlockOrientation?.()
    } catch {
      /* noop */
    }
    try {
      screen.orientation?.unlock?.()
    } catch {
      /* noop */
    }
    document.body.classList.add('poker-landscape-active')
    return () => {
      document.body.classList.remove('poker-landscape-active')
      try {
        wa?.unlockOrientation?.()
      } catch {
        /* noop */
      }
    }
  }, [gameId])

  // Native Telegram BackButton — «Назад» only while a game is open.
  useEffect(() => {
    const wa = getWebApp()
    const btn = wa?.BackButton
    if (!btn) return

    let alive = true
    const handle = () => {
      if (gameIdRef.current === 'durak' && durakModeRef.current !== 'pick') {
        setDurakMode('pick')
        return
      }
      onBackRef.current()
    }

    const showBack = () => {
      if (!alive) return
      try {
        btn.show()
      } catch {
        /* noop */
      }
    }

    btn.onClick(handle)
    showBack()
    // Fullscreen / viewport changes can restore «Закрыть» — re-assert Back in-game only.
    wa.onEvent('fullscreenChanged', showBack)
    wa.onEvent('viewportChanged', showBack)
    const timers = [0, 120, 400, 1000].map((ms) => window.setTimeout(showBack, ms))

    return () => {
      alive = false
      timers.forEach((id) => window.clearTimeout(id))
      wa.offEvent?.('fullscreenChanged', showBack)
      wa.offEvent?.('viewportChanged', showBack)
      btn.offClick(handle)
      try {
        btn.hide()
      } catch {
        /* noop */
      }
    }
  }, [])

  // Re-show when entering a game / changing Durak mode without tearing down the listener.
  useEffect(() => {
    try {
      getWebApp()?.BackButton?.show()
    } catch {
      /* noop */
    }
  }, [gameId, durakMode])

  return (
    <div
      className={`game-shell${gameId === 'durak' ? ' game-shell--durak' : ''}${gameId === 'poker' ? ' game-shell--poker' : ''}${isBoardGame ? ' game-shell--board' : ''}${immersive ? ' game-shell--immersive' : ''}`}
    >
      {!immersive && (
        <header className={`game-topbar${inTelegram ? ' game-topbar--tg-back' : ''}`}>
          {/* Never show an in-app chevron inside Telegram — only native BackButton */}
          {!inTelegram && (
            <button type="button" className="back-btn" onClick={onBack} aria-label="Назад">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          )}
          <h1>{meta?.title ?? 'Игра'}</h1>
        </header>
      )}
      <div
        className={`game-body ${immersive ? 'game-body--felt' : ''}${gameId === 'poker' ? ' game-body--poker' : ''}${isBoardGame ? ' game-body--board' : ''}`}
      >
        {gameId === 'poker' && <PokerGame onHaptic={onHaptic} />}
        {gameId === 'durak' && durakMode === 'pick' && (
          <div className="durak-mode-pick">
            <h2>Дурак</h2>
            <p>Выберите режим</p>
            <button
              type="button"
              className="durak-btn durak-btn-primary"
              onClick={() => {
                setDurakMode('bot')
                onHaptic?.('medium')
              }}
            >
              Против бота
            </button>
            <button
              type="button"
              className="durak-btn durak-btn-bito"
              onClick={() => {
                setDurakMode('online')
                onHaptic?.('medium')
              }}
            >
              С другом онлайн
            </button>
          </div>
        )}
        {gameId === 'durak' && durakMode === 'bot' && <DurakGame onHaptic={onHaptic} />}
        {gameId === 'durak' && durakMode === 'online' && (
          <DurakOnline
            initialCode={durakRoomCode}
            onHaptic={onHaptic}
            onBackToBot={() => setDurakMode('bot')}
          />
        )}
        {gameId === 'chess' && <ChessGame onHaptic={onHaptic} />}
        {gameId === 'checkers' && <CheckersGame onHaptic={onHaptic} />}
        {gameId === 'solitaire' && <SolitaireGame onHaptic={onHaptic} />}
      </div>
    </div>
  )
}
