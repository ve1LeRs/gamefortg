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
import { loadSettings, playPokerSound, playUiSound, getDealTiming } from '../lib/settings'
import {
  awardPokerXp,
  botDisplayLevel,
  formatXpNote,
  levelFromXp,
  loadPokerProgress,
  type PokerProgress,
} from '../lib/pokerProgress'

type Phase = 'preflop' | 'flop' | 'turn' | 'river' | 'over'

type HandRank = {
  score: number
  label: string
}

const START_STACK = 1000
const TOP_UP = 1000
const BLIND = 15
const POKER_STACKS_KEY = 'playfort-poker-stacks'
const BOT_COUNT = 4

type Seat = {
  name: string
  accent: string
  hole: Card[]
  stack: number
  streetBet: number
  folded: boolean
  showCards: boolean
}

type SavedStacks = { player: number; bots: number[] }

const SEAT_META: { name: string; accent: string }[] = [
  { name: 'Вы', accent: 'linear-gradient(145deg,#3a6ea5,#1a3358)' },
  { name: 'Бот', accent: 'linear-gradient(145deg,#6b3a3a,#3a1515)' },
  { name: 'Алекс', accent: 'linear-gradient(145deg,#2d5a3d,#143322)' },
  { name: 'Ника', accent: 'linear-gradient(145deg,#2a5a5a,#143030)' },
  { name: 'Лев', accent: 'linear-gradient(145deg,#6b5a2a,#3a2e10)' },
]

function normalizeBotStacks(raw: unknown): number[] {
  if (Array.isArray(raw) && raw.length >= BOT_COUNT) {
    return raw.slice(0, BOT_COUNT).map((v) => {
      const n = Math.floor(Number(v))
      return Number.isFinite(n) && n > 0 ? n : START_STACK
    })
  }
  return Array.from({ length: BOT_COUNT }, () => START_STACK)
}

function loadPokerStacks(): SavedStacks {
  try {
    const raw = localStorage.getItem(POKER_STACKS_KEY)
    if (!raw) {
      return {
        player: START_STACK,
        bots: Array.from({ length: BOT_COUNT }, () => START_STACK),
      }
    }
    const parsed = JSON.parse(raw) as {
      player?: unknown
      bot?: unknown
      bots?: unknown
    }
    const player = Math.floor(Number(parsed.player))
    let bots: number[]
    if (Array.isArray(parsed.bots)) {
      bots = normalizeBotStacks(parsed.bots)
    } else if (parsed.bot != null) {
      // Migrate old heads-up `{ player, bot }` → first bot keeps chips, rest start fresh.
      const oldBot = Math.floor(Number(parsed.bot))
      const first = Number.isFinite(oldBot) && oldBot > 0 ? oldBot : START_STACK
      bots = [first, START_STACK, START_STACK, START_STACK]
    } else {
      bots = Array.from({ length: BOT_COUNT }, () => START_STACK)
    }
    return {
      player: Number.isFinite(player) && player > 0 ? player : START_STACK,
      bots,
    }
  } catch {
    return {
      player: START_STACK,
      bots: Array.from({ length: BOT_COUNT }, () => START_STACK),
    }
  }
}

function savePokerStacks(player: number, bots: number[]) {
  try {
    const p = Math.max(0, Math.floor(player))
    const b = bots.slice(0, BOT_COUNT).map((n) => Math.max(0, Math.floor(n)))
    while (b.length < BOT_COUNT) b.push(START_STACK)
    localStorage.setItem(POKER_STACKS_KEY, JSON.stringify({ player: p, bots: b }))
  } catch {
    /* noop */
  }
}

