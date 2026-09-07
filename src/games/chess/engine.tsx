import { ChessPieceSvg } from '../../components/ChessPieceSvg'
import type { BotDifficulty } from '../botDifficulty'


export type Color = 'w' | 'b'
export type Piece = 'K' | 'Q' | 'R' | 'B' | 'N' | 'P' | 'k' | 'q' | 'r' | 'b' | 'n' | 'p' | null
export type Sq = { r: number; c: number }
export type Castle = { wK: boolean; wQ: boolean; bK: boolean; bQ: boolean }

export const START_CASTLE: Castle = { wK: true, wQ: true, bK: true, bQ: true }

export const START: Piece[][] = [
  ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'],
  ['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p'],
  [null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null],
  ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'],
  ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'],
]

export function PieceGlyph({ piece }: { piece: NonNullable<Piece> }) {
  const white = isWhite(piece)
  const kind = piece.toUpperCase() as 'K' | 'Q' | 'R' | 'B' | 'N' | 'P'
  return (
    <span className={`piece piece-svg-wrap ${white ? 'piece-w' : 'piece-b'}`}>
      <ChessPieceSvg kind={kind} white={white} />
    </span>
  )
}

export function clone(board: Piece[][]): Piece[][] {
  return board.map((row) => [...row])
}

export function isWhite(p: Piece): boolean {
  return !!p && p === p.toUpperCase()
}

function inBounds(r: number, c: number) {
  return r >= 0 && r < 8 && c >= 0 && c < 8
}

function findKing(board: Piece[][], white: boolean): Sq | null {
  const target = white ? 'K' : 'k'
  for (let r = 0; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      if (board[r][c] === target) return { r, c }
    }
  }
  return null
}

function attacksSquare(board: Piece[][], from: Sq, to: Sq): boolean {
  // Castling is never an attack — omit castle rights here.
  const moves = pseudoMoves(board, from, null)
  return moves.some((m) => m.r === to.r && m.c === to.c)
}

function isSquareAttacked(board: Piece[][], sq: Sq, whiteVictim: boolean): boolean {
  for (let r = 0; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      const p = board[r][c]
      if (!p) continue
      if (isWhite(p) === whiteVictim) continue
      if (attacksSquare(board, { r, c }, sq)) return true
    }
  }
  return false
}

export function isInCheck(board: Piece[][], white: boolean): boolean {
  const king = findKing(board, white)
  if (!king) return true
  return isSquareAttacked(board, king, white)
}

function updateCastle(castle: Castle, moved: Piece, from: Sq, to: Sq): Castle {
  const next = { ...castle }
  if (moved === 'K') {
    next.wK = false
    next.wQ = false
  } else if (moved === 'k') {
    next.bK = false
    next.bQ = false
  } else if (moved === 'R') {
    if (from.r === 7 && from.c === 0) next.wQ = false
    if (from.r === 7 && from.c === 7) next.wK = false
  } else if (moved === 'r') {
    if (from.r === 0 && from.c === 0) next.bQ = false
    if (from.r === 0 && from.c === 7) next.bK = false
  }
  // Rook captured on its starting square
  if (to.r === 7 && to.c === 0) next.wQ = false
  if (to.r === 7 && to.c === 7) next.wK = false
  if (to.r === 0 && to.c === 0) next.bQ = false
  if (to.r === 0 && to.c === 7) next.bK = false
  return next
}

function appendCastling(board: Piece[][], from: Sq, white: boolean, castle: Castle, moves: Sq[]) {
  const row = white ? 7 : 0
  if (from.r !== row || from.c !== 4) return
  if (isInCheck(board, white)) return
  const rook = white ? 'R' : 'r'

  if ((white ? castle.wK : castle.bK) && board[row][7] === rook && !board[row][5] && !board[row][6]) {
    if (!isSquareAttacked(board, { r: row, c: 5 }, white) && !isSquareAttacked(board, { r: row, c: 6 }, white)) {
      moves.push({ r: row, c: 6 })
    }
  }
  if (
    (white ? castle.wQ : castle.bQ) &&
    board[row][0] === rook &&
    !board[row][1] &&
    !board[row][2] &&
    !board[row][3]
  ) {
    if (!isSquareAttacked(board, { r: row, c: 3 }, white) && !isSquareAttacked(board, { r: row, c: 2 }, white)) {
      moves.push({ r: row, c: 2 })
    }
  }
}

