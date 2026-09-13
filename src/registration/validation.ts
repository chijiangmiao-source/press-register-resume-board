import { OFFSET_MAX, OFFSET_MIN, OFFSET_STEP } from './steps'

/** 偏移解析结果：合法时给出规整到 0.01 的数值，否则给出现场可读的原因。 */
export type OffsetParseResult =
  | { ok: true; value: number }
  | { ok: false; reason: string }

const NUMBER_RE = /^[+-]?(\d+(?:\.\d+)?|\.\d+)$/

/**
 * 解析并校验一个偏移输入（相对黑版，单位 mm）。
 * 规则：
 * - 必填，仅接受普通十进制写法（不接受科学计数法、空白、非法字符）；
 * - 范围 [-2.00, 2.00]；
 * - 精确到 0.01，超过两位小数或不是 0.01 的整数倍即拒绝。
 */
export function parseOffset(raw: string, axis: 'X' | 'Y'): OffsetParseResult {
  const text = raw.trim()
  if (text === '') {
    return { ok: false, reason: `${axis} 必填` }
  }
  if (!NUMBER_RE.test(text)) {
    return { ok: false, reason: `${axis} 必须是十进制数字（mm）` }
  }
  // 先按文本的小数位拦截，避免 0.001 被浮点四舍五入后误放行。
  const fractional = text.includes('.') ? text.split('.')[1] : ''
  if (fractional.length > 2) {
    return { ok: false, reason: `${axis} 只能精确到 0.01 mm` }
  }

  const value = Number(text)
  if (!Number.isFinite(value)) {
    return { ok: false, reason: `${axis} 不是有效数值` }
  }
  if (value < OFFSET_MIN || value > OFFSET_MAX) {
    return {
      ok: false,
      reason: `${axis} 超出允许范围 ${OFFSET_MIN.toFixed(2)} ~ ${OFFSET_MAX.toFixed(2)} mm`
    }
  }
  const hundredths = Math.round(value / OFFSET_STEP)
  if (Math.abs(hundredths * OFFSET_STEP - value) > 1e-9) {
    return { ok: false, reason: `${axis} 必须是 0.01 mm 的整数倍` }
  }
  // 归一化负零（如输入 “-0.00”），落盘与展示一律使用 +0。
  const normalized = hundredths * OFFSET_STEP
  return { ok: true, value: Object.is(normalized, -0) ? 0 : normalized }
}

/**
 * 判断持久化恢复出来的数值是否仍是合法测量值（同样不猜测、不放行脏值）。
 * 容差必须贴着浮点噪声：本应用落盘的读数就是“百分之一毫米”整数乘步进，
 * 恢复时偏差恒为 0；手工/旧工具写入的干净小数（如 0.29）偏差也不超过
 * 2.3e-16。容差若放宽（如 1e-9），会把 0.1200000001 这类非 0.01 mm 精度的
 * 脏读数误判为合法而继续会话，因此收紧到 1e-12。
 */
export function isValidStoredOffset(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  if (value < OFFSET_MIN || value > OFFSET_MAX) return false
  const hundredths = Math.round(value / OFFSET_STEP)
  return Math.abs(hundredths * OFFSET_STEP - value) < 1e-12
}
