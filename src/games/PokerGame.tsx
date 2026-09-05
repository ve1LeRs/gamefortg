import { useCallback, useMemo, useRef, useState } from 'react'
import { PlayingCard } from '../components/PlayingCard'
import {
  type Card,
  type Rank,
  POKER_RANKS,
  makeDeck,
  shuffle,
  rankValue,
} from '../lib/cards'

type Phase = 'preflop' | 'flop' | 'turn' | 'river' | 'over'

type HandRank = {
  score: number
  label: string
}

const START_STACK = 1000
const BLIND = 15

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
    if (!isStraight && uniq.includes(12) && [0, 1, 2, 3].every((v) => uniq.includes(v))) {
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

function dealHole() {
  const deck = shuffle(makeDeck(POKER_RANKS as Rank[]))
  return {
    player: [deck.pop()!, deck.pop()!],
    bot: [deck.pop()!, deck.pop()!],
    deck,
  }
}

function postBlinds(playerStack: number, botStack: number) {
  const pBlind = Math.min(BLIND, playerStack)
  const bBlind = Math.min(BLIND, botStack)
  return {
    stack: playerStack - pBlind,
    botStack: botStack - bBlind,
    pot: pBlind + bBlind,
  }
}

function betSize(phase: Phase) {
  if (phase === 'preflop') return 20
  if (phase === 'flop') return 40
  if (phase === 'turn') return 60
  return 80
}

export function PokerGame({
  onHaptic,
}: {
  onHaptic?: (t?: 'light' | 'medium' | 'success' | 'error') => void
}) {
  const firstDeal = useMemo(() => dealHole(), [])
  const firstBlinds = useMemo(() => postBlinds(START_STACK, START_STACK), [])

  const [deck, setDeck] = useState(firstDeal.deck)
  const [player, setPlayer] = useState(firstDeal.player)
  const [bot, setBot] = useState(firstDeal.bot)
  const [board, setBoard] = useState<Card[]>([])
  const [phase, setPhase] = useState<Phase>('preflop')
  const [pot, setPot] = useState(firstBlinds.pot)
  const [stack, setStack] = useState(firstBlinds.stack)
  const [botStack, setBotStack] = useState(firstBlinds.botStack)
  const [showBot, setShowBot] = useState(false)
  const [status, setStatus] = useState(`Блайнды по ${BLIND}. Чек или ставка ${betSize('preflop')}?`)
  const [resultClass, setResultClass] = useState('')
  const [matchOver, setMatchOver] = useState(false)

  const totalChips = stack + botStack + pot
  const stackRef = useRef(stack)
  const botStackRef = useRef(botStack)
  stackRef.current = stack
  botStackRef.current = botStack

  const settlePot = useCallback((winner: 'player' | 'bot' | 'tie', potAmount: number) => {
    if (winner === 'player') {
      stackRef.current += potAmount
      setStack(stackRef.current)
    } else if (winner === 'bot') {
      botStackRef.current += potAmount
      setBotStack(botStackRef.current)
    } else {
      const half = Math.floor(potAmount / 2)
      stackRef.current += half
      botStackRef.current += potAmount - half
      setStack(stackRef.current)
      setBotStack(botStackRef.current)
    }
    setPot(0)
  }, [])

  const dealNextHand = useCallback(
    (playerStack: number, botChips: number) => {
      if (playerStack <= 0 || botChips <= 0) {
        setMatchOver(true)
        setPhase('over')
        setShowBot(false)
        setPot(0)
        setStack(Math.max(0, playerStack))
        setBotStack(Math.max(0, botChips))
        if (playerStack <= 0 && botChips <= 0) {
          setStatus('Фишки закончились у обоих.')
        } else if (playerStack <= 0) {
          setStatus('У вас закончились фишки. Бот забрал стол.')
          setResultClass('lose')
        } else {
          setStatus('У бота закончились фишки. Вы выиграли стол!')
          setResultClass('win')
        }
        return
      }

      const hole = dealHole()
      const blinds = postBlinds(playerStack, botChips)
      setDeck(hole.deck)
      setPlayer(hole.player)
      setBot(hole.bot)
      setBoard([])
      setPhase('preflop')
      setPot(blinds.pot)
      setStack(blinds.stack)
      setBotStack(blinds.botStack)
      setShowBot(false)
      setResultClass('')
      setMatchOver(false)
      setStatus(`Блайнды по ${BLIND}. Чек или ставка ${betSize('preflop')}?`)
      onHaptic?.('medium')
    },
    [onHaptic],
  )

  const resetMatch = useCallback(() => {
    dealNextHand(START_STACK, START_STACK)
  }, [dealNextHand])

  const nextHand = useCallback(() => {
    dealNextHand(stackRef.current, botStackRef.current)
  }, [dealNextHand])

  const showdown = useCallback(
    (community: Card[], potAmount: number, playerHole: Card[], botHole: Card[]) => {
      setShowBot(true)
      setPhase('over')
      const p = bestHand(playerHole, community)
      const o = bestHand(botHole, community)
      if (p.score > o.score) {
        settlePot('player', potAmount)
        setStatus(`Победа! ${p.label} бьёт ${o.label}. +${potAmount}`)
        setResultClass('win')
        onHaptic?.('success')
      } else if (p.score < o.score) {
        settlePot('bot', potAmount)
        setStatus(`Поражение. У бота ${o.label}, у вас ${p.label}. −банк`)
        setResultClass('lose')
        onHaptic?.('error')
      } else {
        settlePot('tie', potAmount)
        setStatus(`Ничья: ${p.label}. Банк пополам.`)
        setResultClass('')
        onHaptic?.('medium')
      }
    },
    [onHaptic, settlePot],
  )

  const advance = useCallback(
    (
      from: Phase,
      currentDeck: Card[],
      currentBoard: Card[],
      potAmount: number,
      playerHole: Card[],
      botHole: Card[],
    ) => {
      const copy = [...currentDeck]
      if (from === 'preflop') {
        copy.pop()
        const flop = [copy.pop()!, copy.pop()!, copy.pop()!]
        setBoard(flop)
        setDeck(copy)
        setPhase('flop')
        setStatus(`Флоп. Чек или ставка ${betSize('flop')}?`)
      } else if (from === 'flop') {
        copy.pop()
        const nextBoard = [...currentBoard, copy.pop()!]
        setBoard(nextBoard)
        setDeck(copy)
        setPhase('turn')
        setStatus(`Тёрн. Чек или ставка ${betSize('turn')}?`)
      } else if (from === 'turn') {
        copy.pop()
        const nextBoard = [...currentBoard, copy.pop()!]
        setBoard(nextBoard)
        setDeck(copy)
        setPhase('river')
        setStatus(`Ривер. Чек или ставка ${betSize('river')}?`)
      } else {
        showdown(currentBoard, potAmount, playerHole, botHole)
      }
    },
    [showdown],
  )

  const check = () => {
    if (phase === 'over' || matchOver) return
    onHaptic?.('light')

    let nextPot = pot
    let nextStack = stack
    let nextBot = botStack

    // Bot occasionally bets; both put in the same amount (auto-call)
    if (Math.random() < 0.25 && phase !== 'river') {
      const amount = betSize(phase)
      if (nextStack >= amount && nextBot >= amount) {
        nextPot += amount * 2
        nextStack -= amount
        nextBot -= amount
        setPot(nextPot)
        setStack(nextStack)
        setBotStack(nextBot)
        setStatus(`Бот поставил ${amount}. Добор автоматом.`)
      }
    }

    if (phase === 'river') {
      showdown(board, nextPot, player, bot)
    } else {
      advance(phase, deck, board, nextPot, player, bot)
    }
  }

  const bet = () => {
    if (phase === 'over' || matchOver) return
    const amount = betSize(phase)
    if (stack < amount || botStack < amount) {
      setStatus('Недостаточно фишек для ставки — нажмите чек.')
      return
    }
    onHaptic?.('medium')
    const nextPot = pot + amount * 2
    const nextStack = stack - amount
    const nextBot = botStack - amount
    setPot(nextPot)
    setStack(nextStack)
    setBotStack(nextBot)
    setStatus(`Ставка ${amount}. Бот коллирует.`)

    const phaseNow = phase
    const deckNow = deck
    const boardNow = board
    const playerNow = player
    const botNow = bot

    window.setTimeout(() => {
      if (phaseNow === 'river') {
        showdown(boardNow, nextPot, playerNow, botNow)
      } else {
        advance(phaseNow, deckNow, boardNow, nextPot, playerNow, botNow)
      }
    }, 280)
  }

  const fold = () => {
    if (phase === 'over' || matchOver) return
    setPhase('over')
    settlePot('bot', pot)
    setStatus(`Вы сбросили. Банк ${pot} уходит боту.`)
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
        <p className="poker-chip-audit" aria-hidden>
          Стол {totalChips}
        </p>
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
        {phase !== 'over' && !matchOver ? (
          <>
            <button type="button" className="btn btn-soft" onClick={check}>
              Чек
            </button>
            <button type="button" className="btn btn-primary" onClick={bet}>
              Ставка {betSize(phase)}
            </button>
            <button type="button" className="btn btn-danger" onClick={fold}>
              Фолд
            </button>
          </>
        ) : matchOver ? (
          <button type="button" className="btn btn-primary" onClick={resetMatch}>
            Новый матч
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={nextHand}>
            Новая раздача
          </button>
        )}
      </div>
    </div>
  )
}
