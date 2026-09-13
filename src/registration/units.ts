import { OFFSET_MAX, OFFSET_MIN, OFFSET_STEP } from './steps'
import { parseOffset } from './validation'
import type { OffsetParseResult } from './validation'
import { formatOffset } from './format'
import type { UnitId } from './types'

/**
 * 单位层：负责录入单位的校验、换算与展示。
 * RegistrationStore 只以 0.01 mm 精度保存和计算；
 * 微米会话在此把输入按 10 µm 步进校验并换算成毫米（10 µm 恰为 0.01 mm，
 * 换算不损失精度），展示时再把毫米读数换算回会话单位。
 */

/** 微米会话的录入规则：±2000 µm，按 10 µm 步进。 */
export const UM_MIN = -2000
export const UM_MAX = 2000
export const UM_STEP = 10

export const UNIT_LABEL: Record<UnitId, string> = {
  mm: '毫米',
  um: '微米'
}

export const UNIT_SYMBOL: Record<UnitId, string> = {
  mm: 'mm',
  um: 'µm'
}

export function isUnitId(value: unknown): value is UnitId {
  return value === 'mm' || value === 'um'
}

const UM_INTEGER_RE = /^[+-]?\d+$/

/**
 * 按会话单位解析并校验一个偏移输入，合法时统一返回毫米数值（0.01 的整数倍）。
 * - 毫米：规则与 parseOffset 一致（±2.00 mm，0.01 mm 步进）；
 * - 微米：仅接受整数文本，±2000 µm，10 µm 的整数倍，再精确换算成毫米。
 */
export function parseUnitOffset(raw: string, axis: 'X' | 'Y', unit: UnitId): OffsetParseResult {
  if (unit === 'mm') return parseOffset(raw, axis)

  const text = raw.trim()
  if (text === '') {
    return { ok: false, reason: `${axis} 必填` }
  }
  if (!UM_INTEGER_RE.test(text)) {
    return { ok: false, reason: `${axis} 必须是整数（µm）` }
  }
  const value = Number(text)
  if (!Number.isSafeInteger(value)) {
    return { ok: false, reason: `${axis} 不是有效数值` }
  }
  if (value < UM_MIN || value > UM_MAX) {
    return {
      ok: false,
      reason: `${axis} 超出允许范围 ${UM_MIN} ~ +${UM_MAX} µm`
    }
  }
  // 负值取模同样可靠：-120 % 10 为 -0，-115 % 10 为 -5。
  if (value % UM_STEP !== 0) {
    return { ok: false, reason: `${axis} 必须是 ${UM_STEP} µm 的整数倍` }
  }
  // 10 µm 恰为 0.01 mm：上面已保证是 UM_STEP 的整数倍，直接换成
  // “百分之一毫米”整数再乘步进，不引入浮点误差。
  const hundredths = Math.round(value / UM_STEP)
  const mm = hundredths * OFFSET_STEP
  return { ok: true, value: Object.is(mm, -0) ? 0 : mm }
}

/**
 * 把存储的毫米读数按会话单位格式化（有符号）。
 * 微米为整数展示；零值一律不带负号，绝不出现负零。
 */
export function formatUnitOffset(valueMm: number, unit: UnitId): string {
  if (unit === 'um') {
    const um = Math.round(valueMm * 1000)
    const normalized = Object.is(um, -0) ? 0 : um
    return `${normalized >= 0 ? '+' : ''}${normalized}`
  }
  return formatOffset(valueMm)
}

/** 阈值、步进等无符号量的单位化展示（如 0.15 mm → 150 µm）。 */
export function formatUnitMagnitude(valueMm: number, unit: UnitId): string {
  if (unit === 'um') return `${Math.round(Math.abs(valueMm) * 1000)}`
  return Math.abs(valueMm).toFixed(2)
}

/** 录入范围提示文本（如 “-2.00 ~ +2.00 mm” / “-2000 ~ +2000 µm”）。 */
export function unitRangeText(unit: UnitId): string {
  if (unit === 'um') return `${UM_MIN} ~ +${UM_MAX} ${UNIT_SYMBOL.um}`
  return `${OFFSET_MIN.toFixed(2)} ~ +${OFFSET_MAX.toFixed(2)} ${UNIT_SYMBOL.mm}`
}
