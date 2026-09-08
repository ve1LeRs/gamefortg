/** Build nested side pots from per-seat hand contributions. */
export type SidePotLayer = {
  /** Chips in this layer. */
  amount: number
  /** Seat indexes that put at least `level` into the pot (including folded). */
  contributors: number[]
}

/**
 * Classic side-pot layers from total chips each seat invested this hand.
 * Example: invested [4500, 4500, 800] →
 *   main 2400 (all 3), side 7400 (first two).
 */
export function buildSidePotLayers(invested: number[]): SidePotLayer[] {
  const levels = [...new Set(invested.filter((v) => v > 0))].sort((a, b) => a - b)
  const layers: SidePotLayer[] = []
  let prev = 0
  for (const level of levels) {
    const slice = level - prev
    if (slice <= 0) {
      prev = level
      continue
    }
    const contributors: number[] = []
    for (let i = 0; i < invested.length; i += 1) {
      if ((invested[i] ?? 0) >= level) contributors.push(i)
    }
    if (contributors.length === 0) {
      prev = level
      continue
    }
    layers.push({ amount: slice * contributors.length, contributors })
    prev = level
  }
  return layers
}

/** Split `amount` as evenly as possible; remainder +1 from the start. */
export function splitPotAmount(amount: number, winnerCount: number): number[] {
  if (amount <= 0 || winnerCount <= 0) return []
  const share = Math.floor(amount / winnerCount)
  let rem = amount - share * winnerCount
  const out: number[] = []
  for (let i = 0; i < winnerCount; i += 1) {
    const extra = rem > 0 ? 1 : 0
    if (rem > 0) rem -= 1
    out.push(share + extra)
  }
  return out
}

export type SidePotAward = {
  /** Chips added to each seat. */
  awards: number[]
  /** Seats that received any chips. */
  winnerIdxs: number[]
  /** Per-layer results for status text. */
  pots: { amount: number; winners: number[]; label: string }[]
  /** Sum of all awards (should match pot). */
  total: number
}

/**
 * Award side pots at showdown.
 * `scoreFor(i)` returns hand score for a live seat, or null if that seat
 * cannot win (folded / no cards). Folded seats still feed pot size via invested.
 */
export function awardSidePots(
  seatCount: number,
  invested: number[],
  scoreFor: (seatIndex: number) => { score: number; label: string } | null,
): SidePotAward {
  const awards = Array.from({ length: seatCount }, () => 0)
  const pots: SidePotAward['pots'] = []
  const winnerSet = new Set<number>()

  for (const layer of buildSidePotLayers(invested)) {
    if (layer.amount <= 0) continue

    let eligible = layer.contributors.filter((i) => scoreFor(i) != null)
    // Degenerate: every contributor folded — give to best remaining live hand.
    if (eligible.length === 0) {
      eligible = []
      for (let i = 0; i < seatCount; i += 1) {
        if (scoreFor(i) != null) eligible.push(i)
      }
    }
    if (eligible.length === 0) continue

    let best = -Infinity
    let label = ''
    for (const i of eligible) {
      const h = scoreFor(i)!
      if (h.score > best) {
        best = h.score
        label = h.label
      }
    }
    const winners = eligible.filter((i) => scoreFor(i)!.score === best)
    const shares = splitPotAmount(layer.amount, winners.length)
    winners.forEach((idx, wi) => {
      awards[idx]! += shares[wi]!
      winnerSet.add(idx)
    })
    pots.push({ amount: layer.amount, winners, label })
  }

  return {
    awards,
    winnerIdxs: [...winnerSet],
    pots,
    total: awards.reduce((a, b) => a + b, 0),
  }
}
