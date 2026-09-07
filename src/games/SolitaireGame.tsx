import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { PlayingCard } from '../components/PlayingCard'
import {
  type Card,
  type Rank,
  SOLITAIRE_RANKS,
  SUITS,
  makeDeck,
  shuffle,
  isRed,
  rankValue,
} from '../lib/cards'

type Pile = Card[]
type Selection = { where: 'waste' | 'tableau' | 'foundation'; col: number; index: number }

function dealSolitaire() {
  const raw = shuffle(makeDeck(SOLITAIRE_RANKS as Rank[]))
  const deck = raw.map((c, i) => ({ ...c, id: `${c.id}-${i}` }))
  const tableau: Pile[] = [[], [], [], [], [], [], []]
  for (let col = 0; col < 7; col += 1) {
    for (let n = 0; n <= col; n += 1) {
      tableau[col].push(deck.pop()!)
    }
  }
  const faceUp = new Set<string>()
  for (const col of tableau) {
    if (col.length) faceUp.add(col[col.length - 1].id)
  }
  return { stock: deck, waste: [] as Card[], foundations: [[], [], [], []] as Pile[], tableau, faceUp }
}

function canStack(upper: Card, lower: Card) {
  return isRed(upper.suit) !== isRed(lower.suit) && rankValue(upper.rank, SOLITAIRE_RANKS) + 1 === rankValue(lower.rank, SOLITAIRE_RANKS)
}

function canFoundation(card: Card, pile: Pile) {
  if (pile.length === 0) return card.rank === 'A'
  const top = pile[pile.length - 1]
  return top.suit === card.suit && rankValue(card.rank, SOLITAIRE_RANKS) === rankValue(top.rank, SOLITAIRE_RANKS) + 1
}

/** Vertical offset so face-up peek strips keep the rank readable. */
function cardOffset(col: Pile, index: number, faceUp: Set<string>) {
  let y = 0
  for (let i = 0; i < index; i += 1) {
    y += faceUp.has(col[i].id) ? 22 : 15
  }
  return y
}

function colHeight(col: Pile, faceUp: Set<string>) {
  if (!col.length) return 84
  return cardOffset(col, col.length - 1, faceUp) + 84
}

/** Stock empty and every tableau card face-up → offer auto-collect. */
function canAutoClear(stock: Card[], tableau: Pile[], faceUp: Set<string>, waste: Card[]): boolean {
  if (stock.length > 0) return false
  for (const col of tableau) {
    for (const card of col) {
      if (!faceUp.has(card.id)) return false
    }
  }
  const remaining = waste.length + tableau.reduce((n, col) => n + col.length, 0)
  return remaining > 0
}

type HomeMove = {
  where: 'waste' | 'tableau'
  col: number
  index: number
  fi: number
  card: Card
}

/** Endgame collect: pull the next foundation card from anywhere (not only pile tops). */
function nextForcedHomeMove(waste: Card[], foundations: Pile[], tableau: Pile[]): HomeMove | null {
  const findCard = (want: Card): Omit<HomeMove, 'fi' | 'card'> & { card: Card } | null => {
    if (waste.length) {
      const idx = waste.findIndex((c) => c.suit === want.suit && c.rank === want.rank)
      if (idx >= 0) return { where: 'waste', col: 0, index: idx, card: waste[idx] }
    }
    for (let ti = 0; ti < 7; ti += 1) {
      const col = tableau[ti]
      const idx = col.findIndex((c) => c.suit === want.suit && c.rank === want.rank)
      if (idx >= 0) return { where: 'tableau', col: ti, index: idx, card: col[idx] }
    }
    return null
  }

  const options: HomeMove[] = []

  for (let fi = 0; fi < 4; fi += 1) {
    const pile = foundations[fi]
    if (pile.length === 0) {
      const claimed = new Set(
        foundations.filter((p) => p.length > 0).map((p) => p[0].suit),
      )
      for (const suit of SUITS) {
        if (claimed.has(suit)) continue
        const hit = findCard({ suit, rank: 'A', id: '' })
        if (hit) {
          options.push({ ...hit, fi })
          break
        }
      }
      continue
    }
    const top = pile[pile.length - 1]
    const nextIdx = rankValue(top.rank, SOLITAIRE_RANKS) + 1
    if (nextIdx >= SOLITAIRE_RANKS.length) continue
    const hit = findCard({ suit: top.suit, rank: SOLITAIRE_RANKS[nextIdx], id: '' })
    if (hit) options.push({ ...hit, fi })
  }

  if (!options.length) return null
  options.sort((a, b) => rankValue(a.card.rank, SOLITAIRE_RANKS) - rankValue(b.card.rank, SOLITAIRE_RANKS))
  return options[0]
}