function rayMoves(board: Piece[][], r: number, c: number, dirs: number[][], white: boolean): Sq[] {
  const out: Sq[] = []
  for (const [dr, dc] of dirs) {
    let nr = r + dr
    let nc = c + dc
    while (inBounds(nr, nc)) {
      const t = board[nr][nc]
      if (!t) out.push({ r: nr, c: nc })
      else {
        if (isWhite(t) !== white) out.push({ r: nr, c: nc })
        break
      }
      nr += dr
      nc += dc
    }
  }
  return out
}

function pseudoMoves(board: Piece[][], from: Sq, castle: Castle | null): Sq[] {
  const p = board[from.r][from.c]
  if (!p) return []
  const white = isWhite(p)
  const kind = p.toUpperCase()
  const moves: Sq[] = []

  if (kind === 'P') {
    const dir = white ? -1 : 1
    const start = white ? 6 : 1
    const nr = from.r + dir
    if (inBounds(nr, from.c) && !board[nr][from.c]) {
      moves.push({ r: nr, c: from.c })
      if (from.r === start && !board[from.r + dir * 2][from.c]) {
        moves.push({ r: from.r + dir * 2, c: from.c })
      }
    }
    for (const dc of [-1, 1]) {
      const nc = from.c + dc
      if (inBounds(nr, nc) && board[nr][nc] && isWhite(board[nr][nc]) !== white) {
        moves.push({ r: nr, c: nc })
      }
    }
  } else if (kind === 'N') {
    for (const [dr, dc] of [
      [-2, -1],
      [-2, 1],
      [-1, -2],
      [-1, 2],
      [1, -2],
      [1, 2],
      [2, -1],
      [2, 1],
    ]) {
      const nr = from.r + dr
      const nc = from.c + dc
      if (!inBounds(nr, nc)) continue
      const t = board[nr][nc]
      if (!t || isWhite(t) !== white) moves.push({ r: nr, c: nc })
    }
  } else if (kind === 'B') {
    moves.push(...rayMoves(board, from.r, from.c, [[-1, -1], [-1, 1], [1, -1], [1, 1]], white))
  } else if (kind === 'R') {
    moves.push(...rayMoves(board, from.r, from.c, [[-1, 0], [1, 0], [0, -1], [0, 1]], white))
  } else if (kind === 'Q') {
    moves.push(
      ...rayMoves(
        board,
        from.r,
        from.c,
        [
          [-1, -1],
          [-1, 1],
          [1, -1],
          [1, 1],
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ],
        white,
      ),
    )
  } else if (kind === 'K') {
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (!dr && !dc) continue
        const nr = from.r + dr
        const nc = from.c + dc
        if (!inBounds(nr, nc)) continue
        const t = board[nr][nc]
        if (!t || isWhite(t) !== white) moves.push({ r: nr, c: nc })
      }
    }
    if (castle) appendCastling(board, from, white, castle, moves)
  }
  return moves
}

export function legalMoves(board: Piece[][], from: Sq, castle: Castle): Sq[] {
  const p = board[from.r][from.c]
  if (!p) return []
  const white = isWhite(p)
  return pseudoMoves(board, from, castle).filter((to) => {
    const next = applyMove(board, from, to)
    return !isInCheck(next, white)
  })
}

export function allMoves(board: Piece[][], white: boolean, castle: Castle): { from: Sq; to: Sq }[] {
  const list: { from: Sq; to: Sq }[] = []
  for (let r = 0; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      const p = board[r][c]
      if (!p || isWhite(p) !== white) continue
      for (const to of legalMoves(board, { r, c }, castle)) {
        list.push({ from: { r, c }, to })
      }
    }
  }
  return list
}

const VALUE: Record<string, number> = {
  P: 100,
  N: 320,
  B: 330,
  R: 500,
  Q: 900,
  K: 20000,
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
}

