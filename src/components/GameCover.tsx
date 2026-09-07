import type { GameId, GameMeta } from '../data/games'

function PokerArt() {
  return (
    <div className="cover-scene cover-poker" aria-hidden>
      <div className="felt" />
      <div className="card card-l">
        <span>A</span>
        <i>♠</i>
      </div>
      <div className="card card-r">
        <span>K</span>
        <i>♥</i>
      </div>
      <div className="chip chip-a" />
      <div className="chip chip-b" />
    </div>
  )
}

function DurakArt() {
  return (
    <div className="cover-scene cover-durak" aria-hidden>
      <div className="fan">
        <div className="card c1">
          <span>6</span>
          <i>♦</i>
        </div>
        <div className="card c2">
          <span>10</span>
          <i>♣</i>
        </div>
        <div className="card c3 trump">
          <span>A</span>
          <i>♥</i>
        </div>
      </div>
    </div>
  )
}

function ChessArt() {
  return (
    <div className="cover-scene cover-chess" aria-hidden>
      <div className="mini-board">
        {Array.from({ length: 16 }, (_, i) => (
          <span key={i} className={(Math.floor(i / 4) + i) % 2 ? 'd' : 'l'} />
        ))}
      </div>
      <div className="piece king">♚</div>
      <div className="piece pawn">
        <svg viewBox="0 0 45 45" width="1em" height="1em" aria-hidden>
          <path
            d="M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03-3 1.06-7.41 5.55-7.41 13.47h23c0-7.92-4.41-12.41-7.41-13.47 1.47-1.19 2.41-3 2.41-5.03 0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z"
            fill="#f3ebe0"
            stroke="#2a1c12"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  )
}

function CheckersArt() {
  return (
    <div className="cover-scene cover-checkers" aria-hidden>
      <div className="mini-board">
        {Array.from({ length: 16 }, (_, i) => (
          <span key={i} className={(Math.floor(i / 4) + i) % 2 ? 'd' : 'l'} />
        ))}
      </div>
      <div className="man m1" />
      <div className="man m2" />
      <div className="man m3" />
    </div>
  )
}

function SolitaireArt() {
  return (
    <div className="cover-scene cover-solitaire" aria-hidden>
      <div className="stack s1">
        <div className="card back" />
        <div className="card">
          <span>Q</span>
          <i>♠</i>
        </div>
      </div>
      <div className="stack s2">
        <div className="card">
          <span>J</span>
          <i>♥</i>
        </div>
        <div className="card face low">
          <span>10</span>
          <i>♦</i>
        </div>
      </div>
      <div className="stack s3">
        <div className="card">
          <span>A</span>
          <i>♣</i>
        </div>
      </div>
    </div>
  )
}

const ART: Record<GameId, () => React.ReactNode> = {
  poker: PokerArt,
  durak: DurakArt,
  chess: ChessArt,
  checkers: CheckersArt,
  solitaire: SolitaireArt,
}

export function GameCover({
  game,
  square,
  showTitle,
}: {
  game: GameMeta
  square?: boolean
  showTitle?: boolean
}) {
  const Art = ART[game.id]
  return (
    <div
      className={`game-cover cover-${game.id}${square ? ' is-square' : ''}`}
      style={{ '--accent': game.accent, '--glow': game.glow } as React.CSSProperties}
    >
      <div className="cover-base" />
      <Art />
      {showTitle ? <div className="cover-title">{game.title}</div> : null}
    </div>
  )
}
