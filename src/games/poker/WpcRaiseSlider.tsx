import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { buildBetStops } from './BetRoulette'

type WpcRaiseSliderProps = {
  min: number
  max: number
  value: number
  disabled?: boolean
  format: (n: number) => string
  /** Verb shown on the resting button (Ставка / Рейз / …). */
  label: React.ReactNode
  onChange: (next: number) => void
  /** Fired on short tap or after a completed drag-raise. */
  onConfirm: (amount: number) => void
  onTick?: () => void
}

const OPEN_PX = 14
const TRACK_H = 168
/** Keep thumb fully inside the track (padding + thumb height). */
const THUMB_INSET = 8
const THUMB_H = 28

/**
 * World Poker Club–style raise control:
 * hold the bet button and drag upward to open a vertical amount slider;
 * release to place that bet. A short tap confirms the current amount.
 */
export function WpcRaiseSlider({
  min,
  max,
  value,
  disabled,
  format,
  label,
  onChange,
  onConfirm,
  onTick,
}: WpcRaiseSliderProps) {
  const stops = useMemo(() => buildBetStops(min, max), [min, max])
  const btnRef = useRef<HTMLButtonElement>(null)
  const startY = useRef(0)
  const startX = useRef(0)
  const opened = useRef(false)
  const amountRef = useRef(value)
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState(value)
  const [anchor, setAnchor] = useState<{ left: number; bottom: number; width: number } | null>(
    null,
  )
  const lastTickIdx = useRef(-1)

  useEffect(() => {
    if (open) return
    amountRef.current = value
    setAmount(value)
  }, [value, open])

  const nearestIdx = (v: number) => {
    let best = 0
    let bestDist = Infinity
    for (let i = 0; i < stops.length; i += 1) {
      const d = Math.abs(stops[i]! - v)
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    }
    return best
  }

  const pickAmount = (clientY: number) => {
    const el = btnRef.current
    if (!el) return stops[0]!
    const rect = el.getBoundingClientRect()
    // Match visual thumb travel: padded inset inside the track
    const trackBottom = rect.top - 8
    const travelTop = trackBottom - TRACK_H + THUMB_INSET
    const travelBottom = trackBottom - THUMB_INSET - THUMB_H
    const t = Math.max(
      0,
      Math.min(1, (travelBottom - clientY) / Math.max(1, travelBottom - travelTop)),
    )
    const idx = Math.round(t * (stops.length - 1))
    return stops[Math.max(0, Math.min(stops.length - 1, idx))]!
  }

  const syncAmount = (next: number) => {
    amountRef.current = next
    setAmount(next)
    onChange(next)
    const idx = stops.indexOf(next)
    if (idx >= 0 && idx !== lastTickIdx.current) {
      lastTickIdx.current = idx
      onTick?.()
    }
  }

  const close = () => {
    opened.current = false
    setOpen(false)
    setAnchor(null)
    lastTickIdx.current = -1
  }

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    startY.current = e.clientY
    startX.current = e.clientX
    opened.current = false
    amountRef.current = value
    setAmount(value)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled || !e.currentTarget.hasPointerCapture(e.pointerId)) return
    const dy = startY.current - e.clientY
    if (!opened.current) {
      if (dy < OPEN_PX || Math.abs(e.clientX - startX.current) > 40) return
      opened.current = true
      const rect = e.currentTarget.getBoundingClientRect()
      setAnchor({
        left: rect.left + rect.width / 2,
        bottom: window.innerHeight - rect.top + 6,
        width: Math.max(72, rect.width),
      })
      setOpen(true)
    }
    syncAmount(pickAmount(e.clientY))
  }

  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled) return
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
    if (opened.current) {
      const finalAmt = amountRef.current
      close()
      onConfirm(finalAmt)
      return
    }
    close()
    onConfirm(value)
  }

  const onPointerCancel = () => {
    close()
  }

  const fill =
    stops.length <= 1 ? 0 : Math.max(0, Math.min(1, nearestIdx(amount) / (stops.length - 1)))
  const thumbBottom = THUMB_INSET + fill * (TRACK_H - THUMB_INSET * 2 - THUMB_H)
  const fillHeight = thumbBottom + THUMB_H / 2

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`poker-btn poker-btn-bet poker-wpc-bet${open ? ' is-raising' : ''}`}
        disabled={disabled}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onContextMenu={(e) => e.preventDefault()}
        aria-label="Ставка — удерживайте и тяните вверх для выбора суммы"
      >
        {open ? (
          <span className="poker-btn-stack">
            <span className="poker-btn-verb">До</span>
            <span className="poker-btn-amt">{format(amount)}</span>
          </span>
        ) : (
          label
        )}
      </button>

      {open && anchor
        ? createPortal(
            <div
              className="poker-wpc-raise"
              style={{
                left: anchor.left,
                bottom: anchor.bottom,
                width: anchor.width,
                height: TRACK_H,
              }}
              aria-hidden
            >
              <div className="poker-wpc-raise-track">
                <div className="poker-wpc-raise-fill" style={{ height: fillHeight }} />
                <div
                  className="poker-wpc-raise-thumb"
                  style={{ bottom: thumbBottom, height: THUMB_H }}
                >
                  <span className="poker-wpc-raise-amt">{format(amount)}</span>
                </div>
                <div className="poker-wpc-raise-marks" aria-hidden>
                  <span>Макс</span>
                  <span>Мин</span>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
