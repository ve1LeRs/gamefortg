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
type PingMsg = { type: 'ping'; role: 'host' }
type NetMsg = HelloMsg | ActionMsg | StateMsg | BusyMsg | ByeMsg | PingMsg

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

/**
 * Public MQTT over WebSocket.
 * Host + guest attach to every reachable broker so LTE fallback cannot
 * split them across different clouds (that caused "host did not reply").
 */
const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
] as const

const CONNECT_MS = 10_000
const HANDSHAKE_MS = 30_000
const HELLO_RETRY_MS = 1_500
const HOST_PING_MS = 4_000

function topicFor(code: string): string {
  return `gft/durak/v2/${code.toUpperCase()}/bus`
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

function connectOne(url: string, clientId: string): Promise<MqttClient> {
  return new Promise((resolve, reject) => {
    let settled = false
    void import('mqtt').then(({ default: mqtt }) => {
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
        finish(() => reject(new Error(`timeout:${url}`)))
      }, CONNECT_MS)
      const onConnect = () => finish(() => resolve(client))
      const onError = () => {
        /* wait for timeout/close */
      }
      const onClose = () => {
        if (settled) return
        try {
          client.end(true)
        } catch {
          /* noop */
        }
        finish(() => reject(new Error(`close:${url}`)))
      }
      client.on('connect', onConnect)
      client.on('error', onError)
      client.on('close', onClose)
    }, reject)
  })
}

async function connectAllBrokers(clientId: string): Promise<MqttClient[]> {
  const results = await Promise.allSettled(
    BROKERS.map((url, i) => connectOne(url, `${clientId}-${i}`)),
  )
  const clients = results
    .filter((r): r is PromiseFulfilledResult<MqttClient> => r.status === 'fulfilled')
    .map((r) => r.value)
  if (clients.length === 0) {
    throw new Error('Не удалось связаться с сервером комнат. Проверьте интернет.')
  }
  return clients
}

function publishAll(clients: MqttClient[], topic: string, msg: NetMsg) {
  const body = JSON.stringify(msg)
  for (const client of clients) {
    if (!client.connected) continue
    client.publish(topic, body, { qos: 1 })
  }
}

function subscribeAll(clients: MqttClient[], topic: string): Promise<void> {
  return Promise.all(
    clients.map(
      (client) =>
        new Promise<void>((resolve, reject) => {
          client.subscribe(topic, { qos: 1 }, (err) => (err ? reject(err) : resolve()))
        }),
    ),
  ).then(() => undefined)
}

function endAll(clients: MqttClient[]) {
  for (const client of clients) {
    try {
      client.end(true)
    } catch {
      /* noop */
    }
  }
}

