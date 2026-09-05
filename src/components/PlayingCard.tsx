import type { Card } from '../lib/cards'
import { isRed } from '../lib/cards'

type Props = {
  card?: Card
  faceDown?: boolean
  selected?: boolean
  playable?: boolean
  throwing?: boolean
  enter?: 'deal' | 'throw-player' | 'throw-bot' | 'none'
  onClick?: () => void
  className?: string
  style?: React.CSSProperties
  index?: number
}

export function PlayingCard({
  card,
  faceDown,
  selected,
  playable,
  throwing,
  enter = 'deal',
  onClick,
  className = '',
  style,
  index = 0,
}: Props) {
  const mergedStyle = {
    ...style,
    ['--i' as string]: index,
  }

  const enterClass =
    enter === 'throw-player'
      ? 'enter-throw-player'
      : enter === 'throw-bot'
        ? 'enter-throw-bot'
        : enter === 'none'
          ? 'enter-none'
          : ''

  if (faceDown || !card) {
    return (
      <button
        type="button"
        className={`pcard face-down ${throwing ? 'throwing' : ''} ${enterClass} ${className}`}
        onClick={onClick}
        style={mergedStyle}
        data-card-id={card?.id}
        aria-label="Карта рубашкой вверх"
      />
    )
  }

  const red = isRed(card.suit)
  return (
    <button
      type="button"
      className={`pcard ${red ? 'red' : ''} ${selected ? 'selected' : ''} ${playable ? 'playable' : ''} ${throwing ? 'throwing' : ''} ${enterClass} ${className}`}
      onClick={onClick}
      style={mergedStyle}
      data-card-id={card.id}
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
