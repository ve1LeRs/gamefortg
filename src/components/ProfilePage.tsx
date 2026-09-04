import { GAMES } from '../data/games'
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
      <p className="page-sub">Статистика сессии в мини-приложении.</p>

      <div className="profile-card">
        <div className="user-avatar" style={{ width: 56, height: 56, fontSize: 22 }}>
          {user?.photoUrl ? (
            <img src={user.photoUrl} alt="" />
          ) : (
            (user?.firstName?.[0] ?? 'G').toUpperCase()
          )}
        </div>
        <h2 className="profile-name">
          {user ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}` : 'Гость GameFort'}
        </h2>
        <p className="hint">{user?.username ? `@${user.username}` : 'Откройте из Telegram, чтобы подтянуть аккаунт'}</p>
      </div>

      <div className="stat-row">
        <div className="stat">
          <strong>{total}</strong>
          <span>Запусков</span>
        </div>
        <div className="stat" style={{ animationDelay: '0.05s' }}>
          <strong>{GAMES.length}</strong>
          <span>Игр</span>
        </div>
        <div className="stat" style={{ animationDelay: '0.1s' }}>
          <strong>{favorites[0] ? plays[favorites[0].id] ?? 0 : 0}</strong>
          <span>Топ</span>
        </div>
      </div>

      <div className="section-head">
        <h2>Любимые</h2>
      </div>
      <div className="game-list">
        {favorites.map((g) => (
          <div key={g.id} className="game-row" style={{ cursor: 'default' }}>
            <div className="game-row-art" style={{ '--tile-glow': g.glow } as React.CSSProperties}>
              <span>
                {g.id === 'poker' ? '♠' : g.id === 'durak' ? '♦' : g.id === 'chess' ? '♟' : g.id === 'checkers' ? '●' : '♣'}
              </span>
            </div>
            <div>
              <h3>{g.title}</h3>
              <p>{plays[g.id] ?? 0} запусков</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
