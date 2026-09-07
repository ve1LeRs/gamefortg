import type { BotDifficulty } from '../games/botDifficulty'

export type AccentTheme = 'gold' | 'mint' | 'azure' | 'coral' | 'violet'
export type CardBack = 'classic' | 'gold' | 'mint' | 'ruby' | 'midnight' | 'emerald'
export type AnimLevel = 'full' | 'reduced' | 'off'
export type DealSpeed = 'slow' | 'normal' | 'fast'
export type FeltStyle = 'blue' | 'forest' | 'crimson' | 'slate'

export type AppSettings = {
  haptics: boolean
  sounds: boolean
  animations: AnimLevel
  dealSpeed: DealSpeed
  accent: AccentTheme
  cardBack: CardBack
  felt: FeltStyle
  botDifficulty: BotDifficulty
  confirmFold: boolean
  autoClearSolitaire: boolean
  showPlayerNames: boolean
  nickname: string
  keepAwake: boolean
  largeTrump: boolean
  highlightHints: boolean
  tableEffects: boolean
}

export const SETTINGS_KEY = 'playfort-settings-v1'

export const DEFAULT_SETTINGS: AppSettings = {
  haptics: true,
  sounds: true,
  animations: 'full',
  dealSpeed: 'normal',
  accent: 'gold',
  cardBack: 'classic',
  felt: 'blue',
  botDifficulty: 'medium',
  confirmFold: false,
  autoClearSolitaire: false,
  showPlayerNames: true,
  nickname: '',
  keepAwake: true,
  largeTrump: true,
  highlightHints: true,
  tableEffects: true,
}

export const ACCENT_OPTIONS: { id: AccentTheme; label: string; color: string }[] = [
  { id: 'gold', label: 'Золото', color: '#e8a838' },
  { id: 'mint', label: 'Мята', color: '#3ddc97' },
  { id: 'azure', label: 'Лазурь', color: '#5ba4ff' },
  { id: 'coral', label: 'Коралл', color: '#ff6b4a' },
  { id: 'violet', label: 'Фиолет', color: '#c084fc' },
]

export const CARD_BACK_OPTIONS: { id: CardBack; label: string }[] = [
  { id: 'classic', label: 'Классика' },
  { id: 'gold', label: 'Золотая' },
  { id: 'mint', label: 'Мятная' },
  { id: 'ruby', label: 'Рубин' },
  { id: 'midnight', label: 'Полночь' },
  { id: 'emerald', label: 'Изумруд' },
]

export const FELT_OPTIONS: { id: FeltStyle; label: string }[] = [
  { id: 'blue', label: 'Синий' },
  { id: 'forest', label: 'Лес' },
  { id: 'crimson', label: 'Бордо' },
  { id: 'slate', label: 'Графит' },
]

const ACCENT_VARS: Record<AccentTheme, { accent: string; accent2: string; glow: string }> = {
  gold: { accent: '#e8a838', accent2: '#3ddc97', glow: 'rgba(232, 168, 56, 0.35)' },
  mint: { accent: '#3ddc97', accent2: '#e8a838', glow: 'rgba(61, 220, 151, 0.35)' },
  azure: { accent: '#5ba4ff', accent2: '#3ddc97', glow: 'rgba(91, 164, 255, 0.35)' },
  coral: { accent: '#ff6b4a', accent2: '#e8a838', glow: 'rgba(255, 107, 74, 0.35)' },
  violet: { accent: '#c084fc', accent2: '#5ba4ff', glow: 'rgba(192, 132, 252, 0.35)' },
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(next: AppSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
  applySettingsToDom(next)
  window.dispatchEvent(new CustomEvent('playfort-settings', { detail: next }))
}

export function applySettingsToDom(s: AppSettings) {
  const root = document.documentElement
  const body = document.body
  const theme = ACCENT_VARS[s.accent] ?? ACCENT_VARS.gold
  root.style.setProperty('--accent', theme.accent)
  root.style.setProperty('--accent-2', theme.accent2)
  root.dataset.cardBack = s.cardBack
  root.dataset.felt = s.felt
  root.dataset.animations = s.animations
  root.dataset.dealSpeed = s.dealSpeed
  root.dataset.largeTrump = s.largeTrump ? '1' : '0'
  root.dataset.tableEffects = s.tableEffects ? '1' : '0'
  root.dataset.highlightHints = s.highlightHints ? '1' : '0'
  body.classList.toggle('settings-reduce-motion', s.animations !== 'full')
  body.classList.toggle('settings-no-motion', s.animations === 'off')
}

export function getDisplayName(telegramName: string | undefined, settings: AppSettings) {
  const nick = settings.nickname.trim()
  if (nick) return nick
  return telegramName?.trim() || 'Гость'
}

/** Soft UI blip — no asset files needed. */
export function playUiSound(kind: 'tap' | 'ok' | 'warn' | 'deal' = 'tap') {
  try {
    const s = loadSettings()
    if (!s.sounds) return
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    const now = ctx.currentTime
    const freq = kind === 'ok' ? 660 : kind === 'warn' ? 220 : kind === 'deal' ? 480 : 520
    osc.frequency.setValueAtTime(freq, now)
    osc.type = kind === 'deal' ? 'triangle' : 'sine'
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.05, now + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (kind === 'deal' ? 0.12 : 0.08))
    osc.start(now)
    osc.stop(now + 0.14)
    window.setTimeout(() => void ctx.close(), 200)
  } catch {
    /* noop */
  }
}

let wakeLock: WakeLockSentinel | null = null

export async function syncWakeLock(playing: boolean) {
  try {
    const s = loadSettings()
    if (!playing || !s.keepAwake) {
      await wakeLock?.release()
      wakeLock = null
      return
    }
    if (!('wakeLock' in navigator)) return
    wakeLock = await navigator.wakeLock.request('screen')
  } catch {
    wakeLock = null
  }
}
