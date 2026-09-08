import { useEffect, useRef, useState } from 'react'
import { getGame, type GameId } from '../data/games'
import { getWebApp } from '../lib/telegram'
import { PokerGame } from '../games/PokerGame'
import { PokerOnline } from '../games/poker/PokerOnline'
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
  pokerRoomCode,
}: {
  gameId: GameId
  onBack: () => void
  onHaptic?: (t?: 'light' | 'medium' | 'success' | 'error') => void
  durakRoomCode?: string | null
  chessRoomCode?: string | null
  checkersRoomCode?: string | null
  pokerRoomCode?: string | null
}) {
  const meta = getGame(gameId)
  const immersive = gameId === 'durak' || gameId === 'poker'
  const isBoardGame = gameId === 'chess' || gameId === 'checkers' || gameId === 'solitaire'
  const hideShellTitle = gameId === 'chess' || gameId === 'checkers'
  const inTelegram = typeof document !== 'undefined' && document.body.classList.contains('tg-webapp')
  const showTopbar = !immersive && (!inTelegram || !hideShellTitle)
  const [durakMode, setDurakMode] = useState<PlayMode>(durakRoomCode ? 'online' : 'pick')
  const [chessMode, setChessMode] = useState<PlayMode>(chessRoomCode ? 'online' : 'pick')
  const [checkersMode, setCheckersMode] = useState<PlayMode>(checkersRoomCode ? 'online' : 'pick')
  const [pokerMode, setPokerMode] = useState<PlayMode>(pokerRoomCode ? 'online' : 'pick')
  const onBackRef = useRef(onBack)
  const durakModeRef = useRef(durakMode)
  const chessModeRef = useRef(chessMode)
  const checkersModeRef = useRef(checkersMode)
  const pokerModeRef = useRef(pokerMode)
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
    pokerModeRef.current = pokerMode
  }, [pokerMode])
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
    if (pokerRoomCode) setPokerMode('online')
  }, [pokerRoomCode])

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
      if (id === 'poker' && pokerModeRef.current !== 'pick') {
        setPokerMode('pick')
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
  }, [gameId, durakMode, chessMode, checkersMode, pokerMode])

  const modePick = (
    title: string,
    onBot: () => void,
    onOnline: () => void,
    botHint = 'Тренировка один на один',
    onlineHint = 'Комнаты в лобби · 1 на 1',
  ) => (
    <div className="durak-mode-pick">
      <div className="mode-pick-panel">
        <p className="mode-pick-kicker">
          Play<em>fort</em>
        </p>
        <h2>{title}</h2>
        <p className="mode-pick-lead">Выберите режим</p>
        <div className="mode-pick-actions">
          <button
            type="button"
            className="mode-pick-option mode-pick-option--bot"
            onClick={() => {
              onBot()
              onHaptic?.('medium')
            }}
          >
            <span className="mode-pick-option-title">Против бота</span>
            <span className="mode-pick-option-hint">{botHint}</span>
          </button>
          <button
            type="button"
            className="mode-pick-option mode-pick-option--online"
            onClick={() => {
              onOnline()
              onHaptic?.('medium')
            }}
          >
            <span className="mode-pick-option-title">С другом онлайн</span>
            <span className="mode-pick-option-hint">{onlineHint}</span>
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div
      className={`game-shell${gameId === 'durak' ? ' game-shell--durak' : ''}${gameId === 'poker' ? ' game-shell--poker' : ''}${isBoardGame ? ' game-shell--board' : ''}${immersive ? ' game-shell--immersive' : ''}`}
    >
      {showTopbar && (
        <header className={`game-topbar${inTelegram ? ' game-topbar--tg-back' : ''}`}>
          {!inTelegram && (
            <button type="button" className="back-btn" onClick={onBack} aria-label="Назад">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          )}
          {!hideShellTitle && <h1>{meta?.title ?? 'Игра'}</h1>}
        </header>
      )}
      <div
        className={`game-body ${immersive ? 'game-body--felt' : ''}${gameId === 'poker' ? ' game-body--poker' : ''}${isBoardGame ? ' game-body--board' : ''}`}
      >
        {gameId === 'poker' &&
          pokerMode === 'pick' &&
          modePick(
            'Покер',
            () => setPokerMode('bot'),
            () => setPokerMode('online'),
            'Техасский холдем против ботов',
            'Хедз-ап онлайн · лобби',
          )}
        {gameId === 'poker' && pokerMode === 'bot' && <PokerGame onHaptic={onHaptic} />}
        {gameId === 'poker' && pokerMode === 'online' && (
          <PokerOnline
            initialCode={pokerRoomCode}
            onHaptic={onHaptic}
            onBackToBot={() => setPokerMode('bot')}
          />
        )}

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
