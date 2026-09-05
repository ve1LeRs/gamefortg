import { useEffect } from 'react'
import { getGame, type GameId } from '../data/games'
import { getWebApp } from '../lib/telegram'
import { PokerGame } from '../games/PokerGame'
import { DurakGame } from '../games/DurakGame'
import { ChessGame } from '../games/ChessGame'
import { CheckersGame } from '../games/CheckersGame'
import { SolitaireGame } from '../games/SolitaireGame'

export function GameShell({
  gameId,
  onBack,
  onHaptic,
}: {
  gameId: GameId
  onBack: () => void
  onHaptic?: (t?: 'light' | 'medium' | 'success' | 'error') => void
}) {
  const meta = getGame(gameId)
  const immersive = gameId === 'durak'

  useEffect(() => {
    if (!immersive) return
    const wa = getWebApp()
    const btn = wa?.BackButton
    if (!btn) return
    const handle = () => onBack()
    btn.show()
    btn.onClick(handle)
    return () => {
      btn.offClick(handle)
      btn.hide()
    }
  }, [immersive, onBack])

  return (
    <div
      className={`game-shell${gameId === 'durak' ? ' game-shell--durak' : ''}${immersive ? ' game-shell--immersive' : ''}`}
    >
      {immersive ? (
        <button type="button" className="durak-float-back" onClick={onBack} aria-label="Назад">
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
        {gameId === 'durak' && <DurakGame onHaptic={onHaptic} />}
        {gameId === 'chess' && <ChessGame onHaptic={onHaptic} />}
        {gameId === 'checkers' && <CheckersGame onHaptic={onHaptic} />}
        {gameId === 'solitaire' && <SolitaireGame onHaptic={onHaptic} />}
      </div>
    </div>
  )
}
