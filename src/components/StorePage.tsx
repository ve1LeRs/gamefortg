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
      <section className="hero">
        <div className="hero-bg" />

        <div className="hero-top">
          <h1 className="hero-brand">
            GameFor<em>Tg</em>
          </h1>
          <div className="user-chip" aria-label={user?.firstName ?? 'Гость'}>
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

        <p className="hero-copy">Покер, дурак, шахматы, шашки и косынка — сразу в Telegram.</p>
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
              onClick={() => onPlay(game.id)}
            >
              <div className="game-row-art">
                <GameCover game={game} square />
              </div>
              <div className="game-row-text">
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
      <GameCover game={game} showTitle />
      <div className="game-meta">
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
