import { type Card, POKER_RANKS, makeDeck, rankValue } from '../../lib/cards'

/**
 * Lexicographic 5-card strength. Categories are spaced so kickers never spill.
 * Uses base-13 packing of ranks (0..12) within each category.
 */
function packRanks(ranks: number[], count: number): number {
  let n = 0
  for (let i = 0; i < count; i += 1) n = n * 13 + (ranks[i] ?? 0)
  return n
}

/** Score of an exact 5-card hand (higher = better). */
export function scoreFive(cards: Card[]): number {
  if (cards.length !== 5) return -1
  const values = cards
    .map((c) => rankValue(c.rank, POKER_RANKS))
    .sort((a, b) => b - a)
  const suits = cards.map((c) => c.suit)
  const counts = new Map<number, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])
  const flush = suits.every((s) => s === suits[0])
  const uniq = [...new Set(values)].sort((a, b) => b - a)

  let straight = false
  let straightHigh = 0
  if (uniq.length === 5 && uniq[0]! - uniq[4]! === 4) {
    straight = true
    straightHigh = uniq[0]!
  } else if (uniq.length === 5 && uniq[0] === 12 && uniq[1] === 3 && uniq[4] === 0) {
    // A-2-3-4-5 wheel
    straight = true
    straightHigh = 3
  }

  // category * 13^5 (371293) + payload
  const CAT = 13 ** 5
  if (straight && flush) return 8 * CAT + straightHigh
  if (groups[0]![1] === 4) {
    return 7 * CAT + packRanks([groups[0]![0], groups[1]?.[0] ?? 0], 2)
  }
  if (groups[0]![1] === 3 && groups[1]?.[1] === 2) {
    return 6 * CAT + packRanks([groups[0]![0], groups[1]![0]], 2)
  }
  if (flush) return 5 * CAT + packRanks(values, 5)
  if (straight) return 4 * CAT + straightHigh
  if (groups[0]![1] === 3) {
    const kickers = values.filter((v) => v !== groups[0]![0])
    return 3 * CAT + packRanks([groups[0]![0], kickers[0]!, kickers[1]!], 3)
  }
  if (groups[0]![1] === 2 && groups[1]?.[1] === 2) {
    const high = Math.max(groups[0]![0], groups[1]![0])
    const low = Math.min(groups[0]![0], groups[1]![0])
    const kicker = values.find((v) => v !== high && v !== low) ?? 0
    return 2 * CAT + packRanks([high, low, kicker], 3)
  }
  if (groups[0]![1] === 2) {
    const kickers = values.filter((v) => v !== groups[0]![0])
    return 1 * CAT + packRanks([groups[0]![0], kickers[0]!, kickers[1]!, kickers[2]!], 4)
  }
  return 0 * CAT + packRanks(values, 5)
}

/** Best 5-card score from hole + board (2+0 .. 2+5). */
export function bestScore(hole: Card[], board: Card[]): number {
  const all = [...hole, ...board]
  if (all.length < 5) {
    // Preflop / incomplete: rank hole only as a proxy (not used in equity runouts).
    if (hole.length < 2) return 0
    const v0 = rankValue(hole[0]!.rank, POKER_RANKS)
    const v1 = rankValue(hole[1]!.rank, POKER_RANKS)
    const high = Math.max(v0, v1)
    const low = Math.min(v0, v1)
    const suited = hole[0]!.suit === hole[1]!.suit ? 1 : 0
    if (v0 === v1) return 1_000_000 + high * 20 + suited
    return high * 400 + low * 20 + suited * 10 + (high - low === 1 ? 5 : 0)
  }
  let best = -1
  const n = all.length
  for (let a = 0; a < n - 4; a += 1) {
    for (let b = a + 1; b < n - 3; b += 1) {
      for (let c = b + 1; c < n - 2; c += 1) {
        for (let d = c + 1; d < n - 1; d += 1) {
          for (let e = d + 1; e < n; e += 1) {
            const s = scoreFive([all[a]!, all[b]!, all[c]!, all[d]!, all[e]!])
            if (s > best) best = s
          }
        }
      }
    }
  }
  return best
}

function drawTop(pool: Card[], n: number): Card[] {
  const a = pool.slice()
  for (let i = 0; i < n; i += 1) {
    const j = i + Math.floor(Math.random() * (a.length - i))
    const tmp = a[i]!
    a[i] = a[j]!
    a[j] = tmp
  }
  return a.slice(0, n)
}

export type EquityOptions = {
  /** Active opponents still in the pot (solo multiway matters a lot). */
  opponents?: number
  trials?: number
}

/**
 * Monte Carlo equity: share of pot hero expects vs N random opponent hands
 * and a random runout of the remaining board.
 */
export function estimateEquity(hole: Card[], board: Card[], options: EquityOptions = {}): number {
  if (hole.length < 2) return 0.5
  const opponents = Math.max(1, Math.min(8, Math.floor(options.opponents ?? 1)))
  const needBoard = Math.max(0, 5 - board.length)
  const cardsNeeded = opponents * 2 + needBoard
  // More samples preflop / multiway — those estimates are noisiest.
  const trials =
    options.trials ??
    (board.length === 0 ? (opponents > 1 ? 900 : 700) : board.length < 5 ? (opponents > 1 ? 700 : 500) : 350)

  const used = new Set([...hole, ...board].map((c) => c.id))
  const remaining = makeDeck(POKER_RANKS).filter((c) => !used.has(c.id))
  if (remaining.length < cardsNeeded) return 0.5

  let equitySum = 0
  for (let t = 0; t < trials; t += 1) {
    const deal = drawTop(remaining, cardsNeeded)
    let cursor = 0
    const oppHoles: Card[][] = []
    for (let o = 0; o < opponents; o += 1) {
      oppHoles.push([deal[cursor]!, deal[cursor + 1]!])
      cursor += 2
    }
    const runout = needBoard > 0 ? deal.slice(cursor, cursor + needBoard) : []
    const fullBoard = needBoard > 0 ? [...board, ...runout] : board
    const hero = bestScore(hole, fullBoard)
    const oppScores = oppHoles.map((oh) => bestScore(oh, fullBoard))
    const bestOpp = Math.max(...oppScores)
    if (hero > bestOpp) equitySum += 1
    else if (hero === bestOpp) {
      const tied = oppScores.filter((s) => s === hero).length
      equitySum += 1 / (tied + 1)
    }
  }
  return equitySum / trials
}

/** Exact equity when all opponent holes are known (showdown). */
export function exactEquity(hole: Card[], board: Card[], oppHoles: Card[][]): number {
  if (oppHoles.length === 0) return 1
  const hero = bestScore(hole, board)
  const scores = oppHoles.map((oh) => bestScore(oh, board))
  const bestOpp = Math.max(...scores)
  if (hero > bestOpp) return 1
  if (hero < bestOpp) return 0
  const tied = scores.filter((s) => s === hero).length
  return 1 / (tied + 1)
}
