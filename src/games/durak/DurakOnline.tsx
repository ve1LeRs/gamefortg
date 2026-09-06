import { useEffect, useMemo, useState } from 'react'
import { PlayingCard } from '../../components/PlayingCard'
import { isRed } from '../../lib/cards'
import { getWebApp } from '../../lib/telegram'
import { type DurakRoom, type PlayerInfo, hostDurakRoom, joinDurakRoom } from './peerRoom'

type Mode = 'menu' | 'host' | 'join'

function playerFromTelegram(): PlayerInfo {
  const u = getWebApp()?.initDataUnsafe?.user
  if (u) {
    return { id: String(u.id), name: u.first_name || u.username || 'Игрок' }
  }
  return { id: `local-${Math.random().toString(36).slice(2, 8)}`, name: 'Игрок' }
}

function inviteLink(code: string): string {
  const bot = (import.meta as { env?: { VITE_BOT_USERNAME?: string } }).env?.VITE_BOT_USERNAME
  if (bot) return `https://t.me/${bot}?startapp=durak_${code}`
  return `${window.location.origin}${window.location.pathname}?durakRoom=${code}`
}

export function DurakOnline({
  initialCode,
  onHaptic,
  onBackToBot,
}: {
  initialCode?: string | null
  onHaptic?: (t?: 'light' | 'medium' | 'success' | 'error') => void
  onBackToBot?: () => void
}) {
  const you = useMemo(() => playerFromTelegram(), [])
  const [mode, setMode] = useState<Mode>(initialCode ? 'join' : 'menu')
  const [joinCode, setJoinCode] = useState(initialCode?.toUpperCase() ?? '')
  const [room, setRoom] = useState<DurakRoom | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    return () => {
      room?.destroy()
    }
  }, [room])

  useEffect(() => {
    if (!initialCode) return
    void connectJoin(initialCode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const connectHost = async () => {
    setError(null)
    setBusy(true)
    setMode('host')
    try {
      const created = await hostDurakRoom(you, {
        onUpdate: (next) => setRoom({ ...next }),
      })
      setRoom(created)
      onHaptic?.('medium')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось создать комнату')
      setMode('menu')
      onHaptic?.('error')
    } finally {
      setBusy(false)
    }
  }

  const connectJoin = async (code: string) => {
    const clean = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (clean.length < 4) {
      setError('Введите код комнаты')
      return
    }
    setError(null)
    setBusy(true)
    setMode('join')
    try {
      const joined = await joinDurakRoom(clean, you, {
        onUpdate: (next) => setRoom({ ...next }),
      })
      setRoom(joined)
      onHaptic?.('medium')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось подключиться')
      setMode('menu')
      onHaptic?.('error')
    } finally {
      setBusy(false)
    }
  }

  const copyInvite = async () => {
    if (!room) return
    try {
      await navigator.clipboard.writeText(`Дурак — код ${room.code}\n${inviteLink(room.code)}`)
      onHaptic?.('success')
    } catch {
      onHaptic?.('error')
    }
  }

  const shareInvite = async () => {
    if (!room) return
    const link = inviteLink(room.code)
    const wa = getWebApp() as { openTelegramLink?: (url: string) => void } | null
    if (wa?.openTelegramLink) {
      wa.openTelegramLink(
        `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(
          `Играем в Дурака! Код: ${room.code}`,
        )}`,
      )
      return
    }
    await copyInvite()
  }

  const leave = () => {
    room?.destroy()
    setRoom(null)
    setMode('menu')
    setError(null)
  }

  const view = room?.view
  if (room?.status === 'playing' && view) {
    return (
      <div className="durak-table durak-online">
        <header className="durak-top">
          <div className="durak-seat">
            <div className="durak-avatar bot-avatar" aria-hidden>
              👤
            </div>
            <div className="durak-seat-meta">
              <span className="durak-name">{room.opponent?.name ?? 'Соперник'}</span>
              <span className="durak-pill">{view.opponentCount}</span>
            </div>
            <div className="durak-bot-cards" aria-hidden>
              {Array.from({ length: Math.min(view.opponentCount, 6) }).map((_, i) => (
                <span key={i} className="durak-mini-back" style={{ ['--i' as string]: i }} />
              ))}
            </div>
          </div>
          <p className="durak-status">{view.status}</p>
        </header>

        <div className="durak-field">
          <div className={`durak-deck${view.deckCount === 0 ? ' is-empty' : ''}`}>
            {view.deckCount > 0 && view.trumpCard ? (
              <>
                <PlayingCard card={view.trumpCard} rankStyle="ru" className="durak-trump-card" enter="none" />
                <span className="durak-deck-layer" style={{ ['--i' as string]: 0 }} />
                <span className="durak-deck-count">{view.deckCount}</span>
              </>
            ) : (
              <span className={`durak-trump-suit${isRed(view.trump) ? ' is-red' : ''}`}>{view.trump}</span>
            )}
          </div>

          <div className="durak-table-zone">
            <div className="durak-table-cards" data-count={view.table.length}>
              {view.table.length === 0 && <span className="durak-empty">Стол</span>}
              {view.table.map((p) => (
                <div className="durak-pair" key={p.attack.id}>
                  <PlayingCard card={p.attack} rankStyle="ru" className="durak-card" enter="none" />
                  {p.defence && (
                    <PlayingCard
                      card={p.defence}
                      rankStyle="ru"
                      className="durak-card durak-defence"
                      enter="none"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className={`durak-bito${view.discardCount ? ' has-cards' : ' is-empty'}`}>
            {view.discardCount > 0 &&
              Array.from({ length: Math.min(view.discardCount, 6) }).map((_, i) => (
                <span key={i} className="durak-bito-card" />
              ))}
          </div>
        </div>

        <div className="durak-actions">
          {view.youWon === true && <div className="durak-banner win">Победа!</div>}
          {view.youWon === false && <div className="durak-banner lose">Вы дурак</div>}
          {view.canTake && (
            <button
              type="button"
              className="durak-btn durak-btn-take"
              onClick={() => {
                room.sendAction({ type: 'take' })
                onHaptic?.('medium')
              }}
            >
              Беру
            </button>
          )}
          {view.canGive && (
            <button
              type="button"
              className="durak-btn durak-btn-take"
              onClick={() => {
                room.sendAction({ type: 'give' })
                onHaptic?.('medium')
              }}
            >
              Отдать
            </button>
          )}
          {view.canBito && (
            <button
              type="button"
              className="durak-btn durak-btn-bito"
              onClick={() => {
                room.sendAction({ type: 'bito' })
                onHaptic?.('medium')
              }}
            >
              Бито
            </button>
          )}
          {(view.youWon !== null) && (
            <button type="button" className="durak-btn durak-btn-primary" onClick={leave}>
              Выйти
            </button>
          )}
        </div>

        <footer className="durak-dock">
          <div className="durak-hand" data-count={view.you.length}>
            {view.you.map((c, i) => {
              const legal = view.legalCardIds.includes(c.id)
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`durak-hand-card${legal ? ' playable' : ''}`}
                  style={{ ['--i' as string]: i, zIndex: i + 1 }}
                  disabled={!legal}
                  onClick={() => {
                    if (!legal) return
                    room.sendAction({ type: 'play', cardId: c.id })
                    onHaptic?.('light')
                  }}
                >
                  <PlayingCard card={c} rankStyle="ru" className="durak-card" enter="none" />
                </button>
              )
            })}
          </div>
          <div className={`durak-seat player${view.yourTurn ? ' is-active' : ''}`}>
            <div className="durak-avatar you-avatar" aria-hidden>
              🧑
            </div>
            <div className="durak-seat-meta">
              <span className="durak-name">Вы</span>
              <span className="durak-pill">{view.you.length}</span>
            </div>
          </div>
        </footer>
      </div>
    )
  }

  return (
    <div className="durak-online-lobby">
      <h2>Дурак онлайн</h2>
      <p className="durak-online-lead">Два игрока по ссылке или коду. Хост раздаёт карты.</p>
      {error && <p className="durak-online-error">{error}</p>}
      {room?.error && <p className="durak-online-error">{room.error}</p>}

      {mode === 'menu' && (
        <div className="durak-online-actions">
          <button
            type="button"
            className="durak-btn durak-btn-primary"
            disabled={busy}
            onClick={() => void connectHost()}
          >
            Создать комнату
          </button>
          <div className="durak-online-join">
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="Код комнаты"
              maxLength={8}
              aria-label="Код комнаты"
            />
            <button
              type="button"
              className="durak-btn durak-btn-bito"
              disabled={busy}
              onClick={() => void connectJoin(joinCode)}
            >
              Войти
            </button>
          </div>
          {onBackToBot && (
            <button type="button" className="durak-btn" onClick={onBackToBot}>
              Играть с ботом
            </button>
          )}
        </div>
      )}

      {(mode === 'host' || mode === 'join') && room && (
        <div className="durak-online-wait">
          <p className="durak-online-code">
            Код: <strong>{room.code}</strong>
          </p>
          <p>
            {room.status === 'waiting'
              ? room.role === 'host'
                ? 'Ждём соперника… Отправьте код другу.'
                : 'Подключаемся…'
              : room.status === 'connecting'
                ? 'Соединение…'
                : room.status === 'disconnected'
                  ? 'Соединение потеряно'
                  : room.status === 'error'
                    ? (room.error ?? 'Ошибка')
                    : 'Готово'}
          </p>
          {room.role === 'host' && room.status === 'waiting' && (
            <div className="durak-online-actions">
              <button type="button" className="durak-btn durak-btn-primary" onClick={() => void shareInvite()}>
                Поделиться
              </button>
              <button type="button" className="durak-btn" onClick={() => void copyInvite()}>
                Скопировать
              </button>
            </div>
          )}
          <button type="button" className="durak-btn" onClick={leave}>
            Отмена
          </button>
        </div>
      )}
    </div>
  )
}
