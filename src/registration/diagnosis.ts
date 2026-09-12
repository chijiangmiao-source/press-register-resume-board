import type { CornerId, Measurement, PlateId } from './types'

/**
 * 整版平移判定阈值（mm）：四个角点相对各自均值的残差绝对值
 * 全部不大于该值（含 0.05 本身）时，判为整版平移；任一越界则为角点不一致。
 */
export const RESIDUAL_LIMIT = 0.05
/** 校正建议的最小步进（mm），建议量按此精度给出。 */
export const ADJUST_STEP = 0.01

/** 内部统一使用“百分之一毫米”整数运算，彻底避开浮点比较与舍入误差。 */
const HUNDREDTHS_PER_MM = 100
/** 残差阈值换算为百分之一毫米：0.05 mm = 5（个 0.01）。 */
const RESIDUAL_LIMIT_HUNDREDTHS = Math.round(RESIDUAL_LIMIT * HUNDREDTHS_PER_MM)

/** 单个色版的复调诊断。 */
export interface PlateDiagnosis {
  plate: PlateId
  /** 四个角点的平均 X 偏移（mm，保留两位小数）。 */
  meanX: number
  /** 四个角点的平均 Y 偏移（mm，保留两位小数）。 */
  meanY: number
  /**
   * 整版平移：四角相对均值的残差绝对值均 ≤ 0.05 mm（恰好 0.05 归入此类）。
   * true 时给出与均值方向相反的整版调整建议；false 时不输出任何建议量。
   */
  uniform: boolean
  /** 与平均偏移方向相反的整版调整建议（mm，按 0.01 给出）；角点不一致时为 null。 */
  advice: { x: number; y: number } | null
  /** 各角点相对均值的残差，角点顺序固定 左上→右上→右下→左下（仅诊断用，单位 mm）。 */
  residuals: ReadonlyArray<{ corner: CornerId; x: number; y: number }>
}

/** 八步完成后的复调诊断：青版、品红版各一条，顺序固定。 */
export interface RegistrationDiagnosis {
  plates: ReadonlyArray<PlateDiagnosis>
}

/**
 * 半数向远离零的方向取整：建议量要能真正抵消平均偏移，
 * 因此 ±k.5 一律朝与均值相反、即绝对值更大的方向进位（如 -2.5 → -3）。
 */
function roundHalfAwayFromZero(value: number): number {
  return value >= 0 ? Math.round(value) : -Math.round(-value)
}

/**
 * 基于既有只读测量值生成单个色版的诊断。
 * 四角偏移全部是 0.01 的整数倍；均值按 0.01 mm 反方向给出，
 * 残差按 0.05 mm 的整数尺度比较，全程不依赖二进制浮点小数。
 */
export function diagnosePlate(plate: PlateId, points: readonly Measurement[]): PlateDiagnosis {
  if (points.length !== 4) throw new Error('每个色版必须有四个角点的读数')

  const corners: CornerId[] = ['tl', 'tr', 'br', 'bl']
  // 以百分之一毫米为单位的整数读数（录入侧已规整为 0.01 的整数倍）。
  const xs = points.map((p) => Math.round(p.x * HUNDREDTHS_PER_MM))
  const ys = points.map((p) => Math.round(p.y * HUNDREDTHS_PER_MM))
  const sumX = xs.reduce((a, b) => a + b, 0)
  const sumY = ys.reduce((a, b) => a + b, 0)

  // 平均偏移（百分之一毫米，可能为半整数，如 17/4=4.25）。
  const meanXH = sumX / 4
  const meanYH = sumY / 4

  // 残差以 0.0025 mm（百分之一毫米的 1/4）为最小尺度，
  // 使四角残差（均值的小数部分只可能是 .00/.25/.50/.75 个 0.01）全部为整数；
  // diffH 的单位是 0.01 mm，乘 4 即换算到 0.0025 mm。
  // 0.05 mm 恰为该尺度的 20 倍，边界判定精确无误差。
  const Q_PER_HUNDREDTH = 4
  const LIMIT_Q = RESIDUAL_LIMIT_HUNDREDTHS * Q_PER_HUNDREDTH
  const residualQ = (valueH: number, meanH: number) =>
    Math.round(Math.abs((valueH - meanH) * Q_PER_HUNDREDTH))

  const residuals = corners.map((corner, i) => {
    // dxQ/dyQ 以 0.0025 mm 为单位；返回给上层时换算回 mm（/400）。
    const dxQ = residualQ(xs[i], meanXH)
    const dyQ = residualQ(ys[i], meanYH)
    return {
      corner,
      x: dxQ / (Q_PER_HUNDREDTH * HUNDREDTHS_PER_MM),
      y: dyQ / (Q_PER_HUNDREDTH * HUNDREDTHS_PER_MM),
      exceeds: dxQ > LIMIT_Q || dyQ > LIMIT_Q
    }
  })
  const uniform = residuals.every((r) => !r.exceeds)

  // 整版平移：建议量与平均偏移方向相反，按 0.01 mm 取整（半数远离零）。
  // 均值为 0 时结果必须是 +0，绝不输出 -0.00 这类负零。
  const toAdvice = (sum: number): number => {
    const hundredths = -roundHalfAwayFromZero(sum / 4)
    return Object.is(hundredths, -0) ? 0 : hundredths / HUNDREDTHS_PER_MM
  }
  const toMean = (meanH: number): number => {
    const hundredths = roundHalfAwayFromZero(meanH)
    return Object.is(hundredths, -0) ? 0 : hundredths / HUNDREDTHS_PER_MM
  }

  return {
    plate,
    meanX: toMean(meanXH),
    meanY: toMean(meanYH),
    uniform,
    advice: uniform ? { x: toAdvice(sumX), y: toAdvice(sumY) } : null,
    // 不向上游暴露内部判定字段。
    residuals: residuals.map(({ corner, x, y }) => ({ corner, x, y }))
  }
}

/**
 * 八步全部完成后，基于既有只读测量值生成青版、品红版的复调诊断。
 * 不修改、不落盘任何测量值；steps 0..3 为青版，4..7 为品红版。
 */
export function buildDiagnosis(values: readonly Measurement[]): RegistrationDiagnosis {
  if (values.length !== 8) throw new Error('只有八步全部完成后才能生成复调诊断')
  return {
    plates: [
      diagnosePlate('cyan', values.slice(0, 4)),
      diagnosePlate('magenta', values.slice(4, 8))
    ]
  }
}
