import type { Card } from '../lib/cards'
import { isRed } from '../lib/cards'

type Props = {
  card?: Card
  faceDown?: boolean
  selected?: boolean
  playable?: boolean
  onClick?: () => void
  className?: string
  style?: React.CSSProperties
}

export function PlayingCard({
  card,
  faceDown,
  selected,
  playable,
  onClick,
  className = '',
  style,
}: Props) {
  if (faceDown || !card) {
    return (
      <button
        type="button"
        className={`pcard face-down ${className}`}
        onClick={onClick}
        style={style}
        aria-label="Карта рубашкой вверх"
      />
    )
  }

  const red = isRed(card.suit)
  return (
    <button
      type="button"
      className={`pcard ${red ? 'red' : ''} ${selected ? 'selected' : ''} ${playable ? 'playable' : ''} ${className}`}
      onClick={onClick}
      style={style}
      aria-label={`${card.rank} ${card.suit}`}
    >
      <span>
        {card.rank}
        {card.suit}
      </span>
      <span className="suit-lg">{card.suit}</span>
      <span style={{ alignSelf: 'flex-end', transform: 'rotate(180deg)' }}>
        {card.rank}
        {card.suit}
      </span>
    </button>
  )
}
