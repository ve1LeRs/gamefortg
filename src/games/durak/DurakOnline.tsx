import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PlayingCard } from '../../components/PlayingCard'
import { type Card, isRed } from '../../lib/cards'
import { getWebApp } from '../../lib/telegram'
import { createSoloDurakRoom } from './localRoom'
import { type DurakRoom, type LobbyListing, type PlayerInfo, hostDurakRoom, joinDurakRoom, watchDurakLobby } from './peerRoom'
import type { SeatView, TablePair } from './engine'
import { bitoMess, handFanLayout, handFanY } from './handFan'

type Mode = 'menu' | 'host' | 'join' | 'solo'
type EnterKind = 'deal' | 'throw-player' | 'throw-bot' | 'none'

type DragState = {
  card: Card
  pointerId: number
  startX: number
  startY: number
  x: number
  y: number
  width: number
  height: number
  grabX: number
  grabY: number
  active: boolean
  overTable: boolean
}

const BITO_MS = 1120
const TAKE_MS = 920
const DEAL_MS = 980

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function playerFromTelegram(): PlayerInfo {
  const u = getWebApp()?.initDataUnsafe?.user
  if (u) {
    return { id: String(u.id), name: u.first_name || u.username || 'Игрок' }
  }
  return { id: `local-${Math.random().toString(36).slice(2, 8)}`, name: 'Игрок' }
}

function inviteLink(code: string): string {
  const bot = (import.meta as { env?: { VITE_BOT_USERNAME?: string } }).env?.VITE_BOT_USERNAME
  if (bot) return `https://t.me/${bot}?startapp=durak_${code}`
  return `${window.location.origin}${window.location.pathname}?durakRoom=${code}`
}

function tableSignature(table: TablePair[]) {
  return table
    .map((p) => `${p.attack.id}:${p.defence?.id ?? '-'}`)
    .join('|')
}

