export type Suit = '♠' | '♥' | '♦' | '♣'
export type Rank =
  | '6'
  | '7'
  | '8'
  | '9'
  | '10'
  | 'J'
  | 'Q'
  | 'K'
  | 'A'
  | '2'
  | '3'
  | '4'
  | '5'

export type Card = {
  suit: Suit
  rank: Rank
  id: string
}

export const SUITS: Suit[] = ['♠', '♥', '♦', '♣']
export const RED_SUITS: Suit[] = ['♥', '♦']

export const DURAK_RANKS: Rank[] = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']
export const POKER_RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']
export const SOLITAIRE_RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

export function isRed(suit: Suit): boolean {
  return RED_SUITS.includes(suit)
}

export function makeDeck(ranks: Rank[]): Card[] {
  const deck: Card[] = []
  for (const suit of SUITS) {
    for (const rank of ranks) {
      deck.push({ suit, rank, id: `${rank}${suit}` })
    }
  }
  return deck
}

export function shuffle<T>(items: T[]): T[] {
  const arr = [...items]
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export function rankValue(rank: Rank, order: Rank[]): number {
  return order.indexOf(rank)
}

export function cardLabel(card: Card): string {
  return `${card.rank}${card.suit}`
}

/** Russian short ranks used on classic Durak faces (Туз, Валет, Дама, Король). */
export function rankGlyph(rank: Rank, style: 'latin' | 'ru' = 'latin'): string {
  if (style !== 'ru') return rank
  const map: Partial<Record<Rank, string>> = {
    A: 'Т',
    J: 'В',
    Q: 'Д',
    K: 'К',
  }
  return map[rank] ?? rank
}
