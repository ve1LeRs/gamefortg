import { GAMES, type GameMeta } from '../data/games'
import { GameCover } from './GameCover'
import type { TgUser } from '../hooks/useTelegram'

export function StorePage({
  user,
  onPlay,
}: {
  user: TgUser | null
  onPlay: (id: string) => void
}) {
  const featured = GAMES.filter((g) => g.featured)
  const rest = GAMES

  return (
    <div className="store-page">
      <div className="brand-bar">
        <div className="brand">
          GameFor<em>Tg</em>
        </div>
        <div className="user-chip">
          <div className="user-avatar">
            {user?.photoUrl ? (
              <img src={user.photoUrl} alt="" />
            ) : (
              (user?.firstName?.[0] ?? 'G').toUpperCase()
            )}
          </div>
          <span>{user?.firstName ?? 'Гость'}</span>
        </div>
      </div>

      <section className="hero">
        <div className="hero-bg" />
        <div className="hero-suits" aria-hidden>
          <span>♠</span>
          <span>♥</span>
          <span>♣</span>
          <span>♦</span>
        </div>
        <h1 className="hero-brand">
          GameFor<em>Tg</em>
        </h1>
        <p className="hero-copy">
          Игровой хаб внутри Telegram. Покер, дурак, шахматы, шашки и косынка — без
          установок, сразу на весь экран.
        </p>
        <div className="cta-row">
          <button type="button" className="btn btn-primary" onClick={() => onPlay('poker')}>
            Играть в покер
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => onPlay('durak')}>
            Открыть дурак
          </button>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>В центре внимания</h2>
          <p>Бесплатно</p>
        </div>
        <div className="game-rail">
          {featured.map((game) => (
            <FeaturedTile key={game.id} game={game} onPlay={onPlay} />
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Каталог</h2>
          <p>{rest.length} игр</p>
        </div>
        <div className="game-list">
          {rest.map((game) => (
            <button
              key={game.id}
              type="button"
              className="game-row"
              style={{ '--tile-glow': game.glow } as React.CSSProperties}
              onClick={() => onPlay(game.id)}
            >
              <div className="game-row-art">
                <span>{game.id === 'poker' ? '♠' : game.id === 'durak' ? '♦' : game.id === 'chess' ? '♟' : game.id === 'checkers' ? '●' : '♣'}</span>
              </div>
              <div>
                <h3>{game.title}</h3>
                <p>
                  {game.genre} · {game.players}
                </p>
              </div>
              <span className="play-pill">Играть</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

function FeaturedTile({ game, onPlay }: { game: GameMeta; onPlay: (id: string) => void }) {
  return (
    <button type="button" className="game-tile" onClick={() => onPlay(game.id)}>
      <GameCover game={game} />
      <div className="game-meta">
        <h3>{game.title}</h3>
        <p>{game.tagline}</p>
        <div className="game-tags">
          <span>{game.genre}</span>
          <span>·</span>
          <span>{game.players}</span>
        </div>
      </div>
    </button>
  )
}
