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
  const favorites = [...GAMES].sort((a, b) => (plays[b.id] ?? 0) - (plays[a.id] ?? 0)).slice(0, 3)

  return (
    <div className="profile-page">
      <h1 className="page-title">Профиль</h1>
      <p className="page-sub">Статистика сессии в GameForTg.</p>
      <p className="hint build-id">Сборка {typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'}</p>

      <div className="profile-card">
        <div className="user-avatar profile-avatar">
          {user?.photoUrl ? (
            <img src={user.photoUrl} alt="" />
          ) : (
            (user?.firstName?.[0] ?? 'G').toUpperCase()
          )}
        </div>
        <div className="profile-info">
          <h2 className="profile-name">
            {user ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}` : 'Гость GameForTg'}
          </h2>
          <p className="hint">
            {user?.username ? `@${user.username}` : 'Откройте из Telegram, чтобы подтянуть аккаунт'}
          </p>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat">
          <strong>{total}</strong>
          <span>Запусков</span>
        </div>
        <div className="stat">
          <strong>{GAMES.length}</strong>
          <span>Игр</span>
        </div>
        <div className="stat">
          <strong>{favorites[0] ? plays[favorites[0].id] ?? 0 : 0}</strong>
          <span>Топ</span>
        </div>
      </div>

      <div className="section-head">
        <h2>Любимые</h2>
      </div>
      <div className="game-list">
        {favorites.map((g) => (
          <div key={g.id} className="game-row is-static">
            <div className="game-row-art">
              <GameCover game={g} square />
            </div>
            <div className="game-row-text">
              <h3>{g.title}</h3>
              <p>{plays[g.id] ?? 0} запусков</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
