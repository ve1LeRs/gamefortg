import type { GameMeta } from '../data/games'

const ICONS: Record<string, string> = {
  poker: '♠',
  durak: '♦',
  chess: '♟',
  checkers: '●',
  solitaire: '♣',
}

export function GameIcon({ id, size = 40 }: { id: string; size?: number }) {
  return (
    <span style={{ fontSize: size, lineHeight: 1 }} aria-hidden>
      {ICONS[id] ?? '🎮'}
    </span>
  )
}

export function GameCover({ game, square }: { game: GameMeta; square?: boolean }) {
  return (
    <div
      className="game-cover"
      style={
        {
          '--tile-glow': game.glow,
          aspectRatio: square ? '1' : undefined,
        } as React.CSSProperties
      }
    >
      <div
        className="game-cover-art"
        style={{
          background: `linear-gradient(145deg, ${game.accent}33, transparent 60%), ${game.accent}18`,
        }}
      >
        <GameIcon id={game.id} size={square ? 48 : 56} />
      </div>
    </div>
  )
}
