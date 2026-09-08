import { useEffect, useMemo, useRef, useState } from 'react'
import { PlayingCard } from '../../components/PlayingCard'
import { OnlineLobbyMenu, OnlineWait } from '../../components/OnlineLobby'
import { getWebApp } from '../../lib/telegram'
import { getDealTiming, playPokerSound, playUiSound } from '../../lib/settings'
import {
  type PokerAction,
  type PokerSeatView,
  bestHand,
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
import { BetActionLabel, ChipPile, PokerSeatCard, PotFlightOverlay } from './tableChrome'

const REVEAL_STAGGER_MS = 720
const NEXT_HAND_SEC = 5
const ONLINE_ANIM_SCALE = 1.65

function onlineDealTiming() {
  const t = getDealTiming()
  return {
    ...t,
    baseMs: Math.round(t.baseMs * ONLINE_ANIM_SCALE),
    gapMs: Math.round(t.gapMs * ONLINE_ANIM_SCALE),
    boardGapMs: Math.round(t.boardGapMs * ONLINE_ANIM_SCALE),
  }
}

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

function holeKey(cards: { id: string }[] | null | undefined) {
  return cards?.map((c) => c.id).join(',') ?? ''
}

function PokerOnlineTable({
  view,
  role,
  opponentName,
  onAction,
  onHaptic,
}: {
  view: PokerSeatView
  role: 'host' | 'guest'
  opponentName: string
  onAction: (action: PokerAction) => void
  onLeave?: () => void
  onHaptic?: (t?: 'light' | 'medium' | 'success' | 'error') => void
}) {
  const landscape = useLandscape()
  const [wager, setWager] = useState(() => Math.max(view.minBet, BLIND))
  const [dealTick, setDealTick] = useState(1)
  const [freshBoardIds, setFreshBoardIds] = useState<string[]>([])
  const [oppRevealed, setOppRevealed] = useState(false)
  const [oppFlipping, setOppFlipping] = useState(false)
  const [winnerIdxs, setWinnerIdxs] = useState<number[]>([])
  const [potFlight, setPotFlight] = useState<{ id: number; targets: number[]; amount: number } | null>(
    null,
  )
  const [nextHandIn, setNextHandIn] = useState<number | null>(null)

  const prev = useRef({
    phase: view.phase,
    boardLen: view.board.length,
    boardIds: view.board.map((c) => c.id).join(','),
    hole: holeKey(view.you.hole),
    pot: view.pot,
    yourTurn: view.yourTurn,
    oppStreet: view.opponent.streetBet,
    oppFolded: view.opponent.folded,
    oppStack: view.opponent.stack,
    youStack: view.you.stack,
    status: view.status,
  })
  const potFlightTimerRef = useRef(0)
  const revealTimerRef = useRef(0)
  const lastPotRef = useRef(view.pot)
  const dealTiming = useMemo(() => onlineDealTiming(), [dealTick])

  const allInSpectating =
    view.phase !== 'over' && view.you.stack <= 0 && !view.yourTurn && !view.you.folded
  const facingAllIn = !!view.facingAllIn
  const callIsAllIn = view.canCall && view.callAmount >= view.you.stack && view.you.stack > 0

  useEffect(() => {
    if (view.pot > 0) lastPotRef.current = view.pot
  }, [view.pot])

  // New hand → deal anim + chips sound
  useEffect(() => {
    const key = holeKey(view.you.hole)
    if (key && key !== prev.current.hole && view.phase === 'preflop') {
      setDealTick((t) => t + 1)
      setOppRevealed(false)
      setOppFlipping(false)
      setWinnerIdxs([])
      setFreshBoardIds([])
      playPokerSound('cards')
      window.setTimeout(() => playPokerSound('chips'), 140)
    }
    prev.current.hole = key
  }, [view.you.hole, view.phase])

  // Board deals
  useEffect(() => {
    const ids = view.board.map((c) => c.id)
    const joined = ids.join(',')
    if (joined !== prev.current.boardIds) {
      const prevIds = prev.current.boardIds ? prev.current.boardIds.split(',').filter(Boolean) : []
      const fresh = ids.filter((id) => !prevIds.includes(id))
      if (fresh.length) {
        setFreshBoardIds(fresh)
        if (fresh.length >= 3) playPokerSound('cards')
        else playPokerSound('card')
        const { baseMs } = getDealTiming()
        window.setTimeout(() => setFreshBoardIds([]), Math.max(280, Math.round(baseMs * 0.55)))
      }
      prev.current.boardIds = joined
      prev.current.boardLen = ids.length
    }
  }, [view.board])

  // Opponent action sounds — only when their status line shows a real action
  useEffect(() => {
    const p = prev.current
    if (view.phase === 'over') {
      p.yourTurn = view.yourTurn
      p.oppStreet = view.opponent.streetBet
      p.oppFolded = view.opponent.folded
      p.oppStack = view.opponent.stack
      p.youStack = view.you.stack
      p.pot = view.pot
      p.status = view.status
      return
    }

    const becameYourTurn = !p.yourTurn && view.yourTurn
    const oppBetGrew = view.opponent.streetBet > p.oppStreet
    const oppFoldedNow = !p.oppFolded && view.opponent.folded
    const statusCore = view.status.replace(/\s*(Ваш ход\.|Ход соперника…)\s*$/u, '').trim()
    const prevCore = p.status.replace(/\s*(Ваш ход\.|Ход соперника…)\s*$/u, '').trim()
    const statusChanged = statusCore !== prevCore

    if (oppFoldedNow) {
      playUiSound('ok')
    } else if (oppBetGrew) {
      playPokerSound('chips')
    } else if (becameYourTurn && statusChanged && /^Чек/u.test(statusCore)) {
      playPokerSound('check')
    } else if (
      becameYourTurn &&
      statusChanged &&
      /^(Колл|Рейз|Ставка|All-in)/u.test(statusCore)
    ) {
      playPokerSound('chips')
    }

    p.yourTurn = view.yourTurn
    p.oppStreet = view.opponent.streetBet
    p.oppFolded = view.opponent.folded
    p.oppStack = view.opponent.stack
    p.youStack = view.you.stack
    p.pot = view.pot
    p.status = view.status
  }, [
    view.yourTurn,
    view.opponent.streetBet,
    view.opponent.folded,
    view.opponent.stack,
    view.you.stack,
    view.pot,
    view.toCall,
    view.phase,
    view.status,
  ])

  const onActionRef = useRef(onAction)
  onActionRef.current = onAction

  // Auto next hand like solo (host advances; guest just watches the countdown)
  useEffect(() => {
    if (view.phase !== 'over') {
      setNextHandIn(null)
      return
    }
    setNextHandIn(NEXT_HAND_SEC)
    const started = Date.now()
    const tick = window.setInterval(() => {
      const left = Math.max(0, NEXT_HAND_SEC - Math.floor((Date.now() - started) / 1000))
      setNextHandIn(left)
    }, 200)
    const t =
      role === 'host'
        ? window.setTimeout(() => {
            onActionRef.current({ type: 'nextHand' })
          }, NEXT_HAND_SEC * 1000)
        : 0
    return () => {
      window.clearInterval(tick)
      if (t) window.clearTimeout(t)
    }
  }, [view.phase, role, dealTick])

  // Staggered opponent reveal at showdown
  useEffect(() => {
    window.clearTimeout(revealTimerRef.current)
    if (view.phase === 'over' && view.opponent.hole && !view.opponent.folded) {
      if (oppRevealed) return
      setOppFlipping(true)
      playPokerSound('card')
      revealTimerRef.current = window.setTimeout(() => {
        setOppFlipping(false)
        setOppRevealed(true)
      }, REVEAL_STAGGER_MS)
      return () => window.clearTimeout(revealTimerRef.current)
    }
    if (view.phase !== 'over') {
      setOppRevealed(false)
      setOppFlipping(false)
    }
  }, [view.phase, view.opponent.hole, view.opponent.folded, oppRevealed])

  // Pot flight + outcome sounds when hand ends
  useEffect(() => {
    if (prev.current.phase !== 'over' && view.phase === 'over') {
      const potSnap = Math.max(lastPotRef.current, prev.current.pot, view.pot)
      const targets: number[] = []
      if (view.winner === view.seat || (view.winner == null && view.youWon)) targets.push(0)
      if (view.winner != null && view.winner !== view.seat) targets.push(2)
      if (view.winner == null && view.youWon !== false) {
        // split — fly to both
        if (!targets.includes(0)) targets.push(0)
        if (!targets.includes(2)) targets.push(2)
      }
      if (targets.length === 0) targets.push(view.youWon ? 0 : 2)

      window.clearTimeout(potFlightTimerRef.current)
      setWinnerIdxs(targets)
      setPotFlight({ id: Date.now(), targets, amount: Math.max(1, potSnap) })
      playPokerSound('chips')
      window.setTimeout(() => playPokerSound('chips'), 320)
      potFlightTimerRef.current = window.setTimeout(() => setPotFlight(null), 1200)

      if (view.youWon === true) {
        onHaptic?.('success')
        playUiSound('ok')
      } else if (view.youWon === false) {
        onHaptic?.('error')
        playUiSound('warn')
      } else {
        onHaptic?.('medium')
        playUiSound('tap')
      }
    }
    if (view.phase !== 'over' && prev.current.phase === 'over') {
      setWinnerIdxs([])
      setPotFlight(null)
    }
    prev.current.phase = view.phase
    prev.current.pot = view.pot
  }, [view.phase, view.winner, view.seat, view.youWon, view.pot, onHaptic])

  useEffect(() => {
    setWager(Math.max(view.minBet, Math.min(view.maxBet, wager || view.minBet)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.minBet, view.maxBet, view.phase, view.toCall])

  useEffect(
    () => () => {
      window.clearTimeout(potFlightTimerRef.current)
      window.clearTimeout(revealTimerRef.current)
    },
    [],
  )

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
    } else if (action.type === 'nextHand') {
      onHaptic?.('medium')
    } else {
      onHaptic?.('medium')
      playPokerSound('chips')
    }
  }

  const resultClass =
    view.phase === 'over' ? (view.youWon ? 'win' : view.youWon === false ? 'lose' : '') : ''

  const liveHint = useMemo(() => {
    if (view.you.hole.length < 2) return null
    const combo = (() => {
      const hand = bestHand(view.you.hole, view.board)
      if (view.board.length === 0) {
        if (hand.label === 'Пара') return 'Пара в руке'
        return hand.label
      }
      return hand.label
    })()
    let pct = 50
    let exact = false
    if (view.phase === 'over' && view.opponent.hole && !view.opponent.folded) {
      const yours = bestHand(view.you.hole, view.board).score
      const theirs = bestHand(view.opponent.hole, view.board).score
      pct = yours > theirs ? 100 : yours < theirs ? 0 : 50
      exact = true
    } else if (view.board.length >= 3) {
      const score = bestHand(view.you.hole, view.board).score
      if (score >= 5000) pct = 78
      else if (score >= 3000) pct = 62
      else if (score >= 1000) pct = 44
      else pct = 32
    }
    const tone = pct >= 58 ? 'good' : pct <= 38 ? 'low' : 'mid'
    return { combo, pct, tone, exact }
  }, [view.you.hole, view.board, view.phase, view.opponent.hole, view.opponent.folded])

  const showOppCards = oppRevealed && !!view.opponent.hole && !view.opponent.folded
  const youWinner = winnerIdxs.includes(0)
  const oppWinner = winnerIdxs.includes(2)
  const waitingTurn = view.phase !== 'over' && !view.yourTurn && !allInSpectating

  return (
    <div className={`poker-landscape poker-online${landscape ? ' is-landscape' : ' is-portrait'}`}>
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
                {view.board.map((c, i) => {
                  const isFresh = freshBoardIds.includes(c.id)
                  const freshIndex = isFresh ? freshBoardIds.indexOf(c.id) : 0
                  return (
                    <PlayingCard
                      key={c.id}
                      card={c}
                      index={i}
                      enter="none"
                      className={`poker-board-card${isFresh ? ' poker-deal-board' : ''}`}
                      style={
                        isFresh
                          ? { animationDelay: `${freshIndex * dealTiming.boardGapMs}ms` }
                          : undefined
                      }
                    />
                  )
                })}
              </div>
            </div>

            {view.pot > 0 ? (
              <div className="poker-pot" key={`pot-${view.pot}`}>
                <ChipPile amount={view.pot} format={formatChips} compact maxChips={3} />
                <span className="poker-pot-label">Банк</span>
              </div>
            ) : potFlight ? (
              <PotFlightOverlay
                id={potFlight.id}
                targets={potFlight.targets}
                amount={potFlight.amount}
                format={formatChips}
              />
            ) : null}

            {view.opponent.streetBet > 0 ? (
              <ChipPile
                key={`bet-opp-${view.opponent.streetBet}`}
                amount={view.opponent.streetBet}
                format={formatChips}
                className="poker-bet-on-table poker-bet-s2"
                flat
              />
            ) : null}

            {view.you.streetBet > 0 ? (
              <ChipPile
                key={`bet-you-${view.you.streetBet}`}
                amount={view.you.streetBet}
                format={formatChips}
                className="poker-bet-on-table poker-bet-s0"
                flat
              />
            ) : null}

            {/* Opponent — same rail seat as solo bot s2 (top-left; pot keeps top-center) */}
            <div
              className={`poker-seat-slot poker-seat-s2${view.opponent.folded ? ' is-folded' : ''}${
                showOppCards ? ' is-revealed' : ''
              }${oppWinner ? ' is-winner' : ''}`}
            >
              <div
                className={`poker-bot-cards${showOppCards ? ' is-revealed' : ''}${
                  oppFlipping ? ' is-flipping' : ''
                }`}
                key={`opp-cards-${dealTick}`}
              >
                {showOppCards && view.opponent.hole
                  ? view.opponent.hole.map((c, ci) => (
                      <PlayingCard
                        key={c.id}
                        card={c}
                        index={ci}
                        enter="none"
                        className="poker-hole-card poker-deal-to-bot"
                      />
                    ))
                  : [0, 1].map((ci) => (
                      <PlayingCard
                        key={`opp-back-${dealTick}-${ci}`}
                        faceDown
                        index={ci}
                        enter="none"
                        className="poker-hole-card poker-deal-to-bot"
                        style={{
                          animationDelay: `${Math.round(dealTiming.gapMs * 1.35) + ci * dealTiming.gapMs}ms`,
                        }}
                      />
                    ))}
              </div>
              <PokerSeatCard
                name={opponentName}
                level={12}
                stackText={formatChips(view.opponent.stack)}
                accent="linear-gradient(145deg,#6b3a3a,#3a1515)"
                dealer={view.dealer !== view.seat && view.phase !== 'over'}
                active={!view.opponent.folded}
                hideName
              />
            </div>

            {/* You — bottom */}
            <div
              className={`poker-seat-slot poker-seat-s0${view.you.folded ? ' is-folded' : ''}${
                view.yourTurn && view.phase !== 'over' && !allInSpectating ? ' is-acting' : ''
              }${youWinner ? ' is-winner' : ''}`}
            >
              <div className="poker-you-cards" key={`hand-${dealTick}`}>
                {liveHint ? (
                  <div className="poker-live-hint" aria-live="polite">
                    <span className="poker-live-combo">{liveHint.combo}</span>
                    <span className="poker-live-sep" aria-hidden>
                      ·
                    </span>
                    <span className={`poker-live-odds is-${liveHint.tone}`}>
                      {liveHint.exact ? `${liveHint.pct}%` : `~${liveHint.pct}%`}
                    </span>
                  </div>
                ) : null}
                <div className="poker-hand">
                  {view.you.hole.map((c, ci) => (
                    <PlayingCard
                      key={c.id}
                      card={c}
                      index={ci}
                      enter="none"
                      className="poker-hole-card poker-deal-to-you"
                      style={{ animationDelay: `${ci * dealTiming.gapMs}ms` }}
                    />
                  ))}
                </div>
                {view.you.hole.length >= 2 ? (
                  <div
                    className={`poker-bet-amount-row${
                      view.phase === 'over' || allInSpectating ? ' is-ghost' : waitingTurn ? ' is-dimmed' : ''
                    }`}
                    aria-hidden={view.phase === 'over' || allInSpectating}
                  >
                    <div className="poker-bet-stepper" aria-label="Размер ставки">
                      <button
                        type="button"
                        className="poker-bet-nudge"
                        aria-label="Уменьшить ставку"
                        disabled={
                          view.phase === 'over' ||
                          allInSpectating ||
                          !view.yourTurn ||
                          wager <= view.minBet
                        }
                        onClick={() => setWager((w) => clampWager(w - 10))}
                      >
                        −
                      </button>
                      <span className="poker-bet-value">{formatChips(wager)}</span>
                      <button
                        type="button"
                        className="poker-bet-nudge"
                        aria-label="Увеличить ставку"
                        disabled={
                          view.phase === 'over' ||
                          allInSpectating ||
                          !view.yourTurn ||
                          wager >= view.maxBet
                        }
                        onClick={() => setWager((w) => clampWager(w + 10))}
                      >
                        +
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
              <PokerSeatCard
                name="Вы"
                level={10}
                stackText={formatChips(view.you.stack)}
                accent="linear-gradient(145deg,#3a6ea5,#1a3358)"
                dealer={view.dealer === view.seat && view.phase !== 'over'}
                active={!view.you.folded}
                hideName
              />
            </div>
          </div>

          <div className="poker-bottom">
            <div
              className={`poker-actions${waitingTurn ? ' is-dimmed' : ''}`}
              aria-disabled={waitingTurn || undefined}
            >
              {view.phase === 'over' ? (
                <p className="poker-next-hint" aria-live="polite">
                  {nextHandIn != null && nextHandIn > 0
                    ? `Новая раздача через ${nextHandIn}…`
                    : 'Новая раздача…'}
                </p>
              ) : allInSpectating ? (
                <p className="poker-allin-wait">All-in — смотрите, как открываются карты</p>
              ) : (
                <>
                  {!facingAllIn && view.canBet ? (
                    <div className="poker-bet-presets">
                      <button
                        type="button"
                        className="poker-bet-chip"
                        disabled={!view.yourTurn}
                        onClick={() => setWager(clampWager(view.minBet))}
                      >
                        Мин
                      </button>
                      <button
                        type="button"
                        className="poker-bet-chip"
                        disabled={!view.yourTurn}
                        onClick={() =>
                          setWager(
                            clampWager(Math.max(view.minBet, Math.floor(view.pot / 2) || view.minBet)),
                          )
                        }
                      >
                        ½ банка
                      </button>
                      <button
                        type="button"
                        className="poker-bet-chip"
                        disabled={!view.yourTurn}
                        onClick={() =>
                          setWager(clampWager(Math.max(view.minBet, view.pot || view.minBet)))
                        }
                      >
                        Банк
                      </button>
                      <button
                        type="button"
                        className="poker-bet-chip"
                        disabled={!view.yourTurn}
                        onClick={() => setWager(clampWager(view.maxBet))}
                      >
                        Макс
                      </button>
                    </div>
                  ) : null}
                  <div className="poker-actions-row">
                    {view.toCall > 0 || view.canCall ? (
                      <button
                        type="button"
                        className="poker-btn poker-btn-soft"
                        disabled={!view.yourTurn || !view.canCall}
                        onClick={() => send({ type: 'call' })}
                      >
                        {callIsAllIn || (view.callAmount >= view.you.stack && view.you.stack > 0) ? (
                          'All In'
                        ) : (
                          <BetActionLabel
                            verb="Колл"
                            amount={Math.max(view.callAmount, view.toCall)}
                            format={formatChips}
                          />
                        )}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="poker-btn poker-btn-soft"
                        onClick={() => send({ type: 'check' })}
                        disabled={!view.yourTurn || !view.canCheck}
                      >
                        Чек
                      </button>
                    )}
                    {view.canBet && !facingAllIn ? (
                      <button
                        type="button"
                        className="poker-btn poker-btn-bet"
                        disabled={
                          !view.yourTurn ||
                          wager <= 0 ||
                          (view.toCall > 0 && wager <= view.toCall)
                        }
                        onClick={() => send({ type: 'bet', amount: clampWager(wager) })}
                      >
                        {wager >= view.you.stack && view.you.stack > 0 ? (
                          'All In'
                        ) : view.toCall > 0 ? (
                          <BetActionLabel verb="Рейз" amount={clampWager(wager)} format={formatChips} />
                        ) : (
                          <BetActionLabel verb="Ставка" amount={clampWager(wager)} format={formatChips} />
                        )}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="poker-btn poker-btn-fold"
                      onClick={() => send({ type: 'fold' })}
                      disabled={!view.yourTurn || !view.canFold}
                    >
                      Сброс
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

type Mode = 'menu' | 'host' | 'join'

function OnlineConnectionIssue({
  opponentLeft,
  message,
  onRetry,
  onLeave,
  onHaptic,
}: {
  opponentLeft: boolean
  message: string
  onRetry?: () => void
  onLeave: () => void
  onHaptic?: (t?: 'light' | 'medium' | 'success' | 'error') => void
}) {
  const [leftIn, setLeftIn] = useState(opponentLeft ? 5 : null)

  useEffect(() => {
    if (!opponentLeft) return
    onHaptic?.('error')
    setLeftIn(5)
    const started = Date.now()
    const tick = window.setInterval(() => {
      const n = Math.max(0, 5 - Math.floor((Date.now() - started) / 1000))
      setLeftIn(n)
    }, 200)
    const t = window.setTimeout(() => onLeave(), 5000)
    return () => {
      window.clearInterval(tick)
      window.clearTimeout(t)
    }
  }, [opponentLeft, onLeave, onHaptic])

  return (
    <div className="online-conn-issue" role="status">
      <p className="online-conn-issue-title">
        {opponentLeft ? 'Соперник вышел из игры' : 'Нет связи'}
      </p>
      <p className="online-conn-issue-msg">{message}</p>
      {opponentLeft ? (
        <p className="online-conn-issue-hint">
          {leftIn != null && leftIn > 0
            ? `Возврат в лобби через ${leftIn}…`
            : 'Возврат в лобби…'}
        </p>
      ) : (
        <div className="online-conn-issue-actions">
          {onRetry ? (
            <button
              type="button"
              className="poker-btn poker-btn-bet"
              onClick={() => {
                onHaptic?.('medium')
                onRetry()
              }}
            >
              Переподключиться
            </button>
          ) : null}
          <button type="button" className="poker-btn poker-btn-soft" onClick={onLeave}>
            В лобби
          </button>
        </div>
      )}
    </div>
  )
}

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
    const onVis = () => {
      if (document.visibilityState !== 'visible') return
      const r = roomRef.current
      if (!r) return
      if (r.status === 'reconnecting' || r.status === 'disconnected') {
        if (!r.opponentLeft) r.retryConnection?.()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onVis)
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
        role={room.role}
        opponentName={room.opponent?.name ?? 'Соперник'}
        onAction={(action) => room.sendAction(action)}
        onLeave={leave}
        onHaptic={onHaptic}
      />
    )
  }

  if (room?.status === 'reconnecting' || room?.status === 'disconnected') {
    const opponentLeft = !!room.opponentLeft
    return (
      <OnlineConnectionIssue
        opponentLeft={opponentLeft}
        message={room.error || (opponentLeft ? 'Соперник вышел из игры' : 'Связь с сервером потеряна')}
        onRetry={
          opponentLeft
            ? undefined
            : () => {
                room.retryConnection?.()
                setRoom({ ...room })
              }
        }
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
