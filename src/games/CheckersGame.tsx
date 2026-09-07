import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BOT_DIFFICULTIES,
  BOT_DIFFICULTY_HINT,
  BOT_DIFFICULTY_LABEL,
  type BotDifficulty,
} from './botDifficulty'
import {
  type Cell,
  type Sq,
  type Step,
  type Flight,
  startBoard,
  isW,
  same,
  FLIGHT_MS,
  captureMoves,
  applyMove,
  allSideMoves,
  pickBotSequence,
  CheckerDisc,
  clone,
} from './checkers/engine'

export function CheckersGame({
  onHaptic,
}: {
  onHaptic?: (t?: 'light' | 'medium' | 'success' | 'error') => void
}) {
  const [phase, setPhase] = useState<'setup' | 'play'>('setup')
  const [difficulty, setDifficulty] = useState<BotDifficulty>('medium')
  const [pick, setPick] = useState<BotDifficulty>('medium')
  const [board, setBoard] = useState(() => startBoard())
  const [turn, setTurn] = useState<'w' | 'b'>('w')
  const [selected, setSelected] = useState<Sq | null>(null)
  const [chainFrom, setChainFrom] = useState<Sq | null>(null)
  const [status, setStatus] = useState('Вы — белые. Ваш ход')
  const [over, setOver] = useState(false)
  const [flight, setFlight] = useState<Flight | null>(null)
  const [fadeCapture, setFadeCapture] = useState<Sq | null>(null)
  const flightId = useRef(0)
  const timers = useRef<number[]>([])
  const difficultyRef = useRef(difficulty)
  difficultyRef.current = difficulty

  const clearTimers = () => {
    for (const t of timers.current) window.clearTimeout(t)
    timers.current = []
  }

  useEffect(() => () => clearTimers(), [])

  const legal = useMemo(() => {
    // Keep legal moves stable during flight so hint classes don't thrash/blink.
    if (phase !== 'play' || over) return [] as Step[]
    if (turn !== 'w') return []
    if (chainFrom) return captureMoves(board, chainFrom)
    return allSideMoves(board, true)
  }, [board, turn, chainFrom, over, phase])

  const hints = useMemo(
    () => (selected ? legal.filter((m) => same(m.from, selected)) : []),
    [legal, selected],
  )

  const mustCapture = legal.some((m) => m.mid)

  const goSetup = useCallback(() => {
    clearTimers()
    setPhase('setup')
    setPick(difficulty)
    setBoard(startBoard())
    setTurn('w')
    setSelected(null)
    setChainFrom(null)
    setStatus('Вы — белые. Ваш ход')
    setOver(false)
    setFlight(null)
    setFadeCapture(null)
    onHaptic?.('medium')
  }, [difficulty, onHaptic])

  const startGame = useCallback(
    (level: BotDifficulty) => {
      clearTimers()
      setDifficulty(level)
      setPick(level)
      setBoard(startBoard())
      setTurn('w')
      setSelected(null)
      setChainFrom(null)
      setStatus('Вы — белые. Ваш ход')
      setOver(false)
      setFlight(null)
      setFadeCapture(null)
      setPhase('play')
      onHaptic?.('medium')
    },
    [onHaptic],
  )

  const finishBotTurn = (after: Cell[][]) => {
    const you = allSideMoves(after, true)
    if (!you.length) {
      setOver(true)
      setStatus('Поражение')
      onHaptic?.('error')
      setTurn('w')
      return
    }
    setTurn('w')
    setStatus(you.some((m) => m.mid) ? 'Ваш ход · нужно бить' : 'Вы — белые. Ваш ход')
  }

  const playAnimated = (
    startBoardState: Cell[][],
    moves: Step[],
    onDone: (finalBoard: Cell[][]) => void,
  ) => {
    clearTimers()
    let i = 0
    let cur = startBoardState

    const runStep = () => {
      if (i >= moves.length) {
        setFlight(null)
        setFadeCapture(null)
        setBoard(cur)
        onDone(cur)
        return
      }
      const move = moves[i]!
      const piece = cur[move.from.r][move.from.c]
      if (!piece) {
        i += 1
        runStep()
        return
      }

      // Keep the board intact during flight — hide the source disc via CSS so
      // Telegram WebView doesn't flash a full board repaint on every lift.
      setFadeCapture(move.mid ?? null)
      const id = ++flightId.current
      setFlight({ id, piece, from: move.from, to: move.to })
      onHaptic?.('light')

      const t = window.setTimeout(() => {
        cur = applyMove(cur, move)
        // Land first, then drop the overlay on the next tick so the destination
        // disc is already painted underneath (avoids a one-frame gap/blink).
        setBoard(clone(cur))
        setFadeCapture(null)
        const land = window.setTimeout(() => {
          setFlight(null)
          i += 1
          const gap = window.setTimeout(runStep, moves.length > 1 ? 80 : 30)
          timers.current.push(gap)
        }, 0)
        timers.current.push(land)
      }, FLIGHT_MS)
      timers.current.push(t)
    }

    const start = window.setTimeout(runStep, 16)
    timers.current.push(start)
  }

  const botPlay = (next: Cell[][]) => {
    const seq = pickBotSequence(next, difficultyRef.current)
    if (!seq.length) {
      setOver(true)
      setStatus('Победа!')
      onHaptic?.('success')
      return
    }
    setTurn('b')
    setStatus('Ход бота…')
    setChainFrom(null)
    setSelected(null)
    playAnimated(next, seq, finishBotTurn)
  }

  const onCell = (r: number, c: number) => {
    if (phase !== 'play' || over || turn !== 'w' || flight) return

    if (selected) {
      const move = hints.find((m) => m.to.r === r && m.to.c === c)
      if (move) {
        setSelected(null)
        playAnimated(board, [move], (after) => {
          if (move.mid) {
            const more = captureMoves(after, move.to)
            if (more.length) {
              setChainFrom(move.to)
              setSelected(move.to)
              setTurn('w')
              setStatus('Продолжайте бить этой шашкой')
              return
            }
          }
          setChainFrom(null)
          botPlay(after)
        })
        return
      }

      if (chainFrom) return
    }

    if (chainFrom) {
      if (same(chainFrom, { r, c })) {
        setSelected({ r, c })
        onHaptic?.('light')
      }
      return
    }

    if (isW(board[r][c]) && legal.some((m) => m.from.r === r && m.from.c === c)) {
      setSelected({ r, c })
      onHaptic?.('light')
    } else {
      setSelected(null)
    }
  }

  if (phase === 'setup') {
    return (
      <div className="table-area bot-setup">
        <h2 className="bot-setup-title">Шашки</h2>
        <p className="bot-setup-lead">Выберите сложность бота</p>
        <div className="bot-difficulty" role="group" aria-label="Сложность бота">
          {BOT_DIFFICULTIES.map((level) => (
            <button
              key={level}
              type="button"
              className={`bot-diff-btn ${pick === level ? 'is-active' : ''}`}
              onClick={() => {
                setPick(level)
                onHaptic?.('light')
              }}
            >
              <span className="bot-diff-name">{BOT_DIFFICULTY_LABEL[level]}</span>
              <span className="bot-diff-hint">{BOT_DIFFICULTY_HINT[level]}</span>
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-primary bot-setup-start" onClick={() => startGame(pick)}>
          Начать партию
        </button>
      </div>
    )
  }

  return (
    <div className="table-area">
      <p className={`game-status ${over && status === 'Победа!' ? 'win' : over ? 'lose' : ''}`}>
        {status}
        {mustCapture && turn === 'w' && !over && !status.includes('бить') ? ' · нужно бить' : ''}
      </p>
      <p className="checkers-sides" aria-hidden>
        <span className="checkers-side checkers-side-bot">
          Бот · чёрные · {BOT_DIFFICULTY_LABEL[difficulty]}
        </span>
        <span className="checkers-side checkers-side-you">Вы · белые</span>
      </p>
      <div className="board-wrap">
        <div className={`board checkers${flight ? ' is-flying' : ''}`}>
          {board.map((row, r) =>
            row.map((cell, c) => {
              const dark = (r + c) % 2 === 1
              const isSel = !flight && selected?.r === r && selected?.c === c
              const isHint = !flight && hints.some((h) => h.to.r === r && h.to.c === c)
              const isCap = isHint && hints.some((h) => h.to.r === r && h.to.c === c && h.mid)
              const isSource = !!(flight && flight.from.r === r && flight.from.c === c)
              const fading = !!(fadeCapture && fadeCapture.r === r && fadeCapture.c === c && cell !== 0)
              return (
                <button
                  key={`${r}-${c}`}
                  type="button"
                  className={`cell ${dark ? 'dark' : 'light'} ${isSel ? 'selected' : ''} ${isHint && !isCap ? 'move-hint' : ''} ${isCap ? 'capture-hint' : ''}`}
                  onClick={() => onCell(r, c)}
                >
                  {cell !== 0 && (
                    <span
                      className={`checker-slot${fading ? ' checker-capture-fade' : ''}${isSource ? ' checker-source-hide' : ''}`}
                    >
                      <CheckerDisc cell={cell} />
                    </span>
                  )}
                </button>
              )
            }),
          )}
          {flight && (
            <span
              key={flight.id}
              className="checker-flight"
              style={{
                ['--from-r' as string]: flight.from.r,
                ['--from-c' as string]: flight.from.c,
                ['--to-r' as string]: flight.to.r,
                ['--to-c' as string]: flight.to.c,
              }}
            >
              <CheckerDisc cell={flight.piece} flying />
            </span>
          )}
        </div>
      </div>
      <div className="action-bar">
        <button type="button" className="btn btn-soft" onClick={goSetup}>
          Новая партия
        </button>
      </div>
    </div>
  )
}
