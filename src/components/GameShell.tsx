import { getGame, type GameId } from '../data/games'
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

  return (
    <div className={`game-shell ${gameId === 'durak' ? 'game-shell--durak' : ''}`}>
      <header className="game-topbar">
        <button type="button" className="back-btn" onClick={onBack} aria-label="Назад">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h1>{meta?.title ?? 'Игра'}</h1>
      </header>
      <div className={`game-body ${gameId === 'durak' ? 'game-body--felt' : ''}`}>
        {gameId === 'poker' && <PokerGame onHaptic={onHaptic} />}
        {gameId === 'durak' && <DurakGame onHaptic={onHaptic} />}
        {gameId === 'chess' && <ChessGame onHaptic={onHaptic} />}
        {gameId === 'checkers' && <CheckersGame onHaptic={onHaptic} />}
        {gameId === 'solitaire' && <SolitaireGame onHaptic={onHaptic} />}
      </div>
    </div>
  )
}
