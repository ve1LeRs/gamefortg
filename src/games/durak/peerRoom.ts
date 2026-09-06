import type { MqttClient } from 'mqtt'
import {
  type DurakAction,
  type DurakState,
  type SeatView,
  applyAction,
  createDurakGame,
  makeRoomCode,
  seatView,
} from './engine'

export type PlayerInfo = {
  id: string
  name: string
}

type HelloMsg = { type: 'hello'; role: 'guest'; player: PlayerInfo }
type ActionMsg = { type: 'action'; role: 'guest'; action: DurakAction }
type StateMsg = { type: 'state'; role: 'host'; view: SeatView; opponent: PlayerInfo }
type BusyMsg = { type: 'busy'; role: 'host' }
type ByeMsg = { type: 'bye'; role: 'host' | 'guest' }
type NetMsg = HelloMsg | ActionMsg | StateMsg | BusyMsg | ByeMsg

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

/** Public MQTT over WebSocket — works on mobile LTE where WebRTC/PeerJS often fails. */
const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
] as const

const CONNECT_MS = 12_000
const HANDSHAKE_MS = 25_000
const HELLO_RETRY_MS = 2_000

function topicFor(code: string): string {
  return `gft/durak/v1/${code.toUpperCase()}/bus`
}

function emit(room: DurakRoom, handlers: RoomHandlers) {
  handlers.onUpdate(room)
}

function failRoom(room: DurakRoom, handlers: RoomHandlers, message: string) {
  room.status = 'error'
  room.error = message
  emit(room, handlers)
}

function parseMsg(raw: string): NetMsg | null {
  try {
    const msg = JSON.parse(raw) as NetMsg
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return null
    return msg
  } catch {
    return null
  }
}

function connectMqtt(clientId: string): Promise<MqttClient> {
  let attempt = 0
  const tryNext = async (): Promise<MqttClient> => {
    const url = BROKERS[attempt]
    if (!url) {
      throw new Error('Не удалось связаться с сервером комнат. Проверьте интернет.')
    }
    attempt += 1
    const mqtt = (await import('mqtt')).default
    return new Promise<MqttClient>((resolve, reject) => {
      let settled = false
      const client = mqtt.connect(url, {
        clientId,
        clean: true,
        connectTimeout: CONNECT_MS,
        reconnectPeriod: 0,
        protocolVersion: 4,
      })
      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        window.clearTimeout(t)
        client.off('connect', onConnect)
        client.off('error', onError)
        client.off('close', onClose)
        fn()
      }
      const t = window.setTimeout(() => {
        try {
          client.end(true)
        } catch {
          /* noop */
        }
        finish(() => {
          tryNext().then(resolve, reject)
        })
      }, CONNECT_MS)
      const onConnect = () => {
        finish(() => resolve(client))
      }
      const onError = () => {
        /* timeout / close handle retry */
      }
      const onClose = () => {
        if (settled) return
        try {
          client.end(true)
        } catch {
          /* noop */
        }
        finish(() => {
          tryNext().then(resolve, reject)
        })
      }
      client.on('connect', onConnect)
      client.on('error', onError)
      client.on('close', onClose)
    })
  }
  return tryNext()
}

function publish(client: MqttClient, topic: string, msg: NetMsg) {
  if (!client.connected) return
  client.publish(topic, JSON.stringify(msg), { qos: 1 })
}

