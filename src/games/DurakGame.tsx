import { useCallback, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PlayingCard } from '../components/PlayingCard'
import {
  type Card,
  type Rank,
  DURAK_RANKS,
  SUITS,
  makeDeck,
  shuffle,
  rankValue,
} from '../lib/cards'

type TablePair = { attack: Card; defence?: Card }

type DragState = {
  card: Card
  pointerId: number
  startX: number
  startY: number
  x: number
  y: number
  width: number
  height: number
  grabX: number
  grabY: number
  active: boolean
  overTable: boolean
}


function beats(a: Card, b: Card, trump: Card['suit']): boolean {
  if (a.suit === b.suit) return rankValue(a.rank, DURAK_RANKS) > rankValue(b.rank, DURAK_RANKS)
  if (a.suit === trump && b.suit !== trump) return true
  return false
}

function canDefend(card: Card, attack: Card, trump: Card['suit']): boolean {
  return beats(card, attack, trump)
}

/** Low → high by rank; same rank by suit; trumps always on the right. */
function sortHand(hand: Card[], trump: Card['suit']): Card[] {
  return [...hand].sort((a, b) => {
    const aTrump = a.suit === trump ? 1 : 0
    const bTrump = b.suit === trump ? 1 : 0
    if (aTrump !== bTrump) return aTrump - bTrump
    const byRank = rankValue(a.rank, DURAK_RANKS) - rankValue(b.rank, DURAK_RANKS)
    if (byRank !== 0) return byRank
    return SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit)
  })
}

function dealDurak() {
  const deck = shuffle(makeDeck(DURAK_RANKS))
  const player: Card[] = []
  const bot: Card[] = []
  for (let i = 0; i < 6; i += 1) {
    player.push(deck.pop()!)
    bot.push(deck.pop()!)
  }
  const trumpCard = deck[0]
  const trump = trumpCard.suit
  return { deck, player: sortHand(player, trump), bot, trump, trumpCard }
}

function refill(hand: Card[], deck: Card[], n = 6): { hand: Card[]; deck: Card[] } {
  const h = [...hand]
  const d = [...deck]
  while (h.length < n && d.length > 0) {
    h.push(d.pop()!)
  }
  return { hand: h, deck: d }
}

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const THROW_MS = 900

