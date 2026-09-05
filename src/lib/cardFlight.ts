import type { Card } from './cards'

export type Box = {
  left: number
  top: number
  width: number
  height: number
}

export type CardFlight = {
  id: string
  card: Card
  faceDown?: boolean
  from: Box
  to: Box
  rotate?: number
}

export function toBox(r: DOMRect | Box): Box {
  return {
    left: r.left,
    top: r.top,
    width: r.width,
    height: r.height,
  }
}

export function rectCenter(r: Box) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

/** Estimate where the next table card should land inside the table-cards box. */
export function estimateTableSlot(tableEl: HTMLElement, slotIndex: number): Box {
  const box = tableEl.getBoundingClientRect()
  const cardW = 56
  const cardH = 80
  const gap = 8
  const pairW = cardW + 10
  const total = Math.max(1, slotIndex + 1)
  const rowY = box.top + Math.max(8, (box.height - cardH) / 2)
  const startX = box.left + Math.max(8, (box.width - (Math.min(total, 3) * (pairW + gap) - gap)) / 2)
  const col = slotIndex % 3
  return {
    left: startX + col * (pairW + gap),
    top: rowY + Math.floor(slotIndex / 3) * 16,
    width: cardW,
    height: cardH,
  }
}

export function handCardEl(handEl: HTMLElement | null, cardId: string): HTMLElement | null {
  if (!handEl) return null
  return handEl.querySelector(`[data-card-id="${cardId}"]`)
}