export async function hostDurakRoom(
  you: PlayerInfo,
  handlers: RoomHandlers,
): Promise<DurakRoom> {
  const code = makeRoomCode()
  const topic = topicFor(code)
  let state: DurakState | null = null
  let opponent: PlayerInfo | null = null
  let client: MqttClient | null = null
  let alive = true

  const room: DurakRoom = {
    code,
    role: 'host',
    status: 'connecting',
    you,
    opponent: null,
    view: null,
    sendAction: () => undefined,
    destroy: () => {
      alive = false
      try {
        if (client?.connected) {
          publish(client, topic, { type: 'bye', role: 'host' })
        }
      } catch {
        /* noop */
      }
      try {
        client?.end(true)
      } catch {
        /* noop */
      }
      client = null
    },
  }

  emit(room, handlers)

  const pushViews = () => {
    if (!alive || !state || !opponent || !client) return
    const hostView = seatView(state, 'a')
    const guestView = seatView(state, 'b')
    room.view = hostView
    room.status = 'playing'
    room.opponent = opponent
    emit(room, handlers)
    publish(client, topic, { type: 'state', role: 'host', view: guestView, opponent: you })
  }

  room.sendAction = (action) => {
    if (!state) return
    state = applyAction(state, 'a', action)
    pushViews()
  }

  try {
    client = await connectMqtt(`gft-h-${code}-${Math.random().toString(36).slice(2, 8)}`)
  } catch (e) {
    room.destroy()
    const message = e instanceof Error ? e.message : 'Не удалось создать комнату'
    failRoom(room, handlers, message)
    throw new Error(message)
  }

  if (!alive) {
    client.end(true)
    throw new Error('Отменено')
  }

  await new Promise<void>((resolve, reject) => {
    client!.subscribe(topic, { qos: 1 }, (err) => {
      if (err) reject(err)
      else resolve()
    })
  }).catch((e) => {
    room.destroy()
    const message = e instanceof Error ? e.message : 'Не удалось открыть комнату'
    failRoom(room, handlers, message)
    throw new Error(message)
  })

  room.status = 'waiting'
  emit(room, handlers)

  client.on('message', (_t, payload) => {
    if (!alive) return
    const msg = parseMsg(payload.toString())
    if (!msg) return
    if (msg.type === 'hello' && msg.role === 'guest') {
      if (opponent && opponent.id !== msg.player.id) {
        publish(client!, topic, { type: 'busy', role: 'host' })
        return
      }
      opponent = msg.player
      room.opponent = opponent
      if (!state) state = createDurakGame('a')
      pushViews()
      return
    }
    if (msg.type === 'action' && msg.role === 'guest' && state) {
      state = applyAction(state, 'b', msg.action)
      pushViews()
      return
    }
    if (msg.type === 'bye' && msg.role === 'guest') {
      room.status = 'disconnected'
      room.error = 'Соперник отключился'
      emit(room, handlers)
    }
  })

  client.on('close', () => {
    if (!alive) return
    if (room.status === 'playing' || room.status === 'waiting') {
      room.status = 'disconnected'
      room.error = 'Связь с сервером потеряна'
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
  const topic = topicFor(clean)
  let client: MqttClient | null = null
  let alive = true
  let helloTimer: number | null = null

  const room: DurakRoom = {
    code: clean,
    role: 'guest',
    status: 'connecting',
    you,
    opponent: null,
    view: null,
    sendAction: (action) => {
      if (!client?.connected) return
      publish(client, topic, { type: 'action', role: 'guest', action })
    },
    destroy: () => {
      alive = false
      if (helloTimer != null) window.clearInterval(helloTimer)
      try {
        if (client?.connected) {
          publish(client, topic, { type: 'bye', role: 'guest' })
        }
      } catch {
        /* noop */
      }
      try {
        client?.end(true)
      } catch {
        /* noop */
      }
      client = null
    },
  }

  emit(room, handlers)

  try {
    client = await connectMqtt(`gft-g-${clean}-${Math.random().toString(36).slice(2, 8)}`)
  } catch (e) {
    room.destroy()
    const message = e instanceof Error ? e.message : 'Не удалось подключиться'
    failRoom(room, handlers, message)
    throw new Error(message)
  }

  if (!alive) {
    client.end(true)
    throw new Error('Отменено')
  }

  await new Promise<void>((resolve, reject) => {
    client!.subscribe(topic, { qos: 1 }, (err) => {
      if (err) reject(err)
      else resolve()
    })
  }).catch((e) => {
    room.destroy()
    const message = e instanceof Error ? e.message : 'Не удалось подключиться'
    failRoom(room, handlers, message)
    throw new Error(message)
  })

  room.status = 'waiting'
  emit(room, handlers)

  const sendHello = () => {
    if (!alive || !client?.connected || room.status === 'playing') return
    publish(client, topic, { type: 'hello', role: 'guest', player: you })
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const t = window.setTimeout(() => {
      settle(() =>
        reject(
          new Error(
            'Хост не ответил. Убедитесь, что друг открыл «Создать комнату» и ждёт с этим кодом.',
          ),
        ),
      )
    }, HANDSHAKE_MS)

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      window.clearTimeout(t)
      if (helloTimer != null) {
        window.clearInterval(helloTimer)
        helloTimer = null
      }
      fn()
    }

    client!.on('message', (_topic, payload) => {
      if (!alive) return
      const msg = parseMsg(payload.toString())
      if (!msg) return
      if (msg.type === 'state' && msg.role === 'host') {
        room.view = msg.view
        room.opponent = msg.opponent
        room.status = 'playing'
        emit(room, handlers)
        settle(() => resolve())
        return
      }
      if (msg.type === 'busy') {
        settle(() => reject(new Error('Комната уже занята')))
        return
      }
      if (msg.type === 'bye' && msg.role === 'host') {
        if (room.status === 'playing') {
          room.status = 'disconnected'
          room.error = 'Связь с хостом потеряна'
          emit(room, handlers)
          return
        }
        settle(() => reject(new Error('Хост вышел из комнаты')))
      }
    })

    client!.on('close', () => {
      if (!alive) return
      if (room.status === 'playing') {
        room.status = 'disconnected'
        room.error = 'Связь с сервером потеряна'
        emit(room, handlers)
        return
      }
      settle(() => reject(new Error('Соединение прервалось')))
    })

    sendHello()
    helloTimer = window.setInterval(sendHello, HELLO_RETRY_MS)
  }).catch((e) => {
    room.destroy()
    const message = e instanceof Error ? e.message : 'Не удалось подключиться'
    failRoom(room, handlers, message)
    throw new Error(message)
  })

  return room
}

export type { SeatView, DurakAction }
export type { Seat } from './engine'
