import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

function formatChips(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`
  return String(n)
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

function clampBet(value: number, min: number, max: number) {
  if (max < min) return Math.max(0, max)
  return Math.min(max, Math.max(min, value))
}

/** 0..1 — rough preflop / made-hand strength for bot decisions. */
function handStrength(hole: Card[], board: Card[]): number {
  if (board.length === 0) {
    const v0 = rankValue(hole[0]!.rank, POKER_RANKS)
    const v1 = rankValue(hole[1]!.rank, POKER_RANKS)
    const high = Math.max(v0, v1)
    const low = Math.min(v0, v1)
    const pair = v0 === v1
    const suited = hole[0]!.suit === hole[1]!.suit
    let s = (high / 12) * 0.5 + (low / 12) * 0.18
    if (pair) s = 0.52 + (high / 12) * 0.42
    if (suited) s += 0.07
    if (!pair && high - low <= 2) s += 0.05
    return Math.min(1, Math.max(0.05, s))
  }
  const score = bestHand(hole, board).score
  if (score >= 7000) return 0.98
  if (score >= 6000) return 0.94
  if (score >= 5000) return 0.88
  if (score >= 4000) return 0.8
  if (score >= 3000) return 0.72
  if (score >= 2000) return 0.58
  if (score >= 1000) return 0.34 + Math.min(0.22, (score - 1000) / 2500)
  return Math.min(0.32, 0.08 + score / 4000)
}

type BotDecision =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'raise'; amount: number }

function botDecide(opts: {
  facingBet: boolean
  callAmount: number
  hole: Card[]
  board: Card[]
  pot: number
  botStack: number
  playerStack: number
  phase: Phase
}): BotDecision {
  const { facingBet, callAmount, hole, board, pot, botStack, playerStack, phase } = opts
  const strength = handStrength(hole, board)
  const maxChip = Math.min(botStack, playerStack)
  const minChip = Math.min(betSize(phase), Math.max(0, maxChip))
  const roll = Math.random()
  const streetAggro = phase === 'preflop' ? 0.12 : phase === 'flop' ? 0.18 : phase === 'turn' ? 0.22 : 0.16

  if (!facingBet) {
    // Player checked — bot may check or lead out (value / bluff).
    const wantBet =
      strength >= 0.58 ||
      (strength >= 0.4 && roll < streetAggro + strength * 0.25) ||
      (strength < 0.28 && roll < 0.1 + streetAggro * 0.35)
    if (wantBet && maxChip > 0) {
      const mult = strength >= 0.7 ? 0.9 + strength * 0.7 : strength >= 0.4 ? 0.55 + roll * 0.5 : 0.45 + roll * 0.35
      const amount = clampBet(Math.round(betSize(phase) * mult), minChip || Math.min(BLIND, maxChip), maxChip)
      if (amount > 0) return { type: 'raise', amount }
    }
    return { type: 'check' }
  }

  // Facing a player bet.
  const potOdds = callAmount / (pot + callAmount + 1)
  const bigBet = callAmount >= pot * 0.55

  // Trash vs big pressure → fold (rare bluff-raise).
  if (strength < 0.24 && (bigBet || callAmount >= botStack * 0.35)) {
    if (roll < 0.07 && maxChip > callAmount && botStack > callAmount * 2) {
      const amount = clampBet(callAmount + betSize(phase), callAmount + minChip, maxChip)
      if (amount > callAmount) return { type: 'raise', amount }
    }
    return { type: 'fold' }
  }
  if (strength < 0.32 && bigBet && roll < 0.55) return { type: 'fold' }
  if (strength < 0.38 && callAmount > pot * 0.85 && roll < 0.4) return { type: 'fold' }

  // Strong / semi-strong → raise for value (or as bluff sometimes).
  const wantRaise =
    (strength >= 0.72 && roll < 0.7) ||
    (strength >= 0.55 && roll < 0.35) ||
    (strength < 0.3 && roll < 0.08)
  if (wantRaise && maxChip > callAmount) {
    const bump = Math.round(betSize(phase) * (0.7 + strength * 0.9 + roll * 0.4))
    const amount = clampBet(callAmount + bump, callAmount + Math.max(minChip, 10), maxChip)
    if (amount > callAmount) return { type: 'raise', amount }
  }

  // Call if odds / equity look fine, or float sometimes.
  if (strength + 0.06 >= potOdds || strength >= 0.4 || (strength >= 0.28 && roll < 0.35)) {
    return { type: 'call' }
  }
  if (roll < 0.22) return { type: 'call' }
  return { type: 'fold' }
}

function isLandscapeNow() {
  if (typeof window === 'undefined') return true
  // Prefer geometry — Telegram WebView often lags on orientation media queries.
  if (window.innerWidth > window.innerHeight) return true
  if (window.innerHeight > window.innerWidth) return false
  try {
    return window.matchMedia('(orientation: landscape)').matches
  } catch {
    return true
  }
}

function useLandscape() {
  const [landscape, setLandscape] = useState(isLandscapeNow)
  useEffect(() => {
    const sync = () => setLandscape(isLandscapeNow())
    sync()
    const mq = window.matchMedia('(orientation: landscape)')
    mq.addEventListener?.('change', sync)
    window.addEventListener('resize', sync)
    window.addEventListener('orientationchange', sync)
    // Telegram may fire viewportChanged after rotate.
    const wa = (window as Window & { Telegram?: { WebApp?: { onEvent?: (e: string, cb: () => void) => void; offEvent?: (e: string, cb: () => void) => void } } })
      .Telegram?.WebApp
    wa?.onEvent?.('viewportChanged', sync)
    const t1 = window.setTimeout(sync, 120)
    const t2 = window.setTimeout(sync, 400)
    return () => {
      mq.removeEventListener?.('change', sync)
      window.removeEventListener('resize', sync)
      window.removeEventListener('orientationchange', sync)
      wa?.offEvent?.('viewportChanged', sync)
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [])
  return landscape
}

function SeatCard({
  name,
  level,
  stackText,
  dealer,
  active,
  accent,
}: {
  name: string
  level: number
  stackText: string
  dealer?: boolean
  active?: boolean
  accent?: string
}) {
  return (
    <div className={`poker-seat${active ? ' is-active' : ''}`}>
      <div className="poker-seat-name">{name}</div>
      <div className="poker-seat-avatar-wrap">
        {dealer && <span className="poker-dealer-btn">D</span>}
        <div className="poker-seat-avatar" style={accent ? { background: accent } : undefined}>
          {name.slice(0, 1)}
        </div>
        <span className="poker-seat-level">{level}</span>
      </div>
      <div className="poker-seat-money">
        <span>{stackText}</span>
      </div>
    </div>
  )
}

export function PokerGame({
  onHaptic,
}: {
  onHaptic?: (t?: 'light' | 'medium' | 'success' | 'error') => void
}) {
  const landscape = useLandscape()
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
  const [status, setStatus] = useState(`Блайнды по ${BLIND}. Чек или выберите ставку.`)
  const [resultClass, setResultClass] = useState('')
  const [matchOver, setMatchOver] = useState(false)
  const [dealTick, setDealTick] = useState(1)
  const [wager, setWager] = useState(() => betSize('preflop'))
  /** Amount the player must put in to continue after a bot bet/raise. 0 = street is open. */
  const [toCall, setToCall] = useState(0)
  /** Board cards that should play the deal animation (ids). */
  const [freshBoardIds, setFreshBoardIds] = useState<string[]>([])
  const boardLenRef = useRef(0)

  const stackRef = useRef(stack)
  const botStackRef = useRef(botStack)
  stackRef.current = stack
  botStackRef.current = botStack

  const maxWager = Math.min(stack, botStack)
  const minWager = Math.min(betSize(phase === 'over' ? 'preflop' : phase), Math.max(0, maxWager))
  const facingBot = toCall > 0

  useEffect(() => {
    if (phase === 'over' || matchOver) return
    if (facingBot) {
      setWager(clampBet(toCall + betSize(phase), toCall, maxWager))
      return
    }
    setWager(clampBet(betSize(phase), minWager, maxWager))
  }, [phase, matchOver, minWager, maxWager, facingBot, toCall])

  const nudgeWager = (delta: number) => {
    const lo = facingBot ? toCall : minWager
    setWager((w) => clampBet(w + delta, lo, maxWager))
    onHaptic?.('light')
  }

  const setWagerPreset = (value: number) => {
    const lo = facingBot ? toCall : minWager
    setWager(clampBet(value, lo, maxWager))
    onHaptic?.('light')
  }

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
      setDealTick((n) => n + 1)
      setToCall(0)
      setFreshBoardIds([])
      boardLenRef.current = 0
      setWager(betSize('preflop'))
      setStatus(`Блайнды по ${BLIND}. Ваш ход: чек, ставка или фолд.`)
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
      setToCall(0)
      if (from === 'preflop') {
        copy.pop()
        const flop = [copy.pop()!, copy.pop()!, copy.pop()!]
        boardLenRef.current = 0
        setFreshBoardIds(flop.map((c) => c.id))
        setBoard(flop)
        setDeck(copy)
        setPhase('flop')
        setStatus('Флоп открыт. Чек, ставка или фолд.')
      } else if (from === 'flop') {
        copy.pop()
        const card = copy.pop()!
        boardLenRef.current = currentBoard.length
        setFreshBoardIds([card.id])
        setBoard([...currentBoard, card])
        setDeck(copy)
        setPhase('turn')
        setStatus('Тёрн. Чек, ставка или фолд.')
      } else if (from === 'turn') {
        copy.pop()
        const card = copy.pop()!
        boardLenRef.current = currentBoard.length
        setFreshBoardIds([card.id])
        setBoard([...currentBoard, card])
        setDeck(copy)
        setPhase('river')
        setStatus('Ривер. Чек, ставка или фолд.')
      } else {
        showdown(currentBoard, potAmount, playerHole, botHole)
      }
    },
    [showdown],
  )

  const check = () => {
    if (phase === 'over' || matchOver || facingBot) return
    onHaptic?.('light')

    const decision = botDecide({
      facingBet: false,
      callAmount: 0,
      hole: bot,
      board,
      pot,
      botStack,
      playerStack: stack,
      phase,
    })

    if (decision.type === 'raise') {
      const amount = clampBet(decision.amount, minWager, Math.min(stack, botStack))
      if (amount > 0 && botStack >= amount) {
        const nextBot = botStack - amount
        const nextPot = pot + amount
        setBotStack(nextBot)
        setPot(nextPot)
        setToCall(amount)
        setWager(clampBet(amount, amount, Math.min(stack, nextBot + amount)))
        setStatus(`Бот ставит ${formatChips(amount)}. Колл, рейз или фолд.`)
        onHaptic?.('medium')
        return
      }
    }

    setStatus('Бот чекает.')
    window.setTimeout(() => {
      if (phase === 'river') {
        showdown(board, pot, player, bot)
      } else {
        advance(phase, deck, board, pot, player, bot)
      }
    }, 320)
  }

  const callBot = () => {
    if (phase === 'over' || matchOver || !facingBot) return
    const amount = Math.min(toCall, stack)
    if (amount <= 0) return
    onHaptic?.('medium')
    const nextStack = stack - amount
    const nextPot = pot + amount
    stackRef.current = nextStack
    setStack(nextStack)
    setPot(nextPot)
    setToCall(0)
    setStatus(`Вы коллируете ${formatChips(amount)}.`)
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

  const bet = () => {
    if (phase === 'over' || matchOver) return

    // Facing bot bet: wager above toCall is a raise; exactly toCall is call.
    if (facingBot) {
      const amount = clampBet(wager, toCall, maxWager)
      if (amount < toCall || stack < amount) {
        setStatus('Недостаточно фишек.')
        return
      }
      if (amount === toCall) {
        callBot()
        return
      }
      // Raise over bot
      const raiseTotal = amount
      if (stack < raiseTotal || botStack < raiseTotal - toCall) {
        setStatus('Недостаточно фишек для рейза.')
        return
      }
      onHaptic?.('medium')
      const nextStack = stack - raiseTotal
      const botAdd = raiseTotal - toCall
      const nextBot = botStack - botAdd
      const nextPot = pot + raiseTotal + botAdd
      // Bot already put toCall into pot earlier; now matches the raise bump
      setStack(nextStack)
      setBotStack(nextBot)
      setPot(nextPot)
      setToCall(0)

      const decision = botDecide({
        facingBet: true,
        callAmount: botAdd,
        hole: bot,
        board,
        pot: nextPot,
        botStack: nextBot,
        playerStack: nextStack,
        phase,
      })

      const phaseNow = phase
      const deckNow = deck
      const boardNow = board
      const playerNow = player
      const botNow = bot

      window.setTimeout(() => {
        if (decision.type === 'fold') {
          settlePot('player', nextPot)
          setPhase('over')
          setStatus(`Бот сбросил на рейз. Вы забираете банк ${formatChips(nextPot)}.`)
          setResultClass('win')
          onHaptic?.('success')
          return
        }
        // call or treat raise as call to avoid infinite re-raise wars this street
        setStatus(
          decision.type === 'raise'
            ? `Бот думал рейзить, но коллирует ${formatChips(botAdd)}.`
            : `Бот коллирует ${formatChips(botAdd)}.`,
        )
        if (phaseNow === 'river') {
          showdown(boardNow, nextPot, playerNow, botNow)
        } else {
          advance(phaseNow, deckNow, boardNow, nextPot, playerNow, botNow)
        }
      }, 420)
      return
    }

    const amount = clampBet(wager, minWager, maxWager)
    if (amount <= 0 || stack < amount) {
      setStatus('Недостаточно фишек для ставки — нажмите чек.')
      return
    }
    onHaptic?.('medium')

    const decision = botDecide({
      facingBet: true,
      callAmount: amount,
      hole: bot,
      board,
      pot,
      botStack,
      playerStack: stack - amount,
      phase,
    })

    const phaseNow = phase
    const deckNow = deck
    const boardNow = board
    const playerNow = player
    const botNow = bot
    const potNow = pot
    const stackNow = stack
    const botStackNow = botStack

    if (decision.type === 'fold') {
      // Player's bet goes into the pot; bot folds → player wins the pot.
      stackRef.current = stackNow - amount
      setStack(stackRef.current)
      const nextPot = potNow + amount
      setPot(nextPot)
      setPhase('over')
      settlePot('player', nextPot)
      setStatus(`Вы поставили ${formatChips(amount)}. Бот сбросил. Банк ваш.`)
      setResultClass('win')
      onHaptic?.('success')
      return
    }

    if (decision.type === 'raise') {
      const raiseAmt = clampBet(decision.amount, amount + minWager, Math.min(stackNow, botStackNow))
      if (raiseAmt > amount && botStackNow >= raiseAmt && stackNow >= raiseAmt) {
        // Player puts amount now; bot puts raiseAmt; player must call the difference
        const nextStack = stackNow - amount
        const nextBot = botStackNow - raiseAmt
        const nextPot = potNow + amount + raiseAmt
        setStack(nextStack)
        setBotStack(nextBot)
        setPot(nextPot)
        const need = raiseAmt - amount
        setToCall(need)
        setWager(clampBet(need, need, Math.min(nextStack, nextBot + need)))
        setStatus(`Вы ${formatChips(amount)}, бот рейзит до ${formatChips(raiseAmt)}. Нужно ещё ${formatChips(need)}.`)
        return
      }
    }

    // Call (or failed raise → call)
    if (botStackNow < amount) {
      setStatus('У бота не хватает фишек — нажмите чек.')
      return
    }
    const nextPot = potNow + amount * 2
    const nextStack = stackNow - amount
    const nextBot = botStackNow - amount
    setPot(nextPot)
    setStack(nextStack)
    setBotStack(nextBot)
    setStatus(`Ставка ${formatChips(amount)}. Бот коллирует.`)

    window.setTimeout(() => {
      if (phaseNow === 'river') {
        showdown(boardNow, nextPot, playerNow, botNow)
      } else {
        advance(phaseNow, deckNow, boardNow, nextPot, playerNow, botNow)
      }
    }, 320)
  }

  const fold = () => {
    if (phase === 'over' || matchOver) return
    setPhase('over')
    setToCall(0)
    settlePot('bot', pot)
    setStatus(
      facingBot
        ? `Вы сбросили на ставку бота. Банк ${formatChips(pot)} уходит боту.`
        : `Вы сбросили. Банк ${formatChips(pot)} уходит боту.`,
    )
    setResultClass('lose')
    onHaptic?.('error')
  }

  // Clear deal animation marks after they play
  useEffect(() => {
    if (freshBoardIds.length === 0) return
    const t = window.setTimeout(() => setFreshBoardIds([]), 600)
    return () => window.clearTimeout(t)
  }, [freshBoardIds])

  return (
    <div className={`poker-landscape${landscape ? ' is-landscape' : ' is-portrait'}`}>
      {!landscape && (
        <div className="poker-rotate-hint" role="status">
          <div className="poker-rotate-icon" aria-hidden>
            ↻
          </div>
          <p>Поверните телефон горизонтально</p>
          <span>Покер рассчитан на широкий стол</span>
        </div>
      )}

      <div className="poker-stage" aria-hidden={!landscape}>
        <div className="poker-room">
          <p className={`poker-status ${resultClass}`}>{status}</p>

          <div className="poker-table">
            <div className="poker-table-rail" />
            <div className="poker-table-felt">
              <div className="poker-table-brand">Playfort Poker</div>

              <div className="poker-board">
                {board.length === 0 ? (
                  <span className="poker-board-empty">Общие карты</span>
                ) : (
                  board.map((c, i) => {
                    const isFresh = freshBoardIds.includes(c.id)
                    const freshIndex = isFresh ? freshBoardIds.indexOf(c.id) : 0
                    return (
                      <PlayingCard
                        key={c.id}
                        card={c}
                        index={i}
                        enter="none"
                        className={`poker-board-card${isFresh ? ' poker-deal-board' : ''}`}
                        style={isFresh ? { animationDelay: `${freshIndex * 70}ms` } : undefined}
                      />
                    )
                  })
                )}
              </div>

              <div className="poker-pot">
                <span className="poker-pot-chip" />
                <span>Банк {formatChips(pot)}</span>
              </div>
            </div>

            <div className="poker-seat-slot poker-seat-bot">
              <div className="poker-bot-cards" key={`bot-${dealTick}`}>
                {bot.map((c, i) => (
                  <PlayingCard
                    key={c.id}
                    card={c}
                    faceDown={!showBot}
                    index={i}
                    enter="none"
                    className="poker-hole-card poker-deal-to-bot"
                    style={{ animationDelay: `${80 + i * 90}ms` }}
                  />
                ))}
              </div>
              <SeatCard
                name="Бот"
                level={55}
                stackText={formatChips(botStack)}
                active
                accent="linear-gradient(145deg,#6b3a3a,#3a1515)"
              />
            </div>

            <div className="poker-seat-slot poker-seat-you">
              <SeatCard
                name="Вы"
                level={12}
                stackText={formatChips(stack)}
                dealer={phase !== 'over'}
                active
                accent="linear-gradient(145deg,#3a6ea5,#1a3358)"
              />
            </div>
          </div>

          <div className="poker-bottom">
            <div className="poker-hand-dock" key={`hand-${dealTick}`}>
              <span className="poker-hand-label">Ваши карты</span>
              <div className="poker-hand">
                {player.map((c, i) => (
                  <PlayingCard
                    key={c.id}
                    card={c}
                    index={i}
                    enter="none"
                    className="poker-hole-card poker-deal-to-you"
                    style={{ animationDelay: `${i * 90}ms` }}
                  />
                ))}
              </div>
            </div>

            <div className="poker-actions">
              {phase !== 'over' && !matchOver ? (
                <>
                  <div className="poker-bet-panel">
                    <div className="poker-bet-stepper" aria-label="Размер ставки">
                      <button
                        type="button"
                        className="poker-bet-nudge"
                        aria-label="Уменьшить ставку"
                        disabled={wager <= minWager}
                        onClick={() => nudgeWager(-10)}
                      >
                        −
                      </button>
                      <span className="poker-bet-value">{formatChips(wager)}</span>
                      <button
                        type="button"
                        className="poker-bet-nudge"
                        aria-label="Увеличить ставку"
                        disabled={wager >= maxWager}
                        onClick={() => nudgeWager(10)}
                      >
                        +
                      </button>
                    </div>
                    <div className="poker-bet-presets">
                      <button type="button" className="poker-bet-chip" onClick={() => setWagerPreset(minWager)}>
                        Мин
                      </button>
                      <button
                        type="button"
                        className="poker-bet-chip"
                        onClick={() => setWagerPreset(Math.max(minWager, Math.floor(pot / 2) || minWager))}
                      >
                        ½ банка
                      </button>
                      <button
                        type="button"
                        className="poker-bet-chip"
                        onClick={() => setWagerPreset(Math.max(minWager, pot || minWager))}
                      >
                        Банк
                      </button>
                      <button type="button" className="poker-bet-chip" onClick={() => setWagerPreset(maxWager)}>
                        Макс
                      </button>
                    </div>
                  </div>
                  <div className="poker-actions-row">
                    {facingBot ? (
                      <button type="button" className="poker-btn poker-btn-soft" onClick={callBot}>
                        Колл {formatChips(toCall)}
                      </button>
                    ) : (
                      <button type="button" className="poker-btn poker-btn-soft" onClick={check}>
                        Чек
                      </button>
                    )}
                    <button
                      type="button"
                      className="poker-btn poker-btn-bet"
                      onClick={bet}
                      disabled={wager <= 0 || (facingBot && wager < toCall)}
                    >
                      {facingBot
                        ? wager > toCall
                          ? `Рейз ${formatChips(wager)}`
                          : `Колл ${formatChips(toCall)}`
                        : `Поставить ${formatChips(wager)}`}
                    </button>
                    <button type="button" className="poker-btn poker-btn-fold" onClick={fold}>
                      Фолд
                    </button>
                  </div>
                </>
              ) : matchOver ? (
                <button type="button" className="poker-btn poker-btn-bet" onClick={resetMatch}>
                  Новый матч
                </button>
              ) : (
                <button type="button" className="poker-btn poker-btn-bet" onClick={nextHand}>
                  Новая раздача
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
