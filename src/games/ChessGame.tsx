import { useCallback, useMemo, useState } from 'react'

type Color = 'w' | 'b'
type Piece = 'K' | 'Q' | 'R' | 'B' | 'N' | 'P' | 'k' | 'q' | 'r' | 'b' | 'n' | 'p' | null
type Sq = { r: number; c: number }

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

const GLYPH: Record<string, string> = {
  K: '♔',
  Q: '♕',
  R: '♖',
  B: '♗',
  N: '♘',
  P: '♙',
  k: '♚',
  q: '♛',
  r: '♜',
  b: '♝',
  n: '♞',
  p: '♟',
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
  const moves = pseudoMoves(board, from, false)
  return moves.some((m) => m.r === to.r && m.c === to.c)
}

function isInCheck(board: Piece[][], white: boolean): boolean {
  const king = findKing(board, white)
  if (!king) return true
  for (let r = 0; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      const p = board[r][c]
      if (!p) continue
      if (isWhite(p) === white) continue
      if (attacksSquare(board, { r, c }, king)) return true
    }
  }
  return false
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

function pseudoMoves(board: Piece[][], from: Sq, _filterCheck: boolean): Sq[] {
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
  }
  return moves
}

function legalMoves(board: Piece[][], from: Sq): Sq[] {
  const p = board[from.r][from.c]
  if (!p) return []
  const white = isWhite(p)
  return pseudoMoves(board, from, true).filter((to) => {
    const next = clone(board)
    next[to.r][to.c] = next[from.r][from.c]
    next[from.r][from.c] = null
    // promote
    const moved = next[to.r][to.c]
    if (moved === 'P' && to.r === 0) next[to.r][to.c] = 'Q'
    if (moved === 'p' && to.r === 7) next[to.r][to.c] = 'q'
    return !isInCheck(next, white)
  })
}

function allMoves(board: Piece[][], white: boolean): { from: Sq; to: Sq }[] {
  const list: { from: Sq; to: Sq }[] = []
  for (let r = 0; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      const p = board[r][c]
      if (!p || isWhite(p) !== white) continue
      for (const to of legalMoves(board, { r, c })) {
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

function scoreBoard(board: Piece[][]): number {
  let s = 0
  for (let r = 0; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      const p = board[r][c]
      if (!p) continue
      const v = VALUE[p] ?? 0
      s += isWhite(p) ? v : -v
    }
  }
  return s
}

function applyMove(board: Piece[][], from: Sq, to: Sq): Piece[][] {
  const next = clone(board)
  next[to.r][to.c] = next[from.r][from.c]
  next[from.r][from.c] = null
  const moved = next[to.r][to.c]
  if (moved === 'P' && to.r === 0) next[to.r][to.c] = 'Q'
  if (moved === 'p' && to.r === 7) next[to.r][to.c] = 'q'
  return next
}

function botMove(board: Piece[][]): Piece[][] {
  const moves = allMoves(board, false)
  if (moves.length === 0) return board
  let best = moves[0]
  let bestScore = Infinity
  for (const m of moves) {
    const next = applyMove(board, m.from, m.to)
    // 1-ply reply
    const replies = allMoves(next, true)
    let worst = scoreBoard(next)
    if (replies.length) {
      worst = -Infinity
      for (const r of replies.slice(0, 24)) {
        const after = applyMove(next, r.from, r.to)
        const sc = scoreBoard(after)
        if (sc > worst) worst = sc
      }
    }
    if (worst < bestScore || (worst === bestScore && Math.random() < 0.3)) {
      bestScore = worst
      best = m
    }
  }
  return applyMove(board, best.from, best.to)
}

export function ChessGame({ onHaptic }: { onHaptic?: (t?: 'light' | 'medium' | 'success' | 'error') => void }) {
  const [board, setBoard] = useState(() => clone(START))
  const [turn, setTurn] = useState<Color>('w')
  const [selected, setSelected] = useState<Sq | null>(null)
  const [status, setStatus] = useState('Ваш ход (белые)')
  const [over, setOver] = useState(false)

  const hints = useMemo(() => {
    if (!selected) return [] as Sq[]
    return legalMoves(board, selected)
  }, [board, selected])

  const reset = useCallback(() => {
    setBoard(clone(START))
    setTurn('w')
    setSelected(null)
    setStatus('Ваш ход (белые)')
    setOver(false)
    onHaptic?.('medium')
  }, [onHaptic])

  const onCell = (r: number, c: number) => {
    if (over || turn !== 'w') return
    const p = board[r][c]

    if (selected) {
      const can = hints.some((h) => h.r === r && h.c === c)
      if (can) {
        let next = applyMove(board, selected, { r, c })
        setBoard(next)
        setSelected(null)
        onHaptic?.('light')

        const botMoves = allMoves(next, false)
        if (botMoves.length === 0) {
          setOver(true)
          setStatus(isInCheck(next, false) ? 'Шах и мат! Победа.' : 'Пат. Ничья.')
          onHaptic?.(isInCheck(next, false) ? 'success' : 'medium')
          return
        }

        setStatus('Ход бота…')
        setTurn('b')
        setTimeout(() => {
          next = botMove(next)
          setBoard(next)
          const youMoves = allMoves(next, true)
          if (youMoves.length === 0) {
            setOver(true)
            setStatus(isInCheck(next, true) ? 'Мат. Поражение.' : 'Пат. Ничья.')
            onHaptic?.(isInCheck(next, true) ? 'error' : 'medium')
            setTurn('w')
            return
          }
          setTurn('w')
          setStatus(isInCheck(next, true) ? 'Шах! Ваш ход.' : 'Ваш ход (белые)')
        }, 350)
        return
      }
    }

    if (p && isWhite(p)) {
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
                  {p && <span className="piece">{GLYPH[p]}</span>}
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
