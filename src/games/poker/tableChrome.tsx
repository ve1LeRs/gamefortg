import type { ReactNode } from 'react'

function formatSeatChips(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`
  return String(n)
}

const CHIP_COLORS = [
  { face: '#c62828', rim: '#8e1b1b', pip: '#fff' },
  { face: '#2e7d32', rim: '#1b5e20', pip: '#fff' },
  { face: '#1565c0', rim: '#0d47a1', pip: '#fff' },
  { face: '#f9a825', rim: '#c17900', pip: '#3a2500' },
  { face: '#263238', rim: '#0d1214', pip: '#fff' },
] as const

function chipCountFor(amount: number, maxChips = 7) {
  if (amount <= 0) return 0
  let n = 1
  if (amount >= 20) n = 2
  if (amount >= 45) n = 3
  if (amount >= 90) n = 4
  if (amount >= 180) n = 5
  if (amount >= 350) n = 6
  if (amount >= 700) n = 7
  return Math.min(n, maxChips)
}

/** Split chips into 1–4 side-by-side stacks for big bets. */
function chipStacksFor(
  amount: number,
  opts?: { flat?: boolean; compact?: boolean },
): number[] {
  if (amount <= 0) return []
  let total = 1
  if (amount >= 15) total = 2
  if (amount >= 35) total = 3
  if (amount >= 55) total = 4
  if (amount >= 90) total = 6
  if (amount >= 140) total = 9
  if (amount >= 220) total = 12
  if (amount >= 350) total = 16
  if (amount >= 550) total = 20
  if (amount >= 900) total = 24

  let cols = 1
  if (total >= 5) cols = 2
  if (total >= 10) cols = 3
  if (total >= 16) cols = 4

  const maxPer = opts?.flat || opts?.compact ? 6 : 7
  total = Math.min(total, cols * maxPer)

  const stacks = Array.from({ length: cols }, () => 0)
  let left = total
  let col = 0
  while (left > 0) {
    if (stacks[col]! < maxPer) {
      stacks[col]! += 1
      left -= 1
    }
    col = (col + 1) % cols
  }
  if (cols >= 3 && stacks[0]! > stacks[1]!) {
    const t = stacks[0]!
    stacks[0] = stacks[1]!
    stacks[1] = t
  }
  return stacks.filter((n) => n > 0)
}

function PokerChipSvg({ colorIndex, size, uid }: { colorIndex: number; size: number; uid: string }) {
  const c = CHIP_COLORS[colorIndex % CHIP_COLORS.length]!
  const shineId = `${uid}-shine-${colorIndex}`
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden className="poker-chip-svg">
      <defs>
        <radialGradient id={shineId} cx="32%" cy="28%" r="65%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="45%" stopColor="#ffffff" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.25" />
        </radialGradient>
      </defs>
      <circle cx="20" cy="21.5" r="17.5" fill="rgba(0,0,0,0.35)" />
      <circle cx="20" cy="20" r="17.5" fill={c.rim} />
      <circle cx="20" cy="20" r="14.2" fill={c.face} />
      <circle cx="20" cy="20" r="14.2" fill={`url(#${shineId})`} />
      <circle cx="20" cy="20" r="14.2" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.2" />
      <circle
        cx="20"
        cy="20"
        r="9.2"
        fill="none"
        stroke={c.pip}
        strokeOpacity="0.9"
        strokeWidth="1.6"
        strokeDasharray="3.2 2.4"
      />
      {[0, 60, 120, 180, 240, 300].map((deg) => {
        const rad = ((deg - 90) * Math.PI) / 180
        const x = 20 + Math.cos(rad) * 15.2
        const y = 20 + Math.sin(rad) * 15.2
        return <circle key={deg} cx={x} cy={y} r="1.35" fill={c.pip} opacity="0.95" />
      })}
      <circle cx="20" cy="20" r="5.2" fill={c.face} stroke={c.pip} strokeOpacity="0.55" strokeWidth="1" />
    </svg>
  )
}

export function ChipPile({
  amount,
  format,
  className = '',
  compact,
  flat,
  maxChips,
}: {
  amount: number
  format: (n: number) => string
  className?: string
  compact?: boolean
  /** Horizontal layout (stacks + amount) — street bets on the felt. */
  flat?: boolean
  maxChips?: number
}) {
  if (amount <= 0) return null
  const uid = `pile-${amount}-${flat ? 'f' : compact ? 'c' : 's'}-${className}`
  const stacks = chipStacksFor(amount, { flat, compact })
  const capped =
    maxChips != null && stacks.length === 1
      ? [Math.min(stacks[0]!, maxChips)]
      : stacks
  const size = flat ? 16 : compact ? 16 : 26
  const multi = capped.length > 1
  return (
    <div
      className={`poker-chip-pile${compact ? ' is-compact' : ''}${flat ? ' is-flat' : ''}${
        multi ? ' is-multi' : ''
      } ${className}`.trim()}
      title={format(amount)}
      style={{ ['--chip-cols' as string]: capped.length }}
    >
      <div className="poker-chip-stacks" aria-hidden>
        {capped.map((n, si) => (
          <div
            key={si}
            className="poker-chip-stack"
            style={{ ['--chip-n' as string]: n, ['--stack-i' as string]: si }}
          >
            {Array.from({ length: n }, (_, i) => (
              <span key={i} className="poker-chip-disk" style={{ ['--chip-i' as string]: i }}>
                <PokerChipSvg
                  colorIndex={(si * 2 + i) % 5}
                  size={size}
                  uid={`${uid}-s${si}-${i}`}
                />
              </span>
            ))}
          </div>
        ))}
      </div>
      <span className="poker-chip-amt">{format(amount)}</span>
    </div>
  )
}

