import { GAMES } from '../data/games'
import { GameCover } from './GameCover'
import type { TgUser } from '../hooks/useTelegram'

export function ProfilePage({
  user,
  plays,
}: {
  user: TgUser | null
  plays: Record<string, number>
}) {
  const total = Object.values(plays).reduce((a, b) => a + b, 0)
  const favorites = [...GAMES]
    .map((g) => ({ game: g, count: plays[g.id] ?? 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
  const topCount = favorites[0]?.count ?? 0
  const displayName = user
    ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}`
    : 'Гость GameForTg'
  const initial = (user?.firstName?.[0] ?? 'G').toUpperCase()

  return (
    <div className="profile-page">
      <header className="profile-hero">
        <div className="profile-hero-glow" aria-hidden />
        <div className="profile-identity">
          <div className="profile-avatar" aria-hidden>
            {user?.photoUrl ? <img src={user.photoUrl} alt="" /> : initial}
          </div>
          <div className="profile-identity-text">
            <p className="profile-kicker">Профиль</p>
            <h1 className="profile-name">{displayName}</h1>
            <p className="profile-handle">
              {user?.username
                ? `@${user.username}`
                : 'Откройте из Telegram, чтобы подтянуть аккаунт'}
            </p>
          </div>
        </div>
      </header>

      <section className="profile-stats" aria-label="Статистика сессии">
        <div className="profile-stat">
          <strong>{total}</strong>
          <span>Запусков</span>
        </div>
        <div className="profile-stat">
          <strong>{GAMES.length}</strong>
          <span>Игр</span>
        </div>
        <div className="profile-stat">
          <strong>{topCount}</strong>
          <span>Топ</span>
        </div>
      </section>

      <section className="profile-fav">
        <div className="section-head">
          <h2>Любимые</h2>
          <p>За эту сессию</p>
        </div>
        <div className="profile-fav-list">
          {favorites.map(({ game, count }, i) => (
            <div key={game.id} className="profile-fav-row">
              <span className="profile-fav-rank">{i + 1}</span>
              <div className="profile-fav-art">
                <GameCover game={game} square />
              </div>
              <div className="profile-fav-text">
                <h3>{game.title}</h3>
                <p>
                  {game.genre} · {count} {count === 1 ? 'запуск' : 'запусков'}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <p className="profile-build" aria-hidden>
        {typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'}
      </p>
    </div>
  )
}
