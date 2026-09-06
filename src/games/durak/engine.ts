import {
  type Card,
  type Rank,
  type Suit,
  DURAK_RANKS,
  SUITS,
  makeDeck,
  shuffle,
  rankValue,
} from '../../lib/cards'

export type Seat = 'a' | 'b'
export type TablePair = { attack: Card; defence?: Card }

export type DurakPhase = 'attack' | 'defend' | 'toss' | 'takeToss' | 'over'

export type DurakAction =
  | { type: 'play'; cardId: string }
  | { type: 'take' }
  | { type: 'bito' }
  | { type: 'give' }

export type DurakState = {
  deck: Card[]
  trump: Suit
  trumpCard: Card
  hands: Record<Seat, Card[]>
  table: TablePair[]
  discard: Card[]
  attacker: Seat
  /** Defender pressed «Беру» — attacker may still toss matching ranks */
  taking: boolean
  phase: DurakPhase
  winner: Seat | null
  status: string
}

export type SeatView = {
  seat: Seat
  you: Card[]
  opponentCount: number
  table: TablePair[]
  deckCount: number
  trump: Suit
  trumpCard: Card | null
  discardCount: number
  attacker: Seat
  taking: boolean
  phase: DurakPhase
  winner: Seat | null
  youWon: boolean | null
  status: string
  legalCardIds: string[]
  canTake: boolean
  canBito: boolean
  canGive: boolean
  yourTurn: boolean
}

function sortHand(hand: Card[], trump: Suit): Card[] {
  return [...hand].sort((a, b) => {
    const aT = a.suit === trump ? 1 : 0
    const bT = b.suit === trump ? 1 : 0
    if (aT !== bT) return aT - bT
    const byRank = rankValue(a.rank, DURAK_RANKS) - rankValue(b.rank, DURAK_RANKS)
    if (byRank !== 0) return byRank
    return SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit)
  })
}

export function beats(a: Card, b: Card, trump: Suit): boolean {
  if (a.suit === b.suit) return rankValue(a.rank, DURAK_RANKS) > rankValue(b.rank, DURAK_RANKS)
  return a.suit === trump && b.suit !== trump
}

export function canDefend(card: Card, attack: Card, trump: Suit): boolean {
  return beats(card, attack, trump)
}

function other(seat: Seat): Seat {
  return seat === 'a' ? 'b' : 'a'
}

function ranksOnTable(table: TablePair[]): Set<Rank> {
  const ranks = new Set<Rank>()
  for (const p of table) {
    ranks.add(p.attack.rank)
    if (p.defence) ranks.add(p.defence.rank)
  }
  return ranks
}

function maxAttackSlots(defenderHandSize: number, table: TablePair[]): number {
  const defended = table.filter((p) => p.defence).length
  return Math.min(6, defenderHandSize + defended)
}

function slotsLeft(defenderHandSize: number, table: TablePair[]): number {
  return maxAttackSlots(defenderHandSize, table) - table.length
}

function refillHands(state: DurakState, first: Seat): DurakState {
  const deck = [...state.deck]
  const hands: Record<Seat, Card[]> = {
    a: [...state.hands.a],
    b: [...state.hands.b],
  }
  const order: Seat[] = first === 'a' ? ['a', 'b'] : ['b', 'a']
  for (const seat of order) {
    while (hands[seat].length < 6 && deck.length > 0) {
      hands[seat].push(deck.pop()!)
    }
  }
  return {
    ...state,
    deck,
    hands: {
      a: sortHand(hands.a, state.trump),
      b: sortHand(hands.b, state.trump),
    },
  }
}

function checkWinner(state: DurakState): DurakState {
  if (state.deck.length > 0) return state
  if (state.table.length > 0) return state
  const aEmpty = state.hands.a.length === 0
  const bEmpty = state.hands.b.length === 0
  if (aEmpty && bEmpty) {
    return { ...state, phase: 'over', winner: null, status: 'Ничья — оба скинули карты.' }
  }
  if (aEmpty) {
    return { ...state, phase: 'over', winner: 'a', status: 'Игрок A победил!' }
  }
  if (bEmpty) {
    return { ...state, phase: 'over', winner: 'b', status: 'Игрок B победил!' }
  }
  return state
}

export function createDurakGame(firstAttacker: Seat = 'a'): DurakState {
  const deck = shuffle(makeDeck(DURAK_RANKS))
  const hands: Record<Seat, Card[]> = { a: [], b: [] }
  for (let i = 0; i < 6; i += 1) {
    hands.a.push(deck.pop()!)
    hands.b.push(deck.pop()!)
  }
  const trumpCard = deck[0]!
  const trump = trumpCard.suit
  return {
    deck,
    trump,
    trumpCard,
    hands: {
      a: sortHand(hands.a, trump),
      b: sortHand(hands.b, trump),
    },
    table: [],
    discard: [],
    attacker: firstAttacker,
    taking: false,
    phase: 'attack',
    winner: null,
    status: firstAttacker === 'a' ? 'Ход игрока A' : 'Ход игрока B',
  }
}

function legalCardIds(state: DurakState, seat: Seat): string[] {
  if (state.phase === 'over') return []
  const hand = state.hands[seat]
  const defender = other(state.attacker)
  const ranks = ranksOnTable(state.table)

  if (state.taking) {
    if (seat !== state.attacker) return []
    if (slotsLeft(state.hands[defender].length, state.table) <= 0) return []
    return hand.filter((c) => ranks.has(c.rank)).map((c) => c.id)
  }

  if (seat === state.attacker && (state.phase === 'attack' || state.phase === 'toss')) {
    if (slotsLeft(state.hands[defender].length, state.table) <= 0) return []
    if (state.table.length === 0) return hand.map((c) => c.id)
    return hand.filter((c) => ranks.has(c.rank)).map((c) => c.id)
  }

  if (seat === defender && state.phase === 'defend') {
    const open = state.table.find((p) => !p.defence)
    if (!open) return []
    return hand.filter((c) => canDefend(c, open.attack, state.trump)).map((c) => c.id)
  }

  return []
}

