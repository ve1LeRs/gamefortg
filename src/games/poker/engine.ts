import {
  type Card,
  type Rank,
  POKER_RANKS,
  makeDeck,
  shuffle,
  rankValue,
} from '../../lib/cards'

export type Seat = 0 | 1
export type Phase = 'preflop' | 'flop' | 'turn' | 'river' | 'over'

export const START_STACK = 1000
export const TOP_UP = 1000
export const BLIND = 15

export type PokerAction =
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'bet'; amount: number }
  | { type: 'fold' }
  | { type: 'nextHand' }

type HandRank = { score: number; label: string }

export type PokerSeat = {
  hole: Card[]
  stack: number
  streetBet: number
  folded: boolean
  showCards: boolean
}

export type PokerState = {
  seats: [PokerSeat, PokerSeat]
  deck: Card[]
  board: Card[]
  pot: number
  phase: Phase
  dealer: Seat
  toCall: number
  /** Whose turn to act (null when hand is over / between hands). */
  acting: Seat | null
  /** Highest street contribution this street. */
  streetMax: number
  status: string
  winner: Seat | null
  handLabel: string
  /** Seats that already acted this betting round. */
  acted: Seat[]
  lastAggressor: Seat | null
}

export type PokerSeatView = {
  seat: Seat
  you: PokerSeat
  opponent: {
    stack: number
    streetBet: number
    folded: boolean
    hole: Card[] | null
    cardCount: number
  }
  board: Card[]
  pot: number
  phase: Phase
  dealer: Seat
  toCall: number
  acting: Seat | null
  yourTurn: boolean
  status: string
  winner: Seat | null
  youWon: boolean | null
  handLabel: string
  canCheck: boolean
  canCall: boolean
  callAmount: number
  minBet: number
  maxBet: number
  canBet: boolean
  canFold: boolean
  canNext: boolean
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

export function bestHand(hole: Card[], board: Card[]): HandRank {
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

function other(seat: Seat): Seat {
  return seat === 0 ? 1 : 0
}

function cloneState(state: PokerState): PokerState {
  return {
    ...state,
    deck: [...state.deck],
    board: [...state.board],
    acted: [...state.acted],
    seats: [
      { ...state.seats[0], hole: [...state.seats[0].hole] },
      { ...state.seats[1], hole: [...state.seats[1].hole] },
    ],
  }
}

function putChips(seat: PokerSeat, amount: number): number {
  const add = Math.min(Math.max(0, Math.floor(amount)), seat.stack)
  seat.stack -= add
  seat.streetBet += add
  return add
}

function formatChips(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`
  return String(n)
}

function topUp(stacks: [number, number]): [number, number] {
  return [stacks[0] <= 0 ? TOP_UP : stacks[0], stacks[1] <= 0 ? TOP_UP : stacks[1]]
}

/** Heads-up: dealer posts SB, other posts BB; SB acts first preflop, BB first postflop. */
export function createPokerGame(stacks: [number, number] = [START_STACK, START_STACK], dealer: Seat = 0): PokerState {
  const topped = topUp(stacks)
  const deck = shuffle(makeDeck(POKER_RANKS as Rank[]))
  const seats: [PokerSeat, PokerSeat] = [
    {
      hole: [deck.pop()!, deck.pop()!],
      stack: topped[0],
      streetBet: 0,
      folded: false,
      showCards: false,
    },
    {
      hole: [deck.pop()!, deck.pop()!],
      stack: topped[1],
      streetBet: 0,
      folded: false,
      showCards: false,
    },
  ]
  const sb = dealer
  const bb = other(dealer)
  let pot = 0
  pot += putChips(seats[sb], BLIND)
  pot += putChips(seats[bb], BLIND)
  const streetMax = Math.max(seats[0].streetBet, seats[1].streetBet)
  const toCall = Math.max(0, streetMax - seats[sb].streetBet)
  return {
    seats,
    deck,
    board: [],
    pot,
    phase: 'preflop',
    dealer,
    toCall,
    acting: sb,
    streetMax,
    status: `Блайнды ${BLIND}.`,
    winner: null,
    handLabel: '',
    acted: [],
    lastAggressor: null,
  }
}

function clearStreet(state: PokerState) {
  state.seats[0].streetBet = 0
  state.seats[1].streetBet = 0
  state.streetMax = 0
  state.toCall = 0
}

function bothMatched(state: PokerState) {
  const a = state.seats[0]
  const b = state.seats[1]
  if (a.folded || b.folded) return true
  const matched =
    a.streetBet === b.streetBet || (a.stack === 0 && a.streetBet <= b.streetBet) || (b.stack === 0 && b.streetBet <= a.streetBet)
  return matched
}

function bothActedOrAllIn(state: PokerState) {
  for (const i of [0, 1] as Seat[]) {
    const s = state.seats[i]
    if (s.folded) continue
    if (s.stack === 0) continue
    if (!state.acted.includes(i)) return false
  }
  return true
}

function advanceStreet(state: PokerState, opts?: { runout?: boolean }) {
  clearStreet(state)
  state.acted = []
  state.lastAggressor = null
  const copy = [...state.deck]
  if (state.phase === 'preflop') {
    copy.pop()
    state.board = [copy.pop()!, copy.pop()!, copy.pop()!]
    state.phase = 'flop'
    state.status = 'Флоп.'
  } else if (state.phase === 'flop') {
    copy.pop()
    state.board = [...state.board, copy.pop()!]
    state.phase = 'turn'
    state.status = 'Тёрн.'
  } else if (state.phase === 'turn') {
    copy.pop()
    state.board = [...state.board, copy.pop()!]
    state.phase = 'river'
    state.status = 'Ривер.'
  } else {
    showdown(state)
    return
  }
  state.deck = copy
  if (opts?.runout) {
    state.acting = null
    return
  }
  const first = other(state.dealer)
  if (state.seats[first].stack > 0 && !state.seats[first].folded) state.acting = first
  else if (state.seats[other(first)].stack > 0 && !state.seats[other(first)].folded) {
    state.acting = other(first)
  } else showdown(state)
}

function showdown(state: PokerState) {
  state.phase = 'over'
  state.acting = null
  state.toCall = 0
  clearStreet(state)
  const live = ([0, 1] as Seat[]).filter((i) => !state.seats[i].folded)
  for (const i of live) state.seats[i].showCards = true

  if (live.length === 1) {
    const w = live[0]!
    state.seats[w].stack += state.pot
    state.winner = w
    state.handLabel = ''
    state.status = `Банк ${formatChips(state.pot)}.`
    state.pot = 0
    return
  }

  const ranks = live.map((i) => ({ i, hand: bestHand(state.seats[i].hole, state.board) }))
  ranks.sort((a, b) => b.hand.score - a.hand.score)
  const best = ranks[0]!.hand.score
  const winners = ranks.filter((r) => r.hand.score === best).map((r) => r.i)
  const share = Math.floor(state.pot / winners.length)
  let rem = state.pot - share * winners.length
  for (const w of winners) {
    state.seats[w].stack += share + (rem > 0 ? 1 : 0)
    if (rem > 0) rem -= 1
  }
  state.winner = winners.length === 1 ? winners[0]! : null
  state.handLabel = ranks[0]!.hand.label
  state.status =
    winners.length > 1
      ? `Ничья: ${ranks[0]!.hand.label}. Банк делится.`
      : `${ranks[0]!.hand.label}. Банк ${formatChips(state.pot)}.`
  state.pot = 0
}

function winUncontested(state: PokerState, winner: Seat, msg: string) {
  state.phase = 'over'
  state.acting = null
  state.toCall = 0
  state.seats[winner].stack += state.pot
  state.seats[other(winner)].showCards = false
  state.winner = winner
  state.handLabel = ''
  state.status = msg
  state.pot = 0
}

function runOutBoard(state: PokerState) {
  while (state.phase !== 'over' && state.board.length < 5) {
    if (state.phase === 'river') break
    const before = state.board.length
    advanceStreet(state, { runout: true })
    if (state.board.length === before) break
  }
  if (state.phase !== 'over') showdown(state)
}

function afterAction(state: PokerState, seat: Seat, kind: 'check' | 'call' | 'bet' | 'fold') {
  if (kind === 'fold') {
    winUncontested(state, other(seat), 'Соперник сбросил. Банк ваш.')
    return
  }
  if (kind === 'bet') {
    state.lastAggressor = seat
    state.acted = [seat]
  } else if (!state.acted.includes(seat)) {
    state.acted = [...state.acted, seat]
  }

  const liveWithChips = ([0, 1] as Seat[]).filter((i) => !state.seats[i].folded && state.seats[i].stack > 0)
  const matched = bothMatched(state)
  const streetDone = matched && bothActedOrAllIn(state)

  if (matched && liveWithChips.length <= 1) {
    runOutBoard(state)
    return
  }

  if (streetDone) {
    if (state.phase === 'river') {
      showdown(state)
      return
    }
    advanceStreet(state)
    return
  }

  const opp = other(seat)
  state.acting = opp
  state.toCall = Math.max(0, state.streetMax - state.seats[opp].streetBet)
  if (state.seats[opp].folded) {
    winUncontested(state, seat, 'Соперник сбросил. Банк ваш.')
  }
}

export function applyAction(state: PokerState, seat: Seat, action: PokerAction): PokerState {
  const next = cloneState(state)

  if (action.type === 'nextHand') {
    if (next.phase !== 'over') return state
    const stacks: [number, number] = [next.seats[0].stack, next.seats[1].stack]
    return createPokerGame(stacks, other(next.dealer))
  }

  if (next.phase === 'over' || next.acting !== seat) return state
  const me = next.seats[seat]
  if (me.folded || me.stack < 0) return state

  if (action.type === 'fold') {
    me.folded = true
    afterAction(next, seat, 'fold')
    return next
  }

  if (action.type === 'check') {
    if (next.toCall > 0) return state
    afterAction(next, seat, 'check')
    next.status = 'Чек.'
    return next
  }

  if (action.type === 'call') {
    const need = Math.max(0, next.streetMax - me.streetBet)
    if (need <= 0) {
      afterAction(next, seat, 'check')
      return next
    }
    const paid = putChips(me, need)
    next.pot += paid
    next.toCall = 0
    next.status = paid >= need || me.stack === 0 ? `Колл ${formatChips(paid)}.` : `Колл.`
    afterAction(next, seat, 'call')
    return next
  }

  if (action.type === 'bet') {
    const need = Math.max(0, next.streetMax - me.streetBet)
    const amount = Math.floor(action.amount)
    if (amount <= 0) return state
    if (amount < need) return state
    const paid = putChips(me, amount)
    next.pot += paid
    next.streetMax = Math.max(next.streetMax, me.streetBet)
    next.toCall = 0
    const raised = me.streetBet > need + (need > 0 ? 0 : 0) && amount > need
    next.status =
      me.stack === 0
        ? `All-in ${formatChips(paid)}.`
        : need > 0 && amount > need
          ? `Рейз ${formatChips(paid)}.`
          : `Ставка ${formatChips(paid)}.`
    afterAction(next, seat, raised || amount > need || need === 0 ? 'bet' : 'call')
    return next
  }

  return state
}

export function seatView(state: PokerState, seat: Seat): PokerSeatView {
  const you = state.seats[seat]
  const opp = state.seats[other(seat)]
  const showOppHole = opp.showCards
  const toCall = state.acting === seat ? Math.max(0, state.streetMax - you.streetBet) : 0
  const yourTurn = state.acting === seat && state.phase !== 'over'
  const minBet = Math.min(Math.max(toCall > 0 ? toCall : BLIND, toCall), you.stack)
  const maxBet = you.stack
  const status =
    state.phase === 'over'
      ? state.winner === seat
        ? `Победа! ${state.status}`
        : state.winner === other(seat)
          ? `Поражение. ${state.status}`
          : state.status
      : yourTurn
        ? `${state.status} Ваш ход.`
        : `${state.status} Ход соперника…`

  return {
    seat,
    you: { ...you, hole: [...you.hole] },
    opponent: {
      stack: opp.stack,
      streetBet: opp.streetBet,
      folded: opp.folded,
      hole: showOppHole ? [...opp.hole] : null,
      cardCount: opp.hole.length,
    },
    board: [...state.board],
    pot: state.pot,
    phase: state.phase,
    dealer: state.dealer,
    toCall,
    acting: state.acting,
    yourTurn,
    status,
    winner: state.winner,
    youWon: state.phase === 'over' ? state.winner === seat || (state.winner === null && !you.folded) : null,
    handLabel: state.handLabel,
    canCheck: yourTurn && toCall <= 0,
    canCall: yourTurn && toCall > 0,
    callAmount: Math.min(toCall, you.stack),
    minBet,
    maxBet,
    canBet: yourTurn && maxBet > 0 && (toCall === 0 || maxBet > toCall),
    canFold: yourTurn,
    canNext: state.phase === 'over',
  }
}

export function makeRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < 6; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)]!
  return out
}

export { formatChips }
