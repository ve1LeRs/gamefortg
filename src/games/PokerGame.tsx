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
import { awardSidePots } from './poker/sidePots'
import { estimateEquity, exactEquity } from './poker/equity'
import { WpcRaiseSlider } from './poker/WpcRaiseSlider'
import { BetFlightOverlay } from './poker/tableChrome'

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
  /** Total chips this seat put into the pot this hand (for side pots). */
  invested: number
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

const BOT_THINK_MS = 1200
/** First bot pause after the player opens/raises — felt response, not instant pile-on. */
const BOT_FACE_BET_MS = 1650
/** Gap between successive bot replies so call/raise doesn't land as one flash. */
const BOT_BETWEEN_MS = 780
const STREET_PAUSE_MS = 1150
const BOT_REPLY_SOUND_MS = 220
const FOLD_RUNOUT_MS = 580
/** Stagger between bot hole-card reveals at showdown. */
const SHOWDOWN_REVEAL_MS = 520

function formatChips(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`
  return String(n)
}

function BetActionLabel({ verb, amount }: { verb: string; amount: number }) {
  return (
    <span className="poker-btn-stack">
      <span className="poker-btn-verb">{verb}</span>
      <span className="poker-btn-amt">{formatChips(amount)}</span>
    </span>
  )
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

function dealSeats(
  stacks: number[],
  dealerIdx = 0,
): { seats: Seat[]; deck: Card[]; pot: number; dealer: number; sb: number; bb: number } {
  const deck = shuffle(makeDeck(POKER_RANKS as Rank[]))
  const seats: Seat[] = SEAT_META.map((meta, i) => ({
    name: meta.name,
    accent: meta.accent,
    hole: [deck.pop()!, deck.pop()!],
    stack: Math.max(0, stacks[i] ?? START_STACK),
    streetBet: 0,
    invested: 0,
    folded: false,
    showCards: false,
  }))

  const n = seats.length
  const dealer = ((dealerIdx % n) + n) % n
  // Only SB + BB post — other seats correctly have no chips until they bet.
  const sb = (dealer + 1) % n
  const bb = (dealer + 2) % n
  let pot = 0
  for (const idx of [sb, bb]) {
    pot += putChips(seats[idx]!, BLIND)
  }

  return { seats, deck, pot, dealer, sb, bb }
}

function topUpStacks(stacks: number[]): { stacks: number[]; topped: boolean[] } {
  const topped = stacks.map((s) => s <= 0)
  const next = stacks.map((s, i) => (topped[i] ? TOP_UP : Math.max(0, s)))
  return { stacks: next, topped }
}

function chipCountFor(amount: number, maxChips = 7) {
  if (amount <= 0) return 0
  let n = 1
  if (amount >= 20) n = 2
  if (amount >= 45) n = 3
  if (amount >= 90) n = 4
  if (amount >= 180) n = 5
  if (amount >= 350) n = 6
  if (amount >= 700) n = 7
  return Math.min(n, maxChips)
}

/**
 * Split chips into 1–4 side-by-side stacks (real-table look for big bets).
 * Returns heights of each stack (chips per column).
 */
function chipStacksFor(
  amount: number,
  opts?: { flat?: boolean; compact?: boolean },
): number[] {
  if (amount <= 0) return []
  let total = 1
  if (amount >= 15) total = 2
  if (amount >= 35) total = 3
  if (amount >= 55) total = 4
  if (amount >= 90) total = 6
  if (amount >= 140) total = 9
  if (amount >= 220) total = 12
  if (amount >= 350) total = 16
  if (amount >= 550) total = 20
  if (amount >= 900) total = 24

  let cols = 1
  if (total >= 5) cols = 2
  if (total >= 10) cols = 3
  if (total >= 16) cols = 4

  const maxPer = opts?.flat || opts?.compact ? 6 : 7
  total = Math.min(total, cols * maxPer)

  const stacks = Array.from({ length: cols }, () => 0)
  // Fill unevenly — outer columns a touch shorter, like a messy real pile
  let left = total
  let col = 0
  while (left > 0) {
    if (stacks[col]! < maxPer) {
      stacks[col]! += 1
      left -= 1
    }
    col = (col + 1) % cols
  }
  // Prefer taller middle stacks when 3–4 columns
  if (cols >= 3 && stacks[0]! > stacks[1]!) {
    const t = stacks[0]!
    stacks[0] = stacks[1]!
    stacks[1] = t
  }
  return stacks.filter((n) => n > 0)
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
  flat,
  maxChips,
}: {
  amount: number
  className?: string
  compact?: boolean
  /** Horizontal layout (stacks + amount) — street bets on the felt. */
  flat?: boolean
  maxChips?: number
}) {
  if (amount <= 0) return null
  const uid = `pile-${amount}-${flat ? 'f' : compact ? 'c' : 's'}-${className}`
  const stacks = chipStacksFor(amount, { flat, compact })
  // Legacy single-stack cap still honored when caller forces a tiny max
  const capped =
    maxChips != null && stacks.length === 1
      ? [Math.min(stacks[0]!, maxChips)]
      : stacks
  const size = flat ? 16 : compact ? 16 : 26
  const multi = capped.length > 1
  return (
    <div
      className={`poker-chip-pile${compact ? ' is-compact' : ''}${flat ? ' is-flat' : ''}${
        multi ? ' is-multi' : ''
      } ${className}`.trim()}
      title={formatChips(amount)}
      style={{ ['--chip-cols' as string]: capped.length }}
    >
      <div className="poker-chip-stacks" aria-hidden>
        {capped.map((n, si) => (
          <div
            key={si}
            className="poker-chip-stack"
            style={{ ['--chip-n' as string]: n, ['--stack-i' as string]: si }}
          >
            {Array.from({ length: n }, (_, i) => (
              <span key={i} className="poker-chip-disk" style={{ ['--chip-i' as string]: i }}>
                <PokerChipSvg
                  colorIndex={(si * 2 + i) % 5}
                  size={size}
                  uid={`${uid}-s${si}-${i}`}
                />
              </span>
            ))}
          </div>
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
  /** Other live opponents still in the pot (multiway tax). */
  opponents: number
}): BotDecision {
  const { facingBet, callAmount, hole, board, pot, botStack, playerStack, phase, opponents } =
    opts
  const strength = handStrength(hole, board)
  const oppCount = Math.max(1, opponents)
  // Cheap Monte Carlo — enough to steer call/fold; blend with made-hand buckets.
  const equity = estimateEquity(hole, board, {
    opponents: oppCount,
    trials: board.length === 0 ? 160 : board.length < 5 ? 130 : 90,
  })
  const equityWeight = board.length === 0 ? 0.42 : board.length < 3 ? 0.58 : 0.72
  const score = Math.min(1, Math.max(0.04, strength * (1 - equityWeight) + equity * equityWeight))
  const multiwayTax = Math.max(0, oppCount - 1) * 0.045
  const maxChip = Math.min(botStack, playerStack)
  const minChip = Math.min(betSize(phase), Math.max(0, maxChip))
  const roll = Math.random()
  const streetAggro =
    phase === 'preflop' ? 0.1 : phase === 'flop' ? 0.16 : phase === 'turn' ? 0.2 : 0.14

  if (!facingBet) {
    const openBar = 0.52 + multiwayTax
    const wantBet =
      score >= openBar ||
      (score >= 0.36 + multiwayTax * 0.5 && roll < streetAggro + score * 0.2) ||
      (score < 0.2 && roll < 0.05 + streetAggro * 0.18 && oppCount <= 2)
    if (wantBet && maxChip > 0) {
      const mult =
        score >= 0.72
          ? 0.95 + score * 0.75
          : score >= 0.48
            ? 0.6 + roll * 0.45
            : 0.4 + roll * 0.3
      const amount = clampBet(
        Math.round(betSize(phase) * mult),
        minChip || Math.min(BLIND, maxChip),
        maxChip,
      )
      if (amount > 0) return { type: 'raise', amount }
    }
    return { type: 'check' }
  }

  const potOdds = callAmount / (pot + callAmount + 1)
  const needed = potOdds + 0.025 + multiwayTax
  const bigBet = callAmount >= pot * 0.5
  const stackCommit = callAmount / Math.max(1, botStack)

  // Trash vs pressure — fold most of the time; rare bluff-raise heads-up only
  if (score < needed - 0.14 && (bigBet || stackCommit >= 0.32)) {
    if (roll < 0.05 && oppCount <= 2 && maxChip > callAmount && botStack > callAmount * 2.2) {
      const amount = clampBet(callAmount + betSize(phase), callAmount + minChip, maxChip)
      if (amount > callAmount) return { type: 'raise', amount }
    }
    return { type: 'fold' }
  }
  if (score < 0.28 && bigBet && roll < 0.62) return { type: 'fold' }
  if (score < needed - 0.06 && callAmount > pot * 0.75 && roll < 0.55) return { type: 'fold' }

  const wantRaise =
    (score >= 0.74 + multiwayTax * 0.3 && roll < 0.72) ||
    (score >= 0.58 + multiwayTax && roll < 0.32) ||
    (score < 0.26 && oppCount <= 2 && roll < 0.06)
  if (wantRaise && maxChip > callAmount) {
    const bump = Math.round(betSize(phase) * (0.75 + score * 0.95 + roll * 0.35))
    const amount = clampBet(callAmount + bump, callAmount + Math.max(minChip, 10), maxChip)
    if (amount > callAmount) return { type: 'raise', amount }
  }

  // Pot-odds call: equity (score) must roughly clear the price
  if (score + 0.03 >= needed || score >= 0.5) return { type: 'call' }
  if (score >= 0.34 && roll < 0.28) return { type: 'call' }
  if (roll < 0.12 && score >= needed - 0.08) return { type: 'call' }
  return { type: 'fold' }
}

function isLandscapeNow() {
  if (typeof window === 'undefined') return true
  // Desktop Telegram / web: always playable — no “rotate phone” gate.
  try {
    const p = window.Telegram?.WebApp?.platform?.toLowerCase() ?? ''
    if (
      p === 'tdesktop' ||
      p === 'web' ||
      p === 'weba' ||
      p === 'webk' ||
      p === 'macos' ||
      p === 'linux' ||
      p === 'windows' ||
      p === 'unigram' ||
      p === 'desktop'
    ) {
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
  winPayout,
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
  /** Chips this seat took from the pot (shown as +amount on the seat). */
  winPayout?: number
}) {
  const won = winPayout != null && winPayout > 0 ? winPayout : 0
  const winLabel = won > 0 ? `+${formatChips(won)}` : undefined
  return (
    <div className={`poker-seat${active ? ' is-active' : ''}${won > 0 ? ' has-payout' : ''}`}>
      {!hideName ? <div className="poker-seat-name">{name}</div> : null}
      <div className={`poker-seat-avatar-wrap${winLabel ? ' has-win-badge' : ''}`}>
        {dealer && <span className="poker-dealer-btn">D</span>}
        {winLabel ? <span className="poker-win-badge">{winLabel}</span> : null}
        <div className="poker-seat-avatar" style={accent ? { background: accent } : undefined}>
          {name.slice(0, 1)}
        </div>
        <span className="poker-seat-level" title={levelTitle ?? `Уровень ${level}`}>
          {level}
        </span>
      </div>
      <div className="poker-seat-money">
        <span className="poker-seat-chip-dot" aria-hidden />
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
  seat.invested += add
  return add
}

function aliveCount(seats: Seat[]) {
  return seats.filter((s) => !s.folded).length
}

function botsAlive(seats: Seat[]) {
  return seats.slice(1).filter((s) => !s.folded)
}

type BotRoundStep = {
  seats: Seat[]
  pot: number
  line: string
  sound: 'chips' | 'check' | null
}

type BotRoundResult = {
  seats: Seat[]
  pot: number
  toCall: number
  status: string
  playerWonUncontested: boolean
  allChecked: boolean
  /** Intermediate table snapshots so the UI can reveal bot replies one-by-one. */
  steps: BotRoundStep[]
}

function snapshotBotStep(
  seats: Seat[],
  pot: number,
  line: string,
  sound: BotRoundStep['sound'],
): BotRoundStep {
  return { seats: cloneSeats(seats), pot, line, sound }
}

function botActAtSeat(
  seats: Seat[],
  pot: number,
  board: Card[],
  phase: Phase,
  seatIdx: number,
  currentMax: number,
): {
  pot: number
  currentMax: number
  raised: boolean
  line: string
  sound: BotRoundStep['sound']
} {
  const seat = seats[seatIdx]!
  const need = Math.max(0, currentMax - seat.streetBet)
  const sizeRef = sizingStack(seats)
  const opponents = seats.filter((s, i) => i !== seatIdx && !s.folded).length

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
      opponents,
    })
    if (decision.type === 'raise' && seat.stack > 0) {
      const amount = clampBet(decision.amount, Math.min(betSize(phase), seat.stack), seat.stack)
      if (amount > 0) {
        pot += putChips(seat, amount)
        return {
          pot,
          currentMax: Math.max(currentMax, seat.streetBet),
          raised: true,
          line: `${seat.name} ставит ${formatChips(amount)}.`,
          sound: 'chips',
        }
      }
    }
    return {
      pot,
      currentMax,
      raised: false,
      line: `${seat.name} чек.`,
      sound: 'check',
    }
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
    opponents,
  })

  if (decision.type === 'fold') {
    seat.folded = true
    return { pot, currentMax, raised: false, line: `${seat.name} сбрасывает.`, sound: null }
  }

  if (decision.type === 'raise' && seat.stack > need) {
    const raiseAmt = clampBet(decision.amount, need + Math.min(10, seat.stack), seat.stack)
    const add = Math.max(need, raiseAmt)
    if (add > need) {
      pot += putChips(seat, add)
      return {
        pot,
        currentMax: Math.max(currentMax, seat.streetBet),
        raised: true,
        line: `${seat.name} рейзит до ${formatChips(seat.streetBet)}.`,
        sound: 'chips',
      }
    }
  }

  pot += putChips(seat, need)
  return {
    pot,
    currentMax,
    raised: false,
    line: `${seat.name} коллирует ${formatChips(need)}.`,
    sound: 'chips',
  }
}

/**
 * Continue the betting round after the human (seat 0) has acted.
 * Stops as soon as action returns to the player so they can answer each raise —
 * bots must not keep re-raising among themselves past the player's turn.
 *
 * `matchedAlreadyActed`: after the player calls a raise, seats that already
 * matched currentMax are seeded into `acted` so the raiser is not asked to
 * check again — but seats still short of the raise keep facing it (correct
 * when action returned to the player before bots on their left had acted).
 */
function runBotsUntilPlayerOrClose(
  seatsIn: Seat[],
  potIn: number,
  board: Card[],
  phase: Phase,
  opts: { playerOpened: boolean; matchedAlreadyActed?: boolean },
): BotRoundResult {
  const seats = cloneSeats(seatsIn)
  let pot = potIn
  let currentMax = streetMaxBet(seats)
  const steps: BotRoundStep[] = []
  const n = seats.length
  const acted = new Set<number>([0])
  if (opts.matchedAlreadyActed) {
    for (let i = 0; i < n; i += 1) {
      const seat = seats[i]!
      if (seat.folded) continue
      const need = Math.max(0, currentMax - seat.streetBet)
      if (need === 0 || seat.stack <= 0) acted.add(i)
    }
  }
  let lastRaiseName: string | null = opts.playerOpened ? seats[0]!.name : null
  let cursor = 1
  let guard = 0

  const playerFacing = (): BotRoundResult | null => {
    const player = seats[0]!
    const playerNeed = Math.max(0, currentMax - player.streetBet)
    if (playerNeed > 0 && player.stack > 0 && !player.folded) {
      const name = lastRaiseName ?? 'Бот'
      return {
        seats,
        pot,
        toCall: Math.min(playerNeed, player.stack),
        status: `${name} повышает. Колл ${formatChips(Math.min(playerNeed, player.stack))}, рейз или фолд.`,
        playerWonUncontested: false,
        allChecked: false,
        steps,
      }
    }
    return null
  }

  while (guard < 64) {
    guard += 1
    if (aliveCount(seats) <= 1) break

    let found = -1
    for (let step = 0; step < n; step += 1) {
      const i = (cursor + step) % n
      const seat = seats[i]!
      if (seat.folded) continue
      const need = Math.max(0, currentMax - seat.streetBet)
      if (need > 0 && seat.stack > 0) {
        found = i
        break
      }
      if (need === 0 && seat.stack > 0 && !acted.has(i)) {
        found = i
        break
      }
    }

    if (found < 0) break

    // Action is on the human — hand control back so they can raise/call now.
    // If they already folded, skip and keep closing the round among bots.
    if (found === 0) {
      if (seats[0]!.folded) {
        acted.add(0)
        cursor = 1
        continue
      }
      const facing = playerFacing()
      if (facing) return facing
      acted.add(0)
      cursor = 1
      continue
    }

    const beforeMax = currentMax
    const result = botActAtSeat(seats, pot, board, phase, found, currentMax)
    pot = result.pot
    currentMax = result.currentMax
    // Skip quiet checks — only show bets / calls / folds / raises.
    if (result.sound !== 'check') {
      steps.push(snapshotBotStep(seats, pot, result.line, result.sound))
    }

    if (result.raised && currentMax > beforeMax) {
      lastRaiseName = seats[found]!.name
      acted.clear()
      acted.add(found)
    } else {
      acted.add(found)
    }

    cursor = found + 1
  }

  if (botsAlive(seats).length === 0) {
    return {
      seats,
      pot,
      toCall: 0,
      status: '',
      playerWonUncontested: true,
      allChecked: false,
      steps,
    }
  }

  const facing = playerFacing()
  if (facing) return facing

  const anyBet = lastRaiseName != null || currentMax > 0
  return {
    seats,
    pot,
    toCall: 0,
    status: opts.playerOpened
      ? 'Ставка принята.'
      : anyBet && steps.some((s) => s.sound === 'chips')
        ? 'Боты уравняли. Открываем дальше…'
        : 'Все чекают.',
    playerWonUncontested: false,
    allChecked: !opts.playerOpened && !steps.some((s) => s.sound === 'chips'),
    steps,
  }
}

/** Run bots in seat order after the player checked (toCall was 0). */
function runBotsAfterCheck(
  seatsIn: Seat[],
  potIn: number,
  board: Card[],
  phase: Phase,
): BotRoundResult {
  return runBotsUntilPlayerOrClose(seatsIn, potIn, board, phase, { playerOpened: false })
}

/** After player opens / raises — each bot faces the bet in order. */
function runBotsAfterPlayerBet(
  seatsIn: Seat[],
  potIn: number,
  board: Card[],
  phase: Phase,
): BotRoundResult {
  return runBotsUntilPlayerOrClose(seatsIn, potIn, board, phase, { playerOpened: true })
}

/** After player calls — finish unmatched seats left of the raiser, then close. */
function runBotsAfterPlayerCall(
  seatsIn: Seat[],
  potIn: number,
  board: Card[],
  phase: Phase,
): BotRoundResult {
  return runBotsUntilPlayerOrClose(seatsIn, potIn, board, phase, {
    playerOpened: false,
    matchedAlreadyActed: true,
  })
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

/** Showdown settlement with side pots — short all-ins only take what they covered. */
function settleShowdownPots(seats: Seat[], board: Card[], potAmount: number) {
  const invested = seats.map((s) => Math.max(0, s.invested))
  const investedTotal = invested.reduce((a, b) => a + b, 0)
  // Prefer tracked contributions; fall back to flat pot if somehow out of sync.
  const useInvested = investedTotal > 0
  const result = awardSidePots(seats.length, useInvested ? invested : seats.map(() => 0), (i) => {
    const s = seats[i]!
    if (s.folded || s.hole.length < 2) return null
    return bestHand(s.hole, board)
  })

  if (!useInvested || result.total <= 0) {
    const flat = bestSeatIndexes(seats, board)
    awardPotToWinners(seats, potAmount, flat.idxs)
    return {
      awards: seats.map((_, i) => (flat.idxs.includes(i) ? Math.floor(potAmount / Math.max(1, flat.idxs.length)) : 0)),
      winnerIdxs: flat.idxs,
      pots: flat.idxs.length
        ? [{ amount: potAmount, winners: flat.idxs, label: flat.label }]
        : [],
      total: potAmount,
      label: flat.label,
    }
  }

  for (let i = 0; i < seats.length; i += 1) {
    seats[i]!.stack += result.awards[i]!
  }

  // If rounding left dust vs potAmount, give remainder to first winner.
  const dust = potAmount - result.total
  if (dust > 0 && result.winnerIdxs.length > 0) {
    seats[result.winnerIdxs[0]!]!.stack += dust
    result.awards[result.winnerIdxs[0]!]! += dust
  }

  const label =
    result.pots.find((p) => p.winners.length)?.label ||
    bestSeatIndexes(seats, board).label

  return { ...result, total: result.total + Math.max(0, dust), label }
}

/** "Вы +1.2K, Бот 1 +800" — who took how much from the pot. */
function formatPayoutShares(seats: Seat[], awards: number[]): string {
  return awards
    .map((amt, i) => (amt > 0 ? `${seats[i]!.name} +${formatChips(amt)}` : null))
    .filter((x): x is string => x != null)
    .join(', ')
}

function formatSidePotStatus(
  seats: Seat[],
  settlement: ReturnType<typeof settleShowdownPots>,
  _potAmount: number,
): string {
  const shares = formatPayoutShares(seats, settlement.awards)
  if (settlement.winnerIdxs.length === 1) {
    const i = settlement.winnerIdxs[0]!
    const won = settlement.awards[i] ?? 0
    return `${seats[i]!.name}: ${settlement.label}. +${formatChips(won)}`
  }
  if (settlement.pots.length <= 1) {
    return `${settlement.label}. Делёж: ${shares}.`
  }
  return `Раздел банка: ${shares}.`
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
    return dealSeats(stacks, 0)
  }, [savedStacks])

  const [deck, setDeck] = useState(firstHand.deck)
  const [seats, setSeats] = useState(firstHand.seats)
  const [board, setBoard] = useState<Card[]>([])
  const [phase, setPhase] = useState<Phase>('preflop')
  const [pot, setPot] = useState(firstHand.pot)
  const [status, setStatus] = useState(
    () =>
      `Блайнды ${firstHand.seats[firstHand.sb]!.name}/${firstHand.seats[firstHand.bb]!.name} по ${BLIND}. Чек или выберите ставку.`,
  )
  const [resultClass, setResultClass] = useState('')
  const [dealTick, setDealTick] = useState(1)
  const [dealerIdx, setDealerIdx] = useState(firstHand.dealer)
  const [wager, setWager] = useState(() => betSize('preflop'))
  const [toCall, setToCall] = useState(() =>
    Math.max(0, Math.max(...firstHand.seats.map((s) => s.streetBet)) - firstHand.seats[0]!.streetBet),
  )
  const [freshBoardIds, setFreshBoardIds] = useState<string[]>([])
  const [progress, setProgress] = useState<PokerProgress>(() => loadPokerProgress())
  const [winnerIdxs, setWinnerIdxs] = useState<number[]>([])
  /** Chips each seat took from the pot this hand (null while hand is live). */
  const [payoutAwards, setPayoutAwards] = useState<number[] | null>(null)
  const [potFlight, setPotFlight] = useState<{
    id: number
    targets: number[]
    amount: number
  } | null>(null)
  const potFlightTimerRef = useRef(0)
  const [betFlights, setBetFlights] = useState<{ id: number; seat: number; count: number }[]>([])
  const prevStreetBetsRef = useRef<number[]>(seats.map((s) => s.streetBet))
  const betFlightTimersRef = useRef<number[]>([])
  const boardLenRef = useRef(0)
  const streetBusyRef = useRef(false)
  const [actionLocked, setActionLocked] = useState(false)
  const setStreetBusy = useCallback((busy: boolean) => {
    streetBusyRef.current = busy
    setActionLocked(busy)
  }, [])
  const revealTimersRef = useRef<number[]>([])
  const [flippingSeat, setFlippingSeat] = useState<number | null>(null)
  const [revealingHands, setRevealingHands] = useState(false)

  const seatsRef = useRef(seats)
  const handRef = useRef({ deck, board, pot, seats })
  seatsRef.current = seats
  handRef.current = { deck, board, pot, seats }

  // Fly chips from seat → street bet when a wager grows
  useEffect(() => {
    const prev = prevStreetBetsRef.current
    const next = seats.map((s) => s.streetBet)
    const spawned: { id: number; seat: number; count: number }[] = []
    const base = Date.now()
    for (let i = 0; i < next.length; i += 1) {
      const before = prev[i] ?? 0
      const after = next[i] ?? 0
      if (after > before) {
        const delta = after - before
        spawned.push({
          id: base + i,
          seat: i,
          count: chipCountFor(delta, 5),
        })
      }
    }
    prevStreetBetsRef.current = next
    if (spawned.length === 0) return
    setBetFlights((cur) => [...cur, ...spawned])
    const clearId = window.setTimeout(() => {
      setBetFlights((cur) => cur.filter((f) => !spawned.some((s) => s.id === f.id)))
    }, 620)
    betFlightTimersRef.current.push(clearId)
    return () => {
      window.clearTimeout(clearId)
    }
  }, [seats])

  useEffect(() => {
    return () => {
      for (const t of betFlightTimersRef.current) window.clearTimeout(t)
      betFlightTimersRef.current = []
    }
  }, [])

  const clearRevealTimers = useCallback(() => {
    for (const t of revealTimersRef.current) window.clearTimeout(t)
    revealTimersRef.current = []
    setFlippingSeat(null)
    setRevealingHands(false)
  }, [])

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

  const playPotWinFx = useCallback((targets: number[], potAmount: number) => {
    window.clearTimeout(potFlightTimerRef.current)
    const idxs = targets.length ? targets : [0]
    setWinnerIdxs(idxs)
    setPotFlight({ id: Date.now(), targets: idxs, amount: Math.max(0, potAmount) })
    playPokerSound('chips')
    window.setTimeout(() => playPokerSound('chips'), 320)
    potFlightTimerRef.current = window.setTimeout(() => setPotFlight(null), 1200)
  }, [])

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

  /** Face-down → face-up for each live bot, one seat at a time. */
  const revealBotsThen = useCallback(
    (seatsBase: Seat[], onDone: (finalSeats: Seat[]) => void) => {
      clearRevealTimers()
      setRevealingHands(true)
      const working = cloneSeats(seatsBase).map((s) => ({
        ...s,
        showCards: false,
        streetBet: 0,
      }))
      if (!working[0]!.folded) working[0]!.showCards = true
      applySeats(working)

      const order = working.map((_, i) => i).filter((i) => i > 0 && !working[i]!.folded)
      if (order.length === 0) {
        setRevealingHands(false)
        onDone(working)
        return
      }

      let step = 0
      const tick = () => {
        const idx = order[step]!
        const next = cloneSeats(seatsRef.current)
        next[idx]!.showCards = true
        applySeats(next)
        setFlippingSeat(idx)
        playPokerSound('card')
        step += 1
        if (step >= order.length) {
          const done = window.setTimeout(() => {
            setFlippingSeat(null)
            setRevealingHands(false)
            onDone(cloneSeats(seatsRef.current))
          }, 300)
          revealTimersRef.current.push(done)
          return
        }
        const t = window.setTimeout(tick, SHOWDOWN_REVEAL_MS)
        revealTimersRef.current.push(t)
      }
      const start = window.setTimeout(tick, 240)
      revealTimersRef.current.push(start)
    },
    [applySeats, clearRevealTimers],
  )

  const dealNextHand = useCallback(
    (current: Seat[]) => {
      clearRevealTimers()
      const rawStacks = current.map((s) => Math.max(0, s.stack))
      const { stacks, topped } = topUpStacks(rawStacks)
      const nextDealer = (dealerIdx + 1) % (BOT_COUNT + 1)
      const hand = dealSeats(stacks, nextDealer)
      setDealerIdx(hand.dealer)
      setDeck(hand.deck)
      applySeats(hand.seats)
      setBoard([])
      setPhase('preflop')
      setPot(hand.pot)
      setResultClass('')
      setWinnerIdxs([])
      setPayoutAwards(null)
      setPotFlight(null)
      window.clearTimeout(potFlightTimerRef.current)
      setDealTick((n) => n + 1)
      const playerNeed = Math.max(
        0,
        Math.max(...hand.seats.map((s) => s.streetBet)) - hand.seats[0]!.streetBet,
      )
      setToCall(playerNeed)
      setFreshBoardIds([])
      boardLenRef.current = 0
      setWager(playerNeed > 0 ? clampBet(playerNeed, playerNeed, hand.seats[0]!.stack) : betSize('preflop'))
      savePokerStacks(hand.seats[0]!.stack, hand.seats.slice(1).map((s) => s.stack))

      const sbName = hand.seats[hand.sb]!.name
      const bbName = hand.seats[hand.bb]!.name
      const blindNote = `Блайнды ${sbName}/${bbName} по ${BLIND}`

      const toppedPlayer = topped[0]
      const toppedBots = topped.slice(1).filter(Boolean).length
      if (toppedPlayer && toppedBots > 0) {
        setStatus(`Пополнение +${TOP_UP}. ${blindNote}. Ваш ход.`)
      } else if (toppedPlayer) {
        setStatus(`Фишки кончились — +${TOP_UP}. ${blindNote}. Ваш ход.`)
      } else if (toppedBots > 0) {
        setStatus(`Боты получили +${TOP_UP}. ${blindNote}. Ваш ход.`)
      } else if (playerNeed > 0) {
        setStatus(`${blindNote}. Колл ${formatChips(playerNeed)}, ставка или фолд.`)
      } else {
        setStatus(`${blindNote}. Чек, ставка или фолд.`)
      }
      onHaptic?.('medium')
      playPokerSound('cards')
      window.setTimeout(() => playPokerSound('chips'), 140)
    },
    [applySeats, clearRevealTimers, dealerIdx, onHaptic],
  )

  const [nextHandIn, setNextHandIn] = useState<number | null>(null)

  useEffect(() => {
    if (phase !== 'over') {
      setNextHandIn(null)
      return
    }
    setNextHandIn(5)
    const started = Date.now()
    const tick = window.setInterval(() => {
      const left = Math.max(0, 5 - Math.floor((Date.now() - started) / 1000))
      setNextHandIn(left)
    }, 250)
    const t = window.setTimeout(() => {
      window.clearInterval(tick)
      setNextHandIn(null)
      dealNextHand(seatsRef.current)
    }, 5000)
    return () => {
      window.clearInterval(tick)
      window.clearTimeout(t)
    }
  }, [phase, dealNextHand])

  const showdown = useCallback(
    (community: Card[], potAmount: number, seatsNow: Seat[]) => {
      setStreetBusy(true)
      setToCall(0)
      setStatus('Вскрываем карты…')

      revealBotsThen(seatsNow, (revealed) => {
        const next = cloneSeats(revealed)
        const settlement = settleShowdownPots(next, community, potAmount)
        const idxs = settlement.winnerIdxs
        const label = settlement.label
        const playerAward = settlement.awards[0] ?? 0
        applySeats(next)
        setPot(0)
        setPhase('over')
        setPayoutAwards(settlement.awards)
        playPotWinFx(idxs, potAmount)

        const playerWins = playerAward > 0
        const onlyPlayer = idxs.length === 1 && idxs[0] === 0
        const playerTied = playerWins && idxs.length > 1
        const potLine = formatSidePotStatus(next, settlement, potAmount)

        if (onlyPlayer) {
          const xpNote = grantXp('win', playerAward || potAmount)
          setStatus(`Победа! ${label}. +${formatChips(playerAward || potAmount)}${xpNote}`)
          setResultClass('win')
          onHaptic?.('success')
          playUiSound('ok')
        } else if (playerTied) {
          const xpNote = grantXp(playerAward > 0 ? 'tie' : 'lose', playerAward || potAmount)
          setStatus(`${potLine}${xpNote}`)
          setResultClass(playerAward > 0 ? 'win' : '')
          onHaptic?.('medium')
          playUiSound('tap')
        } else if (playerWins) {
          const xpNote = grantXp('win', playerAward)
          setStatus(`Вы забрали ${formatChips(playerAward)}. ${potLine}${xpNote}`)
          setResultClass('win')
          onHaptic?.('success')
          playUiSound('ok')
        } else {
          const xpNote = grantXp('lose', potAmount)
          const yours = next[0]!.folded
            ? 'фолд'
            : bestHand(next[0]!.hole, community).label
          setStatus(`Поражение. ${potLine} У вас ${yours}.${xpNote}`)
          setResultClass('lose')
          onHaptic?.('error')
          playUiSound('warn')
        }
        setStreetBusy(false)
      })
    },
    [applySeats, grantXp, onHaptic, playPotWinFx, revealBotsThen],
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
      setPayoutAwards(next.map((_, i) => (i === 0 ? potAmount : 0)))
      playPotWinFx([0], potAmount)
      const xpNote = grantXp('win', potAmount)
      setStatus(`${msg}${xpNote}`)
      setResultClass('win')
      onHaptic?.('success')
      playUiSound('ok')
    },
    [applySeats, grantXp, onHaptic, playPotWinFx],
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
      setStreetBusy(true)
      window.setTimeout(() => {
        const chipsLeft = seatsNow.filter((s) => !s.folded && s.stack > 0).length
        const runout = seatsNow[0]!.stack <= 0 || chipsLeft <= 1
        if (phaseNow === 'river') {
          showdown(boardNow, potNow, seatsNow)
        } else {
          advance(phaseNow, deckNow, boardNow, potNow, seatsNow, { runout })
        }
        setStreetBusy(false)
      }, delay)
    },
    [advance, showdown],
  )

  useEffect(() => {
    if (!allInSpectating) return
    if (streetBusyRef.current) return
    setStatus(player.stack <= 0 ? 'All-in — смотрите раздачу…' : 'All-in за столом — открываем карты…')
    setStreetBusy(true)
    const phaseNow = phase
    const t = window.setTimeout(() => {
      const h = handRef.current
      if (phaseNow === 'river') {
        showdown(h.board, h.pot, h.seats)
      } else {
        advance(phaseNow, h.deck, h.board, h.pot, h.seats, { runout: true })
      }
      setStreetBusy(false)
    }, 700)
    return () => {
      window.clearTimeout(t)
      setStreetBusy(false)
    }
  }, [allInSpectating, phase, player.stack, advance, showdown])

  const finishBotRound = useCallback(
    (
      result: BotRoundResult,
      phaseNow: Phase,
      deckNow: Card[],
      boardNow: Card[],
      opts?: { uncontestedMsg?: string; settledStatus?: string; finalSound?: 'chips' | 'check' | 'turn' | null },
    ) => {
      applySeats(result.seats)
      setPot(result.pot)

      if (result.playerWonUncontested) {
        setStreetBusy(false)
        winUncontested(
          result.seats,
          result.pot,
          opts?.uncontestedMsg ?? `Боты сбросили. Банк ${formatChips(result.pot)} ваш.`,
        )
        return
      }

      if (result.toCall > 0) {
        setToCall(result.toCall)
        setWager(
          clampBet(
            result.toCall,
            result.toCall,
            Math.min(result.seats[0]!.stack, maxOppStack || result.toCall || maxWager),
          ),
        )
        setStatus(result.status)
        onHaptic?.('medium')
        // Action returned to you after a raise — turn cue, not another chip rustle
        window.setTimeout(() => playPokerSound('turn'), BOT_REPLY_SOUND_MS)
        setStreetBusy(false)
        return
      }

      setToCall(0)
      setStatus(opts?.settledStatus ?? result.status)
      const lastStepSound = result.steps[result.steps.length - 1]?.sound ?? null
      const finalSound =
        opts?.finalSound === undefined ? ('chips' as const) : opts.finalSound
      // Skip duplicate settle FX when the last bot step already played the same cue
      if (finalSound && finalSound !== lastStepSound) {
        window.setTimeout(() => playPokerSound(finalSound), BOT_REPLY_SOUND_MS)
      }
      queueContinue(STREET_PAUSE_MS, phaseNow, deckNow, boardNow, result.pot, result.seats)
    },
    [applySeats, maxOppStack, maxWager, onHaptic, queueContinue, winUncontested],
  )

  const playBotRound = useCallback(
    (
      result: BotRoundResult,
      firstDelay: number,
      phaseNow: Phase,
      deckNow: Card[],
      boardNow: Card[],
      opts?: { uncontestedMsg?: string; settledStatus?: string; finalSound?: 'chips' | 'check' | 'turn' | null },
    ) => {
      const steps = result.steps
      if (steps.length === 0) {
        window.setTimeout(() => finishBotRound(result, phaseNow, deckNow, boardNow, opts), firstDelay)
        return
      }

      let i = 0
      const tick = () => {
        const step = steps[i]!
        applySeats(step.seats)
        setPot(step.pot)
        if (step.line) setStatus(step.line)
        if (step.sound) playPokerSound(step.sound)
        i += 1
        if (i >= steps.length) {
          window.setTimeout(() => finishBotRound(result, phaseNow, deckNow, boardNow, opts), BOT_BETWEEN_MS)
          return
        }
        window.setTimeout(tick, BOT_BETWEEN_MS)
      }
      window.setTimeout(tick, firstDelay)
    },
    [applySeats, finishBotRound],
  )

  const check = () => {
    if (phase === 'over' || facingBet || allInSpectating || streetBusyRef.current) return
    if (player.folded) return
    onHaptic?.('light')
    playPokerSound('check')
    setStreetBusy(true)

    const result = runBotsAfterCheck(seats, pot, board, phase)
    playBotRound(result, BOT_THINK_MS, phase, deck, board, {
      uncontestedMsg: `Все сбросили. Банк ${formatChips(result.pot)} ваш.`,
      settledStatus: result.status || 'Все чекают.',
      // Round closed — soft turn cue, not another check knock
      finalSound:
        result.allChecked && result.toCall === 0 && !result.steps.some((s) => s.sound === 'chips')
          ? 'turn'
          : null,
    })
  }

  const callBet = () => {
    if (phase === 'over' || !facingBet || player.stack <= 0 || streetBusyRef.current) return
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
    setStreetBusy(true)
    setStatus(
      next[0]!.stack <= 0
        ? `All-in ${formatChips(paid)}. Доигрываем раздачу…`
        : `Вы коллируете ${formatChips(paid)}.`,
    )
    // Do not advance the street yet — bots left of the raiser may still need
    // to call/fold. Only finishBotRound advances when toCall settles to 0.
    const result = runBotsAfterPlayerCall(next, nextPot, board, phase)
    playBotRound(result, BOT_FACE_BET_MS, phase, deck, board, {
      uncontestedMsg: `Боты сбросили. Банк ${formatChips(result.pot)} ваш.`,
      settledStatus:
        next[0]!.stack <= 0
          ? `All-in ${formatChips(paid)}. Доигрываем…`
          : result.status || `Колл ${formatChips(paid)}. Боты ответили.`,
    })
  }

  const bet = (amountOverride?: number) => {
    if (phase === 'over' || allInSpectating || streetBusyRef.current) return
    if (player.folded) return

    if (facingBet) {
      const amount = clampBet(amountOverride ?? wager, toCall, maxWager)
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
      const potAfter = pot + paid
      applySeats(next)
      setPot(potAfter)
      setToCall(0)
      setStreetBusy(true)

      const result = runBotsAfterPlayerBet(next, potAfter, board, phase)
      playBotRound(result, BOT_FACE_BET_MS, phase, deck, board, {
        uncontestedMsg: `Боты сбросили на рейз. Банк ${formatChips(result.pot)} ваш.`,
        settledStatus:
          result.seats[0]!.stack <= 0
            ? `All-in. Доигрываем…`
            : result.status || `Рейз ${formatChips(paid)}. Боты ответили.`,
      })
      return
    }

    const amount = clampBet(amountOverride ?? wager, minWager, maxWager)
    if (amount <= 0 || player.stack < amount) {
      setStatus('Недостаточно фишек для ставки — нажмите чек.')
      return
    }
    onHaptic?.('medium')
    playPokerSound('chips')

    const next = cloneSeats(seats)
    const paid = putChips(next[0]!, amount)
    const potAfter = pot + paid
    applySeats(next)
    setPot(potAfter)
    setStreetBusy(true)

    const result = runBotsAfterPlayerBet(next, potAfter, board, phase)
    playBotRound(result, BOT_FACE_BET_MS, phase, deck, board, {
      uncontestedMsg: `Вы поставили ${formatChips(paid)}. Боты сбросили. Банк ваш.`,
      settledStatus:
        result.seats[0]!.stack <= 0
          ? `All-in ${formatChips(paid)}. Доигрываем…`
          : `Ставка ${formatChips(paid)}. ${result.status}`,
    })
  }

  const resolveFoldShowdown = useCallback(
    (finalBoard: Card[], seatsNow: Seat[], potAmount: number, wasFacingBet: boolean) => {
      setStreetBusy(true)
      setBoard(finalBoard)
      setToCall(0)
      setStatus('Вскрываем карты…')

      revealBotsThen(seatsNow, (revealed) => {
        const next = cloneSeats(revealed)
        const settlement = settleShowdownPots(next, finalBoard, potAmount)
        const winnerIdxsLocal = settlement.winnerIdxs
        applySeats(next)
        setPot(0)
        setPhase('over')
        setPayoutAwards(settlement.awards)
        playPotWinFx(winnerIdxsLocal, potAmount)
        const xpNote = grantXp('lose', potAmount)
        const potLine = formatSidePotStatus(next, settlement, potAmount)
        setStatus(
          wasFacingBet
            ? `Вы сбросили. ${potLine}${xpNote}`
            : `Вы сбросили. ${potLine}${xpNote}`,
        )
        setResultClass('lose')
        setStreetBusy(false)
      })
    },
    [applySeats, grantXp, playPotWinFx, revealBotsThen],
  )

  const fold = () => {
    if (phase === 'over' || allInSpectating || streetBusyRef.current) return
    if (loadSettings().confirmFold && !window.confirm('Сбросить карты и отдать банк?')) return

    const next = cloneSeats(seats)
    next[0]!.folded = true
    const wasFacingBet = facingBet
    const potSnap = pot
    const phaseSnap = phase
    const deckSnap = [...deck]
    const boardSnap = [...board]

    const contenders = next
      .map((s, i) => ({ i, s }))
      .filter((x) => !x.s.folded)

    onHaptic?.('error')
    playUiSound('warn')
    setToCall(0)

    /** Last bot standing takes the pot — no reveal needed. */
    const awardFoldUncontested = (seatsNow: Seat[], potNow: number) => {
      const winnerIdx = seatsNow.findIndex((s) => !s.folded)
      const winnerIdxsLocal = winnerIdx >= 0 ? [winnerIdx] : []
      const awarded = cloneSeats(seatsNow).map((s) => ({
        ...s,
        streetBet: 0,
        showCards: false,
      }))
      awardPotToWinners(awarded, potNow, winnerIdxsLocal)
      applySeats(awarded)
      setPot(0)
      setPhase('over')
      const share = Math.floor(potNow / Math.max(1, winnerIdxsLocal.length))
      let rem = potNow - share * winnerIdxsLocal.length
      const exactAwards = awarded.map(() => 0)
      for (const idx of winnerIdxsLocal) {
        exactAwards[idx] = share + (rem > 0 ? 1 : 0)
        if (rem > 0) rem -= 1
      }
      setPayoutAwards(exactAwards)
      playPotWinFx(winnerIdxsLocal, potNow)
      const xpNote = grantXp('lose', potNow)
      const names = formatPayoutShares(awarded, exactAwards)
      setStatus(`Вы сбросили. Банк → ${names || '—'}.${xpNote}`)
      setResultClass('lose')
      setStreetBusy(false)
    }

    const playBotSteps = (
      steps: BotRoundStep[],
      onDone: () => void,
      firstDelay = BOT_FACE_BET_MS,
    ) => {
      if (steps.length === 0) {
        window.setTimeout(onDone, 360)
        return
      }
      let i = 0
      const tick = () => {
        const step = steps[i]!
        applySeats(step.seats)
        setPot(step.pot)
        if (step.line) setStatus(step.line)
        if (step.sound) playPokerSound(step.sound)
        i += 1
        if (i >= steps.length) {
          window.setTimeout(onDone, BOT_BETWEEN_MS)
          return
        }
        window.setTimeout(tick, BOT_BETWEEN_MS)
      }
      window.setTimeout(tick, firstDelay)
    }

    /**
     * After the player folds, remaining bots keep betting street-by-street
     * until one remains (uncontested) or the river closes (showdown).
     */
    const continueBotOnlyHand = (
      seatsNow: Seat[],
      potNow: number,
      phaseNow: Phase,
      deckNow: Card[],
      boardNow: Card[],
      closeCurrentFirst: boolean,
    ) => {
      const live = seatsNow.filter((s) => !s.folded)
      if (live.length <= 1) {
        awardFoldUncontested(seatsNow, potNow)
        return
      }

      const chipsLeft = seatsNow.filter((s) => !s.folded && s.stack > 0).length
      // All-in among bots — just run the board, then showdown
      if (chipsLeft <= 1) {
        setStatus('Вы сбросили. Доигрываем доску…')
        let d = [...deckNow]
        let b = [...boardNow]
        let p: Phase = phaseNow
        const dealRest = () => {
          if (b.length >= 5 || p === 'river') {
            resolveFoldShowdown(b, seatsNow, potNow, wasFacingBet)
            return
          }
          if (b.length === 0) {
            d.pop()
            const flop = [d.pop()!, d.pop()!, d.pop()!]
            b = flop
            boardLenRef.current = 0
            setFreshBoardIds(flop.map((c) => c.id))
            setBoard(flop)
            setDeck(d)
            setPhase('flop')
            p = 'flop'
            playPokerSound('cards')
            window.setTimeout(dealRest, FOLD_RUNOUT_MS)
            return
          }
          if (b.length === 3) {
            d.pop()
            const card = d.pop()!
            b = [...b, card]
            boardLenRef.current = 3
            setFreshBoardIds([card.id])
            setBoard(b)
            setDeck(d)
            setPhase('turn')
            p = 'turn'
            playPokerSound('card')
            window.setTimeout(dealRest, FOLD_RUNOUT_MS)
            return
          }
          d.pop()
          const card = d.pop()!
          b = [...b, card]
          boardLenRef.current = 4
          setFreshBoardIds([card.id])
          setBoard(b)
          setDeck(d)
          setPhase('river')
          p = 'river'
          playPokerSound('card')
          window.setTimeout(dealRest, FOLD_RUNOUT_MS)
        }
        window.setTimeout(dealRest, 420)
        return
      }

      setStatus('Вы сбросили. Боты играют…')
      const result = runBotsUntilPlayerOrClose(seatsNow, potNow, boardNow, phaseNow, {
        playerOpened: false,
        matchedAlreadyActed: closeCurrentFirst,
      })

      playBotSteps(result.steps, () => {
        applySeats(result.seats)
        setPot(result.pot)

        const stillLive = result.seats.filter((s) => !s.folded)
        if (stillLive.length <= 1) {
          awardFoldUncontested(result.seats, result.pot)
          return
        }

        if (phaseNow === 'river') {
          resolveFoldShowdown(boardNow, result.seats, result.pot, wasFacingBet)
          return
        }

        // Next street, then another bot-only betting round
        window.setTimeout(() => {
          const copy = [...deckNow]
          const cleared = clearStreetBets(result.seats)
          applySeats(cleared)
          setToCall(0)

          let nextBoard = boardNow
          let nextPhase: Phase = phaseNow
          let nextDeck = copy

          if (phaseNow === 'preflop') {
            copy.pop()
            const flop = [copy.pop()!, copy.pop()!, copy.pop()!]
            nextBoard = flop
            nextDeck = copy
            nextPhase = 'flop'
            boardLenRef.current = 0
            setFreshBoardIds(flop.map((c) => c.id))
            setBoard(flop)
            setDeck(copy)
            setPhase('flop')
            playPokerSound('cards')
            setStatus('Вы сбросили. Флоп. Боты играют…')
          } else if (phaseNow === 'flop') {
            copy.pop()
            const card = copy.pop()!
            nextBoard = [...boardNow, card]
            nextDeck = copy
            nextPhase = 'turn'
            boardLenRef.current = boardNow.length
            setFreshBoardIds([card.id])
            setBoard(nextBoard)
            setDeck(copy)
            setPhase('turn')
            playPokerSound('card')
            setStatus('Вы сбросили. Тёрн. Боты играют…')
          } else {
            copy.pop()
            const card = copy.pop()!
            nextBoard = [...boardNow, card]
            nextDeck = copy
            nextPhase = 'river'
            boardLenRef.current = boardNow.length
            setFreshBoardIds([card.id])
            setBoard(nextBoard)
            setDeck(copy)
            setPhase('river')
            playPokerSound('card')
            setStatus('Вы сбросили. Ривер. Боты играют…')
          }

          window.setTimeout(() => {
            continueBotOnlyHand(cleared, result.pot, nextPhase, nextDeck, nextBoard, false)
          }, FOLD_RUNOUT_MS + 280)
        }, 520)
      })
    }

    if (contenders.length <= 1) {
      setStreetBusy(true)
      applySeats(next)
      awardFoldUncontested(next, potSnap)
      return
    }

    setStreetBusy(true)
    applySeats(next)
    setStatus('Вы сбросили. Боты играют…')
    continueBotOnlyHand(next, potSnap, phaseSnap, deckSnap, boardSnap, wasFacingBet)
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
    const revealedOpps = seats
      .slice(1)
      .filter((s) => !s.folded && s.showCards && s.hole.length >= 2)
    const liveOpps = seats.slice(1).filter((s) => !s.folded).length
    if (phase === 'over' && revealedOpps.length > 0) {
      equity = exactEquity(
        player.hole,
        board,
        revealedOpps.map((s) => s.hole),
      )
    } else {
      equity = estimateEquity(player.hole, board, {
        opponents: Math.max(1, liveOpps),
      })
    }
    const pct = Math.round(equity * 100)
    const tone = pct >= 58 ? 'good' : pct <= 38 ? 'low' : 'mid'
    const exact = phase === 'over' && revealedOpps.length > 0
    return { combo, pct, tone, exact }
  }, [player.hole, board, seats, phase])

  const dealTiming = useMemo(() => getDealTiming(), [dealTick])
  const lastTableTapRef = useRef(0)

  /** Double-tap the table on your turn → check (free) or call (facing a bet). */
  const onTableDoubleTap = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const el = e.target as HTMLElement | null
    if (
      el?.closest?.(
        'button, a, input, textarea, .poker-actions, .poker-wpc-raise, .poker-bottom, .poker-bet-chip',
      )
    ) {
      return
    }
    if (
      phase === 'over' ||
      player.folded ||
      allInSpectating ||
      revealingHands ||
      actionLocked ||
      streetBusyRef.current
    ) {
      return
    }
    const now = Date.now()
    if (now - lastTableTapRef.current > 340) {
      lastTableTapRef.current = now
      return
    }
    lastTableTapRef.current = 0
    e.preventDefault()
    if (facingBet) callBet()
    else check()
  }

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

          <div
            className="poker-table"
            onPointerUp={onTableDoubleTap}
            role="presentation"
          >
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
            ) : potFlight ? (
              <div className="poker-pot is-flying-out" aria-hidden>
                <ChipPile amount={potFlight.amount} compact maxChips={3} />
                <span className="poker-pot-label">Банк</span>
              </div>
            ) : null}

            {potFlight ? (
              <div className="poker-pot-flight" aria-hidden key={potFlight.id}>
                {potFlight.targets.flatMap((seatIdx, ti) =>
                  [0, 1, 2, 3, 4, 5].map((ci) => (
                    <span
                      key={`${seatIdx}-${ci}`}
                      className={`poker-pot-flight-chip poker-fly-to-s${seatIdx}`}
                      style={{
                        animationDelay: `${80 + ti * 70 + ci * 55}ms`,
                        ['--chip-scatter' as string]: `${(ci % 3) * 6 - 6}px`,
                      }}
                    >
                      <PokerChipSvg
                        colorIndex={ci % 5}
                        size={18}
                        uid={`pot-fly-${potFlight.id}-${seatIdx}-${ci}`}
                      />
                    </span>
                  )),
                )}
              </div>
            ) : null}

            {seats.map((seat, i) =>
              seat.streetBet > 0 ? (
                <ChipPile
                  key={`bet-${i}`}
                  amount={seat.streetBet}
                  className={`poker-bet-on-table poker-bet-s${i}`}
                  flat
                />
              ) : null,
            )}

            <BetFlightOverlay flights={betFlights} />

            {seats.map((seat, i) => {
              const isHuman = i === 0
              const revealed = seat.showCards && !seat.folded
              const isWinner = winnerIdxs.includes(i)
              const winPayout = isWinner ? payoutAwards?.[i] ?? 0 : 0
              const playerActing =
                isHuman && phase !== 'over' && !seat.folded && !allInSpectating && !actionLocked && !revealingHands
              return (
                <div
                  key={`seat-${i}`}
                  className={`poker-seat-slot poker-seat-s${i}${revealed ? ' is-revealed' : ''}${
                    seat.folded ? ' is-folded' : ''
                  }${isWinner ? ' is-winner' : ''}${playerActing ? ' is-acting' : ''}`}
                >
                  {isHuman ? (
                    <>
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
                          {seat.hole.map((c, ci) => (
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
                      </div>
                      <SeatCard
                        name={seat.name}
                        level={playerLevel}
                        stackText={formatChips(seat.stack)}
                        dealer={i === dealerIdx && phase !== 'over'}
                        active={!seat.folded}
                        accent={seat.accent}
                        xpFrac={playerLevelInfo.frac}
                        levelTitle={playerLevelTitle}
                        hideName
                        winPayout={winPayout}
                      />
                    </>
                  ) : (
                    <>
                      <div
                        className={`poker-bot-cards${revealed ? ' is-revealed' : ''}${
                          flippingSeat === i ? ' is-flipping' : ''
                        }`}
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
                      <SeatCard
                        name={seat.name}
                        level={botLevels[i - 1]!}
                        stackText={formatChips(seat.stack)}
                        dealer={i === dealerIdx && phase !== 'over'}
                        active={!seat.folded}
                        accent={seat.accent}
                        levelTitle={`Уровень ${botLevels[i - 1]!}`}
                        hideName
                        winPayout={winPayout}
                      />
                    </>
                  )}
                </div>
              )
            })}
          </div>

          <div className="poker-bottom">
            <div
              className={`poker-actions${
                phase !== 'over' && !allInSpectating && !revealingHands && actionLocked ? ' is-dimmed' : ''
              }`}
              aria-disabled={actionLocked || undefined}
            >
              {phase !== 'over' && (allInSpectating || revealingHands) ? (
                <div className="poker-allin-wait is-quiet" aria-hidden />
              ) : phase !== 'over' ? (
                <>
                  <div className="poker-bet-presets">
                    <button
                      type="button"
                      className="poker-bet-chip"
                      disabled={actionLocked}
                      onClick={() => setWagerPreset(facingBet ? toCall : minWager)}
                    >
                      Мин
                    </button>
                    <button
                      type="button"
                      className="poker-bet-chip"
                      disabled={actionLocked}
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
                      disabled={actionLocked}
                      onClick={() =>
                        setWagerPreset(Math.max(facingBet ? toCall : minWager, pot || minWager))
                      }
                    >
                      Банк
                    </button>
                    <button
                      type="button"
                      className="poker-bet-chip"
                      disabled={actionLocked}
                      onClick={() => setWagerPreset(maxWager)}
                    >
                      Макс
                    </button>
                  </div>
                  <div className="poker-actions-row">
                    {facingBet ? (
                      <button
                        type="button"
                        className="poker-btn poker-btn-soft"
                        disabled={actionLocked}
                        onClick={callBet}
                      >
                        {toCall >= player.stack ? (
                          'All In'
                        ) : (
                          <BetActionLabel verb="Колл" amount={toCall} />
                        )}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="poker-btn poker-btn-soft"
                        disabled={actionLocked}
                        onClick={check}
                      >
                        Чек
                      </button>
                    )}
                    <WpcRaiseSlider
                      min={facingBet ? Math.max(toCall, minWager) : minWager}
                      max={Math.max(facingBet ? toCall : minWager, maxWager)}
                      value={wager}
                      disabled={actionLocked || maxWager <= 0}
                      format={formatChips}
                      onChange={(next) =>
                        setWager(clampBet(next, facingBet ? toCall : minWager, maxWager))
                      }
                      onConfirm={(amount) => bet(amount)}
                      onTick={() => onHaptic?.('light')}
                      label={
                        wager >= player.stack && player.stack > 0 ? (
                          'All In'
                        ) : facingBet ? (
                          wager > toCall ? (
                            <BetActionLabel verb="Рейз" amount={wager} />
                          ) : (
                            <BetActionLabel verb="Колл" amount={toCall} />
                          )
                        ) : (
                          <BetActionLabel verb="Ставка" amount={wager} />
                        )
                      }
                    />
                    <button
                      type="button"
                      className="poker-btn poker-btn-fold"
                      disabled={actionLocked}
                      onClick={fold}
                    >
                      Сброс
                    </button>
                  </div>
                </>
              ) : (
                <p className="poker-next-hint" aria-live="polite">
                  {nextHandIn != null && nextHandIn > 0
                    ? `Новая раздача через ${nextHandIn}…`
                    : 'Новая раздача…'}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
