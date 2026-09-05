import { GAMES } from '../data/games'
import { GameCover } from './GameCover'

export function LibraryPage({ onPlay }: { onPlay: (id: string) => void }) {
  return (
    <div className="library-page">
      <h1 className="page-title">Библиотека</h1>
      <p className="page-sub">Все установленные игры GameForTg — всегда под рукой.</p>
      <div className="library-grid">
        {GAMES.map((game, i) => (
          <button
            key={game.id}
            type="button"
            className="lib-card"
            style={{ animationDelay: `${i * 0.05}s` }}
            onClick={() => onPlay(game.id)}
          >
            <GameCover game={game} square />
            <div className="game-meta">
              <h3>{game.title}</h3>
              <p>{game.genre}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