function applyHomeMove(
  move: HomeMove,
  waste: Card[],
  foundations: Pile[],
  tableau: Pile[],
): { waste: Card[]; foundations: Pile[]; tableau: Pile[] } {
  const foundationsNext = foundations.map((p) => [...p])
  let wasteNext = [...waste]
  const tableauNext = tableau.map((p) => [...p])

  if (move.where === 'waste') {
    wasteNext.splice(move.index, 1)
  } else {
    tableauNext[move.col] = tableauNext[move.col].filter((_, i) => i !== move.index)
  }
  foundationsNext[move.fi] = [...foundationsNext[move.fi], move.card]
  return { waste: wasteNext, foundations: foundationsNext, tableau: tableauNext }
}

type Hint = { select: Selection; message: string; pulse?: string }

function allTableauFaceUp(tableau: Pile[], faceUp: Set<string>): boolean {
  for (const col of tableau) {
    for (const card of col) {
      if (!faceUp.has(card.id)) return false
    }
  }
  return true
}

function cardPlayableOnBoard(
  card: Card,
  foundations: Pile[],
  tableau: Pile[],
  allowKingToEmpty: boolean,
): boolean {
  for (let f = 0; f < 4; f += 1) {
    if (canFoundation(card, foundations[f])) return true
  }
  for (let to = 0; to < 7; to += 1) {
    const dest = tableau[to]
    if (dest.length === 0) {
      if (card.rank === 'K' && allowKingToEmpty) return true
      continue
    }
    if (canStack(card, dest[dest.length - 1])) return true
  }
  return false
}

/** True if drawing through stock (and one recycle of waste) can yield a playable card. */
function drawCycleHasPlay(
  stock: Card[],
  waste: Card[],
  foundations: Pile[],
  tableau: Pile[],
  faceUpAll: boolean,
): boolean {
  const allowKing = !faceUpAll
  // Next draws come from the end of stock (pop).
  for (let i = stock.length - 1; i >= 0; i -= 1) {
    if (cardPlayableOnBoard(stock[i], foundations, tableau, allowKing)) return true
  }
  // After recycle, waste is reversed onto stock — any buried waste card may surface.
  for (let i = 0; i < waste.length; i += 1) {
    if (cardPlayableOnBoard(waste[i], foundations, tableau, allowKing)) return true
  }
  return false
}

