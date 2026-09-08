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
  const timing = dealTimingFor(s.dealSpeed)
  root.style.setProperty('--deal-duration-scale', String(timing.durationScale))
  root.style.setProperty('--deal-stagger-scale', String(timing.staggerScale))
  body.classList.toggle('settings-reduce-motion', s.animations !== 'full')
  body.classList.toggle('settings-no-motion', s.animations === 'off')
}

/** Timing used by deal animations (CSS) and JS wait windows. */
export function dealTimingFor(speed: DealSpeed = loadSettings().dealSpeed) {
  if (speed === 'slow') {
    return { durationScale: 1.55, staggerScale: 1.45, baseMs: 1450, gapMs: 160, boardGapMs: 110 }
  }
  if (speed === 'fast') {
    return { durationScale: 0.52, staggerScale: 0.5, baseMs: 480, gapMs: 50, boardGapMs: 35 }
  }
  return { durationScale: 1, staggerScale: 1, baseMs: 980, gapMs: 110, boardGapMs: 70 }
}

export function getDealTiming() {
  return dealTimingFor(loadSettings().dealSpeed)
}

export function getDisplayName(telegramName: string | undefined, settings: AppSettings) {
  const nick = settings.nickname.trim()
  if (nick) return nick
  return telegramName?.trim() || 'Гость'
}

let sharedAudioCtx: AudioContext | null = null

function getAudioCtx(): AudioContext | null {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return null
    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
      sharedAudioCtx = new Ctx()
    }
    if (sharedAudioCtx.state === 'suspended') void sharedAudioCtx.resume()
    return sharedAudioCtx
  } catch {
    return null
  }
}

function noiseBuffer(ctx: AudioContext, seconds: number) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds))
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1
  return buf
}

/** Soft UI blip — no asset files needed. */
export function playUiSound(kind: 'tap' | 'ok' | 'warn' | 'deal' = 'tap') {
  try {
    const s = loadSettings()
    if (!s.sounds) return
    const ctx = getAudioCtx()
    if (!ctx) return
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
  } catch {
    /* noop */
  }
}

/** Poker table FX: chip rustle / card slide — synthesized, no assets. */
export function playPokerSound(kind: 'chips' | 'card' | 'cards') {
  try {
    const s = loadSettings()
    if (!s.sounds) return
    const ctx = getAudioCtx()
    if (!ctx) return
    const now = ctx.currentTime

    const noiseBurst = (
      t: number,
      dur: number,
      vol: number,
      opts: { hp: number; lp: number; peakAt?: number },
    ) => {
      const src = ctx.createBufferSource()
      src.buffer = noiseBuffer(ctx, dur + 0.05)
      const high = ctx.createBiquadFilter()
      high.type = 'highpass'
      high.frequency.value = opts.hp
      high.Q.value = 0.7
      const low = ctx.createBiquadFilter()
      low.type = 'lowpass'
      low.frequency.setValueAtTime(opts.lp, t)
      low.frequency.exponentialRampToValueAtTime(Math.max(280, opts.lp * 0.45), t + dur)
      low.Q.value = 0.8
      const gain = ctx.createGain()
      const peak = t + (opts.peakAt ?? 0.012)
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(vol, peak)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
      src.connect(high)
      high.connect(low)
      low.connect(gain)
      gain.connect(ctx.destination)
      src.start(t)
      src.stop(t + dur + 0.06)
    }

    const chipTick = (t: number, freq: number, vol: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(freq, t)
      osc.frequency.exponentialRampToValueAtTime(Math.max(90, freq * 0.5), t + 0.035)
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(vol, t + 0.003)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.04)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.05)
    }

    /** Soft paper/card whoosh — no tonal beep. */
    const cardSlide = (t: number) => {
      // Air/friction of the slide
      noiseBurst(t, 0.11, 0.038, { hp: 700, lp: 2800, peakAt: 0.018 })
      // Quieter mid scrape
      noiseBurst(t + 0.01, 0.07, 0.022, { hp: 1400, lp: 4500, peakAt: 0.01 })
      // Soft felt land thump
      noiseBurst(t + 0.06, 0.055, 0.03, { hp: 120, lp: 520, peakAt: 0.008 })
    }

    if (kind === 'chips') {
      for (let i = 0; i < 5; i += 1) {
        const t = now + i * 0.03 + Math.random() * 0.008
        noiseBurst(t, 0.04, 0.04 + Math.random() * 0.015, { hp: 800, lp: 3800, peakAt: 0.006 })
        chipTick(t + 0.003, 820 + Math.random() * 520, 0.022)
      }
      return
    }

    if (kind === 'card') {
      cardSlide(now)
      return
    }

    // cards — staggered deal, slightly varied timing
    for (let i = 0; i < 3; i += 1) {
      cardSlide(now + i * 0.078 + Math.random() * 0.01)
    }
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
