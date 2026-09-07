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
  const [boardTick, setBoardTick] = useState(0)
  const [wager, setWager] = useState(() => betSize('preflop'))

  const stackRef = useRef(stack)
  const botStackRef = useRef(botStack)
  stackRef.current = stack
  botStackRef.current = botStack

  const maxWager = Math.min(stack, botStack)
  const minWager = Math.min(betSize(phase === 'over' ? 'preflop' : phase), Math.max(0, maxWager))

  useEffect(() => {
    if (phase === 'over' || matchOver) return
    setWager(clampBet(betSize(phase), minWager, maxWager))
  }, [phase, matchOver, minWager, maxWager])

  const nudgeWager = (delta: number) => {
    setWager((w) => clampBet(w + delta, minWager, maxWager))
    onHaptic?.('light')
  }

  const setWagerPreset = (value: number) => {
    setWager(clampBet(value, minWager, maxWager))
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
      setBoardTick(0)
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
      if (from === 'preflop') {
        copy.pop()
        const flop = [copy.pop()!, copy.pop()!, copy.pop()!]
        setBoard(flop)
        setDeck(copy)
        setPhase('flop')
        setBoardTick((n) => n + 1)
        setStatus(`Флоп открыт. Чек, ставка или фолд.`)
      } else if (from === 'flop') {
        copy.pop()
        const nextBoard = [...currentBoard, copy.pop()!]
        setBoard(nextBoard)
        setDeck(copy)
        setPhase('turn')
        setBoardTick((n) => n + 1)
        setStatus(`Тёрн. Чек, ставка или фолд.`)
      } else if (from === 'turn') {
        copy.pop()
        const nextBoard = [...currentBoard, copy.pop()!]
        setBoard(nextBoard)
        setDeck(copy)
        setPhase('river')
        setBoardTick((n) => n + 1)
        setStatus(`Ривер. Чек, ставка или фолд.`)
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

    if (Math.random() < 0.25 && phase !== 'river') {
      const amount = clampBet(wager, minWager, Math.min(nextStack, nextBot))
      if (amount > 0 && nextStack >= amount && nextBot >= amount) {
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
    const amount = clampBet(wager, minWager, maxWager)
    if (amount <= 0 || stack < amount || botStack < amount) {
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

              <div className="poker-board" key={`board-${boardTick}`}>
                {board.length === 0 ? (
                  <span className="poker-board-empty">Общие карты</span>
                ) : (
                  board.map((c, i) => (
                    <PlayingCard
                      key={c.id}
                      card={c}
                      index={i}
                      enter="none"
                      className="poker-board-card poker-deal-board"
                      style={{ animationDelay: `${i * 70}ms` }}
                    />
                  ))
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
                  <span className="poker-bet-label">Размер ставки</span>
                  <div className="poker-bet-stepper">
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
                  <p className="poker-bet-meta">
                    Стек {formatChips(stack)} · бот {formatChips(botStack)}
                  </p>
                </div>
                <div className="poker-actions-row">
                  <button type="button" className="poker-btn poker-btn-soft" onClick={check}>
                    Чек
                  </button>
                  <button type="button" className="poker-btn poker-btn-bet" onClick={bet} disabled={wager <= 0}>
                    Поставить {formatChips(wager)}
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
  )
}
