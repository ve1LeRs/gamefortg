import type { BotDifficulty } from '../botDifficulty'


/** 0 empty, 1 white man, 2 black man, 3 white king, 4 black king */
export type Cell = 0 | 1 | 2 | 3 | 4
export type Sq = { r: number; c: number }
/** One jump step; multi-jumps are played as a chain of these. */
export type Move = { from: Sq; to: Sq; mid: Sq }
export type Step = { from: Sq; to: Sq; mid?: Sq }
export type Sequence = { moves: Step[]; board: Cell[][] }

export type Flight = {
  id: number
  piece: Cell
  from: Sq
  to: Sq
}

export function startBoard(): Cell[][] {
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

export const isW = (c: Cell) => c === 1 || c === 3
export const isB = (c: Cell) => c === 2 || c === 4
export const isK = (c: Cell) => c === 3 || c === 4
export const clone = (b: Cell[][]) => b.map((row) => [...row] as Cell[])
const ok = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8
export const same = (a: Sq, b: Sq) => a.r === b.r && a.c === b.c

const DIAG = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
] as const

export const FLIGHT_MS = 300

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

export function captureMoves(board: Cell[][], from: Sq): Move[] {
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

export function applyMove(board: Cell[][], move: { from: Sq; to: Sq; mid?: Sq }): Cell[][] {
  const next = clone(board)
  let piece = next[move.from.r][move.from.c]
  next[move.from.r][move.from.c] = 0
  if (move.mid) next[move.mid.r][move.mid.c] = 0
  if (piece === 1 && move.to.r === 0) piece = 3
  if (piece === 2 && move.to.r === 7) piece = 4
  next[move.to.r][move.to.c] = piece
  return next
}

export function allSideMoves(board: Cell[][], white: boolean): Step[] {
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

export function pickBotSequence(board: Cell[][], difficulty: BotDifficulty): Step[] {
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

export function CheckerDisc({ cell, flying }: { cell: Cell; flying?: boolean }) {
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

