import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BOT_DIFFICULTIES,
  BOT_DIFFICULTY_HINT,
  BOT_DIFFICULTY_LABEL,
  type BotDifficulty,
} from './botDifficulty'

/** 0 empty, 1 white man, 2 black man, 3 white king, 4 black king */
type Cell = 0 | 1 | 2 | 3 | 4
type Sq = { r: number; c: number }
/** One jump step; multi-jumps are played as a chain of these. */
type Move = { from: Sq; to: Sq; mid: Sq }
type Step = { from: Sq; to: Sq; mid?: Sq }
type Sequence = { moves: Step[]; board: Cell[][] }

type Flight = {
  id: number
  piece: Cell
  from: Sq
  to: Sq
}

function startBoard(): Cell[][] {
  const b = Array.from({ length: 8 }, () => Array(8).fill(0) as Cell[])
  for (let r = 0; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      if ((r + c) % 2 === 0) continue
      if (r < 3) b[r][c] = 2
      if (r > 4) b[r][c] = 1
    }
  }
  return b
}

const isW = (c: Cell) => c === 1 || c === 3
const isB = (c: Cell) => c === 2 || c === 4
const isK = (c: Cell) => c === 3 || c === 4
const clone = (b: Cell[][]) => b.map((row) => [...row] as Cell[])
const ok = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8
const same = (a: Sq, b: Sq) => a.r === b.r && a.c === b.c

const DIAG = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
] as const

const FLIGHT_MS = 300

function stepMoves(board: Cell[][], from: Sq): { from: Sq; to: Sq }[] {
  const piece = board[from.r][from.c]
  if (!piece) return []
  const out: { from: Sq; to: Sq }[] = []

  if (isK(piece)) {
    for (const [dr, dc] of DIAG) {
      let r = from.r + dr
      let c = from.c + dc
      while (ok(r, c) && board[r][c] === 0) {
        out.push({ from, to: { r, c } })
        r += dr
        c += dc
      }
    }
    return out
  }

  const forward = isW(piece) ? [-1] : [1]
  for (const dr of forward) {
    for (const dc of [-1, 1]) {
      const r = from.r + dr
      const c = from.c + dc
      if (ok(r, c) && board[r][c] === 0) out.push({ from, to: { r, c } })
    }
  }
  return out
}

function captureMoves(board: Cell[][], from: Sq): Move[] {
  const piece = board[from.r][from.c]
  if (!piece) return []
  const out: Move[] = []
  const enemy = (x: Cell) => (isW(piece) ? isB(x) : isW(x))

  if (isK(piece)) {
    for (const [dr, dc] of DIAG) {
      let r = from.r + dr
      let c = from.c + dc
      while (ok(r, c) && board[r][c] === 0) {
        r += dr
        c += dc
      }
      if (!ok(r, c) || !enemy(board[r][c])) continue
      const mid = { r, c }
      r += dr
      c += dc
      while (ok(r, c) && board[r][c] === 0) {
        out.push({ from, to: { r, c }, mid })
        r += dr
        c += dc
      }
    }
    return out
  }

  for (const [dr, dc] of DIAG) {
    const midR = from.r + dr
    const midC = from.c + dc
    const toR = from.r + dr * 2
    const toC = from.c + dc * 2
    if (!ok(toR, toC)) continue
    const mid = board[midR]?.[midC]
    if (!mid || board[toR][toC] !== 0) continue
    if (enemy(mid)) out.push({ from, to: { r: toR, c: toC }, mid: { r: midR, c: midC } })
  }
  return out
}

function applyMove(board: Cell[][], move: { from: Sq; to: Sq; mid?: Sq }): Cell[][] {
  const next = clone(board)
  let piece = next[move.from.r][move.from.c]
  next[move.from.r][move.from.c] = 0
  if (move.mid) next[move.mid.r][move.mid.c] = 0
  if (piece === 1 && move.to.r === 0) piece = 3
  if (piece === 2 && move.to.r === 7) piece = 4
  next[move.to.r][move.to.c] = piece
  return next
}

function allSideMoves(board: Cell[][], white: boolean): Step[] {
  const caps: Move[] = []
  const steps: { from: Sq; to: Sq }[] = []
  for (let r = 0; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      const p = board[r][c]
      if (!p) continue
      if (white !== isW(p)) continue
      const from = { r, c }
      caps.push(...captureMoves(board, from))
      steps.push(...stepMoves(board, from))
    }
  }
  if (caps.length) return caps
  return steps
}

