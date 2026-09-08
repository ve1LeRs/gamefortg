import type { MqttClient } from 'mqtt'
import {
  type PokerAction,
  type PokerState,
  type PokerSeatView,
  applyAction,
  createPokerGame,
  makeRoomCode,
  seatView,
} from './engine'

export type PlayerInfo = {
  id: string
  name: string
}

type HelloMsg = { type: 'hello'; role: 'guest'; player: PlayerInfo }
type ActionMsg = { type: 'action'; role: 'guest'; action: PokerAction }
type StateMsg = { type: 'state'; role: 'host'; view: PokerSeatView; opponent: PlayerInfo }
type BusyMsg = { type: 'busy'; role: 'host' }
type ByeMsg = { type: 'bye'; role: 'host' | 'guest' }
type PingMsg = { type: 'ping'; role: 'host' }
type PongMsg = { type: 'pong'; role: 'guest' }
type NetMsg = HelloMsg | ActionMsg | StateMsg | BusyMsg | ByeMsg | PingMsg | PongMsg

type LobbyAnnounceMsg = {
  type: 'announce'
  code: string
  host: PlayerInfo
  ts: number
}
type LobbyWithdrawMsg = {
  type: 'withdraw'
  code: string
  ts: number
}
type LobbyMsg = LobbyAnnounceMsg | LobbyWithdrawMsg

export type LobbyListing = {
  code: string
  host: PlayerInfo
  ts: number
}

export type RoomStatus =
  | 'connecting'
  | 'waiting'
  | 'playing'
  | 'reconnecting'
  | 'disconnected'
  | 'error'

export type PokerRoom = {
  code: string
  role: 'host' | 'guest'
  status: RoomStatus
  error?: string
  /** True when the peer sent bye / left on purpose. */
  opponentLeft?: boolean
  you: PlayerInfo
  opponent: PlayerInfo | null
  view: PokerSeatView | null
  sendAction: (action: PokerAction) => void
  destroy: () => void
  /** Try to restore MQTT after a background drop. */
  retryConnection?: () => void
  /** Present in local solo test mode */
  solo?: boolean
  controllingSeat?: 0 | 1
  switchSeat?: () => void
}

