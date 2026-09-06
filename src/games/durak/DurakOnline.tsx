import { useEffect, useMemo, useRef, useState } from 'react'
import { PlayingCard } from '../../components/PlayingCard'
import { isRed } from '../../lib/cards'
import { getWebApp } from '../../lib/telegram'
import { createSoloDurakRoom } from './localRoom'
import { type DurakRoom, type PlayerInfo, hostDurakRoom, joinDurakRoom } from './peerRoom'

type Mode = 'menu' | 'host' | 'join' | 'solo'

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
  const sessionRef = useRef(0)
  const roomRef = useRef<DurakRoom | null>(null)
  const lastPlayRef = useRef(0)

  useEffect(() => {
    return () => {
      sessionRef.current += 1
      roomRef.current?.destroy()
    }
  }, [])

  useEffect(() => {
    if (!initialCode) return
    void connectJoin(initialCode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const syncRoom = (next: DurakRoom, session: number) => {
    if (session !== sessionRef.current) {
      next.destroy()
      return
    }
    roomRef.current = next
    // Clone so React re-renders while keeping method references.
    setRoom({ ...next })
  }

  const connectHost = async () => {
    const session = ++sessionRef.current
    roomRef.current?.destroy()
    roomRef.current = null
    setError(null)
    setBusy(true)
    setMode('host')
    setRoom(null)
    try {
      const created = await hostDurakRoom(you, {
        onUpdate: (next) => syncRoom(next, session),
      })
      if (session !== sessionRef.current) {
        created.destroy()
        return
      }
      syncRoom(created, session)
      onHaptic?.('medium')
    } catch (e) {
      if (session !== sessionRef.current) return
      setError(e instanceof Error ? e.message : 'Не удалось создать комнату')
      setMode('menu')
      setRoom(null)
      onHaptic?.('error')
    } finally {
      if (session === sessionRef.current) setBusy(false)
    }
  }

  const connectJoin = async (code: string) => {
    const clean = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (clean.length < 4) {
      setError('Введите код комнаты')
      return
    }
    const session = ++sessionRef.current
    roomRef.current?.destroy()
    roomRef.current = null
    setJoinCode(clean)
    setError(null)
    setBusy(true)
    setMode('join')
    setRoom(null)
    try {
      const joined = await joinDurakRoom(clean, you, {
        onUpdate: (next) => syncRoom(next, session),
      })
      if (session !== sessionRef.current) {
        joined.destroy()
        return
      }
      syncRoom(joined, session)
      onHaptic?.('medium')
    } catch (e) {
      if (session !== sessionRef.current) return
      setError(e instanceof Error ? e.message : 'Не удалось подключиться')
      setMode('menu')
      setRoom(null)
      onHaptic?.('error')
    } finally {
      if (session === sessionRef.current) setBusy(false)
    }
  }

  const startSolo = () => {
    const session = ++sessionRef.current
    roomRef.current?.destroy()
    roomRef.current = null
    setError(null)
    setBusy(false)
    setMode('solo')
    setRoom(null)
    try {
      const solo = createSoloDurakRoom(you, {
        onUpdate: (next) => syncRoom(next, session),
      })
      syncRoom(solo, session)
      onHaptic?.('medium')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось начать тест')
      setMode('menu')
      setRoom(null)
      onHaptic?.('error')
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
    sessionRef.current += 1
    roomRef.current?.destroy()
    roomRef.current = null
    setRoom(null)
    setMode('menu')
    setBusy(false)
    setError(null)
  }

  const forceRefreshApp = () => {
    const next = new URL(location.href)
    next.searchParams.set('v', typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : String(Date.now()))
    next.searchParams.set('_', String(Date.now()))
    location.replace(next.toString())
  }

  const friendlyError = (msg: string | null | undefined) => {
    if (!msg) return null
    if (/negotiation|peerjs|gft-durak|webrtc/i.test(msg)) {
      return 'Старая версия приложения в кэше Telegram. Нажмите «Обновить» ниже или полностью закройте Telegram и откройте снова.'
    }
    return msg
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
          <p className="durak-status">
            {room.solo
              ? `${view.yourTurn ? 'Ваш ход' : 'Ждём ход'} · ${room.you.name}`
              : view.yourTurn
                ? view.status
                : view.table.length === 0
                  ? `Ход: ${room.opponent?.name ?? 'соперник'} — ждите первую карту`
                  : view.status}
          </p>
          {room.solo && (
            <div className="durak-solo-toolbar">
              <button
                type="button"
                className="durak-solo-switch"
                onClick={() => {
                  room.switchSeat?.()
                  onHaptic?.('light')
                }}
              >
                Сменить игрока ({room.controllingSeat === 'a' ? '1→2' : '2→1'})
              </button>
              <button type="button" className="durak-solo-switch" onClick={leave}>
                Выйти из теста
              </button>
            </div>
          )}
          {view.yourTurn && view.legalCardIds.length > 0 && (
            <p className="durak-tap-hint">Нажмите карту в руке, чтобы сходить</p>
          )}
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
          {view.youWon !== null && (
            <button type="button" className="durak-btn durak-btn-primary" onClick={leave}>
              Выйти
            </button>
          )}
        </div>

        <footer className="durak-bottom">
          <div
            className="durak-hand durak-online-hand"
            data-count={view.you.length}
            style={{
              ['--hand-card-w' as string]: '92px',
              ['--hand-card-h' as string]: '128px',
              ['--hand-step' as string]: `${Math.max(34, Math.min(58, Math.floor(300 / Math.max(view.you.length, 1))))}px`,
            }}
          >
            <div className="durak-hand-row">
              {view.you.map((c, i) => {
                const legal = view.legalCardIds.includes(c.id)
                const n = view.you.length
                const mid = (n - 1) / 2
                const offset = i - mid
                const play = () => {
                  if (!legal) return
                  const now = Date.now()
                  if (now - lastPlayRef.current < 400) return
                  lastPlayRef.current = now
                  room.sendAction({ type: 'play', cardId: c.id })
                  onHaptic?.('light')
                }
                return (
                  <PlayingCard
                    key={c.id}
                    card={c}
                    index={i}
                    rankStyle="ru"
                    enter="none"
                    playable={legal}
                    className={`durak-card durak-hand-card${legal ? ' playable' : ' is-waiting'}`}
                    style={{
                      ['--fan' as string]: offset,
                      ['--rot' as string]: `${offset * 2.2}deg`,
                      zIndex: legal ? 40 + i : i + 1,
                    }}
                    onClick={play}
                    onPointerUp={(e) => {
                      // Telegram iOS WebView often drops click when touch-action is none.
                      if (e.pointerType === 'mouse') return
                      play()
                    }}
                  />
                )
              })}
            </div>
          </div>
          <div className={`durak-seat player${view.yourTurn ? ' is-active' : ''}`}>
            <div className="durak-avatar you-avatar" aria-hidden>
              🧑
            </div>
            <div className="durak-seat-meta">
              <span className="durak-name">{room.solo ? room.you.name : 'Вы'}</span>
              <span className="durak-pill">{view.you.length}</span>
            </div>
          </div>
        </footer>
      </div>
    )
  }

  const showWait = mode === 'host' || mode === 'join'
  const waitStatus =
    room?.status === 'waiting'
      ? room.role === 'host'
        ? 'Ждём соперника… Отправьте код другу.'
        : 'Подключаемся к хосту…'
      : room?.status === 'connecting' || (busy && !room)
        ? 'Соединение…'
        : room?.status === 'disconnected'
          ? 'Соединение потеряно'
          : room?.status === 'error'
            ? (room.error ?? 'Ошибка')
            : busy
              ? 'Соединение…'
              : null

  const shownError = friendlyError(error) || friendlyError(room?.status !== 'playing' ? room?.error : null)

  return (
    <div className="durak-online-lobby">
      <h2>Дурак онлайн</h2>
      <p className="durak-online-lead">Два игрока по ссылке или коду. Хост раздаёт карты.</p>
      <p className="durak-online-build" title={typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : ''}>
        онлайн · mqtt
      </p>
      {shownError && <p className="durak-online-error">{shownError}</p>}

      {mode === 'menu' && !busy && (
        <div className="durak-online-actions">
          <button
            type="button"
            className="durak-btn durak-btn-primary"
            disabled={busy}
            onClick={() => void connectHost()}
          >
            Создать комнату
          </button>
          <button
            type="button"
            className="durak-btn durak-btn-bito"
            disabled={busy}
            onClick={startSolo}
          >
            Тест на одном устройстве
          </button>
          <div className="durak-online-join">
            <label className="durak-online-join-label" htmlFor="durak-room-code">
              Код комнаты
            </label>
            <input
              id="durak-room-code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="например VPAZRT"
              maxLength={8}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              aria-label="Код комнаты"
            />
            <button
              type="button"
              className="durak-btn durak-btn-bito"
              disabled={busy || joinCode.trim().length < 4}
              onClick={() => void connectJoin(joinCode)}
            >
              Войти
            </button>
          </div>
          <button type="button" className="durak-btn" onClick={forceRefreshApp}>
            Обновить приложение
          </button>
          {onBackToBot && (
            <button type="button" className="durak-btn" onClick={onBackToBot}>
              Играть с ботом
            </button>
          )}
        </div>
      )}

      {showWait && (
        <div className="durak-online-wait">
          {(room?.code || joinCode) && (
            <p className="durak-online-code">
              Код: <strong>{room?.code || joinCode}</strong>
            </p>
          )}
          {waitStatus && <p className="durak-online-wait-status">{waitStatus}</p>}
          {room?.role === 'host' && room.status === 'waiting' && (
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