/** Piece-square tables from white's POV (row 0 = black back rank). */
const PST: Record<string, number[][]> = {
  P: [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [50, 50, 50, 50, 50, 50, 50, 50],
    [10, 10, 20, 30, 30, 20, 10, 10],
    [5, 5, 10, 25, 25, 10, 5, 5],
    [0, 0, 0, 20, 20, 0, 0, 0],
    [5, -5, -10, 0, 0, -10, -5, 5],
    [5, 10, 10, -20, -20, 10, 10, 5],
    [0, 0, 0, 0, 0, 0, 0, 0],
  ],
  N: [
    [-50, -40, -30, -30, -30, -30, -40, -50],
    [-40, -20, 0, 0, 0, 0, -20, -40],
    [-30, 0, 10, 15, 15, 10, 0, -30],
    [-30, 5, 15, 20, 20, 15, 5, -30],
    [-30, 0, 15, 20, 20, 15, 0, -30],
    [-30, 5, 10, 15, 15, 10, 5, -30],
    [-40, -20, 0, 5, 5, 0, -20, -40],
    [-50, -40, -30, -30, -30, -30, -40, -50],
  ],
  B: [
    [-20, -10, -10, -10, -10, -10, -10, -20],
    [-10, 0, 0, 0, 0, 0, 0, -10],
    [-10, 0, 5, 10, 10, 5, 0, -10],
    [-10, 5, 5, 10, 10, 5, 5, -10],
    [-10, 0, 10, 10, 10, 10, 0, -10],
    [-10, 10, 10, 10, 10, 10, 10, -10],
    [-10, 5, 0, 0, 0, 0, 5, -10],
    [-20, -10, -10, -10, -10, -10, -10, -20],
  ],
  R: [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [5, 10, 10, 10, 10, 10, 10, 5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [0, 0, 0, 5, 5, 0, 0, 0],
  ],
  Q: [
    [-20, -10, -10, -5, -5, -10, -10, -20],
    [-10, 0, 0, 0, 0, 0, 0, -10],
    [-10, 0, 5, 5, 5, 5, 0, -10],
    [-5, 0, 5, 5, 5, 5, 0, -5],
    [0, 0, 5, 5, 5, 5, 0, -5],
    [-10, 5, 5, 5, 5, 5, 0, -10],
    [-10, 0, 5, 0, 0, 0, 0, -10],
    [-20, -10, -10, -5, -5, -10, -10, -20],
  ],
  K: [
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-20, -30, -30, -40, -40, -30, -30, -20],
    [-10, -20, -20, -20, -20, -20, -20, -10],
    [20, 20, 0, 0, 0, 0, 20, 20],
    [20, 30, 10, 0, 0, 10, 30, 20],
  ],
}

function pieceValue(p: Piece): number {
  return p ? VALUE[p] ?? 0 : 0
}

function scoreBoard(board: Piece[][]): number {
  let s = 0
  for (let r = 0; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      const p = board[r][c]
      if (!p) continue
      const kind = p.toUpperCase()
      const table = PST[kind]
      const pst = table ? (isWhite(p) ? table[r][c] : table[7 - r][c]) : 0
      const v = (VALUE[p] ?? 0) + pst
      if (isWhite(p)) s += v
      else s -= v
    }
  }
  if (isInCheck(board, true)) s -= 50
  if (isInCheck(board, false)) s += 50
  return s
}

function applyMove(board: Piece[][], from: Sq, to: Sq): Piece[][] {
  const next = clone(board)
  const piece = next[from.r][from.c]
  next[to.r][to.c] = piece
  next[from.r][from.c] = null
  // Castling: king jumps two files — also move the rook.
  if (piece && piece.toUpperCase() === 'K' && Math.abs(to.c - from.c) === 2) {
    if (to.c === 6) {
      next[to.r][5] = next[to.r][7]
      next[to.r][7] = null
    } else if (to.c === 2) {
      next[to.r][3] = next[to.r][0]
      next[to.r][0] = null
    }
  }
  const moved = next[to.r][to.c]
  if (moved === 'P' && to.r === 0) next[to.r][to.c] = 'Q'
  if (moved === 'p' && to.r === 7) next[to.r][to.c] = 'q'
  return next
}

export function playMove(board: Piece[][], from: Sq, to: Sq, castle: Castle): { board: Piece[][]; castle: Castle } {
  const piece = board[from.r][from.c]
  return {
    board: applyMove(board, from, to),
    castle: updateCastle(castle, piece, from, to),
  }
}

