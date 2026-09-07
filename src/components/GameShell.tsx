import { useEffect, useRef, useState } from 'react'
import { getGame, type GameId } from '../data/games'
import { getWebApp } from '../lib/telegram'
import { PokerGame } from '../games/PokerGame'
import { DurakGame } from '../games/DurakGame'
import { DurakOnline } from '../games/durak/DurakOnline'
import { ChessGame } from '../games/ChessGame'
import { ChessOnline } from '../games/chess/ChessOnline'
import { CheckersGame } from '../games/CheckersGame'
import { CheckersOnline } from '../games/checkers/CheckersOnline'
import { SolitaireGame } from '../games/SolitaireGame'

type PlayMode = 'pick' | 'bot' | 'online'

export function GameShell({
  gameId,
  onBack,
  onHaptic,
  durakRoomCode,
  chessRoomCode,
  checkersRoomCode,
}: {
  gameId: GameId
  onBack: () => void
  onHaptic?: (t?: 'light' | 'medium' | 'success' | 'error') => void
  durakRoomCode?: string | null
  chessRoomCode?: string | null
  checkersRoomCode?: string | null
}) {
  const meta = getGame(gameId)
  const immersive = gameId === 'durak' || gameId === 'poker'
  const isBoardGame = gameId === 'chess' || gameId === 'checkers' || gameId === 'solitaire'
  const [durakMode, setDurakMode] = useState<PlayMode>(durakRoomCode ? 'online' : 'pick')
  const [chessMode, setChessMode] = useState<PlayMode>(chessRoomCode ? 'online' : 'pick')
  const [checkersMode, setCheckersMode] = useState<PlayMode>(checkersRoomCode ? 'online' : 'pick')
  const inTelegram = typeof document !== 'undefined' && document.body.classList.contains('tg-webapp')
  const onBackRef = useRef(onBack)
  const durakModeRef = useRef(durakMode)
  const chessModeRef = useRef(chessMode)
  const checkersModeRef = useRef(checkersMode)
  const gameIdRef = useRef(gameId)

  useEffect(() => {
    onBackRef.current = onBack
  }, [onBack])
  useEffect(() => {
    durakModeRef.current = durakMode
  }, [durakMode])
  useEffect(() => {
    chessModeRef.current = chessMode
  }, [chessMode])
  useEffect(() => {
    checkersModeRef.current = checkersMode
  }, [checkersMode])
  useEffect(() => {
    gameIdRef.current = gameId
  }, [gameId])

  useEffect(() => {
    if (durakRoomCode) setDurakMode('online')
  }, [durakRoomCode])
  useEffect(() => {
    if (chessRoomCode) setChessMode('online')
  }, [chessRoomCode])
  useEffect(() => {
    if (checkersRoomCode) setCheckersMode('online')
  }, [checkersRoomCode])

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

  useEffect(() => {
    const wa = getWebApp()
    const btn = wa?.BackButton
    if (!btn) return

    let alive = true
    const handle = () => {
      const id = gameIdRef.current
      if (id === 'durak' && durakModeRef.current !== 'pick') {
        setDurakMode('pick')
        return
      }
      if (id === 'chess' && chessModeRef.current !== 'pick') {
        setChessMode('pick')
        return
      }
      if (id === 'checkers' && checkersModeRef.current !== 'pick') {
        setCheckersMode('pick')
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

  useEffect(() => {
    try {
      getWebApp()?.BackButton?.show()
    } catch {
      /* noop */
    }
  }, [gameId, durakMode, chessMode, checkersMode])

  const modePick = (
    title: string,
    onBot: () => void,
    onOnline: () => void,
  ) => (
    <div className="durak-mode-pick">
      <h2>{title}</h2>
      <p>Выберите режим</p>
      <button
        type="button"
        className="durak-btn durak-btn-primary"
        onClick={() => {
          onBot()
          onHaptic?.('medium')
        }}
      >
        Против бота
      </button>
      <button
        type="button"
        className="durak-btn durak-btn-bito"
        onClick={() => {
          onOnline()
          onHaptic?.('medium')
        }}
      >
        С другом онлайн
      </button>
    </div>
  )

  return (
    <div
      className={`game-shell${gameId === 'durak' ? ' game-shell--durak' : ''}${gameId === 'poker' ? ' game-shell--poker' : ''}${isBoardGame ? ' game-shell--board' : ''}${immersive ? ' game-shell--immersive' : ''}`}
    >
      {!immersive && (
        <header className={`game-topbar${inTelegram ? ' game-topbar--tg-back' : ''}`}>
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

        {gameId === 'durak' && durakMode === 'pick' && modePick('Дурак', () => setDurakMode('bot'), () => setDurakMode('online'))}
        {gameId === 'durak' && durakMode === 'bot' && <DurakGame onHaptic={onHaptic} />}
        {gameId === 'durak' && durakMode === 'online' && (
          <DurakOnline
            initialCode={durakRoomCode}
            onHaptic={onHaptic}
            onBackToBot={() => setDurakMode('bot')}
          />
        )}

        {gameId === 'chess' && chessMode === 'pick' && modePick('Шахматы', () => setChessMode('bot'), () => setChessMode('online'))}
        {gameId === 'chess' && chessMode === 'bot' && <ChessGame onHaptic={onHaptic} />}
        {gameId === 'chess' && chessMode === 'online' && (
          <ChessOnline
            initialCode={chessRoomCode}
            onHaptic={onHaptic}
            onBackToBot={() => setChessMode('bot')}
          />
        )}

        {gameId === 'checkers' &&
          checkersMode === 'pick' &&
          modePick('Шашки', () => setCheckersMode('bot'), () => setCheckersMode('online'))}
        {gameId === 'checkers' && checkersMode === 'bot' && <CheckersGame onHaptic={onHaptic} />}
        {gameId === 'checkers' && checkersMode === 'online' && (
          <CheckersOnline
            initialCode={checkersRoomCode}
            onHaptic={onHaptic}
            onBackToBot={() => setCheckersMode('bot')}
          />
        )}

        {gameId === 'solitaire' && <SolitaireGame onHaptic={onHaptic} />}
      </div>
    </div>
  )
}
