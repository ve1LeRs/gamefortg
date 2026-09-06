import { useEffect, useState } from 'react'
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
  const immersive = gameId === 'durak'
  const [durakMode, setDurakMode] = useState<DurakMode>(durakRoomCode ? 'online' : 'pick')

  useEffect(() => {
    if (durakRoomCode) setDurakMode('online')
  }, [durakRoomCode])

  useEffect(() => {
    if (!immersive) return
    const wa = getWebApp()
    const btn = wa?.BackButton
    if (!btn) return
    const handle = () => {
      if (gameId === 'durak' && durakMode !== 'pick') {
        setDurakMode('pick')
        return
      }
      onBack()
    }
    btn.show()
    btn.onClick(handle)
    return () => {
      btn.offClick(handle)
      btn.hide()
    }
  }, [immersive, onBack, gameId, durakMode])

  return (
    <div
      className={`game-shell${gameId === 'durak' ? ' game-shell--durak' : ''}${immersive ? ' game-shell--immersive' : ''}`}
    >
      {immersive ? (
        <button
          type="button"
          className="durak-float-back"
          onClick={() => {
            if (gameId === 'durak' && durakMode !== 'pick') {
              setDurakMode('pick')
              return
            }
            onBack()
          }}
          aria-label="Назад"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      ) : (
        <header className="game-topbar">
          <button type="button" className="back-btn" onClick={onBack} aria-label="Назад">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <h1>{meta?.title ?? 'Игра'}</h1>
        </header>
      )}
      <div className={`game-body ${immersive ? 'game-body--felt' : ''}`}>
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
