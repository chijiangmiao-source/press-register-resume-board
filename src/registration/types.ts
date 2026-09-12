/** 被测色版：本接力板只复测青版与品红版（黑版为基准版）。 */
export type PlateId = 'cyan' | 'magenta'

/** 角点顺序固定为：左上 → 右上 → 右下 → 左下。 */
export type CornerId = 'tl' | 'tr' | 'br' | 'bl'

/** 一个测量步骤的固定定义（步骤顺序与会话无关，永远不变）。 */
export interface StepDef {
  /** 步骤索引，0..7，即 localStorage 中记录的 nextIndex 含义。 */
  index: number
  plate: PlateId
  corner: CornerId
}

/** 一次已提交的角点测量值（相对黑版，单位 mm，已规整为 0.01 的倍数）。 */
export interface Measurement {
  x: number
  y: number
}

/** 八步全部完成后的放行结论。 */
export interface Verdict {
  pass: boolean
  /** 超差项，按测量顺序（步骤索引升序）排列。 */
  deviations: Deviation[]
}

/** 单条超差记录。 */
export interface Deviation {
  step: StepDef
  measurement: Measurement
  /** 实际超差的轴。 */
  axes: Array<'x' | 'y'>
}

/** 一次会话的完整可持久化状态。 */
export interface SessionData {
  /** 持久化结构版本号，版本不匹配必须报错，不能猜测进度。 */
  version: number
  /** 会话编号。 */
  sessionId: string
  /** 创建时间（毫秒时间戳）。 */
  createdAt: number
  /** 八步固定定义冗余存档，恢复时与现行定义逐一核对。 */
  steps: StepDef[]
  /** 已提交值，长度即已完成步数；下一步索引为 values.length。 */
  values: Measurement[]
}

/** 恢复结果：空仓库、可继续的会话、或损坏/不兼容记录。 */
export type LoadState =
  | { kind: 'empty' }
  | { kind: 'ready'; session: SessionData }
  | { kind: 'error'; reason: 'missing' | 'unparseable' | 'invalid'; message: string }

export const PLATE_LABEL: Record<PlateId, string> = {
  cyan: '青版',
  magenta: '品红版'
}

export const CORNER_LABEL: Record<CornerId, string> = {
  tl: '左上',
  tr: '右上',
  br: '右下',
  bl: '左下'
}
