import { useEffect, useMemo, useRef, useState } from 'react'
import { OnlineLobbyMenu, OnlineWait, useOnlineLobbyRoom } from '../../components/OnlineLobby'
import {
  type CheckersAction,
  type CheckersNetState,
  hostCheckersRoom,
  joinCheckersRoom,
  watchCheckersLobby,
} from './peerRoom'
import {
  type Flight,
  type Sq,
  type Step,
  CheckerDisc,
  FLIGHT_MS,
  allSideMoves,
  applyMove,
  captureMoves,
  clone,
  isW,
  isB,
  same,
} from './engine'

function CheckersOnlineTable({
  state,
  role,
  opponentName,
  onStep,
  onLeave,
  onHaptic,
}: {
  state: CheckersNetState
  role: 'host' | 'guest'
  opponentName: string
  onStep: (action: CheckersAction) => void
  onLeave: () => void
  onHaptic?: (t?: 'light' | 'medium' | 'success' | 'error') => void
}) {
  const humanWhite = role === 'host'
  const flipped = !humanWhite
  const myTurn = !state.over && state.turn === (humanWhite ? 'w' : 'b')
  const status = role === 'host' ? state.statusHost : state.statusGuest
  const [selected, setSelected] = useState<Sq | null>(null)
  const [board, setBoard] = useState(state.board)
  const [flight, setFlight] = useState<Flight | null>(null)
  const [fadeCapture, setFadeCapture] = useState<Sq | null>(null)
  const flightId = useRef(0)
  const timers = useRef<number[]>([])
  const lastStepId = useRef<string | null>(null)

  const flipSq = (sq: Sq): Sq => (flipped ? { r: 7 - sq.r, c: 7 - sq.c } : sq)

  const clearTimers = () => {
    for (const t of timers.current) window.clearTimeout(t)
    timers.current = []
  }

  useEffect(() => () => clearTimers(), [])

  // Sync remote board; animate opponent's last step when it changes
  useEffect(() => {
    const step = state.lastStep
    const stepKey = step ? `${step.from.r},${step.from.c}-${step.to.r},${step.to.c}-${step.mid?.r ?? ''}` : null
    if (!step || stepKey === lastStepId.current) {
      setBoard(clone(state.board))
      setSelected(state.chainFrom && myTurn ? state.chainFrom : null)
      return
    }
    // Only animate if the step isn't from our own pending local play
    lastStepId.current = stepKey
    const piece = board[step.from.r]?.[step.from.c] || state.board[step.to.r]?.[step.to.c]
    if (!piece || myTurn) {
      setBoard(clone(state.board))
      setSelected(state.chainFrom && myTurn ? state.chainFrom : null)
      return
    }
    clearTimers()
    setFadeCapture(step.mid ?? null)
    const id = ++flightId.current
    setFlight({ id, piece, from: step.from, to: step.to })
    const t = window.setTimeout(() => {
      setBoard(clone(state.board))
      setFadeCapture(null)
      const land = window.setTimeout(() => setFlight(null), 0)
      timers.current.push(land)
    }, FLIGHT_MS)
    timers.current.push(t)
    setSelected(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.board, state.lastStep, state.chainFrom])

  const legal = useMemo(() => {
    if (!myTurn || flight) return [] as Step[]
    if (state.chainFrom) return captureMoves(board, state.chainFrom)
    return allSideMoves(board, humanWhite)
  }, [myTurn, flight, state.chainFrom, board, humanWhite])

  const hints = useMemo(
    () => (selected ? legal.filter((m) => same(m.from, selected)) : []),
    [legal, selected],
  )

  const mustCapture = legal.some((m) => m.mid)

  const playLocal = (move: Step) => {
    clearTimers()
    const piece = board[move.from.r][move.from.c]
    if (!piece) return
    setSelected(null)
    setFadeCapture(move.mid ?? null)
    const id = ++flightId.current
    setFlight({ id, piece, from: move.from, to: move.to })
    onHaptic?.('light')
    const t = window.setTimeout(() => {
      const after = applyMove(board, move)
      setBoard(after)
      setFadeCapture(null)
      const land = window.setTimeout(() => {
        setFlight(null)
        lastStepId.current = `${move.from.r},${move.from.c}-${move.to.r},${move.to.c}-${move.mid?.r ?? ''}`
        onStep({ type: 'step', from: move.from, to: move.to, mid: move.mid })
      }, 0)
      timers.current.push(land)
    }, FLIGHT_MS)
    timers.current.push(t)
  }

  const onCell = (r: number, c: number) => {
    if (!myTurn || flight || state.over) return

    if (selected) {
      const move = hints.find((m) => m.to.r === r && m.to.c === c)
      if (move) {
        playLocal(move)
        return
      }
      if (state.chainFrom) return
    }

    if (state.chainFrom) {
      if (same(state.chainFrom, { r, c })) {
        setSelected({ r, c })
        onHaptic?.('light')
      }
      return
    }

    const cell = board[r][c]
    const mine = humanWhite ? isW(cell) : isB(cell)
    if (mine && legal.some((m) => m.from.r === r && m.from.c === c)) {
      setSelected({ r, c })
      onHaptic?.('light')
    } else {
      setSelected(null)
    }
  }

  const onCellDisplay = (dr: number, dc: number) => {
    const { r, c } = flipSq({ r: dr, c: dc })
    onCell(r, c)
  }

  return (
    <div className="table-area">
      <p className={`game-status ${state.over && status === 'Победа!' ? 'win' : state.over ? 'lose' : ''}`}>
        {status}
        {mustCapture && myTurn && !state.over && !status.includes('бить') ? ' · нужно бить' : ''}
      </p>
      <p className="checkers-sides" aria-hidden>
        <span className="checkers-side checkers-side-bot">
          {opponentName} · {humanWhite ? 'чёрные' : 'белые'}
        </span>
        <span className="checkers-side checkers-side-you">Вы · {humanWhite ? 'белые' : 'чёрные'}</span>
      </p>
      <div className="board-wrap">
        <div className={`board checkers${flight ? ' is-flying' : ''}`}>
          {Array.from({ length: 8 }, (_, dr) =>
            Array.from({ length: 8 }, (_, dc) => {
              const src = flipSq({ r: dr, c: dc })
              const cell = board[src.r][src.c]
              const dark = (dr + dc) % 2 === 1
              const isSel = !flight && selected?.r === src.r && selected?.c === src.c
              const isHint = !flight && hints.some((h) => h.to.r === src.r && h.to.c === src.c)
              const isCap = isHint && hints.some((h) => h.to.r === src.r && h.to.c === src.c && h.mid)
              const isSource = !!(flight && flight.from.r === src.r && flight.from.c === src.c)
              const fading = !!(
                fadeCapture &&
                fadeCapture.r === src.r &&
                fadeCapture.c === src.c &&
                cell !== 0
              )
              return (
                <button
                  key={`${dr}-${dc}`}
                  type="button"
                  className={`cell ${dark ? 'dark' : 'light'} ${isSel ? 'selected' : ''} ${isHint && !isCap ? 'move-hint' : ''} ${isCap ? 'capture-hint' : ''}`}
                  onClick={() => onCellDisplay(dr, dc)}
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
                ['--from-r' as string]: flipSq(flight.from).r,
                ['--from-c' as string]: flipSq(flight.from).c,
                ['--to-r' as string]: flipSq(flight.to).r,
                ['--to-c' as string]: flipSq(flight.to).c,
              }}
            >
              <CheckerDisc cell={flight.piece} flying />
            </span>
          )}
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

export function CheckersOnline({
  initialCode,
  onHaptic,
  onBackToBot,
}: {
  initialCode?: string | null
  onHaptic?: (t?: 'light' | 'medium' | 'success' | 'error') => void
  onBackToBot?: () => void
}) {
  const lobby = useOnlineLobbyRoom<CheckersNetState>({
    title: 'Шашки онлайн',
    watchLobby: watchCheckersLobby,
    hostRoom: hostCheckersRoom,
    joinRoom: joinCheckersRoom,
    initialCode,
    onHaptic,
  })

  if (lobby.room?.status === 'playing' && lobby.room.state) {
    return (
      <CheckersOnlineTable
        state={lobby.room.state}
        role={lobby.room.role}
        opponentName={lobby.room.opponent?.name ?? 'Соперник'}
        onStep={(action) => lobby.room?.sendAction(action)}
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
      title="Шашки онлайн"
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
      onRefresh={lobby.forceRefreshApp}
      onBackToBot={onBackToBot}
      onHaptic={onHaptic}
    />
  )
}