function OnlineTable({
  room,
  view,
  onHaptic,
  onLeave,
}: {
  room: DurakRoom
  view: SeatView
  onHaptic?: (t?: 'light' | 'medium' | 'success' | 'error') => void
  onLeave: () => void
}) {
  const [handViewportW, setHandViewportW] = useState(
    () => (typeof window !== 'undefined' ? window.innerWidth : 390),
  )
  const [drag, setDrag] = useState<DragState | null>(null)
  const [enterMap, setEnterMap] = useState<Record<string, EnterKind>>({})
  const [dealOrder, setDealOrder] = useState<Record<string, number>>({})
  const [throwingId, setThrowingId] = useState<string | null>(null)
  const [bitoFlying, setBitoFlying] = useState(false)
  const [tableFlying, setTableFlying] = useState(false)
  const [bitoAim, setBitoAim] = useState<Record<string, { dx: number; dy: number }> | null>(null)
  const [flightTable, setFlightTable] = useState<TablePair[] | null>(null)

  const fieldRef = useRef<HTMLDivElement>(null)
  const handRef = useRef<HTMLDivElement>(null)
  const tableCardsRef = useRef<HTMLDivElement>(null)
  const bitoPileRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const skipClickRef = useRef(false)
  const lastPlayRef = useRef(0)
  const lastPlayByUs = useRef(false)
  const prevView = useRef({
    sig: tableSignature(view.table),
    discardCount: view.discardCount,
    taking: view.taking,
    handIds: view.you.map((c) => c.id).join(','),
    table: view.table,
  })
  const animLock = useRef(false)

  const playerHand = view.you
  const handLayout = useMemo(
    () => handFanLayout(playerHand.length, handViewportW),
    [playerHand.length, handViewportW],
  )

  const iAmAttacker = view.attacker === view.seat
  const opponentTaking = view.taking && iAmAttacker
  const displayTable = flightTable ?? view.table
  const deckLayers = Math.min(5, Math.max(1, Math.ceil(view.deckCount / 6)))

  useEffect(() => {
    const el = handRef.current
    if (!el) return
    const measure = () => {
      const w = el.clientWidth || window.innerWidth
      setHandViewportW(Math.max(160, w))
    }
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measure()) : null
    ro?.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  // Deal stagger when new cards appear in hand
  useEffect(() => {
    const ids = playerHand.map((c) => c.id)
    const prev = prevView.current.handIds.split(',').filter(Boolean)
    const joined = ids.filter((id) => !prev.includes(id))
    if (joined.length === 0) return
    const order: Record<string, number> = {}
    joined.forEach((id, i) => {
      order[id] = i
    })
    setDealOrder((p) => ({ ...p, ...order }))
    setEnterMap((m) => {
      const next = { ...m }
      for (const id of joined) next[id] = 'deal'
      return next
    })
    const ms = prefersReducedMotion() ? 40 : DEAL_MS + joined.length * 80
    const t = window.setTimeout(() => {
      setEnterMap((m) => {
        const next = { ...m }
        for (const id of joined) {
          if (next[id] === 'deal') next[id] = 'none'
        }
        return next
      })
    }, ms)
    return () => window.clearTimeout(t)
  }, [playerHand])

  // Table throws + bito/take flights from remote/local state deltas
  useEffect(() => {
    const prev = prevView.current
    const sig = tableSignature(view.table)

    // New cards on table → throw enter
    if (sig !== prev.sig && view.table.length > 0) {
      const prevIds = new Set(
        prev.table.flatMap((p) => [p.attack.id, p.defence?.id].filter(Boolean) as string[]),
      )
      const kind: EnterKind = lastPlayByUs.current ? 'throw-player' : 'throw-bot'
      lastPlayByUs.current = false
      setEnterMap((m) => {
        const next = { ...m }
        for (const p of view.table) {
          if (!prevIds.has(p.attack.id)) next[p.attack.id] = kind
          if (p.defence && !prevIds.has(p.defence.id)) next[p.defence.id] = kind
        }
        return next
      })
    }

    // Bito: table cleared, discard grew
    if (
      !animLock.current &&
      prev.table.length > 0 &&
      view.table.length === 0 &&
      view.discardCount > prev.discardCount
    ) {
      animLock.current = true
      const snapshot = prev.table
      setFlightTable(snapshot)
      const aim: Record<string, { dx: number; dy: number }> = {}
      const pile = bitoPileRef.current
      const board = tableCardsRef.current
      if (pile && board) {
        const br = pile.getBoundingClientRect()
        const tx = br.left + Math.min(18, Math.max(8, br.width * 0.28))
        const ty = br.top + br.height * 0.48
        board.querySelectorAll<HTMLElement>('.durak-pair').forEach((el) => {
          const id = el.dataset.pairId
          if (!id) return
          const r = el.getBoundingClientRect()
          aim[id] = {
            dx: Math.round(tx - (r.left + r.width / 2)),
            dy: Math.round(ty - (r.top + r.height / 2)),
          }
        })
      }
      setBitoAim(Object.keys(aim).length ? aim : null)
      setBitoFlying(true)
      void (async () => {
        if (!prefersReducedMotion()) await sleep(BITO_MS)
        setBitoFlying(false)
        setBitoAim(null)
        setFlightTable(null)
        animLock.current = false
      })()
    }

    // Take: table cleared while taking ended (or opponent/you scooped)
    if (
      !animLock.current &&
      prev.table.length > 0 &&
      view.table.length === 0 &&
      prev.taking &&
      !view.taking &&
      view.discardCount === prev.discardCount
    ) {
      animLock.current = true
      setFlightTable(prev.table)
      setTableFlying(true)
      void (async () => {
        if (!prefersReducedMotion()) await sleep(TAKE_MS)
        setTableFlying(false)
        setFlightTable(null)
        animLock.current = false
      })()
    }

    prevView.current = {
      sig,
      discardCount: view.discardCount,
      taking: view.taking,
      handIds: view.you.map((c) => c.id).join(','),
      table: view.table.length > 0 ? view.table : prev.table,
    }
  }, [view])

  const enterFor = (id: string, fallback: EnterKind = 'none'): EnterKind =>
    enterMap[id] ?? fallback

  const pointInTable = (x: number, y: number) => {
    const el = fieldRef.current
    if (!el) return false
    const r = el.getBoundingClientRect()
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
  }

  const playCard = (card: Card, fromDrag = false) => {
    if (!view.legalCardIds.includes(card.id)) return
    const now = Date.now()
    if (now - lastPlayRef.current < 280) return
    lastPlayRef.current = now
    lastPlayByUs.current = true
    setThrowingId(card.id)
    setEnterMap((m) => ({ ...m, [card.id]: 'throw-player' }))
    room.sendAction({ type: 'play', cardId: card.id })
    onHaptic?.(fromDrag ? 'medium' : 'light')
    window.setTimeout(() => setThrowingId(null), prefersReducedMotion() ? 40 : 420)
  }

  const onCardClick = (card: Card) => {
    if (skipClickRef.current) {
      skipClickRef.current = false
      return
    }
    playCard(card)
  }

  const onCardPointerDown = (card: Card, e: React.PointerEvent<HTMLButtonElement>) => {
    if (view.youWon !== null || e.button !== 0) return
    if (!view.legalCardIds.includes(card.id)) return
    const rect = e.currentTarget.getBoundingClientRect()
    const next: DragState = {
      card,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      grabX: e.clientX - rect.left,
      grabY: e.clientY - rect.top,
      active: false,
      overTable: false,
    }
    dragRef.current = next
    setDrag(next)
  }

  const onCardPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    const dist = Math.hypot(dx, dy)
    let active = d.active
    if (!active && dist > 14) {
      if (Math.abs(dy) >= Math.abs(dx) * 0.85 && dy < 4) {
        active = true
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          /* ignore */
        }
      } else if (Math.abs(dx) > Math.abs(dy)) {
        dragRef.current = null
        setDrag(null)
        return
      }
    }
    if (!active && !d.active) return
    const overTable = active && pointInTable(e.clientX, e.clientY)
    const next: DragState = {
      ...d,
      active,
      overTable,
      x: e.clientX - d.grabX,
      y: e.clientY - d.grabY,
    }
    dragRef.current = next
    setDrag(next)
  }

  const endCardPointer = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    const shouldPlay = d.active && d.overTable
    if (d.active) skipClickRef.current = true
    dragRef.current = null
    setDrag(null)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
    if (shouldPlay) playCard(d.card, true)
  }

  const statusClass = [
    view.youWon === true ? 'win' : '',
    view.youWon === false ? 'lose' : '',
    opponentTaking || tableFlying || bitoFlying ? 'is-take' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const overClass =
    view.youWon === true ? 'is-win' : view.youWon === false ? 'is-lose' : ''

  return (
    <div
      className={`durak-table durak-online ${overClass}${bitoFlying ? ' is-bito-flight' : ''}${tableFlying ? ' is-take-flight' : ''}`}
    >
      <header className="durak-top">
        <div
          className={`durak-seat${!iAmAttacker ? ' is-active' : ''}${opponentTaking ? ' is-taking' : ''}${tableFlying ? ' is-receiving-cards' : ''}`}
        >
          <div className="durak-avatar bot-avatar" aria-hidden>
            👤
          </div>
          <div className="durak-seat-meta">
            <span className="durak-name">{room.opponent?.name ?? 'Соперник'}</span>
            <span className="durak-pill">{view.opponentCount}</span>
          </div>
          <div className="durak-bot-cards" aria-hidden>
            {Array.from({ length: Math.min(view.opponentCount, 6) }).map((_, i) => (
              <span
                key={i}
                className="durak-mini-back"
                style={{ ['--i' as string]: i, ['--n' as string]: Math.min(view.opponentCount, 6) }}
              />
            ))}
          </div>
        </div>
        {!opponentTaking && !tableFlying && !bitoFlying && (
          <p className={`durak-status ${statusClass}`}>
            {room.solo ? `${view.status} · ${room.you.name}` : view.status}
          </p>
        )}
        {room.solo && (
          <div className="durak-solo-toolbar">
            <button
              type="button"
              className="durak-solo-switch"
              onClick={() => {
                room.switchSeat?.()
                onHaptic?.('light')
              }}
            >
              Сменить игрока ({room.controllingSeat === 'a' ? '1→2' : '2→1'})
            </button>
            <button type="button" className="durak-solo-switch" onClick={onLeave}>
              Выйти из теста
            </button>
          </div>
        )}
      </header>

      <div
        ref={fieldRef}
        className={`durak-field${bitoFlying ? ' is-bito-flight' : ''}${tableFlying ? ' is-take-flight' : ''}`}
      >
        <div
          className={`durak-deck${view.deckCount === 0 ? ' is-empty' : ''}`}
          aria-label={view.deckCount > 0 ? `Колода: ${view.deckCount}` : `Козырь ${view.trump}`}
        >
          {view.deckCount > 0 && view.trumpCard ? (
            <>
              <PlayingCard card={view.trumpCard} rankStyle="ru" className="durak-trump-card" enter="none" />
              {Array.from({ length: deckLayers }).map((_, i) => (
                <span key={i} className="durak-deck-layer" style={{ ['--i' as string]: i }} />
              ))}
              <span className="durak-deck-count">{view.deckCount}</span>
            </>
          ) : (
            <span className={`durak-trump-suit${isRed(view.trump) ? ' is-red' : ''}`} aria-hidden>
              {view.trump}
            </span>
          )}
        </div>

        <div className="durak-table-zone">
          <div
            ref={tableCardsRef}
            className={`durak-table-cards${tableFlying ? ' is-bot-taking' : ''}${bitoFlying ? ' is-to-bito' : ''}`}
            data-count={displayTable.length}
          >
            {displayTable.length === 0 && <span className="durak-empty">Ход картой</span>}
            {displayTable.map((p) => {
              const aim = bitoAim?.[p.attack.id]
              return (
                <div
                  className="durak-pair"
                  key={p.attack.id}
                  data-pair-id={p.attack.id}
                  style={
                    aim
                      ? {
                          ['--bito-dx' as string]: `${aim.dx}px`,
                          ['--bito-dy' as string]: `${aim.dy}px`,
                        }
                      : undefined
                  }
                >
                  <PlayingCard
                    card={p.attack}
                    rankStyle="ru"
                    enter={enterFor(p.attack.id, 'none')}
                    className="durak-card"
                  />
                  {p.defence && (
                    <PlayingCard
                      card={p.defence}
                      rankStyle="ru"
                      enter={enterFor(p.defence.id, 'none')}
                      className="durak-card durak-defence"
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <div
          ref={bitoPileRef}
          className={`durak-bito${view.discardCount ? ' has-cards' : ' is-empty'}${bitoFlying ? ' is-catching' : ''}`}
          aria-label={view.discardCount ? `Бита: ${view.discardCount}` : 'Бита пуста'}
        >
          {view.discardCount > 0 &&
            Array.from({ length: Math.min(view.discardCount, 5) }).map((_, i) => (
              <span key={`bito-${i}`} className="durak-bito-card" style={bitoMess(`bito-${i}`, i)} aria-hidden />
            ))}
        </div>
      </div>

      {opponentTaking && !tableFlying && (
        <div className="durak-take-banner" role="status">
          Соперник берёт — подкиньте карты тех же рангов, потом «Отдать»
        </div>
      )}

      <div className="durak-actions">
        {view.youWon === true && <div className="durak-banner win">Победа!</div>}
        {view.youWon === false && <div className="durak-banner lose">Вы дурак</div>}
        {view.canTake && (
          <button
            type="button"
            className="durak-btn durak-btn-take"
            onClick={() => {
              room.sendAction({ type: 'take' })
              onHaptic?.('medium')
            }}
          >
            Беру
          </button>
        )}
        {view.canGive && (
          <button
            type="button"
            className="durak-btn durak-btn-take is-pulse"
            onClick={() => {
              room.sendAction({ type: 'give' })
              onHaptic?.('medium')
            }}
          >
            Отдать
          </button>
        )}
        {view.canBito && (
          <button
            type="button"
            className="durak-btn durak-btn-bito"
            onClick={() => {
              room.sendAction({ type: 'bito' })
              onHaptic?.('medium')
            }}
          >
            Бито
          </button>
        )}
        {view.youWon !== null && (
          <button type="button" className="durak-btn durak-btn-primary" onClick={onLeave}>
            Выйти
          </button>
        )}
      </div>

      <footer className="durak-bottom">
        <div
          ref={handRef}
          className={`durak-hand${drag?.active ? ' is-dragging' : ''}${Object.keys(dealOrder).length ? ' is-receiving' : ''}`}
          data-count={playerHand.length}
          data-rows={handLayout.rows}
          style={{
            ['--hand-card-w' as string]: `${handLayout.cardW}px`,
            ['--hand-card-h' as string]: `${handLayout.cardH}px`,
            ['--hand-step' as string]: `${handLayout.step}px`,
            ['--hand-fan-w' as string]: `${handLayout.fanWidth}px`,
            ['--hand-rows' as string]: handLayout.rows,
          }}
        >
          <div
            className="durak-hand-row"
            style={{ width: Math.min(handLayout.fanWidth, Math.max(0, handViewportW - 4)), zIndex: 1 }}
          >
            {playerHand.map((c, i) => {
              const n = playerHand.length
              const mid = (n - 1) / 2
              const offset = i - mid
              const fanY = handFanY(offset, n)
              const legal = view.legalCardIds.includes(c.id)
              const isDrag = drag?.card.id === c.id && drag.active
              const dealI = dealOrder[c.id] ?? 0
              return (
                <PlayingCard
                  key={c.id}
                  card={c}
                  index={i}
                  rankStyle="ru"
                  playable={false}
                  throwing={throwingId === c.id}
                  enter={enterFor(c.id, 'none')}
                  className={`durak-card durak-hand-card${isDrag ? ' is-drag-source' : ''}${legal ? '' : ' is-waiting'}`}
                  style={{
                    ['--fan' as string]: offset,
                    ['--rot' as string]: `${(offset * handLayout.rotStep).toFixed(2)}deg`,
                    ['--fan-y' as string]: `${fanY.toFixed(1)}px`,
                    ['--deal-i' as string]: dealI,
                    zIndex: isDrag ? 50 : throwingId === c.id ? 30 : i + 1,
                    touchAction: 'none',
                    opacity: legal || view.youWon !== null ? undefined : 0.72,
                  }}
                  onClick={() => onCardClick(c)}
                  onPointerDown={(e) => onCardPointerDown(c, e)}
                  onPointerMove={onCardPointerMove}
                  onPointerUp={endCardPointer}
                  onPointerCancel={endCardPointer}
                />
              )
            })}
          </div>
        </div>
        <div className="durak-dock">
          <div className={`durak-seat player ${iAmAttacker ? 'is-active' : ''}`}>
            <div className="durak-avatar you-avatar" aria-hidden>
              👤
            </div>
            <span className="durak-name">{room.solo ? room.you.name : 'Вы'}</span>
            <span className="durak-pill">{playerHand.length}</span>
          </div>
        </div>
      </footer>

      {drag?.active &&
        createPortal(
          <div
            className="durak-drag-ghost"
            style={{
              left: drag.x,
              top: drag.y,
              width: drag.width,
              height: drag.height,
            }}
            aria-hidden
          >
            <PlayingCard card={drag.card} rankStyle="ru" enter="none" className="durak-card" />
          </div>,
          document.body,
        )}
    </div>
  )
}

export function DurakOnline({
  initialCode,
  onHaptic,
  onBackToBot,
}: {
  initialCode?: string | null
  onHaptic?: (t?: 'light' | 'medium' | 'success' | 'error') => void
  onBackToBot?: () => void
}) {
  const you = useMemo(() => playerFromTelegram(), [])
  const [mode, setMode] = useState<Mode>(initialCode ? 'join' : 'menu')
  const [joinCode, setJoinCode] = useState(initialCode?.toUpperCase() ?? '')
  const [showCodeJoin, setShowCodeJoin] = useState(false)
  const [lobbyRooms, setLobbyRooms] = useState<LobbyListing[]>([])
  const [lobbyReady, setLobbyReady] = useState(false)
  const [joiningHost, setJoiningHost] = useState<string | null>(null)
  const [room, setRoom] = useState<DurakRoom | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const sessionRef = useRef(0)
  const roomRef = useRef<DurakRoom | null>(null)

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
    const stop = watchDurakLobby((rooms) => {
      setLobbyRooms(rooms.filter((r) => r.host.id !== you.id))
      setLobbyReady(true)
    })
    return () => {
      stop()
    }
  }, [mode, busy, you.id])

  useEffect(() => {
    if (!initialCode) return
    void connectJoin(initialCode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const syncRoom = (next: DurakRoom, session: number) => {
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
      const created = await hostDurakRoom(you, {
        onUpdate: (next) => syncRoom(next, session),
      })
      if (session !== sessionRef.current) {
        created.destroy()
        return
      }
      syncRoom(created, session)
      onHaptic?.('medium')
    } catch (e) {
      if (session !== sessionRef.current) return
      setError(e instanceof Error ? e.message : 'Не удалось создать комнату')
      setMode('menu')
      setRoom(null)
      onHaptic?.('error')
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
      const joined = await joinDurakRoom(clean, you, {
        onUpdate: (next) => syncRoom(next, session),
      })
      if (session !== sessionRef.current) {
        joined.destroy()
        return
      }
      syncRoom(joined, session)
      onHaptic?.('medium')
    } catch (e) {
      if (session !== sessionRef.current) return
      setError(e instanceof Error ? e.message : 'Не удалось подключиться')
      setMode('menu')
      setRoom(null)
      setJoiningHost(null)
      onHaptic?.('error')
    } finally {
      if (session === sessionRef.current) setBusy(false)
    }
  }

  const startSolo = () => {
    const session = ++sessionRef.current
    roomRef.current?.destroy()
    roomRef.current = null
    setError(null)
    setBusy(false)
    setMode('solo')
    setRoom(null)
    try {
      const solo = createSoloDurakRoom(you, {
        onUpdate: (next) => syncRoom(next, session),
      })
      syncRoom(solo, session)
      onHaptic?.('medium')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось начать тест')
      setMode('menu')
      setRoom(null)
      onHaptic?.('error')
    }
  }

  const copyInvite = async () => {
    if (!room) return
    try {
      await navigator.clipboard.writeText(`Дурак — код ${room.code}\n${inviteLink(room.code)}`)
      onHaptic?.('success')
    } catch {
      onHaptic?.('error')
    }
  }

  const shareInvite = async () => {
    if (!room) return
    const link = inviteLink(room.code)
    const wa = getWebApp() as { openTelegramLink?: (url: string) => void } | null
    if (wa?.openTelegramLink) {
      wa.openTelegramLink(
        `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(
          `Играем в Дурака! Код: ${room.code}`,
        )}`,
      )
      return
    }
    await copyInvite()
  }

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

  const friendlyError = (msg: string | null | undefined) => {
    if (!msg) return null
    if (/negotiation|peerjs|gft-durak|webrtc/i.test(msg)) {
      return 'Старая версия приложения в кэше Telegram. Нажмите «Обновить» ниже или полностью закройте Telegram и откройте снова.'
    }
    return msg
  }

  const view = room?.view
  if (room?.status === 'playing' && view) {
    return <OnlineTable room={room} view={view} onHaptic={onHaptic} onLeave={leave} />
  }

  const showWait = mode === 'host' || mode === 'join'
  const waitStatus =
    room?.status === 'waiting'
      ? room.role === 'host'
        ? 'Комната в списке лобби. Ждём соперника…'
        : joiningHost
          ? `Подключаемся к ${joiningHost}…`
          : 'Подключаемся к комнате…'
      : room?.status === 'connecting' || (busy && !room)
        ? 'Соединение…'
        : room?.status === 'disconnected'
          ? 'Соединение потеряно'
          : room?.status === 'error'
            ? (room.error ?? 'Ошибка')
            : busy
              ? 'Соединение…'
              : null

  const shownError = friendlyError(error) || friendlyError(room?.status !== 'playing' ? room?.error : null)

  return (
    <div className="durak-online-lobby">
      <h2>Дурак онлайн</h2>
      <p className="durak-online-lead">Создайте комнату или зайдите в открытую из списка.</p>
      <p className="durak-online-build" title={typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : ''}>
        онлайн · лобби
      </p>
      {shownError && <p className="durak-online-error">{shownError}</p>}

      {mode === 'menu' && !busy && (
        <div className="durak-online-actions">
          <button
            type="button"
            className="durak-btn durak-btn-primary"
            disabled={busy}
            onClick={() => void connectHost()}
          >
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
                disabled={busy}
                onClick={() => void connectJoin(row.code, row.host.name)}
              >
                <span className="durak-lobby-row-name">{row.host.name}</span>
                <span className="durak-lobby-row-meta">1 / 2 · войти</span>
              </button>
            ))}
          </div>

          <button type="button" className="durak-btn durak-btn-bito" disabled={busy} onClick={startSolo}>
            Тест на одном устройстве
          </button>

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
              <label className="durak-online-join-label" htmlFor="durak-room-code">
                Код комнаты
              </label>
              <input
                id="durak-room-code"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="например VPAZRT"
                maxLength={8}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
                aria-label="Код комнаты"
              />
              <button
                type="button"
                className="durak-btn durak-btn-bito"
                disabled={busy || joinCode.trim().length < 4}
                onClick={() => void connectJoin(joinCode)}
              >
                Войти
              </button>
            </div>
          )}

          <button type="button" className="durak-btn" onClick={forceRefreshApp}>
            Обновить приложение
          </button>
          {onBackToBot && (
            <button type="button" className="durak-btn" onClick={onBackToBot}>
              Играть с ботом
            </button>
          )}
        </div>
      )}

      {showWait && (
        <div className="durak-online-wait">
          {room?.role === 'host' && room.status === 'waiting' && (
            <p className="durak-online-wait-hint">Вас видно в списке лобби у других игроков</p>
          )}
          {waitStatus && <p className="durak-online-wait-status">{waitStatus}</p>}
          {room?.role === 'host' && room.status === 'waiting' && (
            <div className="durak-online-actions">
              <button type="button" className="durak-btn durak-btn-primary" onClick={() => void shareInvite()}>
                Пригласить по ссылке
              </button>
              <button type="button" className="durak-btn" onClick={() => void copyInvite()}>
                Скопировать ссылку
              </button>
            </div>
          )}
          <button type="button" className="durak-btn" onClick={leave}>
            Отмена
          </button>
        </div>
      )}
    </div>
  )
}
