import type { Card } from './cards'

export type CardFlight = {
  id: string
  card: Card
  faceDown?: boolean
  from: DOMRect
  to: DOMRect
  rotate?: number
}

export function rectCenter(r: DOMRect) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

/** Estimate where the next table card should land inside the table-cards box. */
export function estimateTableSlot(tableEl: HTMLElement, slotIndex: number): DOMRect {
  const box = tableEl.getBoundingClientRect()
  const cardW = 56
  const cardH = 80
  const gap = 8
  const pairW = cardW + 10
  const x = box.left + box.width / 2 - pairW / 2 + (slotIndex % 3) * (pairW + gap) - pairW
  const y = box.top + box.height / 2 - cardH / 2 + Math.floor(slotIndex / 3) * 12
  return new DOMRect(Math.max(box.left + 4, x), Math.max(box.top + 4, y), cardW, cardH)
}

export function handCardEl(handEl: HTMLElement | null, cardId: string): HTMLElement | null {
  if (!handEl) return null
  return handEl.querySelector(`[data-card-id="${cardId}"]`)
}
