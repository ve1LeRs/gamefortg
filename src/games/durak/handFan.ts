/** Shared Durak hand fan math (solo + online). */

/** One-row hand fan like cards held in a fist.
 *  Prefer a tight index peek — never spread to fill the screen.
 *  `viewportW` is the hand content-box width (padding already excluded). */
export function handFanLayout(n: number, viewportW = 390) {
  const slack = 14
  const avail = Math.max(180, Math.min(viewportW, 440) - slack)
  const rows = 1
  const perRow = Math.max(1, n)
  let cardW = n <= 3 ? 118 : n <= 5 ? 112 : n <= 7 ? 104 : 96
  let cardH = Math.round(cardW * (138 / 98))
  let peek = n <= 3 ? 36 : n <= 5 ? 30 : n <= 8 ? 26 : 22
  let step = cardW
  if (perRow > 1) {
    const need = cardW + (perRow - 1) * peek
    if (need > avail) {
      cardW = Math.max(52, Math.floor(avail - (perRow - 1) * peek))
      cardH = Math.round(cardW * (138 / 98))
      step = peek
      if (cardW + (perRow - 1) * peek > avail) {
        peek = Math.max(16, Math.floor((avail - cardW) / (perRow - 1)))
        step = peek
      }
    } else {
      step = peek
    }
  }
  const rotStep = n <= 3 ? 8.5 : n <= 5 ? 6 : n <= 7 ? 4.4 : n <= 10 ? 2.6 : n <= 13 ? 1.6 : 1.1
  const rowWidth = perRow <= 1 ? cardW : cardW + (perRow - 1) * step
  return {
    cardW: Math.round(cardW),
    cardH: Math.round(cardH),
    step: Math.round(step * 10) / 10,
    rotStep,
    fanWidth: Math.round(Math.min(rowWidth, avail)),
    rows,
    perRow,
    scrollable: false,
  }
}

/** Vertical fan offset — lift left a bit, never bury the right under the dock. */
export function handFanY(offset: number, n: number) {
  const arc = n <= 5 ? 2.2 : n <= 8 ? 1.0 : n <= 12 ? 0.3 : 0.1
  const side = n <= 5 ? 1.0 : n <= 8 ? 1.15 : n <= 12 ? 0.4 : 0.15
  const liftAll = n >= 12 ? -10 : n >= 9 ? -5 : 0
  const y = Math.abs(offset) * arc + offset * side + liftAll
  const maxSink = n <= 6 ? 12 : n <= 10 ? 5 : 1
  return Math.min(maxSink, Math.max(-22, y))
}

/** Stable messy offsets for discard pile cards — keep tight so бита only peeks. */
export function bitoMess(seed: string, i: number) {
  let h = 0
  for (let k = 0; k < seed.length; k += 1) h = (Math.imul(h, 31) + seed.charCodeAt(k)) | 0
  const a = ((h + i * 47) % 1000) / 1000
  const b = ((h * 3 + i * 91) % 1000) / 1000
  const c = ((h * 7 + i * 13) % 1000) / 1000
  return {
    ['--dx' as string]: `${((a - 0.5) * 10).toFixed(1)}px`,
    ['--dy' as string]: `${((b - 0.5) * 8).toFixed(1)}px`,
    ['--rot' as string]: `${((a - 0.5) * 28 + (c - 0.5) * 10).toFixed(1)}deg`,
    ['--sc' as string]: `${(0.94 + c * 0.06).toFixed(3)}`,
    zIndex: i + 1,
  }
}
