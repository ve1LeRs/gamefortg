import { useEffect, useMemo, useRef, useState } from 'react'
import { PlayingCard } from '../../components/PlayingCard'
import { OnlineLobbyMenu, OnlineWait } from '../../components/OnlineLobby'
import { getWebApp } from '../../lib/telegram'
import { playPokerSound, playUiSound } from '../../lib/settings'
import {
  type PokerAction,
  type PokerSeatView,
  formatChips,
  BLIND,
} from './engine'
import {
  type LobbyListing,
  type PlayerInfo,
  type PokerRoom,
  hostPokerRoom,
  joinPokerRoom,
  watchPokerLobby,
} from './peerRoom'

function playerFromTelegram(): PlayerInfo {
  const u = getWebApp()?.initDataUnsafe?.user
  if (u) return { id: String(u.id), name: u.first_name || u.username || 'Игрок' }
  return { id: `local-${Math.random().toString(36).slice(2, 8)}`, name: 'Игрок' }
}

function isLandscapeNow() {
  if (typeof window === 'undefined') return true
  try {
    const p = window.Telegram?.WebApp?.platform?.toLowerCase() ?? ''
    if (['tdesktop', 'web', 'weba', 'webk', 'macos', 'linux', 'windows', 'unigram', 'desktop'].includes(p)) {
      return true
    }
    if (!window.Telegram?.WebApp && window.innerWidth >= 820) return true
  } catch {
    /* noop */
  }
  if (window.innerWidth > window.innerHeight) return true
  if (window.innerHeight > window.innerWidth) return false
  try {
    return window.matchMedia('(orientation: landscape)').matches
  } catch {
    return true
  }
}

function useLandscape() {
  const [landscape, setLandscape] = useState(isLandscapeNow)
  useEffect(() => {
    const sync = () => setLandscape(isLandscapeNow())
    sync()
    window.addEventListener('resize', sync)
    window.addEventListener('orientationchange', sync)
    const wa = getWebApp()
    wa?.onEvent?.('viewportChanged', sync)
    return () => {
      window.removeEventListener('resize', sync)
      window.removeEventListener('orientationchange', sync)
      wa?.offEvent?.('viewportChanged', sync)
    }
  }, [])
  return landscape
}

function BetActionLabel({ verb, amount }: { verb: string; amount: number }) {
  return (
    <span className="poker-btn-stack">
      <span className="poker-btn-verb">{verb}</span>
      <span className="poker-btn-amt">{formatChips(amount)}</span>
    </span>
  )
}

function SeatBadge({
  name,
  stack,
  accent,
  dealer,
  active,
}: {
  name: string
  stack: number
  accent: string
  dealer?: boolean
  active?: boolean
}) {
  const initial = (name.trim()[0] || '?').toUpperCase()
  return (
    <div className={`poker-seat${active ? ' is-active' : ''}`}>
      <div className="poker-seat-avatar" style={{ background: accent }} aria-hidden>
        {initial}
        {dealer ? <span className="poker-dealer-btn">D</span> : null}
      </div>
      <div className="poker-seat-meta">
        <span className="poker-seat-stack">{formatChips(stack)}</span>
      </div>
    </div>
  )
}

