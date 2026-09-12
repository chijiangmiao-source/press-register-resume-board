import type { CornerId, PlateId, StepDef } from './types'

/**
 * 当前持久化结构版本。
 * v2：nextIndex 独立落盘（v1 仅靠 values.length 反推）。
 * 版本不一致的旧记录一律拒绝恢复。
 */
export const STORAGE_VERSION = 2

/** localStorage 键名（跨版本保持固定，便于检出并上报旧版记录）。 */
export const STORAGE_KEY = 'registration-relay-board:session'

/** 允许录入的偏移范围（mm）。 */
export const OFFSET_MIN = -2.0
export const OFFSET_MAX = 2.0
/** 最小步进精度（mm）。 */
export const OFFSET_STEP = 0.01
/** 放行阈值：|X|、|Y| 均不大于该值（mm）。 */
export const TOLERANCE = 0.15

const PLATE_ORDER: PlateId[] = ['cyan', 'magenta']
const CORNER_ORDER: CornerId[] = ['tl', 'tr', 'br', 'bl']

/**
 * 一次会话固定依次测量青版、品红版；
 * 每版按 左上、右上、右下、左下 提交，共八步，顺序不可调整。
 */
export const STEPS: readonly StepDef[] = Object.freeze(
  PLATE_ORDER.flatMap((plate) =>
    CORNER_ORDER.map((corner, cornerIndex) => ({
      index: plate === 'cyan' ? cornerIndex : cornerIndex + 4,
      plate,
      corner
    }))
  ).map((step) => Object.freeze(step))
)

export function getStep(index: number): StepDef {
  const step = STEPS[index]
  if (!step) throw new Error(`步骤索引越界: ${index}`)
  return step
}
