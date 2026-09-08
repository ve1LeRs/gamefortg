import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PlayingCard } from '../components/PlayingCard'
import {
  type Card,
  type Rank,
  POKER_RANKS,
  makeDeck,
  shuffle,
  rankValue,
} from '../lib/cards'
import { loadSettings, playPokerSound, playUiSound } from '../lib/settings'

type Phase = 'preflop' | 'flop' | 'turn' | 'river' | 'over'

type HandRank = {
  score: number
  label: string
}

const START_STACK = 1000
const TOP_UP = 1000
const BLIND = 15
const POKER_STACKS_KEY = 'playfort-poker-stacks'

type SavedStacks = { player: number; bot: number }

function loadPokerStacks(): SavedStacks {
  try {
    const raw = localStorage.getItem(POKER_STACKS_KEY)
    if (!raw) return { player: START_STACK, bot: START_STACK }
    const parsed = JSON.parse(raw) as { player?: unknown; bot?: unknown }
    const player = Math.floor(Number(parsed.player))
    const bot = Math.floor(Number(parsed.bot))
    return {
      player: Number.isFinite(player) && player > 0 ? player : START_STACK,
      bot: Number.isFinite(bot) && bot > 0 ? bot : START_STACK,
    }
  } catch {
    return { player: START_STACK, bot: START_STACK }
  }
}

function savePokerStacks(player: number, bot: number) {
  try {
    const p = Math.max(0, Math.floor(player))
    const b = Math.max(0, Math.floor(bot))
    localStorage.setItem(POKER_STACKS_KEY, JSON.stringify({ player: p, bot: b }))
  } catch {
    /* noop */
  }
}

