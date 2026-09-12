import { describe, expect, it } from 'vitest'
import { buildDiagnosis, diagnosePlate, RESIDUAL_LIMIT } from './diagnosis'
import type { Measurement } from './types'

/** 四个角点（左上、右上、右下、左下）的便捷构造。 */
function corners(xs: number[], ys: number[]): Measurement[] {
  return xs.map((x, i) => ({ x, y: ys[i] }))
}

describe('diagnosePlate 整版平移（四角一致）', () => {
  it('四角完全相同：均值即该值，建议量方向相反、按 0.01 给出', () => {
    const d = diagnosePlate('cyan', corners([0.2, 0.2, 0.2, 0.2], [-0.1, -0.1, -0.1, -0.1]))
    expect(d.uniform).toBe(true)
    expect(d.meanX).toBe(0.2)
    expect(d.meanY).toBe(-0.1)
    expect(d.advice).toEqual({ x: -0.2, y: 0.1 })
  })

  it('四角全部为零时建议量为 +0.00，不出现负零', () => {
    const d = diagnosePlate('magenta', corners([0, 0, 0, 0], [0, 0, 0, 0]))
    expect(d.uniform).toBe(true)
    expect(d.advice).toEqual({ x: 0, y: 0 })
    expect(Object.is(d.advice!.x, -0)).toBe(false)
    expect(Object.is(d.advice!.y, -0)).toBe(false)
    expect(Object.is(d.meanX, -0)).toBe(false)
    expect(Object.is(d.meanY, -0)).toBe(false)
  })

  it(`残差绝对值恰好等于 ${RESIDUAL_LIMIT.toFixed(2)} mm 时仍判为整版平移（边界归入平移）`, () => {
    // X 依次 +0.05/-0.05 摆动：均值 0.17，残差绝对值恰为 0.05
    const d = diagnosePlate(
      'cyan',
      corners([0.22, 0.12, 0.22, 0.12], [0.17, 0.17, 0.17, 0.17])
    )
    expect(d.residuals.map((r) => r.x)).toEqual([0.05, 0.05, 0.05, 0.05])
    expect(d.uniform).toBe(true)
    expect(d.advice).not.toBeNull()
    // 均值 0.17 原样保留为两位小数；建议反向
    expect(d.meanX).toBe(0.17)
    expect(d.advice).toEqual({ x: -0.17, y: -0.17 })
  })

  it('正负相消均值为 0 的整版平移：建议量为 +0.00 而非 -0.00', () => {
    // 对称摆动，均值恰为 0，残差 0.05 ≤ 阈值
    const d = diagnosePlate('cyan', corners([0.05, -0.05, 0.05, -0.05], [0, 0, 0, 0]))
    expect(d.uniform).toBe(true)
    expect(d.meanX).toBe(0)
    expect(d.advice!.x).toBe(0)
    expect(Object.is(d.advice!.x, -0)).toBe(false)
  })

  it('均值出现半厘（.005）时半数远离零取整，建议量确定反向抵消', () => {
    // X 和 = 0.43，均值 0.1075 → 显示 0.11；建议 -0.11（半数远离零，而非 -0.10）
    const d = diagnosePlate(
      'magenta',
      corners([0.1, 0.11, 0.11, 0.11], [0, 0, 0, 0])
    )
    expect(d.uniform).toBe(true)
    expect(d.meanX).toBe(0.11)
    expect(d.advice!.x).toBe(-0.11)
  })

  it('负向均值的半厘舍入同样远离零（-0.1075 → -0.11，建议 +0.11）', () => {
    const d = diagnosePlate(
      'magenta',
      corners([-0.1, -0.11, -0.11, -0.11], [0, 0, 0, 0])
    )
    expect(d.meanX).toBe(-0.11)
    expect(d.advice!.x).toBe(0.11)
  })

  it('不修改传入的只读测量值', () => {
    const input = corners([0.2, 0.2, 0.2, 0.2], [-0.1, -0.1, -0.1, -0.1])
    const snapshot = input.map((m) => ({ ...m }))
    diagnosePlate('cyan', input)
    expect(input).toEqual(snapshot)
  })
})

describe('diagnosePlate 角点不一致', () => {
  it('任一 X 残差超过 0.05 mm 即判不一致，不输出建议量', () => {
    // 0.10, 0.10, 0.10, 0.32：均值 0.155，三个残差 0.165 > 0.05
    const d = diagnosePlate('cyan', corners([0.1, 0.1, 0.1, 0.32], [0, 0, 0, 0]))
    expect(d.uniform).toBe(false)
    expect(d.advice).toBeNull()
  })

  it('任一 Y 残差越界同样判不一致', () => {
    const d = diagnosePlate(
      'magenta',
      corners([0.2, 0.2, 0.2, 0.2], [0, 0, 0, 0.1])
    )
    expect(d.uniform).toBe(false)
    expect(d.advice).toBeNull()
  })

  it('刚好越过 0.05 mm 边界（残差 0.0525）判不一致，且不给可能误导的调整量', () => {
    // X 和 0.71，均值 0.1775：前三个角残差 0.0525 > 0.05（越界），
    // 第四角残差 -0.1575；Y 四角一致。
    const d = diagnosePlate(
      'cyan',
      corners([0.23, 0.23, 0.23, 0.02], [0.18, 0.18, 0.18, 0.18])
    )
    expect(d.residuals[0].x).toBeCloseTo(0.0525, 10)
    expect(d.residuals[3].x).toBeCloseTo(0.1575, 10)
    expect(d.uniform).toBe(false)
    expect(d.advice).toBeNull()
  })

  it('残差按四角（左上→右上→右下→左下）顺序给出', () => {
    const d = diagnosePlate('cyan', corners([0.2, 0.2, 0.2, 0.2], [0, 0, 0, 0]))
    expect(d.residuals.map((r) => r.corner)).toEqual(['tl', 'tr', 'br', 'bl'])
  })
})

describe('buildDiagnosis 八步汇总', () => {
  it('按步骤顺序拆分青版（0..3）与品红版（4..7），各自独立判定', () => {
    // 青版：整版平移（一致 +0.20）
    // 品红版：角点不一致
    const values: Measurement[] = [
      ...corners([0.2, 0.2, 0.2, 0.2], [0, 0, 0, 0]),
      ...corners([0.1, 0.1, 0.1, 0.32], [0, 0, 0, 0])
    ]
    const diag = buildDiagnosis(values)
    expect(diag.plates).toHaveLength(2)
    expect(diag.plates[0].plate).toBe('cyan')
    expect(diag.plates[0].uniform).toBe(true)
    expect(diag.plates[0].advice).toEqual({ x: -0.2, y: 0 })
    expect(diag.plates[1].plate).toBe('magenta')
    expect(diag.plates[1].uniform).toBe(false)
    expect(diag.plates[1].advice).toBeNull()
  })

  it('未凑齐八步时拒绝生成诊断', () => {
    expect(() => buildDiagnosis([])).toThrow()
    expect(() => buildDiagnosis(Array.from({ length: 7 }, () => ({ x: 0, y: 0 })))).toThrow()
  })
})
