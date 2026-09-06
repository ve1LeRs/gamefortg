import {
  type DurakAction,
  type DurakState,
  type Seat,
  applyAction,
  createDurakGame,
  seatView,
} from './engine'
import type { DurakRoom, PlayerInfo, RoomStatus } from './peerRoom'

type RoomHandlers = {
  onUpdate: (room: DurakRoom) => void
}

export type SoloDurakRoom = DurakRoom & {
  solo: true
  controllingSeat: Seat
  switchSeat: () => void
}

/**
 * In-memory two-seat room for solo testing (no network).
 * Play as one seat, then switch — or auto-switch when the turn moves.
 */
export function createSoloDurakRoom(you: PlayerInfo, handlers: RoomHandlers): SoloDurakRoom {
  let state: DurakState = createDurakGame('a')
  let seat: Seat = 'a'
  let alive = true

  const playerA: PlayerInfo = {
    id: you.id,
    name: you.name?.trim() ? `${you.name} · 1` : 'Игрок 1',
  }
  const playerB: PlayerInfo = {
    id: `${you.id}-seat-b`,
    name: 'Игрок 2 · тест',
  }

  const room: SoloDurakRoom = {
    code: 'SOLO',
    role: 'host',
    status: 'playing' satisfies RoomStatus,
    you: playerA,
    opponent: playerB,
    view: null,
    solo: true,
    controllingSeat: 'a',
    sendAction: () => undefined,
    switchSeat: () => undefined,
    destroy: () => {
      alive = false
    },
  }

  const push = () => {
    if (!alive) return
    const me = seat === 'a' ? playerA : playerB
    const opp = seat === 'a' ? playerB : playerA
    room.you = me
    room.opponent = opp
    room.controllingSeat = seat
    room.view = seatView(state, seat)
    room.status = 'playing'
    handlers.onUpdate(room)
  }

  const maybeAutoSwitch = () => {
    const viewA = seatView(state, 'a')
    const viewB = seatView(state, 'b')
    if (seat === 'a' && !viewA.yourTurn && viewB.yourTurn) seat = 'b'
    else if (seat === 'b' && !viewB.yourTurn && viewA.yourTurn) seat = 'a'
  }

  room.sendAction = (action: DurakAction) => {
    if (!alive) return
    state = applyAction(state, seat, action)
    maybeAutoSwitch()
    push()
  }

  room.switchSeat = () => {
    if (!alive) return
    seat = seat === 'a' ? 'b' : 'a'
    push()
  }

  push()
  return room
}