function formatChips(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`
  return String(n)
}

function evaluate(cards: Card[]): HandRank {
  const values = cards
    .map((c) => rankValue(c.rank, POKER_RANKS))
    .sort((a, b) => b - a)
  const suits = cards.map((c) => c.suit)
  const counts = new Map<number, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])
  const isFlush = suits.every((s) => s === suits[0])
  const uniq = [...new Set(values)].sort((a, b) => b - a)
  let isStraight = false
  let straightHigh = 0
  if (uniq.length >= 5) {
    for (let i = 0; i <= uniq.length - 5; i += 1) {
      if (uniq[i] - uniq[i + 4] === 4) {
        isStraight = true
        straightHigh = uniq[i]
        break
      }
    }
    if (!isStraight && uniq.includes(12) && [0, 1, 2, 3].every((v) => uniq.includes(v))) {
      isStraight = true
      straightHigh = 3
    }
  }

  const best5 = (vals: number[]) => vals.slice(0, 5)

  if (isStraight && isFlush) return { score: 8000 + straightHigh, label: 'Стрит-флеш' }
  if (groups[0][1] === 4) {
    return { score: 7000 + groups[0][0] * 20 + (groups[1]?.[0] ?? 0), label: 'Каре' }
  }
  if (groups[0][1] === 3 && groups[1]?.[1] === 2) {
    return { score: 6000 + groups[0][0] * 20 + groups[1][0], label: 'Фулл-хаус' }
  }
  if (isFlush) return { score: 5000 + best5(values).reduce((a, b) => a * 15 + b, 0) / 1e6, label: 'Флеш' }
  if (isStraight) return { score: 4000 + straightHigh, label: 'Стрит' }
  if (groups[0][1] === 3) {
    const kickers = values.filter((v) => v !== groups[0][0])
    return { score: 3000 + groups[0][0] * 50 + kickers[0], label: 'Тройка' }
  }
  if (groups[0][1] === 2 && groups[1]?.[1] === 2) {
    const high = Math.max(groups[0][0], groups[1][0])
    const low = Math.min(groups[0][0], groups[1][0])
    const kicker = values.find((v) => v !== high && v !== low) ?? 0
    return { score: 2000 + high * 40 + low * 2 + kicker * 0.01, label: 'Две пары' }
  }
  if (groups[0][1] === 2) {
    const kickers = values.filter((v) => v !== groups[0][0])
    return { score: 1000 + groups[0][0] * 50 + kickers[0], label: 'Пара' }
  }
  return { score: best5(values).reduce((a, b) => a * 15 + b, 0) / 1e5, label: 'Старшая карта' }
}

function bestHand(hole: Card[], board: Card[]): HandRank {
  const all = [...hole, ...board]
  if (all.length < 5) return evaluate(all)
  let best: HandRank = { score: -1, label: '' }
  const n = all.length
  for (let a = 0; a < n - 4; a += 1) {
    for (let b = a + 1; b < n - 3; b += 1) {
      for (let c = b + 1; c < n - 2; c += 1) {
        for (let d = c + 1; d < n - 1; d += 1) {
          for (let e = d + 1; e < n; e += 1) {
            const hand = evaluate([all[a], all[b], all[c], all[d], all[e]])
            if (hand.score > best.score) best = hand
          }
        }
      }
    }
  }
  return best
}

function shuffleInPlace<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/** Monte Carlo equity vs random opponent hole (+ random runout). */
function estimateEquity(hole: Card[], board: Card[], trials = 160): number {
  if (hole.length < 2) return 0.5
  const used = new Set([...hole, ...board].map((c) => c.id))
  const remaining = makeDeck(POKER_RANKS as Rank[]).filter((c) => !used.has(c.id))
  if (remaining.length < 2) return 0.5
  const needBoard = Math.max(0, 5 - board.length)
  let wins = 0
  let ties = 0
  for (let t = 0; t < trials; t += 1) {
    const pool = shuffleInPlace(remaining.slice())
    const opp = [pool[0]!, pool[1]!]
    const runout = needBoard > 0 ? pool.slice(2, 2 + needBoard) : []
    const fullBoard = board.length >= 5 ? board : [...board, ...runout]
    const p = bestHand(hole, fullBoard).score
    const o = bestHand(opp, fullBoard).score
    if (p > o) wins += 1
    else if (p === o) ties += 1
  }
  return (wins + ties * 0.5) / trials
}

function liveComboLabel(hole: Card[], board: Card[]): string {
  if (hole.length < 2) return '—'
  const hand = bestHand(hole, board)
  if (board.length === 0) {
    if (hand.label === 'Пара') return 'Пара в руке'
    const high = [...hole].sort(
      (a, b) => rankValue(b.rank, POKER_RANKS) - rankValue(a.rank, POKER_RANKS),
    )[0]!
    return `Старшая ${high.rank}${high.suit}`
  }
  return hand.label
}

function dealHole() {
  const deck = shuffle(makeDeck(POKER_RANKS as Rank[]))
  return {
    player: [deck.pop()!, deck.pop()!],
    bot: [deck.pop()!, deck.pop()!],
    deck,
  }
}

function postBlinds(playerStack: number, botStack: number) {
  const pBlind = Math.min(BLIND, playerStack)
  const bBlind = Math.min(BLIND, botStack)
  return {
    stack: playerStack - pBlind,
    botStack: botStack - bBlind,
    pot: pBlind + bBlind,
    pBlind,
    bBlind,
  }
}

function chipCountFor(amount: number, maxChips = 6) {
  if (amount <= 0) return 0
  let n = 1
  if (amount >= 20) n = 2
  if (amount >= 50) n = 3
  if (amount >= 100) n = 4
  if (amount >= 200) n = 5
  if (amount >= 400) n = 6
  return Math.min(n, maxChips)
}

const CHIP_COLORS = [
  { face: '#c62828', rim: '#8e1b1b', pip: '#fff' },
  { face: '#2e7d32', rim: '#1b5e20', pip: '#fff' },
  { face: '#1565c0', rim: '#0d47a1', pip: '#fff' },
  { face: '#f9a825', rim: '#c17900', pip: '#3a2500' },
  { face: '#263238', rim: '#0d1214', pip: '#fff' },
] as const

function PokerChipSvg({ colorIndex, size, uid }: { colorIndex: number; size: number; uid: string }) {
  const c = CHIP_COLORS[colorIndex % CHIP_COLORS.length]!
  const shineId = `${uid}-shine-${colorIndex}`
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden className="poker-chip-svg">
      <defs>
        <radialGradient id={shineId} cx="32%" cy="28%" r="65%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="45%" stopColor="#ffffff" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.25" />
        </radialGradient>
      </defs>
      <circle cx="20" cy="21.5" r="17.5" fill="rgba(0,0,0,0.35)" />
      <circle cx="20" cy="20" r="17.5" fill={c.rim} />
      <circle cx="20" cy="20" r="14.2" fill={c.face} />
      <circle cx="20" cy="20" r="14.2" fill={`url(#${shineId})`} />
      <circle cx="20" cy="20" r="14.2" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.2" />
      <circle cx="20" cy="20" r="9.2" fill="none" stroke={c.pip} strokeOpacity="0.9" strokeWidth="1.6" strokeDasharray="3.2 2.4" />
      {[0, 60, 120, 180, 240, 300].map((deg) => {
        const rad = ((deg - 90) * Math.PI) / 180
        const x = 20 + Math.cos(rad) * 15.2
        const y = 20 + Math.sin(rad) * 15.2
        return <circle key={deg} cx={x} cy={y} r="1.35" fill={c.pip} opacity="0.95" />
      })}
      <circle cx="20" cy="20" r="5.2" fill={c.face} stroke={c.pip} strokeOpacity="0.55" strokeWidth="1" />
    </svg>
  )
}

function ChipPile({
  amount,
  className = '',
  compact,
  maxChips,
}: {
  amount: number
  className?: string
  compact?: boolean
  maxChips?: number
}) {
  if (amount <= 0) return null
  const n = chipCountFor(amount, maxChips ?? (compact ? 4 : 6))
  const size = compact ? 18 : 28
  const uid = `pile-${amount}-${compact ? 'c' : 'f'}-${className}`
  return (
    <div className={`poker-chip-pile${compact ? ' is-compact' : ''} ${className}`.trim()} title={formatChips(amount)}>
      <div className="poker-chip-stack" aria-hidden style={{ ['--chip-n' as string]: n }}>
        {Array.from({ length: n }, (_, i) => (
          <span key={i} className="poker-chip-disk" style={{ ['--chip-i' as string]: i }}>
            <PokerChipSvg colorIndex={i} size={size} uid={`${uid}-${i}`} />
          </span>
        ))}
      </div>
      <span className="poker-chip-amt">{formatChips(amount)}</span>
    </div>
  )
}

