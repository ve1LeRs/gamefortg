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
let audioLifecycleInstalled = false

type AudioCtxState = AudioContextState | 'interrupted'

function createAudioCtx(): AudioContext | null {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return null
    return new Ctx()
  } catch {
    return null
  }
}

function audioIsRunning(ctx: AudioContext) {
  return (ctx.state as AudioCtxState) === 'running'
}

function audioNeedsResume(ctx: AudioContext) {
  const state = ctx.state as AudioCtxState
  return state === 'suspended' || state === 'interrupted'
}

/** Tap a zero-sample buffer so WebKit marks the graph as user-unlocked. */
function tickSilentUnlock(ctx: AudioContext) {
  try {
    const buf = ctx.createBuffer(1, 1, ctx.sampleRate)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(ctx.destination)
    src.start(0)
  } catch {
    /* noop */
  }
}

/**
 * Telegram / mobile WebViews suspend AudioContext in the background.
 * Resume must finish before oscillators are scheduled, or FX stay silent
 * until the mini-app is fully reopened.
 */
async function ensureAudioRunning(opts?: { recreateIfStuck?: boolean }): Promise<AudioContext | null> {
  try {
    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
      sharedAudioCtx = createAudioCtx()
    }
    if (!sharedAudioCtx) return null

    if (audioNeedsResume(sharedAudioCtx)) {
      try {
        await sharedAudioCtx.resume()
      } catch {
        /* noop */
      }
    }

    if (audioIsRunning(sharedAudioCtx)) return sharedAudioCtx

    if (!opts?.recreateIfStuck) return sharedAudioCtx

    try {
      await sharedAudioCtx.close()
    } catch {
      /* noop */
    }
    sharedAudioCtx = createAudioCtx()
    if (!sharedAudioCtx) return null
    try {
      await sharedAudioCtx.resume()
    } catch {
      /* noop */
    }
    return sharedAudioCtx
  } catch {
    return null
  }
}

/** Wake audio after app switch / Telegram blur. Safe to call often. */
export function wakeAudioContext(fromUserGesture = false) {
  void (async () => {
    const ctx = await ensureAudioRunning({ recreateIfStuck: fromUserGesture })
    if (ctx && fromUserGesture) tickSilentUnlock(ctx)
  })()
}

/** Install once: resume on foreground + unlock on the next tap. */
export function installAudioLifecycle() {
  if (audioLifecycleInstalled || typeof window === 'undefined') return
  audioLifecycleInstalled = true

  const onForeground = () => {
    if (document.visibilityState && document.visibilityState !== 'visible') return
    wakeAudioContext(false)
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') onForeground()
  })
  window.addEventListener('pageshow', onForeground)
  window.addEventListener('focus', onForeground)

  const onGesture = () => wakeAudioContext(true)
  for (const type of ['pointerdown', 'touchstart', 'mousedown', 'keydown'] as const) {
    window.addEventListener(type, onGesture, { capture: true, passive: true })
  }

  try {
    const wa = window.Telegram?.WebApp
    wa?.onEvent('activated', onForeground)
    wa?.onEvent('viewportChanged', onForeground)
  } catch {
    /* noop */
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
  void (async () => {
    try {
      const s = loadSettings()
      if (!s.sounds) return
      const ctx = await ensureAudioRunning({ recreateIfStuck: true })
      if (!ctx || !audioIsRunning(ctx)) return
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
  })()
}

/** Poker table FX: chip rustle / card slide / check knocks — synthesized, no assets. */
export function playPokerSound(kind: 'chips' | 'card' | 'cards' | 'check') {
  void (async () => {
    try {
      const s = loadSettings()
      if (!s.sounds) return
      const ctx = await ensureAudioRunning({ recreateIfStuck: true })
      if (!ctx || !audioIsRunning(ctx)) return
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

      /** Soft paper/card whoosh — no tonal beep. */
      const cardSlide = (t: number) => {
        noiseBurst(t, 0.11, 0.038, { hp: 700, lp: 2800, peakAt: 0.018 })
        noiseBurst(t + 0.01, 0.07, 0.022, { hp: 1400, lp: 4500, peakAt: 0.01 })
        noiseBurst(t + 0.06, 0.055, 0.03, { hp: 120, lp: 520, peakAt: 0.008 })
      }

      /** Two knuckles on the rail — classic check. */
      const tableKnock = (t: number) => {
        noiseBurst(t, 0.038, 0.06, { hp: 90, lp: 780, peakAt: 0.003 })
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(155, t)
        osc.frequency.exponentialRampToValueAtTime(78, t + 0.05)
        gain.gain.setValueAtTime(0.0001, t)
        gain.gain.exponentialRampToValueAtTime(0.04, t + 0.003)
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.055)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(t)
        osc.stop(t + 0.07)
      }

      if (kind === 'check') {
        tableKnock(now)
        tableKnock(now + 0.1)
        return
      }

      if (kind === 'chips') {
        // Soft clay stack: dull body thud + short ceramic edge — no buzzy triangle ticks.
        for (let i = 0; i < 3; i += 1) {
          const t = now + i * 0.072 + Math.random() * 0.014
          noiseBurst(t, 0.042, 0.04, { hp: 70, lp: 420, peakAt: 0.004 })
          noiseBurst(t + 0.008, 0.022, 0.026, { hp: 900, lp: 3200, peakAt: 0.002 })
        }
        return
      }

      if (kind === 'card') {
        cardSlide(now)
        return
      }

      for (let i = 0; i < 3; i += 1) {
        cardSlide(now + i * 0.078 + Math.random() * 0.01)
      }
    } catch {
      /* noop */
    }
  })()
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
