import { useCallback, useMemo, useState } from 'react'
import { PlayingCard } from '../components/PlayingCard'
import {
  type Card,
  type Rank,
  DURAK_RANKS,
  makeDeck,
  shuffle,
  rankValue,
} from '../lib/cards'

type TablePair = { attack: Card; defence?: Card }

function beats(a: Card, b: Card, trump: Card['suit']): boolean {
  const order = DURAK_RANKS
  if (a.suit === b.suit) return rankValue(a.rank, order) > rankValue(b.rank, order)
  if (a.suit === trump && b.suit !== trump) return true
  return false
}

function canDefend(card: Card, attack: Card, trump: Card['suit']): boolean {
  return beats(card, attack, trump)
}

function dealDurak() {
  const deck = shuffle(makeDeck(DURAK_RANKS as Rank[]))
  const player: Card[] = []
  const bot: Card[] = []
  for (let i = 0; i < 6; i += 1) {
    player.push(deck.pop()!)
    bot.push(deck.pop()!)
  }
  const trumpCard = deck[0]
  return { deck, player, bot, trump: trumpCard.suit, trumpCard }
}

function refill(hand: Card[], deck: Card[], n = 6): { hand: Card[]; deck: Card[] } {
  const h = [...hand]
  const d = [...deck]
  while (h.length < n && d.length > 0) {
    h.push(d.pop()!)
  }
  return { hand: h, deck: d }
}

