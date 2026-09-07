import { useCallback, useMemo, useState } from 'react'

type Color = 'w' | 'b'
type Piece = 'K' | 'Q' | 'R' | 'B' | 'N' | 'P' | 'k' | 'q' | 'r' | 'b' | 'n' | 'p' | null
type Sq = { r: number; c: number }
type Castle = { wK: boolean; wQ: boolean; bK: boolean; bQ: boolean }

const START_CASTLE: Castle = { wK: true, wQ: true, bK: true, bQ: true }

const START: Piece[][] = [
  ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'],
  ['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p'],
  [null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null],
  ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'],
  ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'],
]

/** Outline glyphs for white (iOS ignores CSS color on filled ♟ etc.). */
const GLYPH: Record<string, string> = {
  K: '♔',
  Q: '♕',
  R: '♖',
  B: '♗',
  N: '♘',
  // White pawn ♙ is drawn as a filled black pawn on Apple Color Emoji — use SVG instead.
  P: '♙',
  k: '♚',
  q: '♛',
  r: '♜',
  b: '♝',
  n: '♞',
  p: '♟',
}

/** Cream-filled pawn; emoji ♙ cannot be recolored on iOS/Telegram. */
function WhitePawnIcon() {
  return (
    <svg className="piece-svg" viewBox="0 0 45 45" aria-hidden>
      <path
        d="M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03-3 1.06-7.41 5.55-7.41 13.47h23c0-7.92-4.41-12.41-7.41-13.47 1.47-1.19 2.41-3 2.41-5.03 0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z"
        fill="#f3ebe0"
        stroke="#2a1c12"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

function PieceGlyph({ piece }: { piece: NonNullable<Piece> }) {
  const white = isWhite(piece)
  if (piece === 'P') {
    return (
      <span className="piece piece-w piece-svg-wrap">
        <WhitePawnIcon />
      </span>
    )
  }
  return <span className={`piece ${white ? 'piece-w' : 'piece-b'}`}>{GLYPH[piece]}</span>
}

function clone(board: Piece[][]): Piece[][] {
  return board.map((row) => [...row])
}

function isWhite(p: Piece): boolean {
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

function isInCheck(board: Piece[][], white: boolean): boolean {
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

function legalMoves(board: Piece[][], from: Sq, castle: Castle): Sq[] {
  const p = board[from.r][from.c]
  if (!p) return []
  const white = isWhite(p)
  return pseudoMoves(board, from, castle).filter((to) => {
    const next = applyMove(board, from, to)
    return !isInCheck(next, white)
  })
}

function allMoves(board: Piece[][], white: boolean, castle: Castle): { from: Sq; to: Sq }[] {
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

function playMove(board: Piece[][], from: Sq, to: Sq, castle: Castle): { board: Piece[][]; castle: Castle } {
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

const BOT_DEPTH = 3

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

function botMove(board: Piece[][], castle: Castle): { board: Piece[][]; castle: Castle } {
  const moves = orderedMoves(board, false, castle)
  if (moves.length === 0) return { board, castle }

  let best = moves[0]
  let bestScore = Infinity
  let alpha = -Infinity
  let beta = Infinity

  for (const m of moves) {
    const next = playMove(board, m.from, m.to, castle)
    // Bot is black: minimize white's score
    const sc = minimax(next.board, next.castle, BOT_DEPTH - 1, alpha, beta, true)
    if (sc < bestScore) {
      bestScore = sc
      best = m
      beta = Math.min(beta, sc)
    }
  }
  return playMove(board, best.from, best.to, castle)
}

export function ChessGame({ onHaptic }: { onHaptic?: (t?: 'light' | 'medium' | 'success' | 'error') => void }) {
  const [board, setBoard] = useState(() => clone(START))
  const [castle, setCastle] = useState<Castle>(() => ({ ...START_CASTLE }))
  const [turn, setTurn] = useState<Color>('w')
  const [selected, setSelected] = useState<Sq | null>(null)
  const [status, setStatus] = useState('Вы — белые. Ваш ход')
  const [over, setOver] = useState(false)

  const hints = useMemo(() => {
    if (!selected) return [] as Sq[]
    return legalMoves(board, selected, castle)
  }, [board, selected, castle])

  const reset = useCallback(() => {
    setBoard(clone(START))
    setCastle({ ...START_CASTLE })
    setTurn('w')
    setSelected(null)
    setStatus('Вы — белые. Ваш ход')
    setOver(false)
    onHaptic?.('medium')
  }, [onHaptic])

  const onCell = (r: number, c: number) => {
    if (over || turn !== 'w') return
    const p = board[r][c]

    if (selected) {
      const can = hints.some((h) => h.r === r && h.c === c)
      if (can) {
        let played = playMove(board, selected, { r, c }, castle)
        setBoard(played.board)
        setCastle(played.castle)
        setSelected(null)
        onHaptic?.('light')

        const botMoves = allMoves(played.board, false, played.castle)
        if (botMoves.length === 0) {
          setOver(true)
          setStatus(isInCheck(played.board, false) ? 'Шах и мат! Победа.' : 'Пат. Ничья.')
          onHaptic?.(isInCheck(played.board, false) ? 'success' : 'medium')
          return
        }

        setStatus('Ход бота…')
        setTurn('b')
        setTimeout(() => {
          played = botMove(played.board, played.castle)
          setBoard(played.board)
          setCastle(played.castle)
          const youMoves = allMoves(played.board, true, played.castle)
          if (youMoves.length === 0) {
            setOver(true)
            setStatus(isInCheck(played.board, true) ? 'Мат. Поражение.' : 'Пат. Ничья.')
            onHaptic?.(isInCheck(played.board, true) ? 'error' : 'medium')
            setTurn('w')
            return
          }
          setTurn('w')
          setStatus(isInCheck(played.board, true) ? 'Шах! Ваш ход (белые).' : 'Вы — белые. Ваш ход')
        }, 420)
        return
      }
    }

    // Player always owns white; black is bot-only
    if (p && isWhite(p) && turn === 'w') {
      setSelected({ r, c })
      onHaptic?.('light')
    } else {
      setSelected(null)
    }
  }

  return (
    <div className="table-area">
      <p className={`game-status ${over && status.includes('Победа') ? 'win' : over && status.includes('Поражение') ? 'lose' : ''}`}>
        {status}
      </p>
      <p className="chess-sides" aria-hidden>
        <span className="chess-side chess-side-bot">Бот · чёрные</span>
        <span className="chess-side chess-side-you">Вы · белые</span>
      </p>
      <div className="board-wrap">
        <div className="board chess">
          {board.map((row, r) =>
            row.map((p, c) => {
              const dark = (r + c) % 2 === 1
              const isSel = selected?.r === r && selected?.c === c
              const isHint = hints.some((h) => h.r === r && h.c === c)
              const capture = isHint && !!p
              return (
                <button
                  key={`${r}-${c}`}
                  type="button"
                  className={`cell ${dark ? 'dark' : 'light'} ${isSel ? 'selected' : ''} ${isHint && !capture ? 'move-hint' : ''} ${capture ? 'capture-hint' : ''}`}
                  onClick={() => onCell(r, c)}
                >
                  {p && <PieceGlyph piece={p} />}
                </button>
              )
            }),
          )}
        </div>
      </div>
      <div className="action-bar">
        <button type="button" className="btn btn-soft" onClick={reset}>
          Новая партия
        </button>
      </div>
    </div>
  )
}
