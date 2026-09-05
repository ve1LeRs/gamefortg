import type { Card } from '../lib/cards'
import { isRed, rankGlyph } from '../lib/cards'

type Props = {
  card?: Card
  faceDown?: boolean
  selected?: boolean
  playable?: boolean
  throwing?: boolean
  enter?: 'deal' | 'throw-player' | 'throw-bot' | 'none'
  /** latin (A,K,Q,J) or Russian Durak glyphs (Т,К,Д,В) */
  rankStyle?: 'latin' | 'ru'
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
  rankStyle = 'latin',
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
  const glyph = rankGlyph(card.rank, rankStyle)
  return (
    <button
      type="button"
      className={`pcard ${red ? 'red' : ''} ${selected ? 'selected' : ''} ${playable ? 'playable' : ''} ${throwing ? 'throwing' : ''} ${enterClass} ${className}`}
      onClick={onClick}
      style={mergedStyle}
      data-card-id={card.id}
      aria-label={`${card.rank} ${card.suit}`}
    >
      <span className="pcard-corner">
        <span className="pcard-rank">{glyph}</span>
        <span className="pcard-suit">{card.suit}</span>
      </span>
      <span className="suit-lg">{card.suit}</span>
      <span className="pcard-corner pcard-corner-br">
        <span className="pcard-rank">{glyph}</span>
        <span className="pcard-suit">{card.suit}</span>
      </span>
    </button>
  )
}
