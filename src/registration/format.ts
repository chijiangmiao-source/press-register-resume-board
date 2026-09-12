import { CORNER_LABEL, PLATE_LABEL } from './types'
import type { PlateId, CornerId } from './types'

/** 有符号、固定两位小数的 mm 展示。 */
export function formatOffset(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`
}

export function plateLabel(plate: PlateId): string {
  return PLATE_LABEL[plate]
}

export function cornerLabel(corner: CornerId): string {
  return CORNER_LABEL[corner]
}

/** “青版 · 左上”形式的测量点名称。 */
export function pointLabel(plate: PlateId, corner: CornerId): string {
  return `${PLATE_LABEL[plate]} · ${CORNER_LABEL[corner]}`
}

export function formatDateTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 长会话编号只展示首尾，完整编号放在 title/复制体中。 */
export function shortSessionId(sessionId: string): string {
  if (sessionId.length <= 12) return sessionId
  return `${sessionId.slice(0, 8)}…${sessionId.slice(-4)}`
}
