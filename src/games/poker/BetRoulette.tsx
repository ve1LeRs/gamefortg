import { useEffect, useMemo, useRef, useState } from 'react'

/** Build stepped bet amounts from min→max (blind-scaled). */
export function buildBetStops(min: number, max: number): number[] {
  const lo = Math.max(0, Math.floor(min))
  const hi = Math.max(lo, Math.floor(max))
  if (hi <= lo) return [lo]

  const range = hi - lo
  let step = 5
  if (range > 80) step = 10
  if (range > 250) step = 25
  if (range > 800) step = 50
  if (range > 2500) step = 100
  if (range > 10_000) step = 250
  if (range > 40_000) step = 500
  if (range > 100_000) step = 1000

  const stops: number[] = []
  for (let v = lo; v < hi; v += step) stops.push(v)
  if (stops[stops.length - 1] !== hi) stops.push(hi)
  return stops
}

function nearestStopIndex(stops: number[], value: number) {
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < stops.length; i += 1) {
    const d = Math.abs(stops[i]! - value)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return best
}

type BetRouletteProps = {
  value: number
  min: number
  max: number
  disabled?: boolean
  format: (n: number) => string
  onChange: (next: number) => void
  onTick?: () => void
}

const ITEM_H = 28

/**
 * Vertical chip-amount drum (World Poker Club–style): drag with a finger to
 * scroll bet sizes; the center window is the active wager.
 */
export function BetRoulette({
  value,
  min,
  max,
  disabled,
  format,
  onChange,
  onTick,
}: BetRouletteProps) {
  const stops = useMemo(() => buildBetStops(min, max), [min, max])
  const scrollerRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const suppressScroll = useRef(false)
  const lastIdx = useRef(-1)
  const [activeIdx, setActiveIdx] = useState(() => nearestStopIndex(stops, value))

  // Keep drum aligned when presets / street changes set wager externally.
  useEffect(() => {
    const idx = nearestStopIndex(stops, value)
    setActiveIdx(idx)
    lastIdx.current = idx
    const el = scrollerRef.current
    if (!el || dragging.current) return
    const top = idx * ITEM_H
    if (Math.abs(el.scrollTop - top) > 1) {
      suppressScroll.current = true
      el.scrollTop = top
      requestAnimationFrame(() => {
        suppressScroll.current = false
      })
    }
  }, [value, stops])

  const emitFromScroll = (scrollTop: number) => {
    if (suppressScroll.current || disabled) return
    const idx = Math.max(0, Math.min(stops.length - 1, Math.round(scrollTop / ITEM_H)))
    if (idx === lastIdx.current) return
    lastIdx.current = idx
    setActiveIdx(idx)
    const next = stops[idx]!
    onChange(next)
    onTick?.()
  }

  return (
    <div
      className={`poker-bet-roulette${disabled ? ' is-disabled' : ''}`}
      aria-label="Размер ставки — тяните пальцем"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-disabled={disabled || undefined}
      role="slider"
    >
      <div className="poker-bet-roulette-fade is-top" aria-hidden />
      <div className="poker-bet-roulette-fade is-bottom" aria-hidden />
      <div className="poker-bet-roulette-window" aria-hidden />
      <div
        ref={scrollerRef}
        className="poker-bet-roulette-scroller"
        onScroll={(e) => emitFromScroll((e.target as HTMLDivElement).scrollTop)}
        onPointerDown={() => {
          if (disabled) return
          dragging.current = true
        }}
        onPointerUp={() => {
          dragging.current = false
          const el = scrollerRef.current
          if (!el) return
          const idx = Math.max(0, Math.min(stops.length - 1, Math.round(el.scrollTop / ITEM_H)))
          el.scrollTo({ top: idx * ITEM_H, behavior: 'smooth' })
        }}
        onPointerCancel={() => {
          dragging.current = false
        }}
      >
        <div className="poker-bet-roulette-pad" aria-hidden />
        {stops.map((v, i) => (
          <div
            key={`${v}-${i}`}
            className={`poker-bet-roulette-item${i === activeIdx ? ' is-active' : ''}`}
            style={{ height: ITEM_H }}
          >
            {format(v)}
          </div>
        ))}
        <div className="poker-bet-roulette-pad" aria-hidden />
      </div>
    </div>
  )
}