type RoomHandlers = {
  onUpdate: (room: PokerRoom) => void
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
const RECONNECT_PERIOD_MS = 2_500
const RECONNECT_GRACE_MS = 18_000
const LOBBY_TOPIC = 'gft/poker/v1/lobby'
const LOBBY_ANNOUNCE_MS = 3_000
const LOBBY_STALE_MS = 9_000
const LOBBY_SWEEP_MS = 2_000

function topicFor(code: string): string {
  return `gft/poker/v1/${code.toUpperCase()}/bus`
}

function emit(room: PokerRoom, handlers: RoomHandlers) {
  handlers.onUpdate(room)
}

function failRoom(room: PokerRoom, handlers: RoomHandlers, message: string) {
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

function parseLobbyMsg(raw: string): LobbyMsg | null {
  try {
    const msg = JSON.parse(raw) as LobbyMsg
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return null
    if (msg.type === 'announce') {
      if (typeof msg.code !== 'string' || !msg.host?.id || !msg.host?.name) return null
      if (typeof msg.ts !== 'number') return null
      return msg
    }
    if (msg.type === 'withdraw') {
      if (typeof msg.code !== 'string' || typeof msg.ts !== 'number') return null
      return msg
    }
    return null
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
        reconnectPeriod: RECONNECT_PERIOD_MS,
        protocolVersion: 4,
      })
      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        window.clearTimeout(t)
        client.off('connect', onConnect)
        client.off('error', onError)
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
        /* wait for timeout / reconnect */
      }
      client.on('connect', onConnect)
      client.on('error', onError)
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

function publishAll(clients: MqttClient[], topic: string, msg: NetMsg | LobbyMsg) {
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

function announceLobby(clients: MqttClient[], code: string, host: PlayerInfo) {
  publishAll(clients, LOBBY_TOPIC, {
    type: 'announce',
    code: code.toUpperCase(),
    host,
    ts: Date.now(),
  })
}

function withdrawLobby(clients: MqttClient[], code: string) {
  publishAll(clients, LOBBY_TOPIC, {
    type: 'withdraw',
    code: code.toUpperCase(),
    ts: Date.now(),
  })
}

/**
 * Live list of open Poker rooms (hosts announcing while waiting for a guest).
 * Returns a stop function; call it when leaving the online menu.
 */
export function watchPokerLobby(onChange: (rooms: LobbyListing[]) => void): () => void {
  let alive = true
  let clients: MqttClient[] = []
  let sweepTimer: number | null = null
  const map = new Map<string, LobbyListing>()

  const flush = () => {
    if (!alive) return
    const now = Date.now()
    for (const [code, row] of map) {
      if (now - row.ts > LOBBY_STALE_MS) map.delete(code)
    }
    const rooms = [...map.values()].sort((a, b) => b.ts - a.ts)
    onChange(rooms)
  }

  const onBus = (_t: string, payload: Buffer | string) => {
    if (!alive) return
    const msg = parseLobbyMsg(payload.toString())
    if (!msg) return
    if (msg.type === 'announce') {
      const code = msg.code.trim().toUpperCase()
      if (code.length < 4) return
      map.set(code, { code, host: msg.host, ts: msg.ts || Date.now() })
      flush()
      return
    }
    if (msg.type === 'withdraw') {
      map.delete(msg.code.trim().toUpperCase())
      flush()
    }
  }

  void (async () => {
    try {
      clients = await connectAllBrokers(`gft-lobby-${Math.random().toString(36).slice(2, 8)}`)
    } catch {
      if (alive) onChange([])
      return
    }
    if (!alive) {
      endAll(clients)
      clients = []
      return
    }
    try {
      await subscribeAll(clients, LOBBY_TOPIC)
    } catch {
      endAll(clients)
      clients = []
      if (alive) onChange([])
      return
    }
    for (const client of clients) {
      client.on('message', onBus)
      client.on('close', () => {
        if (!alive) return
        clients = clients.filter((c) => c !== client && c.connected)
      })
    }
    flush()
    sweepTimer = window.setInterval(flush, LOBBY_SWEEP_MS)
  })()

  return () => {
    alive = false
    if (sweepTimer != null) window.clearInterval(sweepTimer)
    endAll(clients)
    clients = []
  }
}

export async function hostPokerRoom(
  you: PlayerInfo,
  handlers: RoomHandlers,
): Promise<PokerRoom> {
  const code = makeRoomCode()
  const topic = topicFor(code)
  let state: PokerState | null = null
  let opponent: PlayerInfo | null = null
  let clients: MqttClient[] = []
  let alive = true
  let pingTimer: number | null = null
  let lobbyTimer: number | null = null
  let listed = false
  let reconnectGraceTimer: number | null = null
  const topicSubscribed = new WeakSet<MqttClient>()

  const clearReconnectGrace = () => {
    if (reconnectGraceTimer != null) {
      window.clearTimeout(reconnectGraceTimer)
      reconnectGraceTimer = null
    }
  }

  const ensureSubscribed = (client: MqttClient) => {
    if (topicSubscribed.has(client)) return
    client.subscribe(topic, { qos: 1 }, (err) => {
      if (!err) topicSubscribed.add(client)
    })
  }

  const stopLobby = () => {
    if (lobbyTimer != null) {
      window.clearInterval(lobbyTimer)
      lobbyTimer = null
    }
    if (listed && clients.length) {
      try {
        withdrawLobby(clients, code)
      } catch {
        /* noop */
      }
    }
    listed = false
  }

  let pushViews = () => undefined

  const markReconnecting = () => {
    if (!alive) return
    if (room.status !== 'playing' && room.status !== 'waiting' && room.status !== 'reconnecting') return
    if (room.opponentLeft) return
    room.status = 'reconnecting'
    room.error = 'Восстанавливаем связь…'
    emit(room, handlers)
    clearReconnectGrace()
    reconnectGraceTimer = window.setTimeout(() => {
      if (!alive) return
      const anyUp = clients.some((c) => c.connected)
      if (anyUp) return
      room.status = 'disconnected'
      room.error = 'Связь с сервером потеряна'
      emit(room, handlers)
    }, RECONNECT_GRACE_MS)
  }

  const onClientBack = (client: MqttClient) => {
    if (!alive) return
    ensureSubscribed(client)
    if (!clients.includes(client)) clients.push(client)
    clearReconnectGrace()
    if (room.status === 'reconnecting' || room.status === 'disconnected') {
      if (state && opponent) {
        room.status = 'playing'
        room.error = undefined
        pushViews()
      } else {
        room.status = 'waiting'
        room.error = undefined
        emit(room, handlers)
      }
    } else if (state && opponent) {
      pushViews()
    }
  }

  const room: PokerRoom = {
    code,
    role: 'host',
    status: 'connecting',
    you,
    opponent: null,
    view: null,
    sendAction: () => undefined,
    destroy: () => {
      alive = false
      clearReconnectGrace()
      if (pingTimer != null) window.clearInterval(pingTimer)
      stopLobby()
      try {
        publishAll(clients, topic, { type: 'bye', role: 'host' })
      } catch {
        /* noop */
      }
      endAll(clients)
      clients = []
    },
    retryConnection: () => {
      if (!alive) return
      for (const c of clients) {
        try {
          if (!c.connected) c.reconnect()
          else onClientBack(c)
        } catch {
          /* noop */
        }
      }
      markReconnecting()
    },
  }

  emit(room, handlers)

  pushViews = () => {
    if (!alive || !state || !opponent) return
    const live = clients.filter((c) => c.connected)
    if (live.length === 0) return
    stopLobby()
    const hostView = seatView(state, 0)
    const guestView = seatView(state, 1)
    room.view = hostView
    room.status = 'playing'
    room.error = undefined
    room.opponent = opponent
    emit(room, handlers)
    publishAll(live, topic, { type: 'state', role: 'host', view: guestView, opponent: you })
  }

  room.sendAction = (action) => {
    if (!state) return
    state = applyAction(state, 0, action)
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
    for (const c of clients) topicSubscribed.add(c)
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
      room.opponentLeft = false
      if (!state) state = createPokerGame()
      pushViews()
      return
    }
    if (msg.type === 'action' && msg.role === 'guest' && state) {
      state = applyAction(state, 1, msg.action)
      pushViews()
      return
    }
    if (msg.type === 'pong' && msg.role === 'guest') {
      return
    }
    if (msg.type === 'bye' && msg.role === 'guest') {
      clearReconnectGrace()
      room.opponentLeft = true
      room.status = 'disconnected'
      room.error = 'Соперник вышел из игры'
      emit(room, handlers)
    }
  }

  for (const client of clients) {
    client.on('message', onBus)
    client.on('connect', () => onClientBack(client))
    client.on('reconnect', () => onClientBack(client))
    client.on('close', () => {
      if (!alive) return
      const live = clients.filter((c) => c.connected)
      if (live.length === 0) markReconnecting()
    })
  }

  room.status = 'waiting'
  emit(room, handlers)
  publishAll(clients, topic, { type: 'ping', role: 'host' })
  listed = true
  announceLobby(clients, code, you)
  pingTimer = window.setInterval(() => {
    if (!alive) return
    if (room.status === 'waiting') {
      publishAll(clients, topic, { type: 'ping', role: 'host' })
      return
    }
    if (room.status === 'playing' || room.status === 'reconnecting') {
      publishAll(clients, topic, { type: 'ping', role: 'host' })
      if (state && opponent) pushViews()
    }
  }, HOST_PING_MS)
  lobbyTimer = window.setInterval(() => {
    if (!alive || room.status !== 'waiting') return
    announceLobby(clients, code, you)
  }, LOBBY_ANNOUNCE_MS)

  return room
}

export async function joinPokerRoom(
  code: string,
  you: PlayerInfo,
  handlers: RoomHandlers,
): Promise<PokerRoom> {
  const clean = code.trim().toUpperCase()
  const topic = topicFor(clean)
  let clients: MqttClient[] = []
  let alive = true
  let helloTimer: number | null = null
  let active: MqttClient[] = []
  let reconnectGraceTimer: number | null = null
  const topicSubscribed = new WeakSet<MqttClient>()

  const clearReconnectGrace = () => {
    if (reconnectGraceTimer != null) {
      window.clearTimeout(reconnectGraceTimer)
      reconnectGraceTimer = null
    }
  }

  const ensureSubscribed = (client: MqttClient) => {
    if (topicSubscribed.has(client)) return
    client.subscribe(topic, { qos: 1 }, (err) => {
      if (!err) topicSubscribed.add(client)
    })
  }

  const markReconnecting = () => {
    if (!alive) return
    if (room.status !== 'playing' && room.status !== 'waiting' && room.status !== 'reconnecting') return
    if (room.opponentLeft) return
    room.status = 'reconnecting'
    room.error = 'Восстанавливаем связь…'
    emit(room, handlers)
    clearReconnectGrace()
    reconnectGraceTimer = window.setTimeout(() => {
      if (!alive) return
      if (clients.some((c) => c.connected)) return
      room.status = 'disconnected'
      room.error = 'Связь с сервером потеряна'
      emit(room, handlers)
    }, RECONNECT_GRACE_MS)
  }

  const sendHello = () => {
    if (!alive) return
    if (room.status === 'playing') return
    publishAll(active.length ? active : clients, topic, { type: 'hello', role: 'guest', player: you })
  }

  const onClientBack = (client: MqttClient) => {
    if (!alive) return
    ensureSubscribed(client)
    if (!clients.includes(client)) clients.push(client)
    active = clients.filter((c) => c.connected)
    clearReconnectGrace()
    if (room.status === 'reconnecting' || room.status === 'disconnected') {
      room.status = room.view ? 'playing' : 'waiting'
      room.error = undefined
      emit(room, handlers)
    }
    sendHello()
  }

  const room: PokerRoom = {
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
      clearReconnectGrace()
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
    retryConnection: () => {
      if (!alive) return
      for (const c of clients) {
        try {
          if (!c.connected) c.reconnect()
          else onClientBack(c)
        } catch {
          /* noop */
        }
      }
      markReconnecting()
      sendHello()
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
    for (const c of clients) topicSubscribed.add(c)
  } catch (e) {
    room.destroy()
    const message = e instanceof Error ? e.message : 'Не удалось подключиться'
    failRoom(room, handlers, message)
    throw new Error(message)
  }

  room.status = 'waiting'
  emit(room, handlers)

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const t = window.setTimeout(() => {
      settle(() =>
        reject(
          new Error(
            'Хост не ответил. Комната могла закрыться — обновите список и зайдите снова.',
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
        room.error = undefined
        room.opponentLeft = false
        emit(room, handlers)
        settle(() => resolve())
        return
      }
      if (msg.type === 'busy') {
        settle(() => reject(new Error('Комната уже занята')))
        return
      }
      if (msg.type === 'ping' && msg.role === 'host') {
        publishAll(active.length ? active : clients, topic, { type: 'pong', role: 'guest' })
        return
      }
      if (msg.type === 'bye' && msg.role === 'host') {
        clearReconnectGrace()
        room.opponentLeft = true
        if (room.status === 'playing' || room.status === 'reconnecting') {
          room.status = 'disconnected'
          room.error = 'Соперник вышел из игры'
          emit(room, handlers)
          return
        }
        settle(() => reject(new Error('Хост вышел из комнаты')))
      }
    }

    for (const client of clients) {
      client.on('message', onBus)
      client.on('connect', () => onClientBack(client))
      client.on('reconnect', () => onClientBack(client))
      client.on('close', () => {
        if (!alive) return
        active = clients.filter((c) => c.connected)
        if (active.length === 0) {
          if (room.status === 'playing' || room.status === 'reconnecting') {
            markReconnecting()
            return
          }
          if (!settled) settle(() => reject(new Error('Соединение прервалось')))
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

export type { PokerSeatView, PokerAction }
export type { Seat } from './engine'
