import { useCallback, useMemo, useState } from 'react'

/** 0 empty, 1 white man, 2 black man, 3 white king, 4 black king */
type Cell = 0 | 1 | 2 | 3 | 4
type Sq = { r: number; c: number }
type Move = { from: Sq; to: Sq; mid?: Sq }

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
const clone = (b: Cell[][]) => b.map((r) => [...r] as Cell[])
const ok = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8

function dirs(piece: Cell): number[][] {
  if (isK(piece)) return [[-1, -1], [-1, 1], [1, -1], [1, 1]]
  return isW(piece) ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]]
}

function movesForPiece(board: Cell[][], from: Sq): Move[] {
  const piece = board[from.r][from.c]
  if (!piece) return []
  const caps: Move[] = []
  const steps: Move[] = []
  for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as number[][]) {
    const midR = from.r + dr
    const midC = from.c + dc
    const toR = from.r + dr * 2
    const toC = from.c + dc * 2
    if (!ok(toR, toC)) continue
    const mid = board[midR][midC]
    if (!mid || board[toR][toC] !== 0) continue
    if ((isW(piece) && isB(mid)) || (isB(piece) && isW(mid))) {
      caps.push({ from, to: { r: toR, c: toC }, mid: { r: midR, c: midC } })
    }
  }
  for (const [dr, dc] of dirs(piece)) {
    const r = from.r + dr
    const c = from.c + dc
    if (ok(r, c) && board[r][c] === 0) steps.push({ from, to: { r, c } })
  }
  return caps.length ? caps : steps
}

function allMoves(board: Cell[][], white: boolean): Move[] {
  const list: Move[] = []
  let mustCapture = false
  for (let r = 0; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      const p = board[r][c]
      if (!p) continue
      if (white !== isW(p)) continue
      const ms = movesForPiece(board, { r, c })
      if (ms.some((m) => m.mid)) mustCapture = true
      list.push(...ms)
    }
  }
  if (mustCapture) return list.filter((m) => m.mid)
  return list
}

function apply(board: Cell[][], move: Move): Cell[][] {
  const next = clone(board)
  let piece = next[move.from.r][move.from.c]
  next[move.from.r][move.from.c] = 0
  if (move.mid) next[move.mid.r][move.mid.c] = 0
  if (isW(piece) && move.to.r === 0) piece = 3
  if (isB(piece) && move.to.r === 7) piece = 4
  next[move.to.r][move.to.c] = piece
  return next
}

function icon(c: Cell) {
  if (c === 1) return '○'
  if (c === 2) return '●'
  if (c === 3) return '◎'
  if (c === 4) return '◉'
  return ''
}

export function CheckersGame({
  onHaptic,
}: {
  onHaptic?: (t?: 'light' | 'medium' | 'success' | 'error') => void
}) {
  const [board, setBoard] = useState(startBoard)
  const [turn, setTurn] = useState<'w' | 'b'>('w')
  const [selected, setSelected] = useState<Sq | null>(null)
  const [status, setStatus] = useState('Ваш ход')
  const [over, setOver] = useState(false)

  const legal = useMemo(() => allMoves(board, true), [board])
  const hints = useMemo(
    () => (selected ? legal.filter((m) => m.from.r === selected.r && m.from.c === selected.c) : []),
    [legal, selected],
  )

  const reset = useCallback(() => {
    setBoard(startBoard())
    setTurn('w')
    setSelected(null)
    setStatus('Ваш ход')
    setOver(false)
    onHaptic?.('medium')
  }, [onHaptic])

  const botPlay = (next: Cell[][]) => {
    const bot = allMoves(next, false)
    if (!bot.length) {
      setOver(true)
      setStatus('Победа!')
      onHaptic?.('success')
      return
    }
    setTurn('b')
    setStatus('Ход бота…')
    setTimeout(() => {
      const caps = bot.filter((m) => m.mid)
      const pool = caps.length ? caps : bot
      const choice = pool[Math.floor(Math.random() * pool.length)]
      const after = apply(next, choice)
      setBoard(after)
      const you = allMoves(after, true)
      if (!you.length) {
        setOver(true)
        setStatus('Поражение')
        onHaptic?.('error')
        setTurn('w')
        return
      }
      setTurn('w')
      setStatus('Ваш ход')
    }, 300)
  }

  const onCell = (r: number, c: number) => {
    if (over || turn !== 'w') return
    if (selected) {
      const move = hints.find((m) => m.to.r === r && m.to.c === c)
      if (move) {
        const next = apply(board, move)
        setBoard(next)
        setSelected(null)
        onHaptic?.('light')
        botPlay(next)
        return
      }
    }
    if (isW(board[r][c]) && legal.some((m) => m.from.r === r && m.from.c === c)) {
      setSelected({ r, c })
      onHaptic?.('light')
    } else setSelected(null)
  }

  return (
    <div className="table-area">
      <p className={`game-status ${over && status === 'Победа!' ? 'win' : over ? 'lose' : ''}`}>
        {status}
        {legal.some((m) => m.mid) && turn === 'w' && !over ? ' · нужно бить' : ''}
      </p>
      <div className="board-wrap">
        <div className="board checkers">
          {board.map((row, r) =>
            row.map((cell, c) => {
              const dark = (r + c) % 2 === 1
              return (
                <button
                  key={`${r}-${c}`}
                  type="button"
                  className={`cell ${dark ? 'dark' : 'light'} ${selected?.r === r && selected?.c === c ? 'selected' : ''} ${hints.some((h) => h.to.r === r && h.to.c === c) ? 'move-hint' : ''}`}
                  onClick={() => onCell(r, c)}
                >
                  {cell !== 0 && (
                    <span className="piece" style={{ color: isW(cell) ? '#f5f0e6' : '#1a1a1a', fontSize: isK(cell) ? '1.1em' : undefined }}>
                      {icon(cell)}
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
