import { useCallback, useMemo, useState } from 'react'
import { PlayingCard } from '../components/PlayingCard'
import {
  type Card,
  type Rank,
  SOLITAIRE_RANKS,
  makeDeck,
  shuffle,
  isRed,
  rankValue,
} from '../lib/cards'

type Pile = Card[]

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
  const [selected, setSelected] = useState<{ where: 'waste' | 'tableau' | 'foundation'; col: number; index: number } | null>(null)
  const [status, setStatus] = useState('Разложите карты по мастям')
  const [won, setWon] = useState(false)

  const reset = useCallback(() => {
    const next = dealSolitaire()
    setStock(next.stock)
    setWaste(next.waste)
    setFoundations(next.foundations)
    setTableau(next.tableau)
    setFaceUp(next.faceUp)
    setSelected(null)
    setStatus('Разложите карты по мастям')
    setWon(false)
    onHaptic?.('medium')
  }, [onHaptic])

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
    if (won) return
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
    if (!waste.length) return
    if (selected?.where === 'waste') {
      setSelected(null)
      return
    }
    setSelected({ where: 'waste', col: 0, index: 0 })
  }

  const onFoundationClick = (fi: number) => {
    if (selected) {
      if (tryMoveToFoundation(fi)) return
    }
    if (foundations[fi].length) {
      setSelected({ where: 'foundation', col: fi, index: foundations[fi].length - 1 })
    }
  }

  const onTableauClick = (ti: number, index: number) => {
    const col = tableau[ti]
    if (selected) {
      if (tryMoveToTableau(ti)) return
      // double-click style: try auto foundation
      if (selected.where === 'tableau' && selected.col === ti && selected.index === index) {
        for (let f = 0; f < 4; f += 1) {
          if (tryMoveToFoundation(f)) return
        }
        setSelected(null)
        return
      }
    }
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
    setSelected({ where: 'tableau', col: ti, index })
    onHaptic?.('light')
  }

  const onEmptyCol = (ti: number) => {
    if (selected) tryMoveToTableau(ti)
  }

  return (
    <div className="solitaire">
      <p className={`game-status ${won ? 'win' : ''}`}>{status}</p>
      <div className="sol-top">
        <div className="sol-stock">
          <div
            className="sol-slot"
            onClick={drawStock}
            onKeyDown={(e) => e.key === 'Enter' && drawStock()}
            role="button"
            tabIndex={0}
            aria-label="Колода"
          >
            {stock.length > 0 ? <PlayingCard faceDown /> : null}
          </div>
          <div
            className="sol-slot"
            onClick={onWasteClick}
            onKeyDown={(e) => e.key === 'Enter' && onWasteClick()}
            role="button"
            tabIndex={0}
            aria-label="Сброс"
          >
            {waste.length > 0 && (
              <PlayingCard
                card={waste[waste.length - 1]}
                selected={selected?.where === 'waste'}
              />
            )}
          </div>
        </div>
        <div className="sol-foundations">
          {foundations.map((pile, fi) => (
            <div
              key={fi}
              className="sol-slot"
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
                />
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="sol-tableau">
        {tableau.map((col, ti) => (
          <div
            key={ti}
            className="sol-col"
            style={{ minHeight: 24 + col.length * 18 }}
            onClick={() => {
              if (!col.length) onEmptyCol(ti)
            }}
          >
            {col.length === 0 && <div className="sol-slot" style={{ width: '100%', height: 'auto', aspectRatio: '5/7' }} />}
            {col.map((card, index) => {
              const up = faceUp.has(card.id)
              const isSel =
                selected?.where === 'tableau' && selected.col === ti && index >= selected.index
              return (
                <PlayingCard
                  key={card.id}
                  card={card}
                  faceDown={!up}
                  selected={!!isSel}
                  playable={up}
                  index={index}
                  onClick={() => onTableauClick(ti, index)}
                  style={{ top: index * 18 }}
                />
              )
            })}
          </div>
        ))}
      </div>
      <div className="action-bar">
        <button type="button" className="btn btn-soft" onClick={reset}>
          Новая раздача
        </button>
        {selected && (
          <button
            type="button"
            className="btn btn-accent"
            onClick={() => {
              for (let f = 0; f < 4; f += 1) {
                if (tryMoveToFoundation(f)) return
              }
              setStatus('На фундамент не ложится')
            }}
          >
            В дом
          </button>
        )}
      </div>
    </div>
  )
}