/** All legal full turns for a side (quiet step or completed multi-jump). */
function allSequences(board: Cell[][], white: boolean): Sequence[] {
  const roots = allSideMoves(board, white)
  if (!roots.length) return []

  const first = roots[0]
  if (!first.mid) {
    return roots.map((m) => ({ moves: [m], board: applyMove(board, m) }))
  }

  const out: Sequence[] = []
  const dfs = (b: Cell[][], from: Sq, path: Move[]) => {
    const nextCaps = captureMoves(b, from)
    if (!nextCaps.length) {
      if (path.length) out.push({ moves: path, board: b })
      return
    }
    for (const m of nextCaps) {
      dfs(applyMove(b, m), m.to, [...path, m])
    }
  }

  for (const m of roots) {
    if (!m.mid) continue
    dfs(applyMove(board, m), m.to, [m as Move])
  }
  return out
}

/** Score from black's perspective (bot). Higher = better for bot. */
function evaluateBoard(board: Cell[][]): number {
  let score = 0
  let whiteMen = 0
  let blackMen = 0
  let whiteKings = 0
  let blackKings = 0

  for (let r = 0; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      const p = board[r][c]
      if (!p) continue
      const center = 3.5 - Math.abs(c - 3.5)
      if (p === 1) {
        whiteMen += 1
        score -= 100 + (7 - r) * 4 + center
      } else if (p === 2) {
        blackMen += 1
        score += 100 + r * 4 + center
      } else if (p === 3) {
        whiteKings += 1
        score -= 175 + center * 2
      } else if (p === 4) {
        blackKings += 1
        score += 175 + center * 2
      }
    }
  }

  if (whiteMen + whiteKings === 0) return 100000
  if (blackMen + blackKings === 0) return -100000
  return score
}

function minimaxCheckers(
  board: Cell[][],
  depth: number,
  maximizingBlack: boolean,
  alpha: number,
  beta: number,
): number {
  const seqs = allSequences(board, !maximizingBlack)
  if (!seqs.length) {
    // Side to move has no moves — previous side wins.
    return maximizingBlack ? -100000 - depth : 100000 + depth
  }
  if (depth === 0) return evaluateBoard(board)

  if (maximizingBlack) {
    let best = -Infinity
    for (const seq of seqs) {
      const sc = minimaxCheckers(seq.board, depth - 1, false, alpha, beta)
      if (sc > best) best = sc
      if (sc > alpha) alpha = sc
      if (beta <= alpha) break
    }
    return best
  }

  let best = Infinity
  for (const seq of seqs) {
    const sc = minimaxCheckers(seq.board, depth - 1, true, alpha, beta)
    if (sc < best) best = sc
    if (sc < beta) beta = sc
    if (beta <= alpha) break
  }
  return best
}

const CHECKERS_DEPTH: Record<BotDifficulty, number> = {
  easy: 0,
  medium: 2,
  hard: 3,
}

function pickBotSequence(board: Cell[][], difficulty: BotDifficulty): Step[] {
  const seqs = allSequences(board, false)
  if (!seqs.length) return []

  // Easy: mostly random among legal turns (captures already forced by rules).
  if (difficulty === 'easy') {
    if (Math.random() < 0.7) {
      return seqs[Math.floor(Math.random() * seqs.length)]!.moves
    }
  }

  const depth = CHECKERS_DEPTH[difficulty]
  const scored = seqs.map((seq) => {
    const sc =
      depth <= 0
        ? evaluateBoard(seq.board)
        : minimaxCheckers(seq.board, depth - 1, false, -Infinity, Infinity)
    return { seq, sc }
  })
  scored.sort((a, b) => b.sc - a.sc)

  let pickIndex = 0
  if (difficulty === 'easy') {
    pickIndex = Math.min(scored.length - 1, Math.floor(Math.random() * Math.min(4, scored.length)))
  } else if (difficulty === 'medium' && scored.length > 1 && Math.random() < 0.22) {
    pickIndex = 1 + Math.floor(Math.random() * Math.min(2, scored.length - 1))
  }

  return scored[pickIndex]!.seq.moves
}

function CheckerDisc({ cell, flying }: { cell: Cell; flying?: boolean }) {
  return (
    <span
      className={`checker ${isW(cell) ? 'checker-w' : 'checker-b'}${isK(cell) ? ' is-king' : ''}${flying ? ' is-flying' : ''}`}
      aria-hidden={flying || undefined}
      aria-label={
        flying
          ? undefined
          : isK(cell)
            ? isW(cell)
              ? 'белая дамка'
              : 'чёрная дамка'
            : isW(cell)
              ? 'белая шашка'
              : 'чёрная шашка'
      }
    >
      {isK(cell) && <span className="checker-crown">♛</span>}
    </span>
  )
}

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