export function PokerSeatCard({
  name,
  level,
  stackText,
  dealer,
  active,
  accent,
  hideName,
  winPayout,
}: {
  name: string
  level?: number
  stackText: string
  dealer?: boolean
  active?: boolean
  accent?: string
  hideName?: boolean
  /** Chips this seat took from the pot. */
  winPayout?: number
}) {
  const initial = (name.trim()[0] || '?').toUpperCase()
  const won = winPayout != null && winPayout > 0 ? winPayout : 0
  const winLabel = won > 0 ? `+${formatSeatChips(won)}` : undefined
  return (
    <div className={`poker-seat${active ? ' is-active' : ''}${won > 0 ? ' has-payout' : ''}`}>
      {!hideName ? <div className="poker-seat-name">{name}</div> : null}
      <div className={`poker-seat-avatar-wrap${winLabel ? ' has-win-badge' : ''}`}>
        {dealer ? <span className="poker-dealer-btn">D</span> : null}
        {winLabel ? <span className="poker-win-badge">{winLabel}</span> : null}
        <div className="poker-seat-avatar" style={accent ? { background: accent } : undefined}>
          {initial}
        </div>
        {level != null ? (
          <span className="poker-seat-level" title={`Уровень ${level}`}>
            {level}
          </span>
        ) : null}
      </div>
      <div className="poker-seat-money">
        <span className="poker-seat-chip-dot" aria-hidden />
        <span>{stackText}</span>
      </div>
    </div>
  )
}

export function BetActionLabel({ verb, amount, format }: { verb: string; amount: number; format: (n: number) => string }) {
  return (
    <span className="poker-btn-stack">
      <span className="poker-btn-verb">{verb}</span>
      <span className="poker-btn-amt">{format(amount)}</span>
    </span>
  )
}

export function PotFlightOverlay({
  id,
  targets,
  amount,
  format,
}: {
  id: number
  targets: number[]
  amount: number
  format: (n: number) => string
}): ReactNode {
  return (
    <>
      <div className="poker-pot is-flying-out" aria-hidden>
        <ChipPile amount={amount} format={format} compact maxChips={3} />
        <span className="poker-pot-label">Банк</span>
      </div>
      <div className="poker-pot-flight" aria-hidden key={id}>
        {targets.flatMap((seatIdx, ti) =>
          [0, 1, 2, 3, 4, 5].map((ci) => (
            <span
              key={`${seatIdx}-${ci}`}
              className={`poker-pot-flight-chip poker-fly-to-s${seatIdx}`}
              style={{
                animationDelay: `${80 + ti * 70 + ci * 55}ms`,
                ['--chip-scatter' as string]: `${(ci % 3) * 6 - 6}px`,
              }}
            >
              <PokerChipSvg
                colorIndex={ci % 5}
                size={18}
                uid={`pot-fly-${id}-${seatIdx}-${ci}`}
              />
            </span>
          )),
        )}
      </div>
    </>
  )
}

/** Chips flying from a seat toward its street-bet spot on the felt. */
export function BetFlightOverlay({
  flights,
}: {
  flights: { id: number; seat: number; count: number }[]
}): ReactNode {
  if (flights.length === 0) return null
  return (
    <>
      {flights.map((f) => (
        <div
          key={f.id}
          className={`poker-bet-flight poker-bet-flight-s${f.seat}`}
          aria-hidden
        >
          {Array.from({ length: Math.max(1, Math.min(5, f.count)) }, (_, ci) => (
            <span
              key={ci}
              className="poker-bet-flight-chip"
              style={{
                animationDelay: `${ci * 45}ms`,
                ['--chip-scatter' as string]: `${(ci % 3) * 5 - 5}px`,
              }}
            >
              <PokerChipSvg
                colorIndex={ci % 5}
                size={18}
                uid={`bet-fly-${f.id}-${ci}`}
              />
            </span>
          ))}
        </div>
      ))}
    </>
  )
}

/** How many disks to show for a bet amount (shared by flight count). */
export function streetBetChipCount(amount: number) {
  return chipCountFor(amount, 6)
}
