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
      <div className="piece pawn">♙</div>
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