export function DurakGame({ onHaptic }: { onHaptic?: (t?: 'light' | 'medium' | 'success' | 'error') => void }) {
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
    const pool = allowed
      ? botHand.filter((c) => allowed.has(c.rank))
      : [...botHand]
    if (pool.length === 0) return null
    pool.sort((a, b) => {
      const aT = a.suit === trump ? 1 : 0
      const bT = b.suit === trump ? 1 : 0
      if (aT !== bT) return aT - bT
      return rankValue(a.rank, DURAK_RANKS) - rankValue(b.rank, DURAK_RANKS)
    })
    return pool[0]
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
    onHaptic?.('medium')
  }, [onHaptic])

  const playPlayerAttack = (card: Card) => {
    if (over || attacker !== 'player') return
    if (table.length > 0 && !ranksOnTable.has(card.rank)) {
      setStatus('Можно подкидывать только уже лежащие ранги')
      return
    }
    if (table.length >= 6) return

    const newPlayer = player.filter((c) => c.id !== card.id)
    const defence = botDefend(card, bot)
    onHaptic?.('light')

    if (!defence) {
      const taken = [...bot, card, ...table.flatMap((p) => (p.defence ? [p.attack, p.defence] : [p.attack]))]
      setBot(taken)
      setPlayer(newPlayer)
      setTable([])
      const drawn = drawUp(newPlayer, taken, deck, 'player')
      if (!checkEnd(drawn.playerNow, drawn.botNow, drawn.deckNow.length)) {
        setAttacker('player')
        setStatus('Бот взял карты. Ходите снова.')
      }
      return
    }

    const newBot = bot.filter((c) => c.id !== defence.id)
    const newTable = [...table, { attack: card, defence }]
    setPlayer(newPlayer)
    setBot(newBot)
    setTable(newTable)
    setStatus('Отбил. Подкиньте ещё или бито.')
    setSelected(null)
  }

  const playerDefend = (card: Card) => {
    if (over || attacker !== 'bot') return
    const open = table.find((p) => !p.defence)
    if (!open) return
    if (!canDefend(card, open.attack, trump)) {
      setStatus('Этой картой не отбиться')
      onHaptic?.('error')
      return
    }
    onHaptic?.('light')
    const newPlayer = player.filter((c) => c.id !== card.id)
    const newTable = table.map((p) => (p === open ? { ...p, defence: card } : p))
    setPlayer(newPlayer)
    setTable(newTable)

    // Bot may toss more
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
      const newerBot = bot.filter((c) => c.id !== toss.id)
      setBot(newerBot)
      setTable([...newTable, { attack: toss }])
      setStatus('Бот подкинул. Отбейтесь!')
    } else {
      setStatus('Отбились. Нажмите «Бито», чтобы завершить.')
    }
  }

  const onCardClick = (card: Card) => {
    if (over) return
    if (attacker === 'player') {
      playPlayerAttack(card)
    } else {
      setSelected(card.id)
      playerDefend(card)
    }
  }

  const takeCards = () => {
    if (over || attacker !== 'bot') return
    const taken = [
      ...player,
      ...table.flatMap((p) => (p.defence ? [p.attack, p.defence] : [p.attack])),
    ]
    setPlayer(taken)
    setTable([])
    onHaptic?.('medium')
    const drawn = drawUp(taken, bot, deck, 'bot')
    if (!checkEnd(drawn.playerNow, drawn.botNow, drawn.deckNow.length)) {
      setAttacker('bot')
      // Bot attacks again
      const atk = botAttackCard(drawn.botNow)
      if (atk) {
        setBot(drawn.botNow.filter((c) => c.id !== atk.id))
        setTable([{ attack: atk }])
        setStatus('Вы взяли. Бот ходит снова — отбейтесь!')
      }
    }
  }

  const bito = () => {
    if (over) return
    if (table.length === 0 || table.some((p) => !p.defence)) {
      setStatus('Сначала закройте все атаки')
      return
    }
    onHaptic?.('medium')
    setTable([])
    const first = attacker
    const nextAttacker = attacker === 'player' ? 'bot' : 'player'
    const drawn = drawUp(player, bot, deck, first)
    if (checkEnd(drawn.playerNow, drawn.botNow, drawn.deckNow.length)) return
    setAttacker(nextAttacker)
    if (nextAttacker === 'bot') {
      const atk = botAttackCard(drawn.botNow)
      if (atk) {
        setBot(drawn.botNow.filter((c) => c.id !== atk.id))
        setTable([{ attack: atk }])
        setStatus('Ход бота — отбейтесь картой')
      }
    } else {
      setStatus('Ваш ход — ходите картой')
    }
  }

  const startBotAttackIfNeeded = () => {
    if (attacker === 'bot' && table.length === 0 && !over) {
      const atk = botAttackCard(bot)
      if (atk) {
        setBot((b) => b.filter((c) => c.id !== atk.id))
        setTable([{ attack: atk }])
        setStatus('Ход бота — отбейтесь картой')
      }
    }
  }

  // Kick off bot attack when role switches with empty table — handled in bito/take

  return (
    <div className="table-area" onClick={startBotAttackIfNeeded}>
      <p className={`game-status ${over === 'win' ? 'win' : over === 'lose' ? 'lose' : ''}`}>
        {status}
      </p>
      <div className="felt">
        <div className="pot-info">
          <span>Бот: {bot.length}</span>
          <span className="trump-badge">
            Козырь {trumpCard.rank}
            {trump}
          </span>
          <span>Колода: {deck.length}</span>
        </div>
        <div className="hand compact">
          {bot.map((c, i) => (
            <PlayingCard key={c.id} faceDown index={i} />
          ))}
        </div>
        <div className="table-cards">
          {table.length === 0 && <span style={{ opacity: 0.5 }}>Стол пуст</span>}
          {table.map((p) => (
            <div className="pair-stack" key={p.attack.id}>
              <PlayingCard card={p.attack} />
              {p.defence && <PlayingCard card={p.defence} />}
            </div>
          ))}
        </div>
      </div>
      <div className="hand">
        {player.map((c, i) => (
          <PlayingCard
            key={c.id}
            card={c}
            index={i}
            selected={selected === c.id}
            playable={!over}
            onClick={() => onCardClick(c)}
          />
        ))}
      </div>
      <div className="action-bar">
        {over ? (
          <button type="button" className="btn btn-primary" onClick={reset}>
            Ещё раз
          </button>
        ) : attacker === 'player' ? (
          <button type="button" className="btn btn-accent" onClick={bito} disabled={table.length === 0}>
            Бито
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-danger" onClick={takeCards}>
              Беру
            </button>
            <button
              type="button"
              className="btn btn-accent"
              onClick={bito}
              disabled={table.length === 0 || table.some((p) => !p.defence)}
            >
              Бито
            </button>
          </>
        )}
      </div>
    </div>
  )
}