function PokerOnlineTable({
  view,
  opponentName,
  onAction,
  onLeave,
  onHaptic,
}: {
  view: PokerSeatView
  opponentName: string
  onAction: (action: PokerAction) => void
  onLeave: () => void
  onHaptic?: (t?: 'light' | 'medium' | 'success' | 'error') => void
}) {
  const landscape = useLandscape()
  const [wager, setWager] = useState(() => Math.max(view.minBet, BLIND))
  const prevPhase = useRef(view.phase)

  useEffect(() => {
    setWager(Math.max(view.minBet, Math.min(view.maxBet, wager || view.minBet)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.minBet, view.maxBet, view.phase, view.toCall])

  useEffect(() => {
    if (prevPhase.current !== view.phase) {
      if (view.board.length >= 3 && view.phase === 'flop') playPokerSound('cards')
      else if (view.phase === 'turn' || view.phase === 'river') playPokerSound('card')
      else if (view.phase === 'over') playPokerSound('chips')
      prevPhase.current = view.phase
    }
  }, [view.phase, view.board.length])

  const clampWager = (n: number) => Math.max(view.minBet, Math.min(view.maxBet, Math.floor(n)))

  const send = (action: PokerAction) => {
    if (!view.yourTurn && action.type !== 'nextHand') return
    onAction(action)
    if (action.type === 'fold') {
      onHaptic?.('error')
      playUiSound('warn')
    } else if (action.type === 'check') {
      onHaptic?.('light')
      playPokerSound('check')
    } else {
      onHaptic?.('medium')
      playPokerSound('chips')
    }
  }

  const resultClass =
    view.phase === 'over' ? (view.youWon ? 'win' : view.youWon === false ? 'lose' : '') : ''

  return (
    <div className={`poker-landscape${landscape ? ' is-landscape' : ' is-portrait'}`}>
      {!landscape && (
        <div className="poker-rotate-hint" role="status">
          <div className="poker-rotate-icon" aria-hidden>
            ↻
          </div>
          <p>Поверните телефон горизонтально</p>
          <span>Покер рассчитан на широкий стол</span>
        </div>
      )}

      <div className="poker-stage" aria-hidden={!landscape}>
        <div className="poker-room">
          <p className={`poker-status ${resultClass}`}>{view.status}</p>

          <div className="poker-table">
            <div className="poker-table-rail" />
            <div className="poker-table-felt">
              <div className="poker-table-brand" aria-hidden>
                <span className="poker-table-brand-ornament" />
                <span className="poker-table-brand-mark">PLAYFORT</span>
                <span className="poker-table-brand-sub">POKER CLUB</span>
                <span className="poker-table-brand-ornament is-flip" />
              </div>

              <div className="poker-board">
                {view.board.map((c, i) => (
                  <PlayingCard key={c.id} card={c} index={i} enter="none" className="poker-board-card" />
                ))}
              </div>

              {view.pot > 0 ? (
                <div className="poker-pot" aria-label={`Банк ${view.pot}`}>
                  <span className="poker-pot-chip" aria-hidden />
                  <span>
                    {formatChips(view.pot)} БАНК
                  </span>
                </div>
              ) : null}
            </div>

            {/* Opponent — top */}
            <div
              className={`poker-seat-slot poker-seat-s2${view.opponent.folded ? ' is-folded' : ''}${
                view.winner != null && view.winner !== view.seat ? ' is-winner' : ''
              }${view.opponent.hole ? ' is-revealed' : ''}`}
            >
              <div className={`poker-bot-cards${view.opponent.hole ? ' is-revealed' : ''}`}>
                {view.opponent.hole
                  ? view.opponent.hole.map((c, ci) => (
                      <PlayingCard key={c.id} card={c} index={ci} enter="none" className="poker-hole-card" />
                    ))
                  : [0, 1].map((ci) => (
                      <PlayingCard
                        key={`opp-back-${ci}`}
                        faceDown
                        index={ci}
                        enter="none"
                        className="poker-hole-card"
                      />
                    ))}
              </div>
              <SeatBadge
                name={opponentName}
                stack={view.opponent.stack}
                accent="linear-gradient(145deg,#6b3a3a,#3a1515)"
                dealer={view.dealer !== view.seat}
                active={!view.opponent.folded}
              />
            </div>

            {view.opponent.streetBet > 0 ? (
              <div className="poker-bet-on-table poker-bet-s2">
                <span className="poker-chip-amt">{formatChips(view.opponent.streetBet)}</span>
              </div>
            ) : null}

            {/* You — bottom */}
            <div
              className={`poker-seat-slot poker-seat-s0${view.you.folded ? ' is-folded' : ''}${
                view.yourTurn ? ' is-acting' : ''
              }${view.winner === view.seat ? ' is-winner' : ''}`}
            >
              <div className="poker-you-cards">
                <div className="poker-hand">
                  {view.you.hole.map((c, ci) => (
                    <PlayingCard
                      key={c.id}
                      card={c}
                      index={ci}
                      enter="none"
                      className="poker-hole-card"
                    />
                  ))}
                </div>
                {view.yourTurn ? (
                  <div className="poker-bet-amount-row">
                    <div className="poker-bet-stepper" aria-label="Размер ставки">
                      <button
                        type="button"
                        className="poker-bet-nudge"
                        aria-label="Уменьшить ставку"
                        disabled={wager <= view.minBet}
                        onClick={() => setWager((w) => clampWager(w - 10))}
                      >
                        −
                      </button>
                      <span className="poker-bet-value">{formatChips(wager)}</span>
                      <button
                        type="button"
                        className="poker-bet-nudge"
                        aria-label="Увеличить ставку"
                        disabled={wager >= view.maxBet}
                        onClick={() => setWager((w) => clampWager(w + 10))}
                      >
                        +
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
              <SeatBadge
                name="Вы"
                stack={view.you.stack}
                accent="linear-gradient(145deg,#3a6ea5,#1a3358)"
                dealer={view.dealer === view.seat}
                active={!view.you.folded}
              />
            </div>

            {view.you.streetBet > 0 ? (
              <div className="poker-bet-on-table poker-bet-s0">
                <span className="poker-chip-amt">{formatChips(view.you.streetBet)}</span>
              </div>
            ) : null}
          </div>

          <div className="poker-bottom">
            <div className="poker-actions">
              {view.phase === 'over' ? (
                <div className="poker-actions-row">
                  <button type="button" className="poker-btn poker-btn-soft" onClick={onLeave}>
                    Выйти
                  </button>
                  <button
                    type="button"
                    className="poker-btn poker-btn-bet"
                    onClick={() => send({ type: 'nextHand' })}
                  >
                    Ещё раздача
                  </button>
                </div>
              ) : view.yourTurn ? (
                <>
                  <div className="poker-bet-presets">
                    <button
                      type="button"
                      className="poker-bet-chip"
                      onClick={() => setWager(clampWager(view.minBet))}
                    >
                      Мин
                    </button>
                    <button
                      type="button"
                      className="poker-bet-chip"
                      onClick={() =>
                        setWager(clampWager(Math.max(view.minBet, Math.floor(view.pot / 2) || view.minBet)))
                      }
                    >
                      ½ банка
                    </button>
                    <button
                      type="button"
                      className="poker-bet-chip"
                      onClick={() => setWager(clampWager(Math.max(view.minBet, view.pot || view.minBet)))}
                    >
                      Банк
                    </button>
                    <button
                      type="button"
                      className="poker-bet-chip"
                      onClick={() => setWager(clampWager(view.maxBet))}
                    >
                      Макс
                    </button>
                  </div>
                  <div className="poker-actions-row">
                    {view.canCall ? (
                      <button
                        type="button"
                        className="poker-btn poker-btn-soft"
                        onClick={() => send({ type: 'call' })}
                      >
                        {view.callAmount >= view.you.stack ? (
                          'All In'
                        ) : (
                          <BetActionLabel verb="Колл" amount={view.callAmount} />
                        )}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="poker-btn poker-btn-soft"
                        onClick={() => send({ type: 'check' })}
                        disabled={!view.canCheck}
                      >
                        Чек
                      </button>
                    )}
                    <button
                      type="button"
                      className="poker-btn poker-btn-bet"
                      disabled={!view.canBet || wager <= 0 || (view.toCall > 0 && wager < view.toCall)}
                      onClick={() => send({ type: 'bet', amount: clampWager(wager) })}
                    >
                      {wager >= view.you.stack && view.you.stack > 0 ? (
                        'All In'
                      ) : view.toCall > 0 ? (
                        wager > view.toCall ? (
                          <BetActionLabel verb="Рейз" amount={clampWager(wager)} />
                        ) : (
                          <BetActionLabel verb="Колл" amount={view.toCall} />
                        )
                      ) : (
                        <BetActionLabel verb="Ставка" amount={clampWager(wager)} />
                      )}
                    </button>
                    <button
                      type="button"
                      className="poker-btn poker-btn-fold"
                      onClick={() => send({ type: 'fold' })}
                      disabled={!view.canFold}
                    >
                      Сброс
                    </button>
                  </div>
                </>
              ) : (
                <p className="poker-allin-wait">Ход соперника…</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

type Mode = 'menu' | 'host' | 'join'

export function PokerOnline({
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
  const [showCodeJoin, setShowCodeJoin] = useState(false)
  const [lobbyRooms, setLobbyRooms] = useState<LobbyListing[]>([])
  const [lobbyReady, setLobbyReady] = useState(false)
  const [joiningHost, setJoiningHost] = useState<string | null>(null)
  const [room, setRoom] = useState<PokerRoom | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const sessionRef = useRef(0)
  const roomRef = useRef<PokerRoom | null>(null)

  useEffect(() => {
    return () => {
      sessionRef.current += 1
      roomRef.current?.destroy()
    }
  }, [])

  useEffect(() => {
    if (mode !== 'menu' || busy) {
      setLobbyReady(false)
      return
    }
    setLobbyReady(false)
    const stop = watchPokerLobby((rooms) => {
      setLobbyRooms(rooms.filter((r) => r.host.id !== you.id))
      setLobbyReady(true)
    })
    return () => stop()
  }, [mode, busy, you.id])

  const syncRoom = (next: PokerRoom, session: number) => {
    if (session !== sessionRef.current) {
      next.destroy()
      return
    }
    roomRef.current = next
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
      const created = await hostPokerRoom(you, {
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

  const connectJoin = async (code: string, hostName?: string) => {
    const clean = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (clean.length < 4) {
      setError('Выберите комнату из списка')
      return
    }
    const session = ++sessionRef.current
    roomRef.current?.destroy()
    roomRef.current = null
    setJoinCode(clean)
    setJoiningHost(hostName ?? null)
    setError(null)
    setBusy(true)
    setMode('join')
    setRoom(null)
    try {
      const joined = await joinPokerRoom(clean, you, {
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
      setJoiningHost(null)
      onHaptic?.('error')
    } finally {
      if (session === sessionRef.current) setBusy(false)
    }
  }

  useEffect(() => {
    if (!initialCode) return
    void connectJoin(initialCode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const leave = () => {
    sessionRef.current += 1
    roomRef.current?.destroy()
    roomRef.current = null
    setRoom(null)
    setMode('menu')
    setBusy(false)
    setError(null)
    setJoiningHost(null)
  }

  if (room?.status === 'playing' && room.view) {
    return (
      <PokerOnlineTable
        view={room.view}
        opponentName={room.opponent?.name ?? 'Соперник'}
        onAction={(action) => room.sendAction(action)}
        onLeave={leave}
        onHaptic={onHaptic}
      />
    )
  }

  if (mode === 'host' || mode === 'join' || busy) {
    const waitStatus =
      room?.status === 'waiting'
        ? room.role === 'host'
          ? 'Комната в списке лобби. Ждём соперника…'
          : joiningHost
            ? `Подключаемся к ${joiningHost}…`
            : 'Подключаемся к комнате…'
        : error || room?.error || 'Соединение…'
    return <OnlineWait role={mode === 'join' ? 'guest' : 'host'} status={waitStatus} onLeave={leave} />
  }

  return (
    <OnlineLobbyMenu
      title="Покер онлайн"
      lead="Хедз-ап холдем. Создайте комнату или зайдите в открытую из списка."
      error={error}
      busy={busy}
      lobbyReady={lobbyReady}
      lobbyRooms={lobbyRooms}
      showCodeJoin={showCodeJoin}
      setShowCodeJoin={setShowCodeJoin}
      joinCode={joinCode}
      setJoinCode={setJoinCode}
      onHost={() => void connectHost()}
      onJoin={(code, name) => void connectJoin(code, name)}
      onBackToBot={onBackToBot}
      onHaptic={onHaptic}
    />
  )
}