function betSize(phase: Phase) {
  if (phase === 'preflop') return 20
  if (phase === 'flop') return 40
  if (phase === 'turn') return 60
  return 80
}

function clampBet(value: number, min: number, max: number) {
  if (max < min) return Math.max(0, max)
  return Math.min(max, Math.max(min, value))
}

/** 0..1 — rough preflop / made-hand strength for bot decisions. */
function handStrength(hole: Card[], board: Card[]): number {
  if (board.length === 0) {
    const v0 = rankValue(hole[0]!.rank, POKER_RANKS)
    const v1 = rankValue(hole[1]!.rank, POKER_RANKS)
    const high = Math.max(v0, v1)
    const low = Math.min(v0, v1)
    const pair = v0 === v1
    const suited = hole[0]!.suit === hole[1]!.suit
    let s = (high / 12) * 0.5 + (low / 12) * 0.18
    if (pair) s = 0.52 + (high / 12) * 0.42
    if (suited) s += 0.07
    if (!pair && high - low <= 2) s += 0.05
    return Math.min(1, Math.max(0.05, s))
  }
  const score = bestHand(hole, board).score
  if (score >= 7000) return 0.98
  if (score >= 6000) return 0.94
  if (score >= 5000) return 0.88
  if (score >= 4000) return 0.8
  if (score >= 3000) return 0.72
  if (score >= 2000) return 0.58
  if (score >= 1000) return 0.34 + Math.min(0.22, (score - 1000) / 2500)
  return Math.min(0.32, 0.08 + score / 4000)
}

type BotDecision =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'raise'; amount: number }

function botDecide(opts: {
  facingBet: boolean
  callAmount: number
  hole: Card[]
  board: Card[]
  pot: number
  botStack: number
  playerStack: number
  phase: Phase
}): BotDecision {
  const { facingBet, callAmount, hole, board, pot, botStack, playerStack, phase } = opts
  const strength = handStrength(hole, board)
  const maxChip = Math.min(botStack, playerStack)
  const minChip = Math.min(betSize(phase), Math.max(0, maxChip))
  const roll = Math.random()
  const streetAggro = phase === 'preflop' ? 0.12 : phase === 'flop' ? 0.18 : phase === 'turn' ? 0.22 : 0.16

  if (!facingBet) {
    // Player checked — bot may check or lead out (value / bluff).
    const wantBet =
      strength >= 0.58 ||
      (strength >= 0.4 && roll < streetAggro + strength * 0.25) ||
      (strength < 0.28 && roll < 0.1 + streetAggro * 0.35)
    if (wantBet && maxChip > 0) {
      const mult = strength >= 0.7 ? 0.9 + strength * 0.7 : strength >= 0.4 ? 0.55 + roll * 0.5 : 0.45 + roll * 0.35
      const amount = clampBet(Math.round(betSize(phase) * mult), minChip || Math.min(BLIND, maxChip), maxChip)
      if (amount > 0) return { type: 'raise', amount }
    }
    return { type: 'check' }
  }

  // Facing a player bet.
  const potOdds = callAmount / (pot + callAmount + 1)
  const bigBet = callAmount >= pot * 0.55

  // Trash vs big pressure → fold (rare bluff-raise).
  if (strength < 0.24 && (bigBet || callAmount >= botStack * 0.35)) {
    if (roll < 0.07 && maxChip > callAmount && botStack > callAmount * 2) {
      const amount = clampBet(callAmount + betSize(phase), callAmount + minChip, maxChip)
      if (amount > callAmount) return { type: 'raise', amount }
    }
    return { type: 'fold' }
  }
  if (strength < 0.32 && bigBet && roll < 0.55) return { type: 'fold' }
  if (strength < 0.38 && callAmount > pot * 0.85 && roll < 0.4) return { type: 'fold' }

  // Strong / semi-strong → raise for value (or as bluff sometimes).
  const wantRaise =
    (strength >= 0.72 && roll < 0.7) ||
    (strength >= 0.55 && roll < 0.35) ||
    (strength < 0.3 && roll < 0.08)
  if (wantRaise && maxChip > callAmount) {
    const bump = Math.round(betSize(phase) * (0.7 + strength * 0.9 + roll * 0.4))
    const amount = clampBet(callAmount + bump, callAmount + Math.max(minChip, 10), maxChip)
    if (amount > callAmount) return { type: 'raise', amount }
  }

  // Call if odds / equity look fine, or float sometimes.
  if (strength + 0.06 >= potOdds || strength >= 0.4 || (strength >= 0.28 && roll < 0.35)) {
    return { type: 'call' }
  }
  if (roll < 0.22) return { type: 'call' }
  return { type: 'fold' }
}

function isLandscapeNow() {
  if (typeof window === 'undefined') return true
  // Prefer geometry — Telegram WebView often lags on orientation media queries.
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
    const mq = window.matchMedia('(orientation: landscape)')
    mq.addEventListener?.('change', sync)
    window.addEventListener('resize', sync)
    window.addEventListener('orientationchange', sync)
    // Telegram may fire viewportChanged after rotate.
    const wa = (window as Window & { Telegram?: { WebApp?: { onEvent?: (e: string, cb: () => void) => void; offEvent?: (e: string, cb: () => void) => void } } })
      .Telegram?.WebApp
    wa?.onEvent?.('viewportChanged', sync)
    const t1 = window.setTimeout(sync, 120)
    const t2 = window.setTimeout(sync, 400)
    return () => {
      mq.removeEventListener?.('change', sync)
      window.removeEventListener('resize', sync)
      window.removeEventListener('orientationchange', sync)
      wa?.offEvent?.('viewportChanged', sync)
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [])
  return landscape
}