export function seatView(state: DurakState, seat: Seat): SeatView {
  const opp = other(seat)
  const legal = legalCardIds(state, seat)
  const defender = other(state.attacker)
  const allDefended = state.table.length > 0 && state.table.every((p) => p.defence)
  const canTake =
    !state.taking &&
    state.phase === 'defend' &&
    seat === defender &&
    state.table.some((p) => !p.defence)
  const canBito =
    !state.taking &&
    allDefended &&
    seat === state.attacker &&
    (state.phase === 'toss' || state.phase === 'attack' || state.phase === 'defend')
  const canGive = state.taking && seat === state.attacker
  const yourTurn = state.phase !== 'over' && (legal.length > 0 || canTake || canBito || canGive)

  let status = state.status
  if (state.phase === 'over') {
    if (state.winner === seat) status = 'Победа! Вы скинули все карты.'
    else if (state.winner === opp) status = 'Поражение. Вы — дурак.'
    else status = state.status
  } else if (seat === state.attacker && state.phase === 'attack' && state.table.length === 0) {
    status = 'Ваш ход — ходите картой'
  } else if (seat === defender && state.phase === 'defend') {
    status = 'Отбейтесь или нажмите «Беру»'
  } else if (state.taking && seat === state.attacker) {
    status = 'Соперник берёт — подкиньте на погоны или «Отдать»'
  } else if (state.taking && seat === defender) {
    status = 'Вы берёте — ждите, пока соперник закончит подкидывать'
  } else if (allDefended && yourTurn) {
    status = 'Отбились. Можно подкинуть или «Бито»'
  } else if (!yourTurn) {
    status = 'Ход соперника…'
  }

  return {
    seat,
    you: state.hands[seat],
    opponentCount: state.hands[opp].length,
    table: state.table,
    deckCount: state.deck.length,
    trump: state.trump,
    trumpCard: state.deck.length > 0 ? state.trumpCard : null,
    discardCount: state.discard.length,
    attacker: state.attacker,
    taking: state.taking,
    phase: state.phase,
    winner: state.winner,
    youWon: state.phase === 'over' ? state.winner === seat : null,
    status,
    legalCardIds: legal,
    canTake,
    canBito,
    canGive,
    yourTurn,
  }
}

export function applyAction(state: DurakState, seat: Seat, action: DurakAction): DurakState {
  if (state.phase === 'over') return state
  const defender = other(state.attacker)

  if (action.type === 'play') {
    const card = state.hands[seat].find((c) => c.id === action.cardId)
    if (!card) return state
    if (!legalCardIds(state, seat).includes(card.id)) return state

    const hands: Record<Seat, Card[]> = {
      a: sortHand(
        state.hands.a.filter((c) => c.id !== card.id),
        state.trump,
      ),
      b: sortHand(
        state.hands.b.filter((c) => c.id !== card.id),
        state.trump,
      ),
    }

    if (seat === state.attacker) {
      const table = [...state.table, { attack: card }]
      const next: DurakState = {
        ...state,
        hands,
        table,
        status: state.taking ? 'Подкинули на погоны' : 'Атака на столе',
        phase: state.taking ? 'takeToss' : 'defend',
      }
      return checkWinner(next)
    }

    if (seat === defender && state.phase === 'defend') {
      const open = state.table.find((p) => !p.defence)
      if (!open || !canDefend(card, open.attack, state.trump)) return state
      const table = state.table.map((p) =>
        p.attack.id === open.attack.id ? { ...p, defence: card } : p,
      )
      const allDefended = table.every((p) => p.defence)
      const next: DurakState = {
        ...state,
        hands,
        table,
        phase: allDefended ? 'toss' : 'defend',
        status: allDefended ? 'Отбито. Подкинуть или бито.' : 'Отбито. Есть открытая атака.',
      }
      return checkWinner(next)
    }

    return state
  }

  if (action.type === 'take') {
    if (state.taking || state.phase !== 'defend' || seat !== defender) return state
    if (!state.table.some((p) => !p.defence)) return state
    return {
      ...state,
      taking: true,
      phase: 'takeToss',
      status: 'Защитник берёт — атакующий может подкинуть',
    }
  }

  if (action.type === 'give') {
    if (!state.taking || seat !== state.attacker) return state
    const taken = sortHand(
      [
        ...state.hands[defender],
        ...state.table.flatMap((p) => (p.defence ? [p.attack, p.defence] : [p.attack])),
      ],
      state.trump,
    )
    let next: DurakState = {
      ...state,
      hands: { ...state.hands, [defender]: taken },
      table: [],
      taking: false,
      attacker: state.attacker,
      phase: 'attack',
      status: 'Карты забраны. Атака продолжается.',
    }
    next = refillHands(next, state.attacker)
    return checkWinner(next)
  }

  if (action.type === 'bito') {
    if (state.taking) return state
    if (state.table.length === 0 || state.table.some((p) => !p.defence)) return state
    if (seat !== state.attacker) return state
    const cleared = state.table.flatMap((p) =>
      p.defence ? [p.attack, p.defence] : [p.attack],
    )
    let next: DurakState = {
      ...state,
      table: [],
      discard: [...state.discard, ...cleared],
      attacker: defender,
      taking: false,
      phase: 'attack',
      status: 'Бито. Ход переходит.',
    }
    next = refillHands(next, state.attacker)
    return checkWinner(next)
  }

  return state
}

export function makeRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < 6; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)]!
  }
  return out
}

