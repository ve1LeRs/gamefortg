import type { ReactNode } from 'react'

const CHIP_COLORS = [
  { face: '#c62828', rim: '#8e1b1b', pip: '#fff' },
  { face: '#2e7d32', rim: '#1b5e20', pip: '#fff' },
  { face: '#1565c0', rim: '#0d47a1', pip: '#fff' },
  { face: '#f9a825', rim: '#c17900', pip: '#3a2500' },
  { face: '#263238', rim: '#0d1214', pip: '#fff' },
] as const

function chipCountFor(amount: number, maxChips = 6) {
  if (amount <= 0) return 0
  let n = 1
  if (amount >= 20) n = 2
  if (amount >= 50) n = 3
  if (amount >= 100) n = 4
  if (amount >= 200) n = 5
  if (amount >= 400) n = 6
  return Math.min(n, maxChips)
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
  flat?: boolean
  maxChips?: number
}) {
  if (amount <= 0) return null
  const uid = `pile-${amount}-${flat ? 'f' : compact ? 'c' : 's'}-${className}`
  if (flat) {
    return (
      <div className={`poker-chip-pile is-flat ${className}`.trim()} title={format(amount)}>
        <span className="poker-chip-disk is-flat-disk" aria-hidden>
          <PokerChipSvg colorIndex={0} size={20} uid={`${uid}-0`} />
        </span>
        <span className="poker-chip-amt">{format(amount)}</span>
      </div>
    )
  }
  const n = chipCountFor(amount, maxChips ?? (compact ? 4 : 6))
  const size = compact ? 18 : 28
  return (
    <div
      className={`poker-chip-pile${compact ? ' is-compact' : ''} ${className}`.trim()}
      title={format(amount)}
    >
      <div className="poker-chip-stack" aria-hidden style={{ ['--chip-n' as string]: n }}>
        {Array.from({ length: n }, (_, i) => (
          <span key={i} className="poker-chip-disk" style={{ ['--chip-i' as string]: i }}>
            <PokerChipSvg colorIndex={i} size={size} uid={`${uid}-${i}`} />
          </span>
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
}: {
  name: string
  level?: number
  stackText: string
  dealer?: boolean
  active?: boolean
  accent?: string
  hideName?: boolean
}) {
  const initial = (name.trim()[0] || '?').toUpperCase()
  return (
    <div className={`poker-seat${active ? ' is-active' : ''}`}>
      {!hideName ? <div className="poker-seat-name">{name}</div> : null}
      <div className="poker-seat-avatar-wrap">
        {dealer ? <span className="poker-dealer-btn">D</span> : null}
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
              className={`poker-pot-flight-chip is-c${ci % 5} poker-fly-to-s${seatIdx}`}
              style={{
                animationDelay: `${80 + ti * 70 + ci * 55}ms`,
                ['--chip-scatter' as string]: `${(ci % 3) * 6 - 6}px`,
              }}
            />
          )),
        )}
      </div>
    </>
  )
}