function moveOrderKey(board: Piece[][], m: { from: Sq; to: Sq }): number {
  const victim = board[m.to.r][m.to.c]
  const attacker = board[m.from.r][m.from.c]
  // MVV-LVA: prefer valuable captures first for alpha-beta cutoffs
  const cap = victim ? pieceValue(victim) * 10 - pieceValue(attacker) : 0
  // Mild bonus for castling so the bot considers it early
  const castleBonus = attacker && attacker.toUpperCase() === 'K' && Math.abs(m.to.c - m.from.c) === 2 ? 40 : 0
  return cap + castleBonus
}

function orderedMoves(board: Piece[][], white: boolean, castle: Castle): { from: Sq; to: Sq }[] {
  const moves = allMoves(board, white, castle)
  moves.sort((a, b) => moveOrderKey(board, b) - moveOrderKey(board, a))
  return moves
}

const DIFFICULTY_DEPTH: Record<BotDifficulty, number> = {
  easy: 1,
  medium: 2,
  hard: 3,
}

function minimax(
  board: Piece[][],
  castle: Castle,
  depth: number,
  alpha: number,
  beta: number,
  maximizingWhite: boolean,
): number {
  if (depth === 0) return scoreBoard(board)

  const moves = orderedMoves(board, maximizingWhite, castle)
  if (moves.length === 0) {
    // Checkmate is catastrophic; stalemate is draw
    if (maximizingWhite) return isInCheck(board, true) ? -100000 - depth : 0
    return isInCheck(board, false) ? 100000 + depth : 0
  }

  if (maximizingWhite) {
    let best = -Infinity
    for (const m of moves) {
      const next = playMove(board, m.from, m.to, castle)
      const sc = minimax(next.board, next.castle, depth - 1, alpha, beta, false)
      if (sc > best) best = sc
      if (sc > alpha) alpha = sc
      if (beta <= alpha) break
    }
    return best
  }

  let best = Infinity
  for (const m of moves) {
    const next = playMove(board, m.from, m.to, castle)
    const sc = minimax(next.board, next.castle, depth - 1, alpha, beta, true)
    if (sc < best) best = sc
    if (sc < beta) beta = sc
    if (beta <= alpha) break
  }
  return best
}

export function botMove(
  board: Piece[][],
  castle: Castle,
  botWhite: boolean,
  difficulty: BotDifficulty,
): { board: Piece[][]; castle: Castle } {
  const moves = orderedMoves(board, botWhite, castle)
  if (moves.length === 0) return { board, castle }

  const depth = DIFFICULTY_DEPTH[difficulty]

  // Easy: often play a random legal move so the bot blunders.
  if (difficulty === 'easy' && Math.random() < 0.45) {
    const pick = moves[Math.floor(Math.random() * moves.length)]
    return playMove(board, pick.from, pick.to, castle)
  }

  const scored: { m: { from: Sq; to: Sq }; sc: number }[] = []
  let alpha = -Infinity
  let beta = Infinity

  for (const m of moves) {
    const next = playMove(board, m.from, m.to, castle)
    const sc = depth <= 1 ? scoreBoard(next.board) : minimax(next.board, next.castle, depth - 1, alpha, beta, !botWhite)
    scored.push({ m, sc })
    if (botWhite) {
      if (sc > alpha) alpha = sc
    } else if (sc < beta) {
      beta = sc
    }
  }

  scored.sort((a, b) => (botWhite ? b.sc - a.sc : a.sc - b.sc))

  // Medium: occasionally pick 2nd/3rd best; hard always takes the top.
  let pickIndex = 0
  if (difficulty === 'easy') {
    pickIndex = Math.min(scored.length - 1, Math.floor(Math.random() * Math.min(4, scored.length)))
  } else if (difficulty === 'medium' && scored.length > 1 && Math.random() < 0.28) {
    pickIndex = 1 + Math.floor(Math.random() * Math.min(2, scored.length - 1))
  }

  const best = scored[pickIndex].m
  return playMove(board, best.from, best.to, castle)
}

export function flipSq(sq: Sq): Sq {
  return { r: 7 - sq.r, c: 7 - sq.c }
}

export function youStatus(human: Color, board: Piece[][]): string {
  const side = human === 'w' ? 'белые' : 'чёрные'
  return isInCheck(board, human === 'w') ? `Шах! Ваш ход (${side}).` : `Вы — ${side}. Ваш ход`
}

export function newHumanColor(): Color {
  return Math.random() < 0.5 ? 'w' : 'b'
}