function findHint(
  stock: Card[],
  waste: Card[],
  foundations: Pile[],
  tableau: Pile[],
  faceUp: Set<string>,
  canClear = false,
): Hint | null {
  // Endgame: all open → collect, don't shuffle kings
  if (canClear) {
    return {
      select: { where: 'waste', col: -2, index: -2 },
      message: 'Нажмите «Собрать косынку»',
      pulse: 'clear',
    }
  }

  // 1) Waste → foundation
  if (waste.length) {
    const card = waste[waste.length - 1]
    for (let f = 0; f < 4; f += 1) {
      if (canFoundation(card, foundations[f])) {
        return { select: { where: 'waste', col: 0, index: 0 }, message: `${card.rank}${card.suit} → в дом` }
      }
    }
  }

  // 2) Tableau tops → foundation
  for (let ti = 0; ti < 7; ti += 1) {
    const col = tableau[ti]
    if (!col.length) continue
    const card = col[col.length - 1]
    if (!faceUp.has(card.id)) continue
    for (let f = 0; f < 4; f += 1) {
      if (canFoundation(card, foundations[f])) {
        return {
          select: { where: 'tableau', col: ti, index: col.length - 1 },
          message: `${card.rank}${card.suit} → в дом`,
        }
      }
    }
  }

  // 3) Tableau moves that reveal a face-down card (skip pointless king reshuffles)
  for (let from = 0; from < 7; from += 1) {
    const col = tableau[from]
    for (let index = 0; index < col.length; index += 1) {
      if (!faceUp.has(col[index].id)) continue
      let runOk = true
      for (let i = index; i < col.length - 1; i += 1) {
        if (!faceUp.has(col[i].id) || !canStack(col[i + 1], col[i])) {
          runOk = false
          break
        }
      }
      if (!runOk) continue
      const moving = col[index]
      const reveals = index > 0 && !faceUp.has(col[index - 1].id)
      if (!reveals) continue
      for (let to = 0; to < 7; to += 1) {
        if (to === from) continue
        const dest = tableau[to]
        if (dest.length === 0) {
          if (moving.rank !== 'K') continue
          return {
            select: { where: 'tableau', col: from, index },
            message: `Король ${moving.suit} → пустая колонка (откроется карта)`,
          }
        }
        if (canStack(moving, dest[dest.length - 1])) {
          return {
            select: { where: 'tableau', col: from, index },
            message: `${moving.rank}${moving.suit} → колонка ${to + 1}`,
          }
        }
      }
    }
  }

  const faceUpAll = allTableauFaceUp(tableau, faceUp)

  // 4) Waste → tableau (no king-parking on empty when everything is already open)
  if (waste.length) {
    const card = waste[waste.length - 1]
    for (let to = 0; to < 7; to += 1) {
      const dest = tableau[to]
      if (dest.length === 0) {
        if (card.rank === 'K' && !faceUpAll) {
          return { select: { where: 'waste', col: 0, index: 0 }, message: `Король ${card.suit} на пустую колонку` }
        }
        continue
      }
      if (canStack(card, dest[dest.length - 1])) {
        return {
          select: { where: 'waste', col: 0, index: 0 },
          message: `${card.rank}${card.suit} → колонка ${to + 1}`,
        }
      }
    }
  }

  // 5) Other legal tableau builds — no pointless king parking on empty
  for (let from = 0; from < 7; from += 1) {
    const col = tableau[from]
    for (let index = 0; index < col.length; index += 1) {
      if (!faceUp.has(col[index].id)) continue
      let runOk = true
      for (let i = index; i < col.length - 1; i += 1) {
        if (!faceUp.has(col[i].id) || !canStack(col[i + 1], col[i])) {
          runOk = false
          break
        }
      }
      if (!runOk) continue
      const moving = col[index]
      for (let to = 0; to < 7; to += 1) {
        if (to === from) continue
        const dest = tableau[to]
        if (dest.length === 0) {
          // Only move a king onto empty if it frees a face-up card that can be played.
          // Whole-column reshuffles (index === 0) and “flip buried” moves are handled in step 3.
          if (moving.rank !== 'K' || index === 0) continue
          const under = col[index - 1]
          if (!faceUp.has(under.id)) continue
          if (!cardPlayableOnBoard(under, foundations, tableau, false)) continue
          return {
            select: { where: 'tableau', col: from, index },
            message: `Король ${moving.suit} → пустая (освободит ${under.rank}${under.suit})`,
          }
        }
        if (canStack(moving, dest[dest.length - 1])) {
          return {
            select: { where: 'tableau', col: from, index },
            message: `${moving.rank}${moving.suit} → колонка ${to + 1}`,
          }
        }
      }
    }
  }

  // 6) Draw / recycle — only if some card in the cycle can actually be played
  if (!drawCycleHasPlay(stock, waste, foundations, tableau, faceUpAll)) {
    return null
  }
  if (stock.length > 0) {
    return { select: { where: 'waste', col: -1, index: -1 }, message: 'Возьмите карту из колоды', pulse: 'stock' }
  }
  if (waste.length > 0) {
    return { select: { where: 'waste', col: -1, index: -1 }, message: 'Переверните колоду', pulse: 'stock' }
  }

  return null
}

