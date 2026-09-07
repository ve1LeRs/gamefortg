export type BotDifficulty = 'easy' | 'medium' | 'hard'

export const BOT_DIFFICULTY_LABEL: Record<BotDifficulty, string> = {
  easy: 'Лёгкий',
  medium: 'Средний',
  hard: 'Сложный',
}

export const BOT_DIFFICULTY_HINT: Record<BotDifficulty, string> = {
  easy: 'Ошибки и случайные ходы',
  medium: 'Играет осторожно',
  hard: 'Считает дальше',
}

export const BOT_DIFFICULTIES: BotDifficulty[] = ['easy', 'medium', 'hard']
