const PROGRESS_KEY = 'playfort-poker-progress'

export type PokerProgress = {
  xp: number
  hands: number
  wins: number
}

export type LevelInfo = {
  level: number
  intoLevel: number
  need: number
  /** 0..1 progress within current level */
  frac: number
}

export type XpAward = {
  gain: number
  leveledUp: boolean
  level: number
  progress: PokerProgress
}

const DEFAULT_PROGRESS: PokerProgress = { xp: 0, hands: 0, wins: 0 }

/** XP required to advance from `level` → `level + 1`. */
export function xpToNextLevel(level: number) {
  const lv = Math.max(1, Math.min(99, Math.floor(level)))
  return 35 + (lv - 1) * 15
}

export function levelFromXp(totalXp: number): LevelInfo {
  let xp = Math.max(0, Math.floor(totalXp))
  let level = 1
  while (level < 99) {
    const need = xpToNextLevel(level)
    if (xp < need) {
      return { level, intoLevel: xp, need, frac: need > 0 ? xp / need : 0 }
    }
    xp -= need
    level += 1
  }
  const need = xpToNextLevel(99)
  return { level: 99, intoLevel: 0, need, frac: 1 }
}

export function loadPokerProgress(): PokerProgress {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY)
    if (!raw) return { ...DEFAULT_PROGRESS }
    const parsed = JSON.parse(raw) as Partial<PokerProgress>
    const xp = Math.max(0, Math.floor(Number(parsed.xp) || 0))
    const hands = Math.max(0, Math.floor(Number(parsed.hands) || 0))
    const wins = Math.max(0, Math.floor(Number(parsed.wins) || 0))
    return { xp, hands, wins }
  } catch {
    return { ...DEFAULT_PROGRESS }
  }
}

export function savePokerProgress(next: PokerProgress) {
  try {
    localStorage.setItem(
      PROGRESS_KEY,
      JSON.stringify({
        xp: Math.max(0, Math.floor(next.xp)),
        hands: Math.max(0, Math.floor(next.hands)),
        wins: Math.max(0, Math.floor(next.wins)),
      }),
    )
  } catch {
    /* noop */
  }
}

/** Bot badge tracks a bit above the player — still a display rank, not AI difficulty. */
export function botDisplayLevel(playerLevel: number) {
  return Math.min(99, Math.max(3, playerLevel + 4))
}

export function xpForOutcome(outcome: 'win' | 'lose' | 'tie', potAmount: number) {
  const pot = Math.max(0, Math.floor(potAmount))
  if (outcome === 'win') return 20 + Math.min(30, Math.floor(pot / 40))
  if (outcome === 'tie') return 8
  return 4
}

export function awardPokerXp(outcome: 'win' | 'lose' | 'tie', potAmount: number): XpAward {
  const before = loadPokerProgress()
  const beforeLevel = levelFromXp(before.xp).level
  const gain = xpForOutcome(outcome, potAmount)
  const progress: PokerProgress = {
    xp: before.xp + gain,
    hands: before.hands + 1,
    wins: before.wins + (outcome === 'win' ? 1 : 0),
  }
  savePokerProgress(progress)
  const level = levelFromXp(progress.xp).level
  return {
    gain,
    leveledUp: level > beforeLevel,
    level,
    progress,
  }
}

export function formatXpNote(award: XpAward) {
  if (award.leveledUp) return ` · +${award.gain} XP · ур. ${award.level}!`
  return ` · +${award.gain} XP`
}