function SeatCard({
  name,
  level,
  stackText,
  dealer,
  active,
  accent,
}: {
  name: string
  level: number
  stackText: string
  dealer?: boolean
  active?: boolean
  accent?: string
}) {
  return (
    <div className={`poker-seat${active ? ' is-active' : ''}`}>
      <div className="poker-seat-name">{name}</div>
      <div className="poker-seat-avatar-wrap">
        {dealer && <span className="poker-dealer-btn">D</span>}
        <div className="poker-seat-avatar" style={accent ? { background: accent } : undefined}>
          {name.slice(0, 1)}
        </div>
        <span className="poker-seat-level">{level}</span>
      </div>
      <div className="poker-seat-money">
        <span>{stackText}</span>
      </div>
    </div>
  )
}

export function PokerGame({
  onHaptic,
}: {
  onHaptic?: (t?: 'light' | 'medium' | 'success' | 'error') => void
}) {
  const landscape = useLandscape()
  const savedStacks = useMemo(() => loadPokerStacks(), [])
  const firstDeal = useMemo(() => dealHole(), [])
  const firstBlinds = useMemo(
    () => postBlinds(savedStacks.player, savedStacks.bot),
    [savedStacks.player, savedStacks.bot],
  )

  const [deck, setDeck] = useState(firstDeal.deck)
  const [player, setPlayer] = useState(firstDeal.player)
  const [bot, setBot] = useState(firstDeal.bot)
  const [board, setBoard] = useState<Card[]>([])
  const [phase, setPhase] = useState<Phase>('preflop')
  const [pot, setPot] = useState(firstBlinds.pot)
  const [stack, setStack] = useState(firstBlinds.stack)
  const [botStack, setBotStack] = useState(firstBlinds.botStack)
  /** Chips sitting in front of each seat this street (blinds / bets). */
  const [playerBet, setPlayerBet] = useState(firstBlinds.pBlind)
  const [botBet, setBotBet] = useState(firstBlinds.bBlind)
  const [showBot, setShowBot] = useState(false)
  const [status, setStatus] = useState(`Блайнды по ${BLIND}. Чек или выберите ставку.`)
  const [resultClass, setResultClass] = useState('')
  const [dealTick, setDealTick] = useState(1)
  const [wager, setWager] = useState(() => betSize('preflop'))
  /** Amount the player must put in to continue after a bot bet/raise. 0 = street is open. */
  const [toCall, setToCall] = useState(0)
  /** Board cards that should play the deal animation (ids). */
  const [freshBoardIds, setFreshBoardIds] = useState<string[]>([])
  const boardLenRef = useRef(0)
  /** True while a timed action → advance/showdown is pending (avoids double-deal on all-in). */
  const streetBusyRef = useRef(false)

  const stackRef = useRef(stack)
  const botStackRef = useRef(botStack)
  const handRef = useRef({ deck, board, pot, player, bot })
  stackRef.current = stack
  botStackRef.current = botStack
  handRef.current = { deck, board, pot, player, bot }

  const maxWager = Math.min(stack, botStack)
  const minWager = Math.min(betSize(phase === 'over' ? 'preflop' : phase), Math.max(0, maxWager))
  const facingBot = toCall > 0
  /** No more betting possible — at least one side is all-in and the street is matched. */
  const allInSpectating = phase !== 'over' && Math.min(stack, botStack) <= 0 && toCall <= 0

  useEffect(() => {
    // Persist chips behind each seat (street bets already left the stack).
    savePokerStacks(stack, botStack)
  }, [stack, botStack])

  useEffect(() => {
    if (phase === 'over') return
    if (facingBot) {
      setWager(clampBet(toCall + betSize(phase), toCall, maxWager))
      return
    }
    setWager(clampBet(betSize(phase), minWager, maxWager))
  }, [phase, minWager, maxWager, facingBot, toCall])

  const nudgeWager = (delta: number) => {
    const lo = facingBot ? toCall : minWager
    setWager((w) => clampBet(w + delta, lo, maxWager))
    onHaptic?.('light')
  }

  const setWagerPreset = (value: number) => {
    const lo = facingBot ? toCall : minWager
    setWager(clampBet(value, lo, maxWager))
    onHaptic?.('light')
  }

  const settlePot = useCallback((winner: 'player' | 'bot' | 'tie', potAmount: number) => {
    if (winner === 'player') {
      stackRef.current += potAmount
      setStack(stackRef.current)
    } else if (winner === 'bot') {
      botStackRef.current += potAmount
      setBotStack(botStackRef.current)
    } else {
      const half = Math.floor(potAmount / 2)
      stackRef.current += half
      botStackRef.current += potAmount - half
      setStack(stackRef.current)
      setBotStack(botStackRef.current)
    }
    setPot(0)
    setPlayerBet(0)
    setBotBet(0)
  }, [])

  const dealNextHand = useCallback(
    (playerStack: number, botChips: number) => {
      let nextPlayer = Math.max(0, playerStack)
      let nextBot = Math.max(0, botChips)
      const toppedPlayer = nextPlayer <= 0
      const toppedBot = nextBot <= 0
      if (toppedPlayer) nextPlayer = TOP_UP
      if (toppedBot) nextBot = TOP_UP

      const hole = dealHole()
      const blinds = postBlinds(nextPlayer, nextBot)
      setDeck(hole.deck)
      setPlayer(hole.player)
      setBot(hole.bot)
      setBoard([])
      setPhase('preflop')
      setPot(blinds.pot)
      setStack(blinds.stack)
      setBotStack(blinds.botStack)
      setPlayerBet(blinds.pBlind)
      setBotBet(blinds.bBlind)
      setShowBot(false)
      setResultClass('')
      setDealTick((n) => n + 1)
      setToCall(0)
      setFreshBoardIds([])
      boardLenRef.current = 0
      setWager(betSize('preflop'))
      savePokerStacks(blinds.stack, blinds.botStack)

      if (toppedPlayer && toppedBot) {
        setStatus(`Оба получили +${TOP_UP}. Блайнды по ${BLIND}. Ваш ход.`)
      } else if (toppedPlayer) {
        setStatus(`Фишки кончились — +${TOP_UP}. Блайнды по ${BLIND}. Ваш ход.`)
      } else if (toppedBot) {
        setStatus(`Бот получил +${TOP_UP}. Блайнды по ${BLIND}. Ваш ход.`)
      } else {
        setStatus(`Блайнды по ${BLIND}. Ваш ход: чек, ставка или фолд.`)
      }
      onHaptic?.('medium')
      playPokerSound('cards')
      window.setTimeout(() => playPokerSound('chips'), 140)
    },
    [onHaptic],
  )

  const nextHand = useCallback(() => {
    dealNextHand(stackRef.current, botStackRef.current)
  }, [dealNextHand])

  const showdown = useCallback(
    (community: Card[], potAmount: number, playerHole: Card[], botHole: Card[]) => {
      setShowBot(true)
      setPhase('over')
      const p = bestHand(playerHole, community)
      const o = bestHand(botHole, community)
      if (p.score > o.score) {
        settlePot('player', potAmount)
        setStatus(`Победа! ${p.label} бьёт ${o.label}. +${potAmount}`)
        setResultClass('win')
        onHaptic?.('success')
        playUiSound('ok')
      } else if (p.score < o.score) {
        settlePot('bot', potAmount)
        setStatus(`Поражение. У бота ${o.label}, у вас ${p.label}. −банк`)
        setResultClass('lose')
        onHaptic?.('error')
        playUiSound('warn')
      } else {
        settlePot('tie', potAmount)
        setStatus(`Ничья: ${p.label}. Банк пополам.`)
        setResultClass('')
        onHaptic?.('medium')
        playUiSound('tap')
      }
      playPokerSound('card')
    },
    [onHaptic, settlePot],
  )

  const advance = useCallback(
    (
      from: Phase,
      currentDeck: Card[],
      currentBoard: Card[],
      potAmount: number,
      playerHole: Card[],
      botHole: Card[],
      opts?: { runout?: boolean },
    ) => {
      const copy = [...currentDeck]
      const runout = opts?.runout
      setToCall(0)
      setPlayerBet(0)
      setBotBet(0)
      if (from === 'preflop') {
        copy.pop()
        const flop = [copy.pop()!, copy.pop()!, copy.pop()!]
        boardLenRef.current = 0
        setFreshBoardIds(flop.map((c) => c.id))
        setBoard(flop)
        setDeck(copy)
        setPhase('flop')
        setStatus(runout ? 'All-in. Флоп…' : 'Флоп открыт. Чек, ставка или фолд.')
        playPokerSound('cards')
      } else if (from === 'flop') {
        copy.pop()
        const card = copy.pop()!
        boardLenRef.current = currentBoard.length
        setFreshBoardIds([card.id])
        setBoard([...currentBoard, card])
        setDeck(copy)
        setPhase('turn')
        setStatus(runout ? 'All-in. Тёрн…' : 'Тёрн. Чек, ставка или фолд.')
        playPokerSound('card')
      } else if (from === 'turn') {
        copy.pop()
        const card = copy.pop()!
        boardLenRef.current = currentBoard.length
        setFreshBoardIds([card.id])
        setBoard([...currentBoard, card])
        setDeck(copy)
        setPhase('river')
        setStatus(runout ? 'All-in. Ривер…' : 'Ривер. Чек, ставка или фолд.')
        playPokerSound('card')
      } else {
        showdown(currentBoard, potAmount, playerHole, botHole)
      }
    },
    [showdown],
  )

  const queueContinue = useCallback(
    (
      delay: number,
      phaseNow: Phase,
      deckNow: Card[],
      boardNow: Card[],
      potNow: number,
      playerNow: Card[],
      botNow: Card[],
      playerChips: number,
      botChips: number,
    ) => {
      streetBusyRef.current = true
      window.setTimeout(() => {
        const runout = playerChips <= 0 || botChips <= 0
        if (phaseNow === 'river') {
          showdown(boardNow, potNow, playerNow, botNow)
        } else {
          advance(phaseNow, deckNow, boardNow, potNow, playerNow, botNow, { runout })
        }
        streetBusyRef.current = false
      }, delay)
    },
    [advance, showdown],
  )

  // After all-in is matched, player has no decisions — run streets out automatically.
  useEffect(() => {
    if (!allInSpectating) return
    if (streetBusyRef.current) return
    setStatus(stack <= 0 ? 'All-in — смотрите раздачу…' : 'Бот в all-in — открываем карты…')
    streetBusyRef.current = true
    const phaseNow = phase
    const t = window.setTimeout(() => {
      const h = handRef.current
      if (phaseNow === 'river') {
        showdown(h.board, h.pot, h.player, h.bot)
      } else {
        advance(phaseNow, h.deck, h.board, h.pot, h.player, h.bot, { runout: true })
      }
      streetBusyRef.current = false
    }, 700)
    return () => {
      window.clearTimeout(t)
      streetBusyRef.current = false
    }
  }, [allInSpectating, phase, stack, advance, showdown])

  const check = () => {
    if (phase === 'over' || facingBot || allInSpectating) return
    onHaptic?.('light')

    const decision = botDecide({
      facingBet: false,
      callAmount: 0,
      hole: bot,
      board,
      pot,
      botStack,
      playerStack: stack,
      phase,
    })

    if (decision.type === 'raise') {
      const amount = clampBet(decision.amount, minWager, Math.min(stack, botStack))
      if (amount > 0 && botStack >= amount && stack > 0) {
        const nextBot = botStack - amount
        const nextPot = pot + amount
        setBotStack(nextBot)
        setPot(nextPot)
        setBotBet((b) => b + amount)
        setToCall(amount)
        setWager(clampBet(amount, amount, Math.min(stack, nextBot + amount)))
        setStatus(`Бот ставит ${formatChips(amount)}. Колл, рейз или фолд.`)
        onHaptic?.('medium')
        playPokerSound('chips')
        return
      }
    }

    setStatus('Бот чекает.')
    queueContinue(320, phase, deck, board, pot, player, bot, stack, botStack)
  }

  const callBot = () => {
    if (phase === 'over' || !facingBot || stack <= 0) return
    const amount = Math.min(toCall, stack)
    if (amount <= 0) return
    onHaptic?.('medium')
    playPokerSound('chips')
    const nextStack = stack - amount
    const nextPot = pot + amount
    stackRef.current = nextStack
    setStack(nextStack)
    setPot(nextPot)
    setPlayerBet((b) => b + amount)
    setToCall(0)
    setStatus(
      nextStack <= 0
        ? `All-in ${formatChips(amount)}. Доигрываем раздачу…`
        : `Вы коллируете ${formatChips(amount)}.`,
    )
    queueContinue(280, phase, deck, board, nextPot, player, bot, nextStack, botStack)
  }

  const bet = () => {
    if (phase === 'over' || allInSpectating) return

    // Facing bot bet: wager above toCall is a raise; exactly toCall is call.
    if (facingBot) {
      const amount = clampBet(wager, toCall, maxWager)
      if (amount < toCall || stack < amount) {
        setStatus('Недостаточно фишек.')
        return
      }
      if (amount === toCall) {
        callBot()
        return
      }
      // Raise over bot
      const raiseTotal = amount
      if (stack < raiseTotal || botStack < raiseTotal - toCall) {
        setStatus('Недостаточно фишек для рейза.')
        return
      }
      onHaptic?.('medium')
      playPokerSound('chips')
      const nextStack = stack - raiseTotal
      const botAdd = raiseTotal - toCall
      const nextBot = botStack - botAdd
      const nextPot = pot + raiseTotal + botAdd
      // Bot already put toCall into pot earlier; now matches the raise bump
      stackRef.current = nextStack
      setStack(nextStack)
      setBotStack(nextBot)
      setPot(nextPot)
      setPlayerBet((b) => b + raiseTotal)
      setBotBet((b) => b + botAdd)
      setToCall(0)

      const decision = botDecide({
        facingBet: true,
        callAmount: botAdd,
        hole: bot,
        board,
        pot: nextPot,
        botStack: nextBot,
        playerStack: nextStack,
        phase,
      })

      streetBusyRef.current = true
      window.setTimeout(() => {
        if (decision.type === 'fold') {
          settlePot('player', nextPot)
          setPhase('over')
          setStatus(`Бот сбросил на рейз. Вы забираете банк ${formatChips(nextPot)}.`)
          setResultClass('win')
          onHaptic?.('success')
          playUiSound('ok')
          streetBusyRef.current = false
          return
        }
        playPokerSound('chips')
        setStatus(
          nextStack <= 0
            ? `All-in. Бот коллирует ${formatChips(botAdd)}. Доигрываем…`
            : decision.type === 'raise'
              ? `Бот думал рейзить, но коллирует ${formatChips(botAdd)}.`
              : `Бот коллирует ${formatChips(botAdd)}.`,
        )
        if (phase === 'river') {
          showdown(board, nextPot, player, bot)
          streetBusyRef.current = false
        } else {
          advance(phase, deck, board, nextPot, player, bot, {
            runout: nextStack <= 0 || nextBot <= 0,
          })
          streetBusyRef.current = false
        }
      }, 420)
      return
    }

    const amount = clampBet(wager, minWager, maxWager)
    if (amount <= 0 || stack < amount) {
      setStatus('Недостаточно фишек для ставки — нажмите чек.')
      return
    }
    onHaptic?.('medium')
    playPokerSound('chips')

    const decision = botDecide({
      facingBet: true,
      callAmount: amount,
      hole: bot,
      board,
      pot,
      botStack,
      playerStack: stack - amount,
      phase,
    })

    const potNow = pot
    const stackNow = stack
    const botStackNow = botStack
    const nextStackAfterBet = stackNow - amount

    if (decision.type === 'fold') {
      // Player's bet goes into the pot; bot folds → player wins the pot.
      stackRef.current = nextStackAfterBet
      setStack(stackRef.current)
      const nextPot = potNow + amount
      setPot(nextPot)
      setPlayerBet((b) => b + amount)
      setPhase('over')
      settlePot('player', nextPot)
      setStatus(`Вы поставили ${formatChips(amount)}. Бот сбросил. Банк ваш.`)
      setResultClass('win')
      onHaptic?.('success')
      playUiSound('ok')
      return
    }

    // Bot cannot re-raise an all-in (no chips left to call a bigger raise).
    if (decision.type === 'raise' && nextStackAfterBet > 0) {
      const raiseAmt = clampBet(decision.amount, amount + minWager, Math.min(stackNow, botStackNow))
      if (raiseAmt > amount && botStackNow >= raiseAmt && stackNow >= raiseAmt) {
        const nextStack = nextStackAfterBet
        const nextBot = botStackNow - raiseAmt
        const nextPot = potNow + amount + raiseAmt
        setStack(nextStack)
        setBotStack(nextBot)
        setPot(nextPot)
        setPlayerBet((b) => b + amount)
        setBotBet((b) => b + raiseAmt)
        const need = raiseAmt - amount
        setToCall(need)
        setWager(clampBet(need, need, Math.min(nextStack, nextBot + need)))
        setStatus(`Вы ${formatChips(amount)}, бот рейзит до ${formatChips(raiseAmt)}. Нужно ещё ${formatChips(need)}.`)
        playPokerSound('chips')
        return
      }
    }

    // Call (or failed raise → call)
    if (botStackNow < amount) {
      setStatus('У бота не хватает фишек — нажмите чек.')
      return
    }
    const nextPot = potNow + amount * 2
    const nextStack = nextStackAfterBet
    const nextBot = botStackNow - amount
    stackRef.current = nextStack
    setPot(nextPot)
    setStack(nextStack)
    setBotStack(nextBot)
    setPlayerBet((b) => b + amount)
    setBotBet((b) => b + amount)
    setStatus(
      nextStack <= 0
        ? `All-in ${formatChips(amount)}. Бот коллирует. Доигрываем…`
        : `Ставка ${formatChips(amount)}. Бот коллирует.`,
    )
    playPokerSound('chips')

    queueContinue(320, phase, deck, board, nextPot, player, bot, nextStack, nextBot)
  }

  const fold = () => {
    if (phase === 'over' || allInSpectating) return
    if (loadSettings().confirmFold && !window.confirm('Сбросить карты и отдать банк боту?')) return
    setPhase('over')
    setToCall(0)
    settlePot('bot', pot)
    setStatus(
      facingBot
        ? `Вы сбросили на ставку бота. Банк ${formatChips(pot)} уходит боту.`
        : `Вы сбросили. Банк ${formatChips(pot)} уходит боту.`,
    )
    setResultClass('lose')
    onHaptic?.('error')
    playUiSound('warn')
  }

  // Clear deal animation marks after they play
  useEffect(() => {
    if (freshBoardIds.length === 0) return
    const t = window.setTimeout(() => setFreshBoardIds([]), 600)
    return () => window.clearTimeout(t)
  }, [freshBoardIds])

  const liveHint = useMemo(() => {
    if (player.length < 2) return null
    const combo = liveComboLabel(player, board)
    let equity: number
    if (phase === 'over' && showBot && bot.length >= 2) {
      const p = bestHand(player, board).score
      const o = bestHand(bot, board).score
      equity = p > o ? 1 : p < o ? 0 : 0.5
    } else {
      equity = estimateEquity(player, board)
    }
    const pct = Math.round(equity * 100)
    const tone = pct >= 58 ? 'good' : pct <= 38 ? 'low' : 'mid'
    const exact = phase === 'over' && showBot
    return { combo, pct, tone, exact }
  }, [player, board, bot, phase, showBot])

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
          <p className={`poker-status ${resultClass}`}>{status}</p>

          <div className="poker-table">
            <div className="poker-table-rail" />
            <div className="poker-table-felt">
              <div className="poker-table-brand">Playfort Poker</div>

              <div className="poker-board">
                {board.length === 0
                  ? null
                  : board.map((c, i) => {
                      const isFresh = freshBoardIds.includes(c.id)
                      const freshIndex = isFresh ? freshBoardIds.indexOf(c.id) : 0
                      return (
                        <PlayingCard
                          key={c.id}
                          card={c}
                          index={i}
                          enter="none"
                          className={`poker-board-card${isFresh ? ' poker-deal-board' : ''}`}
                          style={isFresh ? { animationDelay: `${freshIndex * 70}ms` } : undefined}
                        />
                      )
                    })}
              </div>
            </div>

            {pot > 0 ? (
              <div className="poker-pot" key={`pot-${pot}`}>
                <ChipPile amount={pot} compact maxChips={3} />
                <span className="poker-pot-label">Банк</span>
              </div>
            ) : null}

            <div className={`poker-seat-slot poker-seat-bot${showBot ? ' is-revealed' : ''}`}>
              <div className={`poker-bot-cards${showBot ? ' is-revealed' : ''}`} key={`bot-${dealTick}`}>
                {bot.map((c, i) => (
                  <PlayingCard
                    key={c.id}
                    card={c}
                    faceDown={!showBot}
                    index={i}
                    enter="none"
                    className="poker-hole-card poker-deal-to-bot"
                    style={{ animationDelay: `${120 + i * 110}ms` }}
                  />
                ))}
              </div>
              <SeatCard
                name="Бот"
                level={55}
                stackText={formatChips(botStack)}
                active
                accent="linear-gradient(145deg,#6b3a3a,#3a1515)"
              />
              <ChipPile amount={botBet} className="poker-bet-on-table poker-bet-bot" compact />
            </div>

            <div className="poker-seat-slot poker-seat-you">
              <SeatCard
                name="Вы"
                level={12}
                stackText={formatChips(stack)}
                dealer={phase !== 'over'}
                active
                accent="linear-gradient(145deg,#3a6ea5,#1a3358)"
              />
              <ChipPile amount={playerBet} className="poker-bet-on-table poker-bet-you" compact />
            </div>
          </div>

          <div className="poker-bottom">
            <div className="poker-hand-dock" key={`hand-${dealTick}`}>
              <span className="poker-hand-label">Ваши карты</span>
              {liveHint ? (
                <div className="poker-live-hint" aria-live="polite">
                  <span className="poker-live-combo">{liveHint.combo}</span>
                  <span className="poker-live-sep" aria-hidden>
                    ·
                  </span>
                  <span className={`poker-live-odds is-${liveHint.tone}`}>
                    {liveHint.exact ? `${liveHint.pct}%` : `~${liveHint.pct}%`} на победу
                  </span>
                </div>
              ) : null}
              <div className="poker-hand">
                {player.map((c, i) => (
                  <PlayingCard
                    key={c.id}
                    card={c}
                    index={i}
                    enter="none"
                    className="poker-hole-card poker-deal-to-you"
                    style={{ animationDelay: `${i * 110}ms` }}
                  />
                ))}
              </div>
            </div>

            <div className="poker-actions">
              {phase !== 'over' && allInSpectating ? (
                <p className="poker-allin-wait">All-in — смотрите, как открываются карты</p>
              ) : phase !== 'over' ? (
                <>
                  <div className="poker-bet-panel">
                    <div className="poker-bet-stepper" aria-label="Размер ставки">
                      <button
                        type="button"
                        className="poker-bet-nudge"
                        aria-label="Уменьшить ставку"
                        disabled={wager <= minWager}
                        onClick={() => nudgeWager(-10)}
                      >
                        −
                      </button>
                      <span className="poker-bet-value">{formatChips(wager)}</span>
                      <button
                        type="button"
                        className="poker-bet-nudge"
                        aria-label="Увеличить ставку"
                        disabled={wager >= maxWager}
                        onClick={() => nudgeWager(10)}
                      >
                        +
                      </button>
                    </div>
                    <div className="poker-bet-presets">
                      <button type="button" className="poker-bet-chip" onClick={() => setWagerPreset(minWager)}>
                        Мин
                      </button>
                      <button
                        type="button"
                        className="poker-bet-chip"
                        onClick={() => setWagerPreset(Math.max(minWager, Math.floor(pot / 2) || minWager))}
                      >
                        ½ банка
                      </button>
                      <button
                        type="button"
                        className="poker-bet-chip"
                        onClick={() => setWagerPreset(Math.max(minWager, pot || minWager))}
                      >
                        Банк
                      </button>
                      <button type="button" className="poker-bet-chip" onClick={() => setWagerPreset(maxWager)}>
                        Макс
                      </button>
                    </div>
                  </div>
                  <div className="poker-actions-row">
                    {facingBot ? (
                      <button type="button" className="poker-btn poker-btn-soft" onClick={callBot}>
                        Колл {formatChips(toCall)}
                      </button>
                    ) : (
                      <button type="button" className="poker-btn poker-btn-soft" onClick={check}>
                        Чек
                      </button>
                    )}
                    <button
                      type="button"
                      className="poker-btn poker-btn-bet"
                      onClick={bet}
                      disabled={wager <= 0 || (facingBot && wager < toCall)}
                    >
                      {facingBot
                        ? wager > toCall
                          ? `Рейз ${formatChips(wager)}`
                          : `Колл ${formatChips(toCall)}`
                        : `Поставить ${formatChips(wager)}`}
                    </button>
                    <button type="button" className="poker-btn poker-btn-fold" onClick={fold}>
                      Сброс
                    </button>
                  </div>
                </>
              ) : (
                <button type="button" className="poker-btn poker-btn-bet" onClick={nextHand}>
                  Новая раздача
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