export async function hostDurakRoom(
  you: PlayerInfo,
  handlers: RoomHandlers,
): Promise<DurakRoom> {
  const code = makeRoomCode()
  const topic = topicFor(code)
  let state: DurakState | null = null
  let opponent: PlayerInfo | null = null
  let clients: MqttClient[] = []
  let alive = true
  let pingTimer: number | null = null

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
      if (pingTimer != null) window.clearInterval(pingTimer)
      try {
        publishAll(clients, topic, { type: 'bye', role: 'host' })
      } catch {
        /* noop */
      }
      endAll(clients)
      clients = []
    },
  }

  emit(room, handlers)

  const pushViews = () => {
    if (!alive || !state || !opponent || clients.length === 0) return
    const hostView = seatView(state, 'a')
    const guestView = seatView(state, 'b')
    room.view = hostView
    room.status = 'playing'
    room.opponent = opponent
    emit(room, handlers)
    publishAll(clients, topic, { type: 'state', role: 'host', view: guestView, opponent: you })
  }

  room.sendAction = (action) => {
    if (!state) return
    state = applyAction(state, 'a', action)
    pushViews()
  }

  try {
    clients = await connectAllBrokers(`gft-h-${code}-${Math.random().toString(36).slice(2, 7)}`)
  } catch (e) {
    room.destroy()
    const message = e instanceof Error ? e.message : 'Не удалось создать комнату'
    failRoom(room, handlers, message)
    throw new Error(message)
  }

  if (!alive) {
    endAll(clients)
    throw new Error('Отменено')
  }

  try {
    await subscribeAll(clients, topic)
  } catch (e) {
    room.destroy()
    const message = e instanceof Error ? e.message : 'Не удалось открыть комнату'
    failRoom(room, handlers, message)
    throw new Error(message)
  }

  const onBus = (_t: string, payload: Buffer | string) => {
    if (!alive) return
    const msg = parseMsg(payload.toString())
    if (!msg) return
    if (msg.type === 'hello' && msg.role === 'guest') {
      if (opponent && opponent.id !== msg.player.id) {
        publishAll(clients, topic, { type: 'busy', role: 'host' })
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
  }

  for (const client of clients) {
    client.on('message', onBus)
    client.on('close', () => {
      if (!alive) return
      clients = clients.filter((c) => c !== client && c.connected)
      if (clients.length === 0 && (room.status === 'playing' || room.status === 'waiting')) {
        room.status = 'disconnected'
        room.error = 'Связь с сервером потеряна'
        emit(room, handlers)
      }
    })
  }

  room.status = 'waiting'
  emit(room, handlers)
  publishAll(clients, topic, { type: 'ping', role: 'host' })
  pingTimer = window.setInterval(() => {
    if (!alive || room.status !== 'waiting') return
    publishAll(clients, topic, { type: 'ping', role: 'host' })
  }, HOST_PING_MS)

  return room
}

export async function joinDurakRoom(
  code: string,
  you: PlayerInfo,
  handlers: RoomHandlers,
): Promise<DurakRoom> {
  const clean = code.trim().toUpperCase()
  const topic = topicFor(clean)
  let clients: MqttClient[] = []
  let alive = true
  let helloTimer: number | null = null
  let active: MqttClient[] = []

  const room: DurakRoom = {
    code: clean,
    role: 'guest',
    status: 'connecting',
    you,
    opponent: null,
    view: null,
    sendAction: (action) => {
      publishAll(active.length ? active : clients, topic, { type: 'action', role: 'guest', action })
    },
    destroy: () => {
      alive = false
      if (helloTimer != null) window.clearInterval(helloTimer)
      try {
        publishAll(active.length ? active : clients, topic, { type: 'bye', role: 'guest' })
      } catch {
        /* noop */
      }
      endAll(clients)
      clients = []
      active = []
    },
  }

  emit(room, handlers)

  try {
    clients = await connectAllBrokers(`gft-g-${clean}-${Math.random().toString(36).slice(2, 7)}`)
    active = clients
  } catch (e) {
    room.destroy()
    const message = e instanceof Error ? e.message : 'Не удалось подключиться'
    failRoom(room, handlers, message)
    throw new Error(message)
  }

  if (!alive) {
    endAll(clients)
    throw new Error('Отменено')
  }

  try {
    await subscribeAll(clients, topic)
  } catch (e) {
    room.destroy()
    const message = e instanceof Error ? e.message : 'Не удалось подключиться'
    failRoom(room, handlers, message)
    throw new Error(message)
  }

  room.status = 'waiting'
  emit(room, handlers)

  const sendHello = () => {
    if (!alive || room.status === 'playing') return
    publishAll(clients, topic, { type: 'hello', role: 'guest', player: you })
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

    const onBus = (_topic: string, payload: Buffer | string) => {
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
    }

    for (const client of clients) {
      client.on('message', onBus)
      client.on('close', () => {
        if (!alive) return
        clients = clients.filter((c) => c !== client && c.connected)
        active = clients
        if (clients.length === 0) {
          if (room.status === 'playing') {
            room.status = 'disconnected'
            room.error = 'Связь с сервером потеряна'
            emit(room, handlers)
            return
          }
          settle(() => reject(new Error('Соединение прервалось')))
        }
      })
    }

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