export function DurakGame({
  onHaptic,
}: {
  onHaptic?: (t?: 'light' | 'medium' | 'success' | 'error') => void
}) {
  const initial = useMemo(() => dealDurak(), [])
  const [deck, setDeck] = useState(initial.deck)
  const [player, setPlayer] = useState(initial.player)
  const [bot, setBot] = useState(initial.bot)
  const [trump] = useState(initial.trump)
  const [trumpCard] = useState(initial.trumpCard)
  const [table, setTable] = useState<TablePair[]>([])
  const [attacker, setAttacker] = useState<'player' | 'bot'>('player')
  const [status, setStatus] = useState('Ваш ход — ходите картой')
  const [over, setOver] = useState<'win' | 'lose' | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [enterMap, setEnterMap] = useState<Record<string, 'throw-player' | 'throw-bot'>>({})
  const [throwingId, setThrowingId] = useState<string | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const fieldRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const skipClickRef = useRef(false)


  const ranksOnTable = useMemo(() => {
    const ranks = new Set<Rank>()
    for (const p of table) {
      ranks.add(p.attack.rank)
      if (p.defence) ranks.add(p.defence.rank)
    }
    return ranks
  }, [table])

  const checkEnd = (pHand: Card[], bHand: Card[], dLen: number) => {
    if (pHand.length === 0 && dLen === 0) {
      setOver('win')
      setStatus('Победа! Вы скинули все карты.')
      onHaptic?.('success')
      return true
    }
    if (bHand.length === 0 && dLen === 0) {
      setOver('lose')
      setStatus('Бот скинул все карты. Вы — дурак.')
      onHaptic?.('error')
      return true
    }
    return false
  }

  const drawUp = (pHand: Card[], bHand: Card[], d: Card[], first: 'player' | 'bot') => {
    let deckNow = d
    let playerNow = pHand
    let botNow = bHand
    if (first === 'player') {
      ;({ hand: playerNow, deck: deckNow } = refill(playerNow, deckNow))
      ;({ hand: botNow, deck: deckNow } = refill(botNow, deckNow))
    } else {
      ;({ hand: botNow, deck: deckNow } = refill(botNow, deckNow))
      ;({ hand: playerNow, deck: deckNow } = refill(playerNow, deckNow))
    }
    playerNow = sortHand(playerNow, trump)
    setPlayer(playerNow)
    setBot(botNow)
    setDeck(deckNow)
    return { playerNow, botNow, deckNow }
  }

  const botDefend = (attack: Card, botHand: Card[]): Card | null => {
    const options = botHand
      .filter((c) => canDefend(c, attack, trump))
      .sort((a, b) => {
        const aT = a.suit === trump ? 1 : 0
        const bT = b.suit === trump ? 1 : 0
        if (aT !== bT) return aT - bT
        return rankValue(a.rank, DURAK_RANKS) - rankValue(b.rank, DURAK_RANKS)
      })
    return options[0] ?? null
  }

  const botAttackCard = (botHand: Card[], allowed?: Set<Rank>): Card | null => {
    const pool = allowed ? botHand.filter((c) => allowed.has(c.rank)) : [...botHand]
    if (pool.length === 0) return null
    pool.sort((a, b) => {
      const aT = a.suit === trump ? 1 : 0
      const bT = b.suit === trump ? 1 : 0
      if (aT !== bT) return aT - bT
      return rankValue(a.rank, DURAK_RANKS) - rankValue(b.rank, DURAK_RANKS)
    })
    return pool[0]
  }

  const waitThrow = async () => {
    if (!prefersReducedMotion()) await sleep(THROW_MS)
  }

  const leaveHand = async (cardId: string) => {
    if (prefersReducedMotion()) return
    setThrowingId(cardId)
    await sleep(180)
    setThrowingId(null)
  }

  const reset = useCallback(() => {
    const next = dealDurak()
    setDeck(next.deck)
    setPlayer(next.player)
    setBot(next.bot)
    setTable([])
    setAttacker('player')
    setStatus('Ваш ход — ходите картой')
    setOver(null)
    setSelected(null)
    setBusy(false)
    setThrowingId(null)
    setEnterMap({})
    onHaptic?.('medium')
  }, [onHaptic])

  const playPlayerAttack = async (card: Card) => {
    if (over || attacker !== 'player' || busy) return
    if (table.length > 0 && !ranksOnTable.has(card.rank)) {
      setStatus('Можно подкидывать только уже лежащие ранги')
      return
    }
    if (table.length >= 6) return

    setBusy(true)
    setSelected(null)

    const newPlayer = player.filter((c) => c.id !== card.id)
    await leaveHand(card.id)
    setPlayer(newPlayer)
    setEnterMap((m) => ({ ...m, [card.id]: 'throw-player' }))
    setTable([...table, { attack: card }])
    await waitThrow()

    const defence = botDefend(card, bot)
    if (!defence) {
      const taken = [
        ...bot,
        card,
        ...table.flatMap((p) => (p.defence ? [p.attack, p.defence] : [p.attack])),
      ]
      setBot(taken)
      setTable([])
      setEnterMap({})
      const drawn = drawUp(newPlayer, taken, deck, 'player')
      if (!checkEnd(drawn.playerNow, drawn.botNow, drawn.deckNow.length)) {
        setAttacker('player')
        setStatus('Бот взял карты. Ходите снова.')
      }
      setBusy(false)
      return
    }

    await sleep(140)
    const newBot = bot.filter((c) => c.id !== defence.id)
    setBot(newBot)
    setEnterMap((m) => ({ ...m, [defence.id]: 'throw-bot' }))
    setTable((t) => t.map((p) => (p.attack.id === card.id ? { ...p, defence } : p)))
    await waitThrow()
    setStatus('Отбил. Подкиньте ещё или бито.')
    setBusy(false)
  }

  const playerDefend = async (card: Card) => {
    if (over || attacker !== 'bot' || busy) return
    const open = table.find((p) => !p.defence)
    if (!open) return
    if (!canDefend(card, open.attack, trump)) {
      setStatus('Этой картой не отбиться')
      onHaptic?.('error')
      return
    }

    setBusy(true)
    setSelected(null)

    const newPlayer = player.filter((c) => c.id !== card.id)
    await leaveHand(card.id)
    setPlayer(newPlayer)
    setEnterMap((m) => ({ ...m, [card.id]: 'throw-player' }))
    const newTable = table.map((p) =>
      p.attack.id === open.attack.id ? { ...p, defence: card } : p,
    )
    setTable(newTable)
    await waitThrow()

    const ranks = new Set<Rank>()
    for (const p of newTable) {
      ranks.add(p.attack.rank)
      if (p.defence) ranks.add(p.defence.rank)
    }
    const toss = botAttackCard(
      bot.filter((c) => !newTable.some((p) => p.attack.id === c.id || p.defence?.id === c.id)),
      ranks,
    )
    if (toss && newTable.length < 6 && newPlayer.length > 0) {
      await sleep(140)
      const newerBot = bot.filter((c) => c.id !== toss.id)
      setBot(newerBot)
      setEnterMap((m) => ({ ...m, [toss.id]: 'throw-bot' }))
      setTable([...newTable, { attack: toss }])
      await waitThrow()
      setStatus('Бот подкинул. Отбейтесь!')
    } else {
      setStatus('Отбились. Нажмите «Бито».')
    }
    setBusy(false)
  }

  const pointInTable = (x: number, y: number) => {
    const el = fieldRef.current
    if (!el) return false
    const r = el.getBoundingClientRect()
    // Expand hit area a bit toward the hand so drops feel forgiving.
    return x >= r.left - 8 && x <= r.right + 8 && y >= r.top - 12 && y <= r.bottom + 36
  }

  const playCard = (card: Card) => {
    if (over || busy) return
    if (attacker === 'player') void playPlayerAttack(card)
    else void playerDefend(card)
  }

  const onCardClick = (card: Card) => {
    if (skipClickRef.current) {
      skipClickRef.current = false
      return
    }
    playCard(card)
  }

  const onCardPointerDown = (card: Card, e: React.PointerEvent<HTMLButtonElement>) => {
    if (over || busy || e.button !== 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const next: DragState = {
      card,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      grabX: e.clientX - rect.left,
      grabY: e.clientY - rect.top,
      active: false,
      overTable: false,
    }
    dragRef.current = next
    setDrag(next)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onCardPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    const dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY)
    const active = d.active || dist > 12
    const overTable = active && pointInTable(e.clientX, e.clientY)
    const next: DragState = {
      ...d,
      active,
      overTable,
      x: e.clientX - d.grabX,
      y: e.clientY - d.grabY,
    }
    dragRef.current = next
    setDrag(next)
  }

  const endCardPointer = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    const shouldPlay = d.active && d.overTable
    if (d.active) skipClickRef.current = true
    dragRef.current = null
    setDrag(null)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
    if (shouldPlay) {
      playCard(d.card)
    }
  }

  const placeBotAttack = async (atk: Card, botHand: Card[], message: string) => {
    setBusy(true)
    const nextBot = botHand.filter((c) => c.id !== atk.id)
    setBot(nextBot)
    setEnterMap((m) => ({ ...m, [atk.id]: 'throw-bot' }))
    setTable([{ attack: atk }])
    await waitThrow()
    setStatus(message)
    setBusy(false)
  }

  const takeCards = () => {
    if (over || attacker !== 'bot' || busy) return
    const taken = sortHand(
      [
        ...player,
        ...table.flatMap((p) => (p.defence ? [p.attack, p.defence] : [p.attack])),
      ],
      trump,
    )
    setPlayer(taken)
    setTable([])
    setEnterMap({})
    onHaptic?.('medium')
    const drawn = drawUp(taken, bot, deck, 'bot')
    if (!checkEnd(drawn.playerNow, drawn.botNow, drawn.deckNow.length)) {
      setAttacker('bot')
      const atk = botAttackCard(drawn.botNow)
      if (atk) {
        void (async () => {
          await sleep(180)
          await placeBotAttack(atk, drawn.botNow, 'Вы взяли. Бот ходит снова — отбейтесь!')
        })()
      }
    }
  }

  const bito = () => {
    if (over || busy) return
    if (table.length === 0 || table.some((p) => !p.defence)) {
      setStatus('Сначала закройте все атаки')
      return
    }
    onHaptic?.('medium')
    setTable([])
    setEnterMap({})
    const first = attacker
    const nextAttacker = attacker === 'player' ? 'bot' : 'player'
    const drawn = drawUp(player, bot, deck, first)
    if (checkEnd(drawn.playerNow, drawn.botNow, drawn.deckNow.length)) return
    setAttacker(nextAttacker)
    if (nextAttacker === 'bot') {
      const atk = botAttackCard(drawn.botNow)
      if (atk) {
        void (async () => {
          await sleep(200)
          await placeBotAttack(atk, drawn.botNow, 'Ход бота — отбейтесь картой')
        })()
      }
    } else {
      setStatus('Ваш ход — ходите картой')
    }
  }

  const startBotAttackIfNeeded = () => {
    if (busy || attacker !== 'bot' || table.length !== 0 || over) return
    const atk = botAttackCard(bot)
    if (!atk) return
    void placeBotAttack(atk, bot, 'Ход бота — отбейтесь картой')
  }

  const enterFor = (id: string, fallback: 'throw-player' | 'throw-bot' | 'deal' = 'deal') =>
    enterMap[id] ?? fallback

  const canBito =
    !busy && table.length > 0 && table.every((p) => p.defence) && (attacker === 'player' || attacker === 'bot')
  const canTake = !busy && !over && attacker === 'bot' && table.some((p) => !p.defence)
  const deckLayers = Math.min(5, Math.max(1, Math.ceil(deck.length / 6)))
  const playerHand = useMemo(() => sortHand(player, trump), [player, trump])

  return (
    <div
      className={`durak-table ${over ? `is-${over}` : ''}`}
      onClick={startBotAttackIfNeeded}
    >
      <div className="durak-trump-mark" aria-hidden>
        {trump}
      </div>

      <header className="durak-top">
        <div className={`durak-seat ${attacker === 'bot' ? 'is-active' : ''}`}>
          <div className="durak-avatar bot-avatar" aria-hidden>
            🤖
          </div>
          <div className="durak-seat-meta">
            <span className="durak-name">Бот</span>
            <span className="durak-pill">{bot.length}</span>
          </div>
          <div className="durak-bot-cards" aria-hidden>
            {bot.slice(0, Math.min(bot.length, 6)).map((c, i) => (
              <span
                key={c.id}
                className="durak-mini-back"
                style={{ ['--i' as string]: i, ['--n' as string]: Math.min(bot.length, 6) }}
              />
            ))}
          </div>
        </div>
        <p className={`durak-status ${over === 'win' ? 'win' : over === 'lose' ? 'lose' : ''}`}>
          {status}
        </p>
      </header>

      <div ref={fieldRef} className="durak-field">
        <div className="durak-table-cards">
          {table.length === 0 && <span className="durak-empty">Ход картой</span>}
          {table.map((p) => (
            <div className="durak-pair" key={p.attack.id}>
              <PlayingCard
                card={p.attack}
                rankStyle="ru"
                enter={enterFor(p.attack.id, 'throw-bot')}
                className="durak-card"
              />
              {p.defence && (
                <PlayingCard
                  card={p.defence}
                  rankStyle="ru"
                  enter={enterFor(p.defence.id, 'throw-player')}
                  className="durak-card durak-defence"
                />
              )}
            </div>
          ))}
        </div>

        <div className="durak-deck" aria-label={`Колода: ${deck.length}`}>
          {/* Trump under the stack — half visible, like a real Durak table */}
          {deck.length > 0 && (
            <PlayingCard card={trumpCard} rankStyle="ru" className="durak-trump-card" enter="none" />
          )}
          {Array.from({ length: deckLayers }).map((_, i) => (
            <span key={i} className="durak-deck-layer" style={{ ['--i' as string]: i }} />
          ))}
          <span className="durak-deck-count">{deck.length}</span>
        </div>
      </div>

      <div className="durak-actions" onClick={(e) => e.stopPropagation()}>
        {over ? (
          <button type="button" className="durak-btn durak-btn-primary" onClick={reset}>
            Ещё раз
          </button>
        ) : (
          <>
            {canTake && (
              <button type="button" className="durak-btn durak-btn-take" onClick={takeCards}>
                Беру
              </button>
            )}
            {canBito && (
              <button type="button" className="durak-btn durak-btn-bito" onClick={bito}>
                Бито
              </button>
            )}
          </>
        )}
      </div>

      <footer className="durak-bottom" onClick={(e) => e.stopPropagation()}>
        <div className={`durak-hand${drag?.active ? ' is-dragging' : ''}`} data-count={playerHand.length}>
          {playerHand.map((c, i) => {
            const n = playerHand.length
            const mid = (n - 1) / 2
            const offset = i - mid
            const isDrag = drag?.card.id === c.id && drag.active
            return (
              <PlayingCard
                key={c.id}
                card={c}
                index={i}
                rankStyle="ru"
                selected={selected === c.id}
                playable={!over && !busy}
                throwing={throwingId === c.id}
                className={`durak-card durak-hand-card${isDrag ? ' is-drag-source' : ''}`}
                style={{
                  ['--fan' as string]: offset,
                  ['--rot' as string]: `${offset * 3.2}deg`,
                  zIndex: isDrag ? 50 : throwingId === c.id ? 30 : i + 1,
                  touchAction: 'none',
                }}
                onClick={() => onCardClick(c)}
                onPointerDown={(e) => onCardPointerDown(c, e)}
                onPointerMove={onCardPointerMove}
                onPointerUp={endCardPointer}
                onPointerCancel={endCardPointer}
              />
            )
          })}
        </div>
        <div className="durak-dock">
          <div className={`durak-seat player ${attacker === 'player' ? 'is-active' : ''}`}>
            <div className="durak-avatar you-avatar" aria-hidden>
              👤
            </div>
            <span className="durak-name">Вы</span>
            <span className="durak-pill">{playerHand.length}</span>
          </div>
        </div>
      </footer>

      {drag?.active &&
        createPortal(
          <div
            className="durak-drag-ghost"
            style={{
              left: drag.x,
              top: drag.y,
              width: drag.width,
              height: drag.height,
            }}
            aria-hidden
          >
            <PlayingCard card={drag.card} rankStyle="ru" enter="none" className="durak-card" />
          </div>,
          document.body,
        )}

    </div>
  )
}
