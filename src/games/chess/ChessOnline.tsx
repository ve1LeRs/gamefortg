import { useMemo, useState } from 'react'
import { OnlineLobbyMenu, OnlineWait, useOnlineLobbyRoom } from '../../components/OnlineLobby'
import {
  type ChessAction,
  type ChessNetState,
  hostChessRoom,
  joinChessRoom,
  watchChessLobby,
} from './peerRoom'
import {
  type Piece,
  type Sq,
  PieceGlyph,
  flipSq,
  isWhite,
  legalMoves,
} from './engine'

function ChessOnlineTable({
  state,
  role,
  opponentName,
  onMove,
  onLeave,
  onHaptic,
}: {
  state: ChessNetState
  role: 'host' | 'guest'
  opponentName: string
  onMove: (action: ChessAction) => void
  onLeave: () => void
  onHaptic?: (t?: 'light' | 'medium' | 'success' | 'error') => void
}) {
  const human = role === 'host' ? 'w' : 'b'
  const flipped = human === 'b'
  const [selected, setSelected] = useState<Sq | null>(null)
  const myTurn = !state.over && state.turn === human
  const status = role === 'host' ? state.statusHost : state.statusGuest

  const hints = useMemo(() => {
    if (!selected || !myTurn) return [] as Sq[]
    return legalMoves(state.board, selected, state.castle)
  }, [selected, myTurn, state.board, state.castle])

  const hintSquares = useMemo(() => {
    if (!selected) return [] as Sq[]
    const piece = state.board[selected.r][selected.c]
    if (!piece || piece.toUpperCase() !== 'K') return hints
    const extra: Sq[] = []
    for (const h of hints) {
      if (Math.abs(h.c - selected.c) !== 2 || h.r !== selected.r) continue
      if (h.c === 6) extra.push({ r: h.r, c: 7 })
      if (h.c === 2) extra.push({ r: h.r, c: 0 })
    }
    return [...hints, ...extra]
  }, [state.board, selected, hints])

  const resolveMoveTo = (r: number, c: number): Sq | null => {
    if (!selected) return null
    if (hints.some((h) => h.r === r && h.c === c)) return { r, c }
    const piece = state.board[selected.r][selected.c]
    const target = state.board[r][c]
    if (piece?.toUpperCase() === 'K' && target && target.toUpperCase() === 'R' && r === selected.r) {
      if (c === 7) return hints.find((h) => h.r === r && h.c === 6) ?? null
      if (c === 0) return hints.find((h) => h.r === r && h.c === 2) ?? null
    }
    return null
  }

  const onCellDisplay = (dr: number, dc: number) => {
    if (!myTurn) return
    const { r, c } = flipped ? flipSq({ r: dr, c: dc }) : { r: dr, c: dc }
    const p = state.board[r][c]

    if (selected) {
      const dest = resolveMoveTo(r, c)
      if (dest) {
        onMove({ type: 'move', from: selected, to: dest })
        setSelected(null)
        onHaptic?.('light')
        return
      }
    }

    const mine = !!p && isWhite(p) === (human === 'w')
    if (mine) {
      setSelected({ r, c })
      onHaptic?.('light')
    } else {
      setSelected(null)
    }
  }

  const displayHintSquares = flipped ? hintSquares.map(flipSq) : hintSquares
  const displaySelected = selected && flipped ? flipSq(selected) : selected

  const cells: { r: number; c: number; p: Piece }[] = []
  for (let dr = 0; dr < 8; dr += 1) {
    for (let dc = 0; dc < 8; dc += 1) {
      const src = flipped ? flipSq({ r: dr, c: dc }) : { r: dr, c: dc }
      cells.push({ r: dr, c: dc, p: state.board[src.r][src.c] })
    }
  }

  return (
    <div className="table-area">
      <p
        className={`game-status ${
          state.over && status.includes('Победа') ? 'win' : state.over && status.includes('Поражение') ? 'lose' : ''
        }`}
      >
        {status}
      </p>
      <p className="chess-sides" aria-hidden>
        <span className="chess-side chess-side-bot">
          {opponentName} · {human === 'w' ? 'чёрные' : 'белые'}
        </span>
        <span className="chess-side chess-side-you">Вы · {human === 'w' ? 'белые' : 'чёрные'}</span>
      </p>
      <div className="board-wrap">
        <div className="board chess">
          {cells.map(({ r, c, p }) => {
            const dark = (r + c) % 2 === 1
            const isSel = displaySelected?.r === r && displaySelected?.c === c
            const isHint = displayHintSquares.some((h) => h.r === r && h.c === c)
            const src = flipped ? flipSq({ r, c }) : { r, c }
            const boardPiece = state.board[src.r][src.c]
            const selPiece = selected ? state.board[selected.r][selected.c] : null
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
        <button type="button" className="btn btn-soft" onClick={onLeave}>
          Выйти
        </button>
      </div>
    </div>
  )
}

export function ChessOnline({
  initialCode,
  onHaptic,
  onBackToBot,
}: {
  initialCode?: string | null
  onHaptic?: (t?: 'light' | 'medium' | 'success' | 'error') => void
  onBackToBot?: () => void
}) {
  const lobby = useOnlineLobbyRoom<ChessNetState>({
    title: 'Шахматы онлайн',
    watchLobby: watchChessLobby,
    hostRoom: hostChessRoom,
    joinRoom: joinChessRoom,
    initialCode,
    onHaptic,
  })

  if (lobby.room?.status === 'playing' && lobby.room.state) {
    return (
      <ChessOnlineTable
        state={lobby.room.state}
        role={lobby.room.role}
        opponentName={lobby.room.opponent?.name ?? 'Соперник'}
        onMove={(action) => lobby.room?.sendAction(action)}
        onLeave={lobby.leave}
        onHaptic={onHaptic}
      />
    )
  }

  if (lobby.mode === 'host' || lobby.mode === 'join' || lobby.busy) {
    const waitStatus =
      lobby.room?.status === 'waiting'
        ? lobby.room.role === 'host'
          ? 'Комната в списке лобби. Ждём соперника…'
          : lobby.joiningHost
            ? `Подключаемся к ${lobby.joiningHost}…`
            : 'Подключаемся к комнате…'
        : lobby.error || lobby.room?.error || 'Соединение…'
    return (
      <OnlineWait
        role={lobby.mode === 'join' ? 'guest' : 'host'}
        status={waitStatus}
        onLeave={lobby.leave}
      />
    )
  }

  return (
    <OnlineLobbyMenu
      title="Шахматы онлайн"
      lead="Создайте комнату или зайдите в открытую из списка."
      error={lobby.error}
      busy={lobby.busy}
      lobbyReady={lobby.lobbyReady}
      lobbyRooms={lobby.lobbyRooms}
      showCodeJoin={lobby.showCodeJoin}
      setShowCodeJoin={lobby.setShowCodeJoin}
      joinCode={lobby.joinCode}
      setJoinCode={lobby.setJoinCode}
      onHost={() => void lobby.connectHost()}
      onJoin={(code, name) => void lobby.connectJoin(code, name)}
      onBackToBot={onBackToBot}
      onHaptic={onHaptic}
    />
  )
}
