export type GameId = 'poker' | 'durak' | 'chess' | 'checkers' | 'solitaire'

export type GameMeta = {
  id: GameId
  title: string
  tagline: string
  genre: string
  players: string
  accent: string
  glow: string
  cover: string
  featured?: boolean
  free: boolean
}

export const GAMES: GameMeta[] = [
  {
    id: 'poker',
    title: 'Покер',
    tagline: 'Техасский холдем против бота. Блефуй, поднимай, забирай банк.',
    genre: 'Карты',
    players: '1 vs бот',
    accent: '#E8A838',
    glow: 'rgba(232, 168, 56, 0.35)',
    cover: 'poker',
    featured: true,
    free: true,
  },
  {
    id: 'durak',
    title: 'Дурак',
    tagline: 'Классика двора. С ботом или с другом по ссылке.',
    genre: 'Карты',
    players: '1 vs бот · 2 онлайн',
    accent: '#3DDC97',
    glow: 'rgba(61, 220, 151, 0.3)',
    cover: 'durak',
    featured: true,
    free: true,
  },
  {
    id: 'chess',
    title: 'Шахматы',
    tagline: 'Полная доска 8×8. Ходи фигурами, думай на ход вперёд.',
    genre: 'Стратегия',
    players: '1 vs бот',
    accent: '#5BA4FF',
    glow: 'rgba(91, 164, 255, 0.3)',
    cover: 'chess',
    free: true,
  },
  {
    id: 'checkers',
    title: 'Шашки',
    tagline: 'Русские шашки. Бить обязательно, дамки ходят далеко.',
    genre: 'Стратегия',
    players: '1 vs бот',
    accent: '#FF6B4A',
    glow: 'rgba(255, 107, 74, 0.3)',
    cover: 'checkers',
    free: true,
  },
  {
    id: 'solitaire',
    title: 'Косынка',
    tagline: 'Пасьянс Klondike. Разложи колоду по мастям — спокойный раунд.',
    genre: 'Пасьянс',
    players: 'Соло',
    accent: '#C084FC',
    glow: 'rgba(192, 132, 252, 0.28)',
    cover: 'solitaire',
    free: true,
  },
]

export function getGame(id: string): GameMeta | undefined {
  return GAMES.find((g) => g.id === id)
}
