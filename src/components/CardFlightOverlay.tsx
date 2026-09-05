import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { PlayingCard } from './PlayingCard'
import type { CardFlight } from '../lib/cardFlight'
import { rectCenter } from '../lib/cardFlight'

type Props = {
  flight: CardFlight | null
  onDone: (id: string) => void
}

export function CardFlightOverlay({ flight, onDone }: Props) {
  const nodeRef = useRef<HTMLDivElement>(null)
  const doneRef = useRef(onDone)
  doneRef.current = onDone

  useEffect(() => {
    if (!flight) return
    const el = nodeRef.current
    if (!el) {
      const t = window.setTimeout(() => doneRef.current(flight.id), 0)
      return () => window.clearTimeout(t)
    }

    const from = rectCenter(flight.from)
    const to = rectCenter(flight.to)
    const dx = to.x - from.x
    const dy = to.y - from.y
    const rot = flight.rotate ?? (dy < 0 ? -12 : 12)

    el.style.left = `${flight.from.left}px`
    el.style.top = `${flight.from.top}px`
    el.style.width = `${Math.max(flight.from.width, 56)}px`
    el.style.height = `${Math.max(flight.from.height, 80)}px`
    el.style.opacity = '1'
    el.style.visibility = 'visible'
    el.style.zIndex = '99999'

    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      doneRef.current(flight.id)
    }

    const reduced =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (reduced || typeof el.animate !== 'function') {
      el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`
      const t = window.setTimeout(finish, 40)
      return () => window.clearTimeout(t)
    }

    const anim = el.animate(
      [
        {
          transform: 'translate3d(0, 0, 0) rotate(0deg) scale(1)',
          offset: 0,
        },
        {
          transform: `translate3d(${dx * 0.55}px, ${dy * 0.55 - 28}px, 0) rotate(${rot}deg) scale(1.08)`,
          offset: 0.55,
        },
        {
          transform: `translate3d(${dx}px, ${dy}px, 0) rotate(0deg) scale(1)`,
          offset: 1,
        },
      ],
      {
        duration: 720,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'forwards',
      },
    )

    anim.onfinish = finish
    const fallback = window.setTimeout(finish, 780)

    return () => {
      window.clearTimeout(fallback)
      try {
        anim.cancel()
      } catch {
        /* ignore */
      }
      // If React tears down mid-flight, still unblock the game loop.
      finish()
    }
  }, [flight])

  if (!flight || typeof document === 'undefined') return null

  return createPortal(
    <div ref={nodeRef} className="card-flight" aria-hidden>
      <PlayingCard
        card={flight.card}
        faceDown={flight.faceDown}
        className="card-flight-inner"
        enter="none"
        index={0}
      />
    </div>,
    document.body,
  )
}
