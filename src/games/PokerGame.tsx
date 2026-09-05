import { useCallback, useMemo, useState } from 'react'
import { PlayingCard } from '../components/PlayingCard'
import {
  type Card,
  type Rank,
  POKER_RANKS,
  makeDeck,
  shuffle,
  rankValue,
} from '../lib/cards'

type Phase = 'betting' | 'flop' | 'turn' | 'river' | 'showdown' | 'over'

type HandRank = {
  score: number
  label: string
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
      if (uniq[i] - uniq[i + 4] === 4) {
        isStraight = true
        straightHigh = uniq[i]
        break
      }
    }
    // Wheel A-5
    if (!isStraight && uniq.includes(12) && uniq.includes(0) && uniq.includes(1) && uniq.includes(2) && uniq.includes(3)) {
      isStraight = true
      straightHigh = 3
    }
  }

  const best5 = (vals: number[]) => vals.slice(0, 5)

  if (isStraight && isFlush) return { score: 8000 + straightHigh, label: 'Стрит-флеш' }
  if (groups[0][1] === 4) {
    return { score: 7000 + groups[0][0] * 20 + (groups[1]?.[0] ?? 0), label: 'Каре' }
  }
  if (groups[0][1] === 3 && groups[1]?.[1] === 2) {
    return { score: 6000 + groups[0][0] * 20 + groups[1][0], label: 'Фулл-хаус' }
  }
  if (isFlush) return { score: 5000 + best5(values).reduce((a, b) => a * 15 + b, 0) / 1e6, label: 'Флеш' }
  if (isStraight) return { score: 4000 + straightHigh, label: 'Стрит' }
  if (groups[0][1] === 3) {
    const kickers = values.filter((v) => v !== groups[0][0])
    return { score: 3000 + groups[0][0] * 50 + kickers[0], label: 'Тройка' }
  }
  if (groups[0][1] === 2 && groups[1]?.[1] === 2) {
    const high = Math.max(groups[0][0], groups[1][0])
    const low = Math.min(groups[0][0], groups[1][0])
    const kicker = values.find((v) => v !== high && v !== low) ?? 0
    return { score: 2000 + high * 40 + low * 2 + kicker * 0.01, label: 'Две пары' }
  }
  if (groups[0][1] === 2) {
    const kickers = values.filter((v) => v !== groups[0][0])
    return { score: 1000 + groups[0][0] * 50 + kickers[0], label: 'Пара' }
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
            const hand = evaluate([all[a], all[b], all[c], all[d], all[e]])
            if (hand.score > best.score) best = hand
          }
        }
      }
    }
  }
  return best
}

function deal(): {
  deck: Card[]
  player: Card[]
  bot: Card[]
} {
  const deck = shuffle(makeDeck(POKER_RANKS as Rank[]))
  return {
    player: [deck.pop()!, deck.pop()!],
    bot: [deck.pop()!, deck.pop()!],
    deck,
  }
}