function stacksFromSeats(seats: Seat[]): SavedStacks {
  return {
    player: seats[0]!.stack,
    bots: seats.slice(1).map((s) => s.stack),
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
      if (uniq[i]! - uniq[i + 4]! === 4) {
        isStraight = true
        straightHigh = uniq[i]!
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
  if (groups[0]![1] === 4) {
    return { score: 7000 + groups[0]![0] * 20 + (groups[1]?.[0] ?? 0), label: 'Каре' }
  }
  if (groups[0]![1] === 3 && groups[1]?.[1] === 2) {
    return { score: 6000 + groups[0]![0] * 20 + groups[1]![0], label: 'Фулл-хаус' }
  }
  if (isFlush) return { score: 5000 + best5(values).reduce((a, b) => a * 15 + b, 0) / 1e6, label: 'Флеш' }
  if (isStraight) return { score: 4000 + straightHigh, label: 'Стрит' }
  if (groups[0]![1] === 3) {
    const kickers = values.filter((v) => v !== groups[0]![0])
    return { score: 3000 + groups[0]![0] * 50 + kickers[0]!, label: 'Тройка' }
  }
  if (groups[0]![1] === 2 && groups[1]?.[1] === 2) {
    const high = Math.max(groups[0]![0], groups[1]![0])
    const low = Math.min(groups[0]![0], groups[1]![0])
    const kicker = values.find((v) => v !== high && v !== low) ?? 0
    return { score: 2000 + high * 40 + low * 2 + kicker * 0.01, label: 'Две пары' }
  }
  if (groups[0]![1] === 2) {
    const kickers = values.filter((v) => v !== groups[0]![0])
    return { score: 1000 + groups[0]![0] * 50 + kickers[0]!, label: 'Пара' }
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
            const hand = evaluate([all[a]!, all[b]!, all[c]!, all[d]!, all[e]!])
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
    ;[arr[i], arr[j]] = [arr[j]!, arr[i]!]
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

function dealSeats(stacks: number[]): { seats: Seat[]; deck: Card[]; pot: number } {
  const deck = shuffle(makeDeck(POKER_RANKS as Rank[]))
  const seats: Seat[] = SEAT_META.map((meta, i) => ({
    name: meta.name,
    accent: meta.accent,
    hole: [deck.pop()!, deck.pop()!],
    stack: Math.max(0, stacks[i] ?? START_STACK),
    streetBet: 0,
    folded: false,
    showCards: false,
  }))

  // Human + first bot post blinds (simple fixed posts).
  let pot = 0
  const blindSeats = [0, 1]
  for (const idx of blindSeats) {
    const seat = seats[idx]!
    const blind = Math.min(BLIND, seat.stack)
    seat.stack -= blind
    seat.streetBet = blind
    pot += blind
  }

  return { seats, deck, pot }
}

function topUpStacks(stacks: number[]): { stacks: number[]; topped: boolean[] } {
  const topped = stacks.map((s) => s <= 0)
  const next = stacks.map((s, i) => (topped[i] ? TOP_UP : Math.max(0, s)))
  return { stacks: next, topped }
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
      <circle
        cx="20"
        cy="20"
        r="9.2"
        fill="none"
        stroke={c.pip}
        strokeOpacity="0.9"
        strokeWidth="1.6"
        strokeDasharray="3.2 2.4"
      />
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
    <div
      className={`poker-chip-pile${compact ? ' is-compact' : ''} ${className}`.trim()}
      title={formatChips(amount)}
    >
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
    const wantBet =
      strength >= 0.58 ||
      (strength >= 0.4 && roll < streetAggro + strength * 0.25) ||
      (strength < 0.28 && roll < 0.1 + streetAggro * 0.35)
    if (wantBet && maxChip > 0) {
      const mult =
        strength >= 0.7 ? 0.9 + strength * 0.7 : strength >= 0.4 ? 0.55 + roll * 0.5 : 0.45 + roll * 0.35
      const amount = clampBet(Math.round(betSize(phase) * mult), minChip || Math.min(BLIND, maxChip), maxChip)
      if (amount > 0) return { type: 'raise', amount }
    }
    return { type: 'check' }
  }

  const potOdds = callAmount / (pot + callAmount + 1)
  const bigBet = callAmount >= pot * 0.55

  if (strength < 0.24 && (bigBet || callAmount >= botStack * 0.35)) {
    if (roll < 0.07 && maxChip > callAmount && botStack > callAmount * 2) {
      const amount = clampBet(callAmount + betSize(phase), callAmount + minChip, maxChip)
      if (amount > callAmount) return { type: 'raise', amount }
    }
    return { type: 'fold' }
  }
  if (strength < 0.32 && bigBet && roll < 0.55) return { type: 'fold' }
  if (strength < 0.38 && callAmount > pot * 0.85 && roll < 0.4) return { type: 'fold' }

  const wantRaise =
    (strength >= 0.72 && roll < 0.7) ||
    (strength >= 0.55 && roll < 0.35) ||
    (strength < 0.3 && roll < 0.08)
  if (wantRaise && maxChip > callAmount) {
    const bump = Math.round(betSize(phase) * (0.7 + strength * 0.9 + roll * 0.4))
    const amount = clampBet(callAmount + bump, callAmount + Math.max(minChip, 10), maxChip)
    if (amount > callAmount) return { type: 'raise', amount }
  }

  if (strength + 0.06 >= potOdds || strength >= 0.4 || (strength >= 0.28 && roll < 0.35)) {
    return { type: 'call' }
  }
  if (roll < 0.22) return { type: 'call' }
  return { type: 'fold' }
}

function isLandscapeNow() {
  if (typeof window === 'undefined') return true
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
    const wa = (
      window as Window & {
        Telegram?: {
          WebApp?: {
            onEvent?: (e: string, cb: () => void) => void
            offEvent?: (e: string, cb: () => void) => void
          }
        }
      }
    ).Telegram?.WebApp
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
  xpFrac,
  levelTitle,
  hideName,
}: {
  name: string
  level: number
  stackText: string
  dealer?: boolean
  active?: boolean
  accent?: string
  xpFrac?: number
  levelTitle?: string
  hideName?: boolean
}) {
  return (
    <div className={`poker-seat${active ? ' is-active' : ''}`}>
      {!hideName ? <div className="poker-seat-name">{name}</div> : null}
      <div className="poker-seat-avatar-wrap">
        {dealer && <span className="poker-dealer-btn">D</span>}
        <div className="poker-seat-avatar" style={accent ? { background: accent } : undefined}>
          {name.slice(0, 1)}
        </div>
        <span className="poker-seat-level" title={levelTitle ?? `Уровень ${level}`}>
          {level}
        </span>
      </div>
      <div className="poker-seat-money">
        <span>{stackText}</span>
      </div>
      {xpFrac != null ? (
        <div className="poker-seat-xp" aria-hidden title={levelTitle}>
          <i style={{ width: `${Math.round(Math.min(1, Math.max(0, xpFrac)) * 100)}%` }} />
        </div>
      ) : null}
    </div>
  )
}

function cloneSeats(seats: Seat[]): Seat[] {
  return seats.map((s) => ({
    ...s,
    hole: [...s.hole],
  }))
}

function streetMaxBet(seats: Seat[]) {
  return Math.max(0, ...seats.filter((s) => !s.folded).map((s) => s.streetBet))
}

function sizingStack(seats: Seat[]) {
  const active = seats.filter((s) => !s.folded && s.stack > 0)
  if (active.length === 0) return seats[0]?.stack ?? 0
  return Math.max(...active.map((s) => s.stack))
}

function putChips(seat: Seat, amount: number): number {
  const add = Math.min(Math.max(0, amount), seat.stack)
  seat.stack -= add
  seat.streetBet += add
  return add
}

function aliveCount(seats: Seat[]) {
  return seats.filter((s) => !s.folded).length
}

function botsAlive(seats: Seat[]) {
  return seats.slice(1).filter((s) => !s.folded)
}

type BotRoundResult = {
  seats: Seat[]
  pot: number
  toCall: number
  status: string
  playerWonUncontested: boolean
  allChecked: boolean
}

/** Run bots in seat order after the player checked (toCall was 0). */
function runBotsAfterCheck(
  seatsIn: Seat[],
  potIn: number,
  board: Card[],
  phase: Phase,
): BotRoundResult {
  const seats = cloneSeats(seatsIn)
  let pot = potIn
  let opener: string | null = null
  let lastRaiseName: string | null = null
  let currentMax = streetMaxBet(seats)

  for (let i = 1; i < seats.length; i += 1) {
    const seat = seats[i]!
    if (seat.folded || seat.stack <= 0) continue
    if (aliveCount(seats) <= 1) break

    const need = Math.max(0, currentMax - seat.streetBet)
    const sizeRef = sizingStack(seats)

    if (need === 0) {
      const decision = botDecide({
        facingBet: false,
        callAmount: 0,
        hole: seat.hole,
        board,
        pot,
        botStack: seat.stack,
        playerStack: sizeRef,
        phase,
      })
      if (decision.type === 'raise') {
        const amount = clampBet(decision.amount, Math.min(betSize(phase), seat.stack), seat.stack)
        if (amount > 0) {
          pot += putChips(seat, amount)
          currentMax = Math.max(currentMax, seat.streetBet)
          opener = seat.name
          lastRaiseName = seat.name
        }
      }
      continue
    }

    const decision = botDecide({
      facingBet: true,
      callAmount: need,
      hole: seat.hole,
      board,
      pot,
      botStack: seat.stack,
      playerStack: sizeRef,
      phase,
    })

    if (decision.type === 'fold') {
      seat.folded = true
      continue
    }

    if (decision.type === 'raise') {
      const raiseTo = clampBet(decision.amount, need + Math.min(10, seat.stack), seat.stack)
      const add = Math.max(need, raiseTo)
      if (add > need && seat.stack > need) {
        pot += putChips(seat, add)
        currentMax = Math.max(currentMax, seat.streetBet)
        lastRaiseName = seat.name
        continue
      }
    }

    // Call (or failed raise → call)
    pot += putChips(seat, need)
  }

  // One pass for remaining bots who still need to match after late raises.
  for (let pass = 0; pass < 3; pass += 1) {
    let changed = false
    currentMax = streetMaxBet(seats)
    for (let i = 1; i < seats.length; i += 1) {
      const seat = seats[i]!
      if (seat.folded || seat.stack <= 0) continue
      const need = Math.max(0, currentMax - seat.streetBet)
      if (need <= 0) continue
      const sizeRef = sizingStack(seats)
      const decision = botDecide({
        facingBet: true,
        callAmount: need,
        hole: seat.hole,
        board,
        pot,
        botStack: seat.stack,
        playerStack: sizeRef,
        phase,
      })
      if (decision.type === 'fold') {
        seat.folded = true
        changed = true
        continue
      }
      if (decision.type === 'raise' && seat.stack > need) {
        const bump = clampBet(decision.amount, need + Math.min(10, seat.stack), seat.stack)
        pot += putChips(seat, Math.max(need, bump))
        if (seat.streetBet > currentMax) {
          currentMax = seat.streetBet
          lastRaiseName = seat.name
        }
        changed = true
        continue
      }
      pot += putChips(seat, need)
      changed = true
    }
    if (!changed) break
  }

  const player = seats[0]!
  currentMax = streetMaxBet(seats)
  const playerNeed = Math.max(0, currentMax - player.streetBet)
  const botsLeft = botsAlive(seats)

  if (botsLeft.length === 0) {
    return {
      seats,
      pot,
      toCall: 0,
      status: '',
      playerWonUncontested: true,
      allChecked: false,
    }
  }

  if (playerNeed > 0 && player.stack > 0) {
    const name = lastRaiseName ?? opener ?? 'Бот'
    return {
      seats,
      pot,
      toCall: Math.min(playerNeed, player.stack),
      status: `${name} ставит. Колл ${formatChips(Math.min(playerNeed, player.stack))}, рейз или фолд.`,
      playerWonUncontested: false,
      allChecked: false,
    }
  }

  if (!opener && !lastRaiseName) {
    return {
      seats,
      pot,
      toCall: 0,
      status: 'Все чекают.',
      playerWonUncontested: false,
      allChecked: true,
    }
  }

  return {
    seats,
    pot,
    toCall: 0,
    status: 'Боты уравняли. Открываем дальше…',
    playerWonUncontested: false,
    allChecked: true,
  }
}

/** After player opens / raises — each bot faces the bet in order. */
function runBotsAfterPlayerBet(
  seatsIn: Seat[],
  potIn: number,
  board: Card[],
  phase: Phase,
): BotRoundResult {
  const seats = cloneSeats(seatsIn)
  let pot = potIn
  let lastRaiseName: string | null = null
  let currentMax = streetMaxBet(seats)

  for (let i = 1; i < seats.length; i += 1) {
    const seat = seats[i]!
    if (seat.folded) continue
    if (aliveCount(seats) <= 1) break
    if (seat.stack <= 0 && seat.streetBet >= currentMax) continue

    const need = Math.max(0, currentMax - seat.streetBet)
    if (need === 0 && seat.stack <= 0) continue

    const sizeRef = sizingStack(seats)
    if (need === 0) {
      // Already matched (e.g. same blind) — may check or raise over player.
      const decision = botDecide({
        facingBet: false,
        callAmount: 0,
        hole: seat.hole,
        board,
        pot,
        botStack: seat.stack,
        playerStack: sizeRef,
        phase,
      })
      if (decision.type === 'raise' && seat.stack > 0) {
        const amount = clampBet(decision.amount, Math.min(betSize(phase), seat.stack), seat.stack)
        if (amount > 0) {
          pot += putChips(seat, amount)
          currentMax = Math.max(currentMax, seat.streetBet)
          lastRaiseName = seat.name
        }
      }
      continue
    }

    const decision = botDecide({
      facingBet: true,
      callAmount: need,
      hole: seat.hole,
      board,
      pot,
      botStack: seat.stack,
      playerStack: sizeRef,
      phase,
    })

    if (decision.type === 'fold') {
      seat.folded = true
      continue
    }

    if (decision.type === 'raise' && seat.stack > need) {
      const raiseAmt = clampBet(decision.amount, need + Math.min(10, seat.stack), seat.stack)
      pot += putChips(seat, Math.max(need, raiseAmt))
      if (seat.streetBet > currentMax) {
        currentMax = seat.streetBet
        lastRaiseName = seat.name
      }
      continue
    }

    pot += putChips(seat, need)
  }

  // Settle leftover mismatches among bots after raises.
  for (let pass = 0; pass < 3; pass += 1) {
    let changed = false
    currentMax = streetMaxBet(seats)
    for (let i = 1; i < seats.length; i += 1) {
      const seat = seats[i]!
      if (seat.folded || seat.stack <= 0) continue
      const need = Math.max(0, currentMax - seat.streetBet)
      if (need <= 0) continue
      const sizeRef = sizingStack(seats)
      const decision = botDecide({
        facingBet: true,
        callAmount: need,
        hole: seat.hole,
        board,
        pot,
        botStack: seat.stack,
        playerStack: sizeRef,
        phase,
      })
      if (decision.type === 'fold') {
        seat.folded = true
        changed = true
        continue
      }
      if (decision.type === 'raise' && seat.stack > need) {
        const bump = clampBet(decision.amount, need + Math.min(10, seat.stack), seat.stack)
        pot += putChips(seat, Math.max(need, bump))
        if (seat.streetBet > currentMax) {
          currentMax = seat.streetBet
          lastRaiseName = seat.name
        }
        changed = true
        continue
      }
      pot += putChips(seat, need)
      changed = true
    }
    if (!changed) break
  }

  const player = seats[0]!
  currentMax = streetMaxBet(seats)
  const playerNeed = Math.max(0, currentMax - player.streetBet)
  const botsLeft = botsAlive(seats)

  if (botsLeft.length === 0) {
    return {
      seats,
      pot,
      toCall: 0,
      status: '',
      playerWonUncontested: true,
      allChecked: false,
    }
  }

  if (playerNeed > 0 && player.stack > 0) {
    const name = lastRaiseName ?? 'Бот'
    return {
      seats,
      pot,
      toCall: Math.min(playerNeed, player.stack),
      status: `${name} рейзит. Нужно ещё ${formatChips(Math.min(playerNeed, player.stack))}.`,
      playerWonUncontested: false,
      allChecked: false,
    }
  }

  const foldedNames = seatsIn
    .slice(1)
    .filter((s, idx) => !s.folded && seats[idx + 1]!.folded)
    .map((s) => s.name)
  const foldNote = foldedNames.length ? ` ${foldedNames.join(', ')} сбросили.` : ''

  return {
    seats,
    pot,
    toCall: 0,
    status: `Ставка принята.${foldNote}`,
    playerWonUncontested: false,
    allChecked: true,
  }
}

function awardPotToWinners(seats: Seat[], potAmount: number, winnerIdxs: number[]) {
  if (winnerIdxs.length === 0 || potAmount <= 0) return
  const share = Math.floor(potAmount / winnerIdxs.length)
  let rem = potAmount - share * winnerIdxs.length
  for (const idx of winnerIdxs) {
    const extra = rem > 0 ? 1 : 0
    if (rem > 0) rem -= 1
    seats[idx]!.stack += share + extra
  }
}

function bestSeatIndexes(seats: Seat[], board: Card[]): { idxs: number[]; label: string } {
  const contenders = seats
    .map((s, i) => ({ i, s, hand: !s.folded && s.hole.length >= 2 ? bestHand(s.hole, board) : null }))
    .filter((x) => x.hand != null) as { i: number; s: Seat; hand: HandRank }[]
  if (contenders.length === 0) return { idxs: [], label: '' }
  let best = contenders[0]!.hand.score
  for (const c of contenders) best = Math.max(best, c.hand.score)
  const winners = contenders.filter((c) => c.hand.score === best)
  return { idxs: winners.map((w) => w.i), label: winners[0]!.hand.label }
}

export function PokerGame({
  onHaptic,
}: {
  onHaptic?: (t?: 'light' | 'medium' | 'success' | 'error') => void
}) {
  const landscape = useLandscape()
  const savedStacks = useMemo(() => loadPokerStacks(), [])
  const firstHand = useMemo(() => {
    const stacks = [savedStacks.player, ...savedStacks.bots]
    return dealSeats(stacks)
  }, [savedStacks])

  const [deck, setDeck] = useState(firstHand.deck)
  const [seats, setSeats] = useState(firstHand.seats)
  const [board, setBoard] = useState<Card[]>([])
  const [phase, setPhase] = useState<Phase>('preflop')
  const [pot, setPot] = useState(firstHand.pot)
  const [status, setStatus] = useState(`Блайнды по ${BLIND}. Чек или выберите ставку.`)
  const [resultClass, setResultClass] = useState('')
  const [dealTick, setDealTick] = useState(1)
  const [wager, setWager] = useState(() => betSize('preflop'))
  const [toCall, setToCall] = useState(0)
  const [freshBoardIds, setFreshBoardIds] = useState<string[]>([])
  const [progress, setProgress] = useState<PokerProgress>(() => loadPokerProgress())
  const boardLenRef = useRef(0)
  const streetBusyRef = useRef(false)

  const seatsRef = useRef(seats)
  const handRef = useRef({ deck, board, pot, seats })
  seatsRef.current = seats
  handRef.current = { deck, board, pot, seats }

  const player = seats[0]!
  const playerLevelInfo = useMemo(() => levelFromXp(progress.xp), [progress.xp])
  const playerLevel = playerLevelInfo.level
  const playerLevelTitle = `Уровень ${playerLevel} · ${playerLevelInfo.intoLevel}/${playerLevelInfo.need} XP · побед ${progress.wins}`

  const botLevels = useMemo(
    () =>
      Array.from({ length: BOT_COUNT }, (_, i) =>
        Math.min(99, Math.max(3, botDisplayLevel(playerLevel) + i - 1)),
      ),
    [playerLevel],
  )

  const grantXp = useCallback(
    (outcome: 'win' | 'lose' | 'tie', potAmount: number) => {
      const award = awardPokerXp(outcome, potAmount)
      setProgress(award.progress)
      if (award.leveledUp) onHaptic?.('success')
      return formatXpNote(award)
    },
    [onHaptic],
  )

  const activeBotStacks = seats.slice(1).filter((s) => !s.folded).map((s) => s.stack)
  const maxOppStack = activeBotStacks.length ? Math.max(...activeBotStacks) : 0
  const maxWager = Math.min(player.stack, maxOppStack > 0 ? maxOppStack : player.stack)
  const minWager = Math.min(betSize(phase === 'over' ? 'preflop' : phase), Math.max(0, maxWager))
  const facingBet = toCall > 0

  const nonFolded = seats.filter((s) => !s.folded)
  const withChips = nonFolded.filter((s) => s.stack > 0)
  const playerMatched = toCall <= 0
  const onlyOneWithChips = withChips.length <= 1
  const playerAllInMatched = player.stack <= 0 && playerMatched
  const allInSpectating =
    phase !== 'over' && playerMatched && (playerAllInMatched || onlyOneWithChips)

  useEffect(() => {
    const s = stacksFromSeats(seats)
    savePokerStacks(s.player, s.bots)
  }, [seats])

  useEffect(() => {
    if (phase === 'over') return
    if (facingBet) {
      setWager(clampBet(toCall + betSize(phase), toCall, maxWager))
      return
    }
    setWager(clampBet(betSize(phase), minWager, maxWager))
  }, [phase, minWager, maxWager, facingBet, toCall])

  const nudgeWager = (delta: number) => {
    const lo = facingBet ? toCall : minWager
    setWager((w) => clampBet(w + delta, lo, maxWager))
    onHaptic?.('light')
  }

  const setWagerPreset = (value: number) => {
    const lo = facingBet ? toCall : minWager
    setWager(clampBet(value, lo, maxWager))
    onHaptic?.('light')
  }

  const applySeats = useCallback((next: Seat[]) => {
    seatsRef.current = next
    setSeats(next)
  }, [])

  const clearStreetBets = (list: Seat[]) =>
    list.map((s) => ({
      ...s,
      streetBet: 0,
    }))

  const dealNextHand = useCallback(
    (current: Seat[]) => {
      const rawStacks = current.map((s) => Math.max(0, s.stack))
      const { stacks, topped } = topUpStacks(rawStacks)
      const hand = dealSeats(stacks)
      setDeck(hand.deck)
      applySeats(hand.seats)
      setBoard([])
      setPhase('preflop')
      setPot(hand.pot)
      setResultClass('')
      setDealTick((n) => n + 1)
      setToCall(0)
      setFreshBoardIds([])
      boardLenRef.current = 0
      setWager(betSize('preflop'))
      savePokerStacks(hand.seats[0]!.stack, hand.seats.slice(1).map((s) => s.stack))

      const toppedPlayer = topped[0]
      const toppedBots = topped.slice(1).filter(Boolean).length
      if (toppedPlayer && toppedBots > 0) {
        setStatus(`Пополнение +${TOP_UP}. Блайнды по ${BLIND}. Ваш ход.`)
      } else if (toppedPlayer) {
        setStatus(`Фишки кончились — +${TOP_UP}. Блайнды по ${BLIND}. Ваш ход.`)
      } else if (toppedBots > 0) {
        setStatus(`Боты получили +${TOP_UP}. Блайнды по ${BLIND}. Ваш ход.`)
      } else {
        setStatus(`Блайнды по ${BLIND}. Ваш ход: чек, ставка или фолд.`)
      }
      onHaptic?.('medium')
      playPokerSound('cards')
      window.setTimeout(() => playPokerSound('chips'), 140)
    },
    [applySeats, onHaptic],
  )

  const nextHand = useCallback(() => {
    dealNextHand(seatsRef.current)
  }, [dealNextHand])

  const showdown = useCallback(
    (community: Card[], potAmount: number, seatsNow: Seat[]) => {
      const next = cloneSeats(seatsNow).map((s) => ({
        ...s,
        showCards: !s.folded,
        streetBet: 0,
      }))
      const { idxs, label } = bestSeatIndexes(next, community)
      awardPotToWinners(next, potAmount, idxs)
      applySeats(next)
      setPot(0)
      setPhase('over')
      setToCall(0)

      const playerWins = idxs.includes(0)
      const onlyPlayer = idxs.length === 1 && playerWins
      const playerTied = playerWins && idxs.length > 1
      const names = idxs.map((i) => next[i]!.name).join(', ')

      if (onlyPlayer) {
        const xpNote = grantXp('win', potAmount)
        setStatus(`Победа! ${label}. +${formatChips(potAmount)}${xpNote}`)
        setResultClass('win')
        onHaptic?.('success')
        playUiSound('ok')
      } else if (playerTied) {
        const xpNote = grantXp('tie', potAmount)
        setStatus(`Ничья: ${label}. Банк делится (${names}).${xpNote}`)
        setResultClass('')
        onHaptic?.('medium')
        playUiSound('tap')
      } else if (playerWins) {
        const xpNote = grantXp('win', potAmount)
        setStatus(`Вы в числе победителей: ${label}. Банк: ${names}.${xpNote}`)
        setResultClass('win')
        onHaptic?.('success')
        playUiSound('ok')
      } else {
        const xpNote = grantXp('lose', potAmount)
        const yours = next[0]!.folded
          ? 'фолд'
          : bestHand(next[0]!.hole, community).label
        setStatus(`Поражение. ${names}: ${label}. У вас ${yours}.${xpNote}`)
        setResultClass('lose')
        onHaptic?.('error')
        playUiSound('warn')
      }
      playPokerSound('card')
    },
    [applySeats, grantXp, onHaptic],
  )

  const winUncontested = useCallback(
    (seatsNow: Seat[], potAmount: number, msg: string) => {
      const next = cloneSeats(seatsNow).map((s) => ({
        ...s,
        showCards: !s.folded && s.name !== 'Вы' ? true : s.showCards,
        streetBet: 0,
      }))
      next[0]!.stack += potAmount
      applySeats(next)
      setPot(0)
      setPhase('over')
      setToCall(0)
      const xpNote = grantXp('win', potAmount)
      setStatus(`${msg}${xpNote}`)
      setResultClass('win')
      onHaptic?.('success')
      playUiSound('ok')
    },
    [applySeats, grantXp, onHaptic],
  )

  const advance = useCallback(
    (
      from: Phase,
      currentDeck: Card[],
      currentBoard: Card[],
      potAmount: number,
      seatsNow: Seat[],
      opts?: { runout?: boolean },
    ) => {
      const copy = [...currentDeck]
      const runout = opts?.runout
      setToCall(0)
      const cleared = clearStreetBets(seatsNow)
      applySeats(cleared)
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
        showdown(currentBoard, potAmount, cleared)
      }
    },
    [applySeats, showdown],
  )

  const queueContinue = useCallback(
    (
      delay: number,
      phaseNow: Phase,
      deckNow: Card[],
      boardNow: Card[],
      potNow: number,
      seatsNow: Seat[],
    ) => {
      streetBusyRef.current = true
      window.setTimeout(() => {
        const chipsLeft = seatsNow.filter((s) => !s.folded && s.stack > 0).length
        const runout = seatsNow[0]!.stack <= 0 || chipsLeft <= 1
        if (phaseNow === 'river') {
          showdown(boardNow, potNow, seatsNow)
        } else {
          advance(phaseNow, deckNow, boardNow, potNow, seatsNow, { runout })
        }
        streetBusyRef.current = false
      }, delay)
    },
    [advance, showdown],
  )

  useEffect(() => {
    if (!allInSpectating) return
    if (streetBusyRef.current) return
    setStatus(player.stack <= 0 ? 'All-in — смотрите раздачу…' : 'All-in за столом — открываем карты…')
    streetBusyRef.current = true
    const phaseNow = phase
    const t = window.setTimeout(() => {
      const h = handRef.current
      if (phaseNow === 'river') {
        showdown(h.board, h.pot, h.seats)
      } else {
        advance(phaseNow, h.deck, h.board, h.pot, h.seats, { runout: true })
      }
      streetBusyRef.current = false
    }, 700)
    return () => {
      window.clearTimeout(t)
      streetBusyRef.current = false
    }
  }, [allInSpectating, phase, player.stack, advance, showdown])

  const check = () => {
    if (phase === 'over' || facingBet || allInSpectating) return
    if (player.folded) return
    onHaptic?.('light')
    playPokerSound('check')

    const result = runBotsAfterCheck(seats, pot, board, phase)
    applySeats(result.seats)
    setPot(result.pot)

    if (result.playerWonUncontested) {
      winUncontested(result.seats, result.pot, `Все сбросили. Банк ${formatChips(result.pot)} ваш.`)
      return
    }

    if (result.toCall > 0) {
      setToCall(result.toCall)
      setWager(clampBet(result.toCall, result.toCall, Math.min(result.seats[0]!.stack, maxWager)))
      setStatus(result.status)
      onHaptic?.('medium')
      playPokerSound('chips')
      return
    }

    setStatus(result.status || 'Все чекают.')
    window.setTimeout(() => playPokerSound('check'), 180)
    queueContinue(320, phase, deck, board, result.pot, result.seats)
  }

  const callBet = () => {
    if (phase === 'over' || !facingBet || player.stack <= 0) return
    const amount = Math.min(toCall, player.stack)
    if (amount <= 0) return
    onHaptic?.('medium')
    playPokerSound('chips')
    const next = cloneSeats(seats)
    const paid = putChips(next[0]!, amount)
    const nextPot = pot + paid
    applySeats(next)
    setPot(nextPot)
    setToCall(0)
    setStatus(
      next[0]!.stack <= 0
        ? `All-in ${formatChips(paid)}. Доигрываем раздачу…`
        : `Вы коллируете ${formatChips(paid)}.`,
    )
    queueContinue(280, phase, deck, board, nextPot, next)
  }

  const bet = () => {
    if (phase === 'over' || allInSpectating) return
    if (player.folded) return

    if (facingBet) {
      const amount = clampBet(wager, toCall, maxWager)
      if (amount < toCall || player.stack < amount) {
        setStatus('Недостаточно фишек.')
        return
      }
      if (amount === toCall) {
        callBet()
        return
      }

      onHaptic?.('medium')
      playPokerSound('chips')
      const next = cloneSeats(seats)
      const paid = putChips(next[0]!, amount)
      let nextPot = pot + paid

      const result = runBotsAfterPlayerBet(next, nextPot, board, phase)
      applySeats(result.seats)
      setPot(result.pot)
      nextPot = result.pot

      if (result.playerWonUncontested) {
        winUncontested(result.seats, nextPot, `Боты сбросили на рейз. Банк ${formatChips(nextPot)} ваш.`)
        return
      }

      if (result.toCall > 0) {
        setToCall(result.toCall)
        setWager(
          clampBet(result.toCall, result.toCall, Math.min(result.seats[0]!.stack, maxOppStack || result.toCall)),
        )
        setStatus(result.status)
        playPokerSound('chips')
        return
      }

      setToCall(0)
      setStatus(
        result.seats[0]!.stack <= 0
          ? `All-in. Доигрываем…`
          : result.status || `Рейз ${formatChips(paid)}. Боты ответили.`,
      )
      queueContinue(320, phase, deck, board, nextPot, result.seats)
      return
    }

    const amount = clampBet(wager, minWager, maxWager)
    if (amount <= 0 || player.stack < amount) {
      setStatus('Недостаточно фишек для ставки — нажмите чек.')
      return
    }
    onHaptic?.('medium')
    playPokerSound('chips')

    const next = cloneSeats(seats)
    const paid = putChips(next[0]!, amount)
    let nextPot = pot + paid

    const result = runBotsAfterPlayerBet(next, nextPot, board, phase)
    applySeats(result.seats)
    setPot(result.pot)
    nextPot = result.pot

    if (result.playerWonUncontested) {
      winUncontested(
        result.seats,
        nextPot,
        `Вы поставили ${formatChips(paid)}. Боты сбросили. Банк ваш.`,
      )
      return
    }

    if (result.toCall > 0) {
      setToCall(result.toCall)
      setWager(
        clampBet(result.toCall, result.toCall, Math.min(result.seats[0]!.stack, maxOppStack || result.toCall)),
      )
      setStatus(result.status)
      playPokerSound('chips')
      return
    }

    setToCall(0)
    setStatus(
      result.seats[0]!.stack <= 0
        ? `All-in ${formatChips(paid)}. Доигрываем…`
        : `Ставка ${formatChips(paid)}. ${result.status}`,
    )
    playPokerSound('chips')
    queueContinue(320, phase, deck, board, nextPot, result.seats)
  }

  const fold = () => {
    if (phase === 'over' || allInSpectating) return
    if (loadSettings().confirmFold && !window.confirm('Сбросить карты и отдать банк?')) return

    const next = cloneSeats(seats)
    next[0]!.folded = true
    for (let i = 1; i < next.length; i += 1) {
      if (!next[i]!.folded) next[i]!.showCards = true
    }

    const contenders = next
      .map((s, i) => ({ i, s }))
      .filter((x) => !x.s.folded)
    let winnerIdxs: number[] = []
    let label = ''

    if (contenders.length === 1) {
      winnerIdxs = [contenders[0]!.i]
      label = contenders[0]!.s.name
    } else if (contenders.length > 1) {
      const ranked = bestSeatIndexes(next, board)
      winnerIdxs = ranked.idxs
      label = ranked.label
    }

    awardPotToWinners(next, pot, winnerIdxs)
    applySeats(next)
    setPot(0)
    setPhase('over')
    setToCall(0)
    const xpNote = grantXp('lose', pot)
    const names = winnerIdxs.map((i) => next[i]!.name).join(', ')
    setStatus(
      facingBet
        ? `Вы сбросили. Банк ${formatChips(pot)} → ${names}${label ? ` (${label})` : ''}.${xpNote}`
        : `Вы сбросили. Банк ${formatChips(pot)} уходит: ${names}.${xpNote}`,
    )
    setResultClass('lose')
    onHaptic?.('error')
    playUiSound('warn')
  }

  useEffect(() => {
    if (freshBoardIds.length === 0) return
    const { baseMs } = getDealTiming()
    const t = window.setTimeout(() => setFreshBoardIds([]), Math.max(280, Math.round(baseMs * 0.55)))
    return () => window.clearTimeout(t)
  }, [freshBoardIds])

  const liveHint = useMemo(() => {
    if (player.hole.length < 2) return null
    const combo = liveComboLabel(player.hole, board)
    let equity: number
    const showing = phase === 'over' && seats.some((s, i) => i > 0 && s.showCards && !s.folded)
    if (showing) {
      const p = bestHand(player.hole, board).score
      const oppScores = seats
        .slice(1)
        .filter((s) => !s.folded && s.showCards)
        .map((s) => bestHand(s.hole, board).score)
      if (oppScores.length === 0) equity = 1
      else {
        const bestOpp = Math.max(...oppScores)
        equity = p > bestOpp ? 1 : p < bestOpp ? 0 : 0.5
      }
    } else {
      equity = estimateEquity(player.hole, board)
    }
    const pct = Math.round(equity * 100)
    const tone = pct >= 58 ? 'good' : pct <= 38 ? 'low' : 'mid'
    const exact = phase === 'over' && showing
    return { combo, pct, tone, exact }
  }, [player.hole, board, seats, phase])

  const dealTiming = useMemo(() => getDealTiming(), [dealTick])

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
              <div className="poker-table-brand" aria-hidden>
                <span className="poker-table-brand-ornament" />
                <span className="poker-table-brand-mark">PLAYFORT</span>
                <span className="poker-table-brand-sub">POKER CLUB</span>
                <span className="poker-table-brand-ornament is-flip" />
              </div>

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

            {pot > 0 ? (
              <div className="poker-pot" key={`pot-${pot}`}>
                <ChipPile amount={pot} compact maxChips={3} />
                <span className="poker-pot-label">Банк</span>
              </div>
            ) : null}

            {seats.map((seat, i) =>
              seat.streetBet > 0 ? (
                <ChipPile
                  key={`bet-${i}-${seat.streetBet}`}
                  amount={seat.streetBet}
                  className={`poker-bet-on-table poker-bet-s${i}`}
                  compact
                />
              ) : null,
            )}

            {seats.map((seat, i) => {
              const isHuman = i === 0
              const revealed = seat.showCards && !seat.folded
              return (
                <div
                  key={`seat-${i}`}
                  className={`poker-seat-slot poker-seat-s${i}${revealed ? ' is-revealed' : ''}${
                    seat.folded ? ' is-folded' : ''
                  }`}
                >
                  {!isHuman ? (
                    <div
                      className={`poker-bot-cards${revealed ? ' is-revealed' : ''}`}
                      key={`botcards-${i}-${dealTick}`}
                    >
                      {seat.hole.map((c, ci) => (
                        <PlayingCard
                          key={c.id}
                          card={c}
                          faceDown={!revealed}
                          index={ci}
                          enter="none"
                          className="poker-hole-card poker-deal-to-bot"
                          style={{
                            animationDelay: `${
                              Math.round(dealTiming.gapMs * (1 + i * 0.35)) + ci * dealTiming.gapMs
                            }ms`,
                          }}
                        />
                      ))}
                    </div>
                  ) : null}
                  <SeatCard
                    name={seat.name}
                    level={isHuman ? playerLevel : botLevels[i - 1]!}
                    stackText={formatChips(seat.stack)}
                    dealer={isHuman && phase !== 'over'}
                    active={!seat.folded}
                    accent={seat.accent}
                    xpFrac={isHuman ? playerLevelInfo.frac : undefined}
                    levelTitle={
                      isHuman ? playerLevelTitle : `Уровень ${botLevels[i - 1]!}`
                    }
                    hideName={!isHuman}
                  />
                </div>
              )
            })}
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
                {player.hole.map((c, i) => (
                  <PlayingCard
                    key={c.id}
                    card={c}
                    index={i}
                    enter="none"
                    className="poker-hole-card poker-deal-to-you"
                    style={{ animationDelay: `${i * dealTiming.gapMs}ms` }}
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
                        disabled={wager <= (facingBet ? toCall : minWager)}
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
                      <button
                        type="button"
                        className="poker-bet-chip"
                        onClick={() => setWagerPreset(facingBet ? toCall : minWager)}
                      >
                        Мин
                      </button>
                      <button
                        type="button"
                        className="poker-bet-chip"
                        onClick={() =>
                          setWagerPreset(
                            Math.max(facingBet ? toCall : minWager, Math.floor(pot / 2) || minWager),
                          )
                        }
                      >
                        ½ банка
                      </button>
                      <button
                        type="button"
                        className="poker-bet-chip"
                        onClick={() =>
                          setWagerPreset(Math.max(facingBet ? toCall : minWager, pot || minWager))
                        }
                      >
                        Банк
                      </button>
                      <button type="button" className="poker-bet-chip" onClick={() => setWagerPreset(maxWager)}>
                        Макс
                      </button>
                    </div>
                  </div>
                  <div className="poker-actions-row">
                    {facingBet ? (
                      <button type="button" className="poker-btn poker-btn-soft" onClick={callBet}>
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
                      disabled={wager <= 0 || (facingBet && wager < toCall)}
                    >
                      {facingBet
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
