import { useCallback, useEffect, useMemo, useState } from 'react'
import { GAMES } from '../data/games'
import {
  applySettingsToDom,
  getDisplayName,
  loadSettings,
  saveSettings,
  type AppSettings,
} from '../lib/settings'
import { levelFromXp, loadPokerProgress } from '../lib/pokerProgress'
import { GameCover } from './GameCover'
import type { TgUser } from '../hooks/useTelegram'

function launchesLabel(n: number) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'запуск'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'запуска'
  return 'запусков'
}

export function ProfilePage({
  user,
  plays,
}: {
  user: TgUser | null
  plays: Record<string, number>
}) {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())
  const poker = useMemo(() => loadPokerProgress(), [])
  const pokerLevel = levelFromXp(poker.xp)

  const total = Object.values(plays).reduce((a, b) => a + b, 0)
  const playedGames = Object.values(plays).filter((n) => n > 0).length
  const favorites = [...GAMES]
    .map((g) => ({ game: g, count: plays[g.id] ?? 0 }))
    .sort((a, b) => b.count - a.count)
  const topFavorite = favorites.find((f) => f.count > 0) ?? null

  const telegramName = user
    ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}`
    : undefined
  const displayName = getDisplayName(telegramName, settings)
  const initial = (displayName[0] ?? 'P').toUpperCase()

  useEffect(() => {
    applySettingsToDom(settings)
  }, [settings])

  const patchNickname = useCallback((nickname: string) => {
    setSettings((prev) => {
      const next = { ...prev, nickname }
      saveSettings(next)
      return next
    })
  }, [])

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

        <label className="profile-nick-field">
          <span>Никнейм</span>
          <input
            value={settings.nickname}
            maxLength={24}
            placeholder="Как вас показывать"
            onChange={(e) => patchNickname(e.target.value)}
          />
        </label>
      </header>

      <section className="profile-stats" aria-label="Статистика">
        <div className="profile-stat">
          <strong>{total}</strong>
          <span>Всего запусков</span>
        </div>
        <div className="profile-stat">
          <strong>{playedGames}</strong>
          <span>Игр пробовали</span>
        </div>
        <div className="profile-stat">
          <strong>{pokerLevel.level}</strong>
          <span>Уровень покера</span>
        </div>
      </section>

      {topFavorite ? (
        <section className="profile-favorite-card" aria-label="Любимая игра">
          <div className="profile-favorite-copy">
            <p className="profile-favorite-kicker">Чаще всего</p>
            <h2>{topFavorite.game.title}</h2>
            <p>
              {topFavorite.count} {launchesLabel(topFavorite.count)} за эту сессию
            </p>
          </div>
          <div className="profile-favorite-art">
            <GameCover game={topFavorite.game} square />
          </div>
        </section>
      ) : (
        <section className="profile-favorite-card is-empty" aria-label="Любимая игра">
          <div className="profile-favorite-copy">
            <p className="profile-favorite-kicker">Чаще всего</p>
            <h2>Пока пусто</h2>
            <p>Запустите игру — здесь появится любимая</p>
          </div>
        </section>
      )}

      <section className="profile-fav">
        <div className="section-head">
          <h2>Недавняя активность</h2>
          <p>По числу запусков</p>
        </div>
        <div className="profile-fav-list">
          {favorites
            .filter((f) => f.count > 0)
            .slice(0, 4)
            .map(({ game, count }, i) => (
              <div key={game.id} className="profile-fav-row">
                <span className="profile-fav-rank">{i + 1}</span>
                <div className="profile-fav-art">
                  <GameCover game={game} square />
                </div>
                <div className="profile-fav-text">
                  <h3>{game.title}</h3>
                  <p>
                    {game.genre} · {count} {launchesLabel(count)}
                  </p>
                </div>
              </div>
            ))}
          {favorites.every((f) => f.count === 0) ? (
            <p className="profile-fav-empty">Ещё нет запусков в этой сессии</p>
          ) : null}
        </div>
      </section>

      <p className="profile-poker-meta">
        Покер: {poker.wins} побед · {poker.hands} раздач · {pokerLevel.intoLevel}/{pokerLevel.need} XP
      </p>

      <p className="profile-build" aria-hidden>
        {typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'}
      </p>
    </div>
  )
}