export function PokerGame({ onHaptic }: { onHaptic?: (t?: 'light' | 'medium' | 'success' | 'error') => void }) {
  const initial = useMemo(() => deal(), [])
  const [deck, setDeck] = useState(initial.deck)
  const [player, setPlayer] = useState(initial.player)
  const [bot, setBot] = useState(initial.bot)
  const [board, setBoard] = useState<Card[]>([])
  const [phase, setPhase] = useState<Phase>('betting')
  const [pot, setPot] = useState(30)
  const [stack, setStack] = useState(970)
  const [botStack, setBotStack] = useState(970)
  const [showBot, setShowBot] = useState(false)
  const [status, setStatus] = useState('Ваш ход. Чек или ставка 20?')
  const [resultClass, setResultClass] = useState('')

  const reset = useCallback(() => {
    const next = deal()
    setDeck(next.deck)
    setPlayer(next.player)
    setBot(next.bot)
    setBoard([])
    setPhase('betting')
    setPot(30)
    setStack((s) => Math.max(0, s - 15))
    setBotStack((s) => Math.max(0, s - 15))
    setShowBot(false)
    setStatus('Блайнды поставлены. Чек или ставка 20?')
    setResultClass('')
    onHaptic?.('medium')
  }, [onHaptic])

  const advanceBoard = useCallback(
    (from: Phase, d: Card[]) => {
      const copy = [...d]
      if (from === 'betting') {
        copy.pop() // burn
        const flop = [copy.pop()!, copy.pop()!, copy.pop()!]
        setBoard(flop)
        setDeck(copy)
        setPhase('flop')
        setStatus('Флоп. Чек или ставка 40?')
      } else if (from === 'flop') {
        copy.pop()
        setBoard((b) => [...b, copy.pop()!])
        setDeck(copy)
        setPhase('turn')
        setStatus('Тёрн. Чек или ставка 60?')
      } else if (from === 'turn') {
        copy.pop()
        setBoard((b) => [...b, copy.pop()!])
        setDeck(copy)
        setPhase('river')
        setStatus('Ривер. Чек или ставка 80?')
      } else {
        finish(copy)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const finish = (currentBoard?: Card[]) => {
    const b = currentBoard ?? board
    setShowBot(true)
    setPhase('over')
    const p = bestHand(player, b.length ? b : board)
    const o = bestHand(bot, b.length ? b : board)
    if (p.score > o.score) {
      setStack((s) => s + pot)
      setStatus(`Победа! ${p.label} бьёт ${o.label}. +${pot}`)
      setResultClass('win')
      onHaptic?.('success')
    } else if (p.score < o.score) {
      setStatus(`Поражение. У бота ${o.label}, у вас ${p.label}.`)
      setResultClass('lose')
      onHaptic?.('error')
    } else {
      setStack((s) => s + Math.floor(pot / 2))
      setBotStack((s) => s + Math.floor(pot / 2))
      setStatus(`Ничья: ${p.label}. Банк пополам.`)
      setResultClass('')
    }
  }

  const check = () => {
    if (phase === 'over' || phase === 'showdown') return
    onHaptic?.('light')
    // Bot sometimes bets
    if (Math.random() < 0.25 && phase !== 'river') {
      const bet = phase === 'betting' ? 20 : phase === 'flop' ? 40 : 60
      if (stack >= bet && botStack >= bet) {
        setPot((p) => p + bet * 2)
        setStack((s) => s - bet)
        setBotStack((s) => s - bet)
        setStatus(`Бот поднял на ${bet}. Добор автоматом.`)
      }
    }
    if (phase === 'river') {
      finish()
    } else {
      advanceBoard(phase, deck)
    }
  }

  const bet = () => {
    if (phase === 'over') return
    const amount = phase === 'betting' ? 20 : phase === 'flop' ? 40 : phase === 'turn' ? 60 : 80
    if (stack < amount || botStack < amount) {
      setStatus('Недостаточно фишек — чек.')
      return
    }
    onHaptic?.('medium')
    setPot((p) => p + amount * 2)
    setStack((s) => s - amount)
    setBotStack((s) => s - amount)
    setStatus(`Ставка ${amount}. Бот коллирует.`)
    if (phase === 'river') {
      setTimeout(() => finish(), 300)
    } else {
      setTimeout(() => advanceBoard(phase, deck), 300)
    }
  }

  const fold = () => {
    if (phase === 'over') return
    setPhase('over')
    setBotStack((s) => s + pot)
    setStatus('Вы сбросили. Банк уходит боту.')
    setResultClass('lose')
    onHaptic?.('error')
  }

  return (
    <div className="table-area">
      <p className={`game-status ${resultClass}`}>{status}</p>
      <div className="felt">
        <div className="pot-info">
          <span>Вы: {stack}</span>
          <span className="chip-stack">
            <span className="chip" />
            Банк {pot}
          </span>
          <span>Бот: {botStack}</span>
        </div>
        <div className="hand compact">
          {bot.map((c, i) => (
            <PlayingCard key={c.id} card={c} faceDown={!showBot} index={i} />
          ))}
        </div>
        <div className="community">
          {board.length === 0 && <span style={{ opacity: 0.5 }}>Общие карты появятся здесь</span>}
          {board.map((c, i) => (
            <PlayingCard key={c.id} card={c} className="compact" index={i} />
          ))}
        </div>
      </div>
      <div className="hand">
        {player.map((c, i) => (
          <PlayingCard key={c.id} card={c} index={i} />
        ))}
      </div>
      <div className="action-bar">
        {phase !== 'over' ? (
          <>
            <button type="button" className="btn btn-soft" onClick={check}>
              Чек
            </button>
            <button type="button" className="btn btn-primary" onClick={bet}>
              Ставка
            </button>
            <button type="button" className="btn btn-danger" onClick={fold}>
              Фолд
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-primary" onClick={reset}>
            Новая раздача
          </button>
        )}
      </div>
    </div>
  )
}
