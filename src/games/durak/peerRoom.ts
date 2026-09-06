import Peer, { type DataConnection, type PeerJSOption } from 'peerjs'
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

const PEER_OPTS: PeerJSOption = {
  debug: 1,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  },
}

const PEER_OPEN_MS = 12_000
const HANDSHAKE_MS = 20_000

function emit(room: DurakRoom, handlers: RoomHandlers) {
  handlers.onUpdate(room)
}

function failRoom(room: DurakRoom, handlers: RoomHandlers, message: string) {
  room.status = 'error'
  room.error = message
  emit(room, handlers)
}

function waitPeerOpen(peer: Peer, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!peer.destroyed && peer.id && peer.open) {
      resolve(peer.id)
      return
    }
    const t = window.setTimeout(() => {
      cleanup()
      reject(new Error('Сервер соединений не ответил. Попробуйте ещё раз.'))
    }, timeoutMs)
    const onOpen = (id: string) => {
      cleanup()
      resolve(id)
    }
    const onError = (err: Error) => {
      cleanup()
      reject(err)
    }
    const cleanup = () => {
      window.clearTimeout(t)
      peer.off('open', onOpen)
      peer.off('error', onError)
    }
    peer.on('open', onOpen)
    peer.on('error', onError)
  })
}

export async function hostDurakRoom(
  you: PlayerInfo,
  handlers: RoomHandlers,
): Promise<DurakRoom> {
  const code = makeRoomCode()
  const peer = new Peer(peerIdForRoom(code), PEER_OPTS)

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
    sendAction: () => undefined,
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

  emit(room, handlers)

  const pushViews = () => {
    if (!state || !conn || !opponent) return
    const hostView = seatView(state, 'a')
    const guestView = seatView(state, 'b')
    room.view = hostView
    room.status = 'playing'
    room.opponent = opponent
    emit(room, handlers)
    const msg: StateMsg = { type: 'state', view: guestView, opponent: you }
    if (conn.open) conn.send(msg)
  }

  room.sendAction = (action) => {
    if (!state) return
    state = applyAction(state, 'a', action)
    pushViews()
  }

  try {
    await waitPeerOpen(peer, PEER_OPEN_MS)
  } catch (e) {
    room.destroy()
    const message = e instanceof Error ? e.message : 'Не удалось создать комнату'
    failRoom(room, handlers, message)
    throw new Error(message)
  }

  room.status = 'waiting'
  emit(room, handlers)

  peer.on('connection', (c) => {
    if (conn) {
      c.on('open', () => {
        c.send({ type: 'error', message: 'Комната уже занята' } satisfies ErrorMsg)
        c.close()
      })
      return
    }
    conn = c

    const onGuestData = (raw: unknown) => {
      const msg = raw as NetMsg
      if (msg.type === 'hello') {
        opponent = msg.player
        room.opponent = opponent
        state = createDurakGame('a')
        room.status = 'playing'
        if (c.open) {
          c.send({ type: 'ready' } satisfies ReadyMsg)
          pushViews()
        }
        return
      }
      if (msg.type === 'action' && state) {
        state = applyAction(state, 'b', msg.action)
        pushViews()
      }
    }

    c.on('data', onGuestData)
    c.on('open', () => {
      // If hello already arrived before open, push again once channel is writable.
      if (opponent && state) {
        c.send({ type: 'ready' } satisfies ReadyMsg)
        pushViews()
      }
    })
    c.on('close', () => {
      room.status = 'disconnected'
      room.error = 'Соперник отключился'
      emit(room, handlers)
    })
    c.on('error', () => {
      room.status = 'disconnected'
      room.error = 'Ошибка соединения с соперником'
      emit(room, handlers)
    })
  })

  peer.on('error', (err) => {
    if (room.status === 'playing') {
      room.status = 'disconnected'
      room.error = err.message || 'Ошибка сети'
      emit(room, handlers)
    }
  })

  return room
}

export async function joinDurakRoom(
  code: string,
  you: PlayerInfo,
  handlers: RoomHandlers,
): Promise<DurakRoom> {
  const clean = code.trim().toUpperCase()
  const peer = new Peer(PEER_OPTS)
  let conn: DataConnection | null = null

  const room: DurakRoom = {
    code: clean,
    role: 'guest',
    status: 'connecting',
    you,
    opponent: null,
    view: null,
    sendAction: (action) => {
      if (conn?.open) {
        conn.send({ type: 'action', action } satisfies ActionMsg)
      }
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

  emit(room, handlers)

  try {
    await waitPeerOpen(peer, PEER_OPEN_MS)
  } catch (e) {
    room.destroy()
    const message = e instanceof Error ? e.message : 'Не удалось подключиться'
    failRoom(room, handlers, message)
    throw new Error(message)
  }

  room.status = 'waiting'
  emit(room, handlers)

  conn = peer.connect(peerIdForRoom(clean), { reliable: true })

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const t = window.setTimeout(() => {
      settle(() => reject(new Error('Не удалось подключиться. Проверьте код и что хост ждёт в комнате.')))
    }, HANDSHAKE_MS)

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      window.clearTimeout(t)
      fn()
    }

    const onData = (raw: unknown) => {
      const msg = raw as NetMsg
      if (msg.type === 'state') {
        room.view = msg.view
        room.opponent = msg.opponent
        room.status = 'playing'
        emit(room, handlers)
        settle(() => resolve())
        return
      }
      if (msg.type === 'ready') {
        // Host acknowledged; wait for state (or treat as almost done).
        return
      }
      if (msg.type === 'error') {
        room.status = 'error'
        room.error = msg.message
        emit(room, handlers)
        settle(() => reject(new Error(msg.message)))
      }
    }

    // Attach listeners BEFORE open completes so we never miss early host packets.
    conn!.on('data', onData)
    conn!.on('open', () => {
      conn!.send({ type: 'hello', player: you } satisfies HelloMsg)
    })
    conn!.on('error', (err) => {
      settle(() => reject(err instanceof Error ? err : new Error('Ошибка соединения')))
    })
    conn!.on('close', () => {
      if (room.status === 'playing') {
        room.status = 'disconnected'
        room.error = 'Связь с хостом потеряна'
        emit(room, handlers)
        return
      }
      settle(() => reject(new Error('Хост закрыл соединение. Проверьте код.')))
    })
  }).catch((e) => {
    room.destroy()
    const message = e instanceof Error ? e.message : 'Не удалось подключиться'
    failRoom(room, handlers, message)
    throw new Error(message)
  })

  conn.on('close', () => {
    if (room.status === 'playing') {
      room.status = 'disconnected'
      room.error = 'Связь с хостом потеряна'
      emit(room, handlers)
    }
  })

  return room
}

export type { SeatView, DurakAction }
export type { Seat } from './engine'
