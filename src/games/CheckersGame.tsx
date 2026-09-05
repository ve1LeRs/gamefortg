import { useCallback, useMemo, useState } from 'react'

/** 0 empty, 1 white man, 2 black man, 3 white king, 4 black king */
type Cell = 0 | 1 | 2 | 3 | 4
type Sq = { r: number; c: number }
/** One jump step; multi-jumps are played as a chain of these. */
type Move = { from: Sq; to: Sq; mid: Sq }

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

/** Quiet steps only (no captures). Men forward; kings fly any distance. */
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

/**
 * Single capture jumps from a square.
 * Russian draughts: men capture in all 4 diagonals; kings fly and may land any empty square beyond.
 */
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

  // Men: short jump, all 4 directions (can capture backward)
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
  // Promote on landing (also mid-combo → continues as king)
  if (piece === 1 && move.to.r === 0) piece = 3
  if (piece === 2 && move.to.r === 7) piece = 4
  next[move.to.r][move.to.c] = piece
  return next
}

function allSideMoves(board: Cell[][], white: boolean): ({ from: Sq; to: Sq; mid?: Sq })[] {
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

/** Prefer longer capturing sequences for the bot. */
function pickBotSequence(board: Cell[][]): { from: Sq; to: Sq; mid?: Sq }[] {
  const roots = allSideMoves(board, false).filter((m): m is Move => !!m.mid)
  if (!roots.length) {
    const quiet = allSideMoves(board, false)
    if (!quiet.length) return []
    return [quiet[Math.floor(Math.random() * quiet.length)]]
  }

  type Seq = { moves: Move[]; board: Cell[][] }
  let best: Seq[] = []
  let bestLen = 0

  const dfs = (b: Cell[][], from: Sq, path: Move[]) => {
    const nextCaps = captureMoves(b, from)
    if (!nextCaps.length) {
      if (path.length > bestLen) {
        bestLen = path.length
        best = [{ moves: path, board: b }]
      } else if (path.length === bestLen && path.length > 0) {
        best.push({ moves: path, board: b })
      }
      return
    }
    for (const m of nextCaps) {
      dfs(applyMove(b, m), m.to, [...path, m])
    }
  }

  for (const m of roots) {
    dfs(applyMove(board, m), m.to, [m])
  }

  if (!best.length) return [roots[0]]
  const choice = best[Math.floor(Math.random() * best.length)]
  return choice.moves
}

export function CheckersGame({
  onHaptic,
}: {
  onHaptic?: (t?: 'light' | 'medium' | 'success' | 'error') => void
}) {
  const [board, setBoard] = useState(() => startBoard())
  const [turn, setTurn] = useState<'w' | 'b'>('w')
  const [selected, setSelected] = useState<Sq | null>(null)
  /** When set, this piece must continue capturing. */
  const [chainFrom, setChainFrom] = useState<Sq | null>(null)
  const [status, setStatus] = useState('Вы — белые. Ваш ход')
  const [over, setOver] = useState(false)

  const legal = useMemo(() => {
    if (over) return [] as { from: Sq; to: Sq; mid?: Sq }[]
    if (turn !== 'w') return []
    if (chainFrom) return captureMoves(board, chainFrom)
    return allSideMoves(board, true)
  }, [board, turn, chainFrom, over])

  const hints = useMemo(
    () => (selected ? legal.filter((m) => same(m.from, selected)) : []),
    [legal, selected],
  )

  const mustCapture = legal.some((m) => m.mid)

  const reset = useCallback(() => {
    setBoard(startBoard())
    setTurn('w')
    setSelected(null)
    setChainFrom(null)
    setStatus('Вы — белые. Ваш ход')
    setOver(false)
    onHaptic?.('medium')
  }, [onHaptic])

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

  const botPlay = (next: Cell[][]) => {
    const seq = pickBotSequence(next)
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

    // Animate multi-jump step by step
    let i = 0
    let cur = next
    const step = () => {
      if (i >= seq.length) {
        setBoard(cur)
        finishBotTurn(cur)
        return
      }
      cur = applyMove(cur, seq[i])
      i += 1
      setBoard(clone(cur))
      onHaptic?.('light')
      window.setTimeout(step, seq.length > 1 ? 280 : 320)
    }
    window.setTimeout(step, 280)
  }

  const onCell = (r: number, c: number) => {
    if (over || turn !== 'w') return

    if (selected) {
      const move = hints.find((m) => m.to.r === r && m.to.c === c)
      if (move) {
        const next = applyMove(board, move)
        setBoard(next)
        onHaptic?.('light')

        if (move.mid) {
          const more = captureMoves(next, move.to)
          if (more.length) {
            setChainFrom(move.to)
            setSelected(move.to)
            setStatus('Продолжайте бить этой шашкой')
            return
          }
        }

        setSelected(null)
        setChainFrom(null)
        botPlay(next)
        return
      }

      // Mid-combo: can only move the chaining piece
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

  return (
    <div className="table-area">
      <p className={`game-status ${over && status === 'Победа!' ? 'win' : over ? 'lose' : ''}`}>
        {status}
        {mustCapture && turn === 'w' && !over && !status.includes('бить') ? ' · нужно бить' : ''}
      </p>
      <p className="checkers-sides" aria-hidden>
        <span className="checkers-side checkers-side-bot">Бот · чёрные</span>
        <span className="checkers-side checkers-side-you">Вы · белые</span>
      </p>
      <div className="board-wrap">
        <div className="board checkers">
          {board.map((row, r) =>
            row.map((cell, c) => {
              const dark = (r + c) % 2 === 1
              const isSel = selected?.r === r && selected?.c === c
              const isHint = hints.some((h) => h.to.r === r && h.to.c === c)
              const isCap = isHint && hints.some((h) => h.to.r === r && h.to.c === c && h.mid)
              return (
                <button
                  key={`${r}-${c}`}
                  type="button"
                  className={`cell ${dark ? 'dark' : 'light'} ${isSel ? 'selected' : ''} ${isHint && !isCap ? 'move-hint' : ''} ${isCap ? 'capture-hint' : ''}`}
                  onClick={() => onCell(r, c)}
                >
                  {cell !== 0 && (
                    <span
                      className={`checker ${isW(cell) ? 'checker-w' : 'checker-b'}${isK(cell) ? ' is-king' : ''}`}
                      aria-label={isK(cell) ? (isW(cell) ? 'белая дамка' : 'чёрная дамка') : isW(cell) ? 'белая шашка' : 'чёрная шашка'}
                    >
                      {isK(cell) && <span className="checker-crown">♛</span>}
                    </span>
                  )}
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
