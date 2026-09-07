import { GAMES } from '../data/games'
import { hardReloadApp } from '../lib/reloadApp'
import { getDisplayName, loadSettings } from '../lib/settings'
import { GameCover } from './GameCover'
import type { TgUser } from '../hooks/useTelegram'

export function StorePage({
  user,
  onPlay,
}: {
  user: TgUser | null
  onPlay: (id: string) => void
}) {
  const settings = loadSettings()
  const name = getDisplayName(user?.firstName, settings)
  const initial = (name[0] ?? 'G').toUpperCase()

  return (
    <div className="store-page">
      <section className="hero">
        <div className="hero-bg" />

        <div className="hero-top">
          <h1 className="hero-brand">
            Play<em>fort</em>
          </h1>
          <div className="user-chip" aria-label={name}>
            <div className="user-avatar">
              {user?.photoUrl ? (
                <img src={user.photoUrl} alt="" />
              ) : (
                initial
              )}
            </div>
            <span>{name}</span>
          </div>
        </div>

        <p className="hero-copy">Cards and board games — right in Telegram.</p>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Каталог</h2>
          <p>{GAMES.length} игр</p>
        </div>
        <div className="game-list">
          {GAMES.map((game) => (
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

      <div className="store-refresh">
        <button type="button" className="btn btn-soft" onClick={hardReloadApp}>
          Обновить приложение
        </button>
      </div>
    </div>
  )
}
