import { useEffect, useMemo, useRef, useState } from 'react'
import { getWebApp } from '../lib/telegram'
import type { BoardRoom, LobbyListing, PlayerInfo } from '../net/boardPeerRoom'

type Mode = 'menu' | 'host' | 'join'

function playerFromTelegram(): PlayerInfo {
  const u = getWebApp()?.initDataUnsafe?.user
  if (u) {
    return { id: String(u.id), name: u.first_name || u.username || 'Игрок' }
  }
  return { id: `local-${Math.random().toString(36).slice(2, 8)}`, name: 'Игрок' }
}

export function useOnlineLobbyRoom<TState>(opts: {
  title: string
  watchLobby: (onChange: (rooms: LobbyListing[]) => void) => () => void
  hostRoom: (
    you: PlayerInfo,
    handlers: { onUpdate: (room: BoardRoom<TState>) => void },
  ) => Promise<BoardRoom<TState>>
  joinRoom: (
    code: string,
    you: PlayerInfo,
    handlers: { onUpdate: (room: BoardRoom<TState>) => void },
  ) => Promise<BoardRoom<TState>>
  initialCode?: string | null
  onHaptic?: (t?: 'light' | 'medium' | 'success' | 'error') => void
}) {
  const you = useMemo(() => playerFromTelegram(), [])
  const [mode, setMode] = useState<Mode>(opts.initialCode ? 'join' : 'menu')
  const [joinCode, setJoinCode] = useState(opts.initialCode?.toUpperCase() ?? '')
  const [showCodeJoin, setShowCodeJoin] = useState(false)
  const [lobbyRooms, setLobbyRooms] = useState<LobbyListing[]>([])
  const [lobbyReady, setLobbyReady] = useState(false)
  const [joiningHost, setJoiningHost] = useState<string | null>(null)
  const [room, setRoom] = useState<BoardRoom<TState> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const sessionRef = useRef(0)
  const roomRef = useRef<BoardRoom<TState> | null>(null)

  useEffect(() => {
    return () => {
      sessionRef.current += 1
      roomRef.current?.destroy()
    }
  }, [])

  useEffect(() => {
    if (mode !== 'menu' || busy) {
      setLobbyReady(false)
      return
    }
    setLobbyReady(false)
    const stop = opts.watchLobby((rooms) => {
      setLobbyRooms(rooms.filter((r) => r.host.id !== you.id))
      setLobbyReady(true)
    })
    return () => stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, busy, you.id])

  const syncRoom = (next: BoardRoom<TState>, session: number) => {
    if (session !== sessionRef.current) {
      next.destroy()
      return
    }
    roomRef.current = next
    setRoom({ ...next })
  }

  const connectHost = async () => {
    const session = ++sessionRef.current
    roomRef.current?.destroy()
    roomRef.current = null
    setError(null)
    setBusy(true)
    setMode('host')
    setRoom(null)
    try {
      const created = await opts.hostRoom(you, {
        onUpdate: (next) => syncRoom(next, session),
      })
      if (session !== sessionRef.current) {
        created.destroy()
        return
      }
      syncRoom(created, session)
      opts.onHaptic?.('medium')
    } catch (e) {
      if (session !== sessionRef.current) return
      setError(e instanceof Error ? e.message : 'Не удалось создать комнату')
      setMode('menu')
      setRoom(null)
      opts.onHaptic?.('error')
    } finally {
      if (session === sessionRef.current) setBusy(false)
    }
  }

  const connectJoin = async (code: string, hostName?: string) => {
    const clean = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (clean.length < 4) {
      setError('Выберите комнату из списка')
      return
    }
    const session = ++sessionRef.current
    roomRef.current?.destroy()
    roomRef.current = null
    setJoinCode(clean)
    setJoiningHost(hostName ?? null)
    setError(null)
    setBusy(true)
    setMode('join')
    setRoom(null)
    try {
      const joined = await opts.joinRoom(clean, you, {
        onUpdate: (next) => syncRoom(next, session),
      })
      if (session !== sessionRef.current) {
        joined.destroy()
        return
      }
      syncRoom(joined, session)
      opts.onHaptic?.('medium')
    } catch (e) {
      if (session !== sessionRef.current) return
      setError(e instanceof Error ? e.message : 'Не удалось подключиться')
      setMode('menu')
      setRoom(null)
      setJoiningHost(null)
      opts.onHaptic?.('error')
    } finally {
      if (session === sessionRef.current) setBusy(false)
    }
  }

  useEffect(() => {
    if (!opts.initialCode) return
    void connectJoin(opts.initialCode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const leave = () => {
    sessionRef.current += 1
    roomRef.current?.destroy()
    roomRef.current = null
    setRoom(null)
    setMode('menu')
    setBusy(false)
    setError(null)
    setJoiningHost(null)
  }

  const forceRefreshApp = () => {
    const next = new URL(location.href)
    next.searchParams.set('v', typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : String(Date.now()))
    next.searchParams.set('_', String(Date.now()))
    location.replace(next.toString())
  }

  return {
    you,
    title: opts.title,
    mode,
    joinCode,
    setJoinCode,
    showCodeJoin,
    setShowCodeJoin,
    lobbyRooms,
    lobbyReady,
    joiningHost,
    room,
    error,
    busy,
    connectHost,
    connectJoin,
    leave,
    forceRefreshApp,
    onHaptic: opts.onHaptic,
  }
}

export function OnlineLobbyMenu({
  title,
  lead,
  error,
  busy,
  lobbyReady,
  lobbyRooms,
  showCodeJoin,
  setShowCodeJoin,
  joinCode,
  setJoinCode,
  onHost,
  onJoin,
  onRefresh,
  onBackToBot,
  onHaptic,
}: {
  title: string
  lead: string
  error: string | null
  busy: boolean
  lobbyReady: boolean
  lobbyRooms: LobbyListing[]
  showCodeJoin: boolean
  setShowCodeJoin: (v: boolean | ((p: boolean) => boolean)) => void
  joinCode: string
  setJoinCode: (v: string) => void
  onHost: () => void
  onJoin: (code: string, hostName?: string) => void
  onRefresh: () => void
  onBackToBot?: () => void
  onHaptic?: (t?: 'light' | 'medium' | 'success' | 'error') => void
}) {
  return (
    <div className="durak-online-lobby">
      <h2>{title}</h2>
      <p className="durak-online-lead">{lead}</p>
      <p className="durak-online-build">онлайн · лобби</p>
      {error && <p className="durak-online-error">{error}</p>}

      {!busy && (
        <div className="durak-online-actions">
          <button type="button" className="durak-btn durak-btn-primary" onClick={onHost}>
            Создать комнату
          </button>

          <div className="durak-lobby-list" aria-live="polite">
            <div className="durak-lobby-list-head">
              <span>Открытые комнаты</span>
              <span className="durak-lobby-list-count">
                {!lobbyReady ? 'поиск…' : lobbyRooms.length ? `${lobbyRooms.length}` : 'пусто'}
              </span>
            </div>
            {!lobbyReady && <p className="durak-lobby-empty">Ищем комнаты…</p>}
            {lobbyReady && lobbyRooms.length === 0 && (
              <p className="durak-lobby-empty">Пока никого нет — создайте комнату</p>
            )}
            {lobbyRooms.map((row) => (
              <button
                key={row.code}
                type="button"
                className="durak-lobby-row"
                onClick={() => onJoin(row.code, row.host.name)}
              >
                <span className="durak-lobby-row-name">{row.host.name}</span>
                <span className="durak-lobby-row-meta">1 / 2 · войти</span>
              </button>
            ))}
          </div>

          <button
            type="button"
            className="durak-btn"
            onClick={() => {
              setShowCodeJoin((v) => !v)
              onHaptic?.('light')
            }}
          >
            {showCodeJoin ? 'Скрыть код' : 'Войти по коду'}
          </button>
          {showCodeJoin && (
            <div className="durak-online-join">
              <label className="durak-online-join-label" htmlFor={`${title}-room-code`}>
                Код комнаты
              </label>
              <input
                id={`${title}-room-code`}
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="например VPAZRT"
                maxLength={8}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
              />
              <button
                type="button"
                className="durak-btn durak-btn-bito"
                disabled={joinCode.trim().length < 4}
                onClick={() => onJoin(joinCode)}
              >
                Войти
              </button>
            </div>
          )}

          <button type="button" className="durak-btn" onClick={onRefresh}>
            Обновить приложение
          </button>
          {onBackToBot && (
            <button type="button" className="durak-btn" onClick={onBackToBot}>
              Играть с ботом
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function OnlineWait({
  role,
  status,
  onLeave,
}: {
  role: 'host' | 'guest'
  status: string
  onLeave: () => void
}) {
  return (
    <div className="durak-online-lobby">
      <div className="durak-online-wait">
        {role === 'host' && (
          <p className="durak-online-wait-hint">Вас видно в списке лобби у других игроков</p>
        )}
        <p className="durak-online-wait-status">{status}</p>
        <button type="button" className="durak-btn" onClick={onLeave}>
          Отмена
        </button>
      </div>
    </div>
  )
}
