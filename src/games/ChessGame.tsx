import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BOT_DIFFICULTIES,
  BOT_DIFFICULTY_HINT,
  BOT_DIFFICULTY_LABEL,
  type BotDifficulty,
} from './botDifficulty'
import {
  type Color,
  type Piece,
  type Sq,
  type Castle,
  START,
  START_CASTLE,
  PieceGlyph,
  clone,
  isWhite,
  isInCheck,
  legalMoves,
  allMoves,
  playMove,
  botMove,
  flipSq,
  youStatus,
  newHumanColor,
} from './chess/engine'

export function ChessGame({ onHaptic }: { onHaptic?: (t?: 'light' | 'medium' | 'success' | 'error') => void }) {
  const [phase, setPhase] = useState<'setup' | 'play'>('setup')
  const [pick, setPick] = useState<BotDifficulty>('medium')
  const [human, setHuman] = useState<Color>('w')
  const [board, setBoard] = useState(() => clone(START))
  const [castle, setCastle] = useState<Castle>(() => ({ ...START_CASTLE }))
  const [turn, setTurn] = useState<Color>('w')
  const [selected, setSelected] = useState<Sq | null>(null)
  const [status, setStatus] = useState('Выберите сложность')
  const [over, setOver] = useState(false)
  const [difficulty, setDifficulty] = useState<BotDifficulty>('medium')
  const flipped = human === 'b'
  const bot = human === 'w' ? 'b' : 'w'
  const difficultyRef = useRef(difficulty)
  difficultyRef.current = difficulty
  const botTimer = useRef<number | null>(null)

  const hints = useMemo(() => {
    if (!selected) return [] as Sq[]
    return legalMoves(board, selected, castle)
  }, [board, selected, castle])

  const hintSquares = useMemo(() => {
    if (!selected) return [] as Sq[]
    const piece = board[selected.r][selected.c]
    if (!piece || piece.toUpperCase() !== 'K') return hints
    const extra: Sq[] = []
    for (const h of hints) {
      if (Math.abs(h.c - selected.c) !== 2 || h.r !== selected.r) continue
      if (h.c === 6) extra.push({ r: h.r, c: 7 })
      if (h.c === 2) extra.push({ r: h.r, c: 0 })
    }
    return [...hints, ...extra]
  }, [board, selected, hints])

  const resolveMoveTo = (r: number, c: number): Sq | null => {
    if (!selected) return null
    if (hints.some((h) => h.r === r && h.c === c)) return { r, c }
    const piece = board[selected.r][selected.c]
    const target = board[r][c]
    if (piece?.toUpperCase() === 'K' && target && target.toUpperCase() === 'R' && r === selected.r) {
      if (c === 7) {
        const dest = hints.find((h) => h.r === r && h.c === 6)
        if (dest) return dest
      }
      if (c === 0) {
        const dest = hints.find((h) => h.r === r && h.c === 2)
        if (dest) return dest
      }
    }
    return null
  }

  const clearBotTimer = () => {
    if (botTimer.current != null) {
      window.clearTimeout(botTimer.current)
      botTimer.current = null
    }
  }

  useEffect(() => () => clearBotTimer(), [])

  const runBotTurn = useCallback(
    (played: { board: Piece[][]; castle: Castle }, humanColor: Color) => {
      const botColor = humanColor === 'w' ? 'b' : 'w'
      const botMoves = allMoves(played.board, botColor === 'w', played.castle)
      if (botMoves.length === 0) {
        setOver(true)
        setStatus(isInCheck(played.board, botColor === 'w') ? 'Шах и мат! Победа.' : 'Пат. Ничья.')
        onHaptic?.(isInCheck(played.board, botColor === 'w') ? 'success' : 'medium')
        return
      }

      setStatus('Ход бота…')
      setTurn(botColor)
      clearBotTimer()
      botTimer.current = window.setTimeout(() => {
        botTimer.current = null
        const next = botMove(played.board, played.castle, botColor === 'w', difficultyRef.current)
        setBoard(next.board)
        setCastle(next.castle)
        const youMoves = allMoves(next.board, humanColor === 'w', next.castle)
        if (youMoves.length === 0) {
          setOver(true)
          setStatus(isInCheck(next.board, humanColor === 'w') ? 'Мат. Поражение.' : 'Пат. Ничья.')
          onHaptic?.(isInCheck(next.board, humanColor === 'w') ? 'error' : 'medium')
          setTurn(humanColor)
          return
        }
        setTurn(humanColor)
        setStatus(youStatus(humanColor, next.board))
      }, 420)
    },
    [onHaptic],
  )

  const goSetup = useCallback(() => {
    clearBotTimer()
    setPhase('setup')
    setPick(difficulty)
    setHuman('w')
    setBoard(clone(START))
    setCastle({ ...START_CASTLE })
    setTurn('w')
    setSelected(null)
    setOver(false)
    setStatus('Выберите сложность')
    onHaptic?.('medium')
  }, [difficulty, onHaptic])

  const startGame = useCallback(
    (level: BotDifficulty) => {
      clearBotTimer()
      const nextHuman = newHumanColor()
      setDifficulty(level)
      setPick(level)
      setHuman(nextHuman)
      setBoard(clone(START))
      setCastle({ ...START_CASTLE })
      setSelected(null)
      setOver(false)
      setPhase('play')
      onHaptic?.('medium')
      if (nextHuman === 'w') {
        setTurn('w')
        setStatus('Вы — белые. Ваш ход')
      } else {
        setTurn('b')
        setStatus('Вы — чёрные. Ход бота…')
        botTimer.current = window.setTimeout(() => {
          botTimer.current = null
          runBotTurn({ board: clone(START), castle: { ...START_CASTLE } }, 'b')
        }, 350)
      }
    },
    [onHaptic, runBotTurn],
  )

  const onCellDisplay = (dr: number, dc: number) => {
    if (phase !== 'play' || over || turn !== human) return
    const { r, c } = flipped ? flipSq({ r: dr, c: dc }) : { r: dr, c: dc }
    const p = board[r][c]

    if (selected) {
      const dest = resolveMoveTo(r, c)
      if (dest) {
        const played = playMove(board, selected, dest, castle)
        setBoard(played.board)
        setCastle(played.castle)
        setSelected(null)
        onHaptic?.('light')
        runBotTurn(played, human)
        return
      }
    }

    const mine = !!p && isWhite(p) === (human === 'w')
    if (mine && turn === human) {
      setSelected({ r, c })
      const moves = legalMoves(board, { r, c }, castle)
      if (p && p.toUpperCase() === 'K' && moves.some((m) => Math.abs(m.c - c) === 2)) {
        setStatus(human === 'w' ? 'Рокировка: король на g1/c1 или нажмите ладью' : 'Рокировка: король на g8/c8 или нажмите ладью')
      } else if (!over) {
        setStatus(youStatus(human, board))
      }
      onHaptic?.('light')
    } else {
      setSelected(null)
    }
  }

  const displayHintSquares = useMemo(() => {
    if (!flipped) return hintSquares
    return hintSquares.map(flipSq)
  }, [hintSquares, flipped])

  const displaySelected = selected && flipped ? flipSq(selected) : selected

  const cells: { r: number; c: number; p: Piece }[] = []
  for (let dr = 0; dr < 8; dr += 1) {
    for (let dc = 0; dc < 8; dc += 1) {
      const src = flipped ? flipSq({ r: dr, c: dc }) : { r: dr, c: dc }
      cells.push({ r: dr, c: dc, p: board[src.r][src.c] })
    }
  }

  if (phase === 'setup') {
    return (
      <div className="table-area bot-setup">
        <h2 className="bot-setup-title">Шахматы</h2>
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
      <p className={`game-status ${over && status.includes('Победа') ? 'win' : over && status.includes('Поражение') ? 'lose' : ''}`}>
        {status}
      </p>
      <p className="chess-sides" aria-hidden>
        <span className={`chess-side ${bot === 'b' ? 'chess-side-bot' : 'chess-side-you'}`}>
          Бот · {bot === 'b' ? 'чёрные' : 'белые'} · {BOT_DIFFICULTY_LABEL[difficulty]}
        </span>
        <span className={`chess-side ${human === 'w' ? 'chess-side-you' : 'chess-side-bot'}`}>
          Вы · {human === 'w' ? 'белые' : 'чёрные'}
        </span>
      </p>
      <div className="board-wrap">
        <div className="board chess">
          {cells.map(({ r, c, p }) => {
            const dark = (r + c) % 2 === 1
            const isSel = displaySelected?.r === r && displaySelected?.c === c
            const isHint = displayHintSquares.some((h) => h.r === r && h.c === c)
            const src = flipped ? flipSq({ r, c }) : { r, c }
            const boardPiece = board[src.r][src.c]
            const selPiece = selected ? board[selected.r][selected.c] : null
            const capture =
              isHint && !!boardPiece && !(selPiece && selPiece.toUpperCase() === 'K' && boardPiece.toUpperCase() === 'R')
            return (
              <button
                key={`${r}-${c}`}
                type="button"
                className={`cell ${dark ? 'dark' : 'light'} ${isSel ? 'selected' : ''} ${isHint && !capture ? 'move-hint' : ''} ${capture ? 'capture-hint' : ''}`}
                onClick={() => onCellDisplay(r, c)}
              >
                {p && <PieceGlyph piece={p} />}
              </button>
            )
          })}
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
