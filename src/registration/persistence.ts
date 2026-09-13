import { STORAGE_VERSION, STEPS } from './steps'
import { isValidStoredOffset } from './validation'
import { isUnitId } from './units'
import type { LoadState, Measurement, PlateId, CornerId, SessionData, StepDef, UnitId } from './types'

const PLATES: readonly PlateId[] = ['cyan', 'magenta']
const CORNERS: readonly CornerId[] = ['tl', 'tr', 'br', 'bl']

function isPlate(v: unknown): v is PlateId {
  return typeof v === 'string' && (PLATES as readonly string[]).includes(v)
}

/**
 * 创建时间必须是有限数值且落在 Date 可表示范围内（约 ±8.64e15 毫秒）。
 * 仅检查 Number.isFinite 不够：1e20 虽是有限数，但 new Date(1e20) 为
 * Invalid Date，界面会渲染成 NaN-NaN-NaN，这类记录必须按损坏处理。
 */
function isRepresentableTime(v: unknown): v is number {
  return (
    typeof v === 'number' &&
    Number.isFinite(v) &&
    !Number.isNaN(new Date(v).getTime())
  )
}

function isCorner(v: unknown): v is CornerId {
  return typeof v === 'string' && (CORNERS as readonly string[]).includes(v)
}

function isMeasurement(v: unknown): v is Measurement {
  if (typeof v !== 'object' || v === null) return false
  const m = v as Record<string, unknown>
  return isValidStoredOffset(m.x) && isValidStoredOffset(m.y)
}

function isStepDef(v: unknown, index: number): v is StepDef {
  if (typeof v !== 'object' || v === null) return false
  const s = v as Record<string, unknown>
  const expected = STEPS[index]
  return (
    s.index === expected.index &&
    isPlate(s.plate) &&
    s.plate === expected.plate &&
    isCorner(s.corner) &&
    s.corner === expected.corner
  )
}

function invalid(message: string): LoadState {
  return { kind: 'error', reason: 'invalid', message }
}

/**
 * 严格校验并恢复一条本地检查点记录。
 * 任何字段缺失、类型不符、版本不匹配、步数/已提交长度异常，
 * 都返回明确错误，绝不猜测当前应停在哪一步。
 */
export function parsePersistedRecord(raw: unknown): LoadState {
  if (typeof raw !== 'object' || raw === null) {
    return invalid('本地检查点不是有效的记录对象，已停止恢复，避免错用旧读数。')
  }
  const data = raw as Record<string, unknown>

  if (!('version' in data)) {
    return invalid('本地检查点缺少版本号，无法确认数据结构，已阻断续作。')
  }
  if (typeof data.version !== 'number' || !Number.isInteger(data.version)) {
    return invalid('本地检查点版本号损坏，已阻断续作。')
  }
  if (data.version !== STORAGE_VERSION) {
    return {
      kind: 'error',
      reason: 'invalid',
      message: `本地检查点版本不匹配（记录为 v${data.version}，当前需要 v${STORAGE_VERSION}），不能猜测进度，已阻断续作。`
    }
  }

  if (typeof data.sessionId !== 'string' || data.sessionId.trim() === '') {
    return invalid('本地检查点缺少有效的会话编号。')
  }
  if (!isRepresentableTime(data.createdAt)) {
    return invalid('本地检查点创建时间损坏（超出日期可表示范围），已阻断续作。')
  }
  // 录入单位随检查点落盘：缺失时按毫米恢复（兼容旧记录）；
  // 存在但取值非法则按损坏处理，不能以猜测的单位续作。
  if ('unit' in data && !isUnitId(data.unit)) {
    return invalid('本地检查点的录入单位取值非法，已阻断续作。')
  }
  const unit: UnitId = isUnitId(data.unit) ? data.unit : 'mm'
  if (!Array.isArray(data.steps) || data.steps.length !== STEPS.length) {
    return invalid('本地检查点的八步定义缺失或数量不对，已阻断续作。')
  }
  if (!data.steps.every((step, i) => isStepDef(step, i))) {
    return invalid('本地检查点的八步定义与现行测量顺序不符，已阻断续作。')
  }
  if (!Array.isArray(data.values)) {
    return invalid('本地检查点缺少已提交测量值，已阻断续作。')
  }
  if (data.values.length > STEPS.length) {
    return invalid('本地检查点的已提交值超过八步，记录已损坏，已阻断续作。')
  }
  if (!data.values.every(isMeasurement)) {
    return invalid('本地检查点中存在非法偏移读数（范围或精度不符），已阻断续作。')
  }
  // nextIndex 是独立字段，不能由已提交值数量反推；
  // 类型/范围不符、或与已提交值数量不一致，都按损坏处理而不是猜测进度。
  if (
    typeof data.nextIndex !== 'number' ||
    !Number.isInteger(data.nextIndex) ||
    data.nextIndex < 0 ||
    data.nextIndex > STEPS.length
  ) {
    return invalid('本地检查点的下一步索引损坏，已阻断续作。')
  }
  if (data.nextIndex !== data.values.length) {
    return invalid(
      `本地检查点的下一步索引（${data.nextIndex}）与已提交读数数量（${data.values.length}）不一致，` +
        '记录已损坏，不能猜测进度，已阻断续作。'
    )
  }

  const session: SessionData = {
    version: data.version,
    sessionId: data.sessionId,
    createdAt: data.createdAt,
    unit,
    steps: data.steps.map((s) => ({ ...(s as StepDef) })),
    values: data.values.map((m) => ({ ...(m as Measurement) })),
    nextIndex: data.nextIndex
  }
  return { kind: 'ready', session }
}

/** 把 localStorage 文本恢复为状态：空仓库 / 可继续会话 / 明确错误。 */
export function restoreFromText(text: string | null): LoadState {
  if (text === null) return { kind: 'empty' }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return {
      kind: 'error',
      reason: 'unparseable',
      message: '本地检查点已损坏，无法解析为 JSON，已阻断续作。请重置后开始新会话。'
    }
  }
  return parsePersistedRecord(parsed)
}
