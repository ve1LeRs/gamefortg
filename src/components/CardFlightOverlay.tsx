import { useEffect, useState } from 'react'
import { PlayingCard } from './PlayingCard'
import type { CardFlight } from '../lib/cardFlight'
import { rectCenter } from '../lib/cardFlight'

type Props = {
  flight: CardFlight | null
  onDone: (id: string) => void
}

export function CardFlightOverlay({ flight, onDone }: Props) {
  const [active, setActive] = useState(false)

  useEffect(() => {
    if (!flight) {
      setActive(false)
      return
    }
    setActive(false)
    const start = requestAnimationFrame(() => {
      requestAnimationFrame(() => setActive(true))
    })
    const done = window.setTimeout(() => onDone(flight.id), 640)
    return () => {
      cancelAnimationFrame(start)
      window.clearTimeout(done)
    }
  }, [flight, onDone])

  if (!flight) return null

  const from = rectCenter(flight.from)
  const to = rectCenter(flight.to)
  const dx = to.x - from.x
  const dy = to.y - from.y
  const rot = flight.rotate ?? (dy < 0 ? -10 : 10)

  return (
    <div
      className={`card-flight ${active ? 'is-flying' : ''}`}
      style={{
        left: flight.from.left,
        top: flight.from.top,
        width: flight.from.width,
        height: flight.from.height,
        ['--dx' as string]: `${dx}px`,
        ['--dy' as string]: `${dy}px`,
        ['--rot' as string]: `${rot}deg`,
      }}
      aria-hidden
    >
      <PlayingCard card={flight.card} faceDown={flight.faceDown} className="card-flight-inner" index={0} />
    </div>
  )
}