export function SolitaireGame({
  onHaptic,
}: {
  onHaptic?: (t?: 'light' | 'medium' | 'success' | 'error') => void
}) {
  const init = useMemo(() => dealSolitaire(), [])
  const [stock, setStock] = useState(init.stock)
  const [waste, setWaste] = useState<Card[]>(init.waste)
  const [foundations, setFoundations] = useState<Pile[]>(init.foundations)
  const [tableau, setTableau] = useState<Pile[]>(init.tableau)
  const [faceUp, setFaceUp] = useState(init.faceUp)
  const [selected, setSelected] = useState<Selection | null>(null)
  const [status, setStatus] = useState('Разложите карты по мастям')
  const [won, setWon] = useState(false)
  const [hintPulse, setHintPulse] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)
  const lastHintKey = useRef<string | null>(null)
  const [flight, setFlight] = useState<{
    card: Card
    fi: number
    id: number
    fromX: number
    fromY: number
    toX: number
    toY: number
  } | null>(null)
  const clearTimer = useRef<number | null>(null)
  const flightId = useRef(0)
  const lastTapRef = useRef<{ key: string; at: number } | null>(null)
  const flightTimer = useRef<number | null>(null)

  const stopClearing = useCallback(() => {
    if (clearTimer.current != null) {
      window.clearTimeout(clearTimer.current)
      clearTimer.current = null
    }
    if (flightTimer.current != null) {
      window.clearTimeout(flightTimer.current)
      flightTimer.current = null
    }
    setClearing(false)
    setFlight(null)
  }, [])

  useEffect(() => () => stopClearing(), [stopClearing])

  const offerAutoClear = useMemo(
    () => !won && !clearing && canAutoClear(stock, tableau, faceUp, waste),
    [won, clearing, stock, tableau, faceUp, waste],
  )

  useEffect(() => {
    if (offerAutoClear && !won) {
      setStatus('Все карты открыты — можно собрать косынку')
    }
  }, [offerAutoClear, won])

  const reset = useCallback(() => {
    stopClearing()
    const next = dealSolitaire()
    setStock(next.stock)
    setWaste(next.waste)
    setFoundations(next.foundations)
    setTableau(next.tableau)
    setFaceUp(next.faceUp)
    setSelected(null)
    setStatus('Разложите карты по мастям')
    setWon(false)
    setHintPulse(null)
    onHaptic?.('medium')
  }, [onHaptic, stopClearing])

  const checkWin = (f: Pile[]) => {
    if (f.every((p) => p.length === 13)) {
      setWon(true)
      setStatus('Победа! Косынка собрана.')
      onHaptic?.('success')
    }
  }

  const revealTop = (cols: Pile[], up: Set<string>) => {
    const next = new Set(up)
    for (const col of cols) {
      if (col.length) next.add(col[col.length - 1].id)
    }
    return next
  }

  const drawStock = () => {
    if (won || clearing) return
    onHaptic?.('light')
    if (stock.length === 0) {
      setStock([...waste].reverse())
      setWaste([])
      setSelected(null)
      return
    }
    const nextStock = [...stock]
    const card = nextStock.pop()!
    setStock(nextStock)
    setWaste((w) => [...w, card])
    setFaceUp((u) => new Set(u).add(card.id))
    setSelected(null)
  }

  const getSelectedCards = (): Card[] | null => {
    if (!selected) return null
    if (selected.where === 'waste') {
      return waste.length ? [waste[waste.length - 1]] : null
    }
    if (selected.where === 'foundation') {
      const pile = foundations[selected.col]
      return pile.length ? [pile[pile.length - 1]] : null
    }
    const col = tableau[selected.col]
    return col.slice(selected.index)
  }

  const slotCenter = (ariaLabel: string) => {
    const el = document.querySelector(`[aria-label="${ariaLabel}"]`) as HTMLElement | null
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2 - 29, y: r.top + r.height / 2 - 41 }
  }

  const cardCenter = (cardId: string) => {
    const el = document.querySelector(`[data-card-id="${cardId}"]`) as HTMLElement | null
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2 - 29, y: r.top + r.height / 2 - 41 }
  }

  /** Double-tap / second tap: send one card home if any foundation accepts it. */
  const sendHome = (source: Selection): boolean => {
    if (flight) return false
    let card: Card | undefined
    if (source.where === 'waste') {
      card = waste[waste.length - 1]
    } else if (source.where === 'tableau') {
      const col = tableau[source.col]
      // Only the exposed top card can go to a foundation
      if (source.index !== col.length - 1) return false
      card = col[source.index]
      if (!card || !faceUp.has(card.id)) return false
    } else {
      return false
    }
    if (!card) return false

    let fi = -1
    for (let f = 0; f < 4; f += 1) {
      if (canFoundation(card, foundations[f])) {
        fi = f
        break
      }
    }
    if (fi < 0) return false

    const from =
      source.where === 'waste'
        ? slotCenter('Сброс') ?? cardCenter(card.id)
        : cardCenter(card.id) ?? slotCenter('Сброс')
    const to = slotCenter(`Фундамент ${fi + 1}`)
    const fromX = from?.x ?? window.innerWidth * 0.2
    const fromY = from?.y ?? window.innerHeight * 0.2
    const toX = to?.x ?? window.innerWidth * 0.7
    const toY = to?.y ?? window.innerHeight * 0.15

    if (source.where === 'waste') {
      setWaste((w) => w.slice(0, -1))
    } else {
      const newTab = tableau.map((p) => [...p])
      newTab[source.col] = newTab[source.col].slice(0, -1)
      setTableau(newTab)
      setFaceUp((u) => revealTop(newTab, u))
    }

    setSelected(null)
    lastTapRef.current = null
    flightId.current += 1
    const id = flightId.current
    setFlight({ card, fi, id, fromX, fromY, toX, toY })
    onHaptic?.('light')

    if (flightTimer.current != null) window.clearTimeout(flightTimer.current)
    flightTimer.current = window.setTimeout(() => {
      flightTimer.current = null
      setFoundations((prev) => {
        const next = prev.map((p) => [...p])
        next[fi] = [...next[fi], card!]
        checkWin(next)
        return next
      })
      setFlight(null)
    }, 340)

    return true
  }

  const registerTap = (key: string) => {
    const now = Date.now()
    const last = lastTapRef.current
    const isDouble = !!(last && last.key === key && now - last.at < 700)
    lastTapRef.current = { key, at: now }
    return isDouble
  }

  const tryMoveToFoundation = (fi: number) => {
    const cards = getSelectedCards()
    if (!cards || cards.length !== 1) return false
    const card = cards[0]
    if (!canFoundation(card, foundations[fi])) return false

    const newFoundations = foundations.map((p) => [...p])
    newFoundations[fi] = [...newFoundations[fi], card]

    if (selected!.where === 'waste') {
      setWaste((w) => w.slice(0, -1))
    } else if (selected!.where === 'tableau') {
      const newTab = tableau.map((p) => [...p])
      newTab[selected!.col] = newTab[selected!.col].slice(0, selected!.index)
      setTableau(newTab)
      setFaceUp((u) => revealTop(newTab, u))
    } else if (selected!.where === 'foundation') {
      newFoundations[selected!.col] = newFoundations[selected!.col].slice(0, -1)
    }

    setFoundations(newFoundations)
    setSelected(null)
    onHaptic?.('light')
    checkWin(newFoundations)
    return true
  }

  const tryMoveToTableau = (ti: number) => {
    const cards = getSelectedCards()
    if (!cards || !cards.length) return false
    const dest = tableau[ti]
    const moving = cards[0]
    if (dest.length === 0) {
      if (moving.rank !== 'K') return false
    } else if (!canStack(moving, dest[dest.length - 1])) {
      return false
    }
    if (selected!.where === 'tableau' && selected!.col === ti) return false

    const newTab = tableau.map((p) => [...p])
    newTab[ti] = [...newTab[ti], ...cards]

    if (selected!.where === 'waste') {
      setWaste((w) => w.slice(0, -1))
    } else if (selected!.where === 'tableau') {
      newTab[selected!.col] = tableau[selected!.col].slice(0, selected!.index)
    } else if (selected!.where === 'foundation') {
      const newFoundations = foundations.map((p) => [...p])
      newFoundations[selected!.col] = newFoundations[selected!.col].slice(0, -1)
      setFoundations(newFoundations)
    }

    setTableau(newTab)
    setFaceUp((u) => revealTop(newTab, u))
    setSelected(null)
    onHaptic?.('light')
    return true
  }

  const onWasteClick = () => {
    if (!waste.length || clearing || won || flight) return
    const top = waste[waste.length - 1]
    const source: Selection = { where: 'waste', col: 0, index: waste.length - 1 }
    const tapKey = `waste:${top.id}`
    const isDouble = registerTap(tapKey)
    const already = selected?.where === 'waste'

    // Second tap on the waste card (or native double-tap window) → home
    if (isDouble || already) {
      if (sendHome(source)) return
      if (already) {
        setSelected(null)
        setStatus('Разложите карты по мастям')
        return
      }
    }
    setSelected(source)
    setStatus(`${top.rank}${top.suit} выбрана — куда положить?`)
    onHaptic?.('light')
  }

  const onWasteDoubleClick = () => {
    if (!waste.length || clearing || won || flight) return
    sendHome({ where: 'waste', col: 0, index: waste.length - 1 })
  }

  const onFoundationClick = (fi: number) => {
    if (clearing || won) return
    if (selected) {
      if (tryMoveToFoundation(fi)) return
    }
    if (foundations[fi].length) {
      const card = foundations[fi][foundations[fi].length - 1]
      setSelected({ where: 'foundation', col: fi, index: foundations[fi].length - 1 })
      setStatus(`${card.rank}${card.suit} выбрана — куда положить?`)
      onHaptic?.('light')
    }
  }

  const onTableauClick = (ti: number, index: number) => {
    if (clearing || won) return
    const col = tableau[ti]
    if (!col.length) {
      if (selected) tryMoveToTableau(ti)
      return
    }
    const card = col[index]
    if (!faceUp.has(card.id)) return
    // ensure sequence from index is valid face-up run
    for (let i = index; i < col.length - 1; i += 1) {
      if (!faceUp.has(col[i].id) || !canStack(col[i + 1], col[i])) return
    }

    const key = `t-${ti}-${index}`
    const sameSelected =
      selected?.where === 'tableau' && selected.col === ti && selected.index === index

    // Double-tap (or second tap on the same card) → try foundation
    if (registerTap(key) || sameSelected) {
      if (sendHome({ where: 'tableau', col: ti, index })) return
      if (sameSelected) {
        setSelected(null)
        setStatus('Разложите карты по мастям')
        return
      }
    }

    if (selected) {
      if (tryMoveToTableau(ti)) return
    }

    setSelected({ where: 'tableau', col: ti, index })
    const runLen = col.length - index
    setStatus(
      runLen > 1
        ? `${card.rank}${card.suit} и ещё ${runLen - 1} — куда положить?`
        : `${card.rank}${card.suit} выбрана — куда положить?`,
    )
    onHaptic?.('light')
  }

  const onEmptyCol = (ti: number) => {
    if (selected) tryMoveToTableau(ti)
  }

  const showHint = () => {
    if (won || clearing) return
    const hint = findHint(stock, waste, foundations, tableau, faceUp, offerAutoClear)
    if (!hint) {
      lastHintKey.current = null
      setSelected(null)
      setHintPulse(null)
      setStatus('Ходов не видно — новая раздача')
      onHaptic?.('error')
      return
    }
    const key = `${hint.pulse ?? hint.select.where}:${hint.select.col}:${hint.select.index}:${hint.message}:${stock.length}:${waste.length}`
    // Same stock/recycle tip again — don't spam the status line; just re-pulse.
    if (hint.pulse === 'stock' && lastHintKey.current === key) {
      setHintPulse('stock')
      window.setTimeout(() => setHintPulse(null), 1400)
      onHaptic?.('light')
      return
    }
    lastHintKey.current = key
    setStatus(hint.message)
    onHaptic?.('medium')
    if (hint.select.col < 0) {
      setSelected(null)
      setHintPulse(hint.pulse ?? 'stock')
      window.setTimeout(() => setHintPulse(null), 1400)
      return
    }
    setSelected(hint.select)
    const pulseKey =
      hint.select.where === 'waste'
        ? 'waste'
        : hint.select.where === 'tableau'
          ? `t-${hint.select.col}-${hint.select.index}`
          : `f-${hint.select.col}`
    setHintPulse(pulseKey)
    window.setTimeout(() => setHintPulse(null), 1200)
  }

  const autoClearOnce = useCallback(
    (
      curWaste: Card[],
      curFoundations: Pile[],
      curTableau: Pile[],
    ): { waste: Card[]; foundations: Pile[]; tableau: Pile[]; moved: HomeMove | null } => {
      const move = nextForcedHomeMove(curWaste, curFoundations, curTableau)
      if (!move) {
        return { waste: curWaste, foundations: curFoundations, tableau: curTableau, moved: null }
      }
      const next = applyHomeMove(move, curWaste, curFoundations, curTableau)
      return { ...next, moved: move }
    },
    [],
  )

  const startAutoClear = () => {
    if (won || clearing || !offerAutoClear) return
    setSelected(null)
    setClearing(true)
    setStatus('Собираем косынку…')
    onHaptic?.('medium')

    let curWaste = waste
    let curFoundations = foundations
    let curTableau = tableau

    const tick = () => {
      const step = autoClearOnce(curWaste, curFoundations, curTableau)
      if (!step.moved) {
        setClearing(false)
        setFlight(null)
        clearTimer.current = null
        if (step.foundations.every((p) => p.length === 13)) {
          setWon(true)
          setStatus('Победа! Косынка собрана.')
          onHaptic?.('success')
        } else {
          setStatus('Автосбор остановился — доложите вручную')
          onHaptic?.('error')
        }
        return
      }
      curWaste = step.waste
      curFoundations = step.foundations
      curTableau = step.tableau
      flightId.current += 1
      const home = slotCenter(`Фундамент ${step.moved.fi + 1}`)
      const cx = window.innerWidth / 2 - 29
      const cy = window.innerHeight * 0.42 - 41
      setFlight({
        card: step.moved.card,
        fi: step.moved.fi,
        id: flightId.current,
        fromX: cx,
        fromY: cy + 40,
        toX: home?.x ?? cx,
        toY: home?.y ?? cy - 80,
      })
      setWaste(curWaste)
      setFoundations(curFoundations)
      setTableau(curTableau)
      onHaptic?.('light')

      if (curFoundations.every((p) => p.length === 13)) {
        clearTimer.current = window.setTimeout(() => {
          setClearing(false)
          setFlight(null)
          clearTimer.current = null
          setWon(true)
          setStatus('Победа! Косынка собрана.')
          onHaptic?.('success')
        }, 180)
        return
      }
      clearTimer.current = window.setTimeout(tick, 140)
    }

    clearTimer.current = window.setTimeout(tick, 60)
  }

  return (
    <div className={`solitaire ${clearing ? 'is-clearing' : ''}`}>
      <p className={`game-status ${won ? 'win' : ''}`}>{status}</p>
      <div className="sol-top">
        <div className="sol-stock">
          <div
            className={`sol-slot ${hintPulse === 'stock' ? 'sol-hint' : ''}`}
            onClick={drawStock}
            onKeyDown={(e) => e.key === 'Enter' && drawStock()}
            role="button"
            tabIndex={0}
            aria-label="Колода"
          >
            {stock.length > 0 ? <PlayingCard faceDown /> : null}
          </div>
          <div
            className={`sol-slot ${hintPulse === 'waste' ? 'sol-hint' : ''}`}
            onClick={waste.length ? undefined : onWasteClick}
            onKeyDown={(e) => e.key === 'Enter' && onWasteClick()}
            role="button"
            tabIndex={0}
            aria-label="Сброс"
          >
            {waste.length > 0 && (
              <PlayingCard
                card={waste[waste.length - 1]}
                selected={selected?.where === 'waste'}
                playable
                enter="none"
                className="sol-waste-card"
                onClick={onWasteClick}
                onDoubleClick={onWasteDoubleClick}
              />
            )}
          </div>
        </div>
        <div className="sol-foundations">
          {foundations.map((pile, fi) => (
            <div
              key={fi}
              className={`sol-slot ${hintPulse === `f-${fi}` ? 'sol-hint' : ''} ${flight?.fi === fi ? 'sol-home-target' : ''}`}
              onClick={() => onFoundationClick(fi)}
              onKeyDown={(e) => e.key === 'Enter' && onFoundationClick(fi)}
              role="button"
              tabIndex={0}
              aria-label={`Фундамент ${fi + 1}`}
            >
              {pile.length > 0 && (
                <PlayingCard
                  card={pile[pile.length - 1]}
                  selected={selected?.where === 'foundation' && selected.col === fi}
                  className={flight?.fi === fi && flight.card.id === pile[pile.length - 1].id ? 'sol-fly-in' : ''}
                />
              )}
            </div>
          ))}
        </div>
      </div>
      {flight && (
        <div
          className="sol-flight"
          key={flight.id}
          aria-hidden
          style={
            {
              ['--sol-fx' as string]: `${flight.fromX}px`,
              ['--sol-fy' as string]: `${flight.fromY}px`,
              ['--sol-tx' as string]: `${flight.toX}px`,
              ['--sol-ty' as string]: `${flight.toY}px`,
            } as CSSProperties
          }
        >
          <PlayingCard card={flight.card} enter="none" className="sol-flight-card" />
        </div>
      )}
      <div className="sol-tableau">
        {tableau.map((col, ti) => (
          <div
            key={ti}
            className="sol-col"
            style={{ minHeight: colHeight(col, faceUp) }}
            onClick={() => {
              if (!col.length) onEmptyCol(ti)
            }}
          >
            {col.length === 0 && <div className="sol-slot" style={{ width: '100%', height: 'auto', aspectRatio: '5/7' }} />}
            {col.map((card, index) => {
              const up = faceUp.has(card.id)
              const isTop = index === col.length - 1
              const inRun =
                selected?.where === 'tableau' && selected.col === ti && index >= selected.index
              const isSel = inRun && selected!.index === index
              const buried = up && !isTop
              const pulse = hintPulse === `t-${ti}-${index}`
              return (
                <PlayingCard
                  key={card.id}
                  card={card}
                  faceDown={!up}
                  selected={!!isSel}
                  playable={up}
                  enter="none"
                  index={index}
                  onClick={() => onTableauClick(ti, index)}
                  className={`${buried ? 'sol-buried' : ''}${inRun && !isSel ? ' sol-in-run' : ''}${pulse ? ' sol-hint-card' : ''}`.trim()}
                  style={{ top: cardOffset(col, index, faceUp), zIndex: index + 1 }}
                />
              )
            })}
          </div>
        ))}
      </div>
      <div className="action-bar sol-actions">
        <button type="button" className="btn btn-accent" onClick={showHint} disabled={won || clearing}>
          Подсказка
        </button>
        {offerAutoClear && (
          <button
            type="button"
            className={`btn btn-accent sol-clear-btn ${hintPulse === 'clear' ? 'sol-hint' : ''}`}
            onClick={startAutoClear}
            disabled={clearing}
          >
            {clearing ? 'Собираем…' : 'Собрать косынку'}
          </button>
        )}
        <button type="button" className="btn btn-soft" onClick={reset} disabled={clearing}>
          Новая раздача
        </button>
      </div>
    </div>
  )
}
