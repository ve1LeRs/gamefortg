import Peer, { type DataConnection } from 'peerjs'
import {
  type DurakAction,
  type DurakState,
  type SeatView,
  applyAction,
  createDurakGame,
  makeRoomCode,
  peerIdForRoom,
  seatView,
} from './engine'

export type PlayerInfo = {
  id: string
  name: string
}

type HelloMsg = { type: 'hello'; player: PlayerInfo }
type ActionMsg = { type: 'action'; action: DurakAction }
type StateMsg = { type: 'state'; view: SeatView; opponent: PlayerInfo }
type ReadyMsg = { type: 'ready' }
type ErrorMsg = { type: 'error'; message: string }
type NetMsg = HelloMsg | ActionMsg | StateMsg | ReadyMsg | ErrorMsg

export type RoomStatus = 'connecting' | 'waiting' | 'playing' | 'disconnected' | 'error'

export type DurakRoom = {
  code: string
  role: 'host' | 'guest'
  status: RoomStatus
  error?: string
  you: PlayerInfo
  opponent: PlayerInfo | null
  view: SeatView | null
  sendAction: (action: DurakAction) => void
  destroy: () => void
}

type RoomHandlers = {
  onUpdate: (room: DurakRoom) => void
}

function emit(room: DurakRoom, handlers: RoomHandlers) {
  handlers.onUpdate({ ...room })
}

export async function hostDurakRoom(
  you: PlayerInfo,
  handlers: RoomHandlers,
): Promise<DurakRoom> {
  const code = makeRoomCode()
  const peer = new Peer(peerIdForRoom(code), {
    debug: 1,
  })

  let state: DurakState | null = null
  let conn: DataConnection | null = null
  let opponent: PlayerInfo | null = null

  const room: DurakRoom = {
    code,
    role: 'host',
    status: 'connecting',
    you,
    opponent: null,
    view: null,
    sendAction: (action) => {
      if (!state || !conn || !opponent) return
      // Host applies own actions locally
      state = applyAction(state, 'a', action)
      pushViews()
    },
    destroy: () => {
      try {
        conn?.close()
      } catch {
        /* noop */
      }
      try {
        peer.destroy()
      } catch {
        /* noop */
      }
    },
  }

  const pushViews = () => {
    if (!state || !conn || !opponent) return
    const hostView = seatView(state, 'a')
    const guestView = seatView(state, 'b')
    room.view = hostView
    room.status = state.phase === 'over' ? 'playing' : 'playing'
    room.opponent = opponent
    emit(room, handlers)
    const msg: StateMsg = { type: 'state', view: guestView, opponent: you }
    conn.send(msg)
  }

  await new Promise<void>((resolve, reject) => {
    peer.on('open', () => resolve())
    peer.on('error', (err) => reject(err))
  })

  room.status = 'waiting'
  emit(room, handlers)

  peer.on('connection', (c) => {
    if (conn) {
      c.send({ type: 'error', message: 'Комната уже занята' } satisfies ErrorMsg)
      c.close()
      return
    }
    conn = c
    c.on('data', (raw) => {
      const msg = raw as NetMsg
      if (msg.type === 'hello') {
        opponent = msg.player
        room.opponent = opponent
        state = createDurakGame('a')
        room.status = 'playing'
        c.send({ type: 'ready' } satisfies ReadyMsg)
        pushViews()
        return
      }
      if (msg.type === 'action' && state) {
        state = applyAction(state, 'b', msg.action)
        pushViews()
      }
    })
    c.on('close', () => {
      room.status = 'disconnected'
      room.error = 'Соперник отключился'
      emit(room, handlers)
    })
  })

  // Override sendAction to work after connection
  room.sendAction = (action) => {
    if (!state) return
    state = applyAction(state, 'a', action)
    pushViews()
  }

  return room
}

export async function joinDurakRoom(
  code: string,
  you: PlayerInfo,
  handlers: RoomHandlers,
): Promise<DurakRoom> {
  const peer = new Peer({ debug: 1 })
  let conn: DataConnection | null = null

  const room: DurakRoom = {
    code: code.toUpperCase(),
    role: 'guest',
    status: 'connecting',
    you,
    opponent: null,
    view: null,
    sendAction: (action) => {
      conn?.send({ type: 'action', action } satisfies ActionMsg)
    },
    destroy: () => {
      try {
        conn?.close()
      } catch {
        /* noop */
      }
      try {
        peer.destroy()
      } catch {
        /* noop */
      }
    },
  }

  await new Promise<void>((resolve, reject) => {
    peer.on('open', () => resolve())
    peer.on('error', (err) => reject(err))
  })

  conn = peer.connect(peerIdForRoom(code), { reliable: true })
  room.status = 'waiting'
  emit(room, handlers)

  await new Promise<void>((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error('Не удалось подключиться. Проверьте код.')), 15000)
    conn!.on('open', () => {
      window.clearTimeout(t)
      conn!.send({ type: 'hello', player: you } satisfies HelloMsg)
      resolve()
    })
    conn!.on('error', (err) => {
      window.clearTimeout(t)
      reject(err)
    })
  })

  conn.on('data', (raw) => {
    const msg = raw as NetMsg
    if (msg.type === 'state') {
      room.view = msg.view
      room.opponent = msg.opponent
      room.status = 'playing'
      emit(room, handlers)
    }
    if (msg.type === 'error') {
      room.status = 'error'
      room.error = msg.message
      emit(room, handlers)
    }
  })

  conn.on('close', () => {
    room.status = 'disconnected'
    room.error = 'Связь с хостом потеряна'
    emit(room, handlers)
  })

  return room
}

export type { SeatView, DurakAction }
export type { Seat } from './engine'
