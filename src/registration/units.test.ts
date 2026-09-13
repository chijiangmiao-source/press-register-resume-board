import { describe, expect, it } from 'vitest'
import {
  UM_MAX,
  UM_MIN,
  UM_STEP,
  formatUnitMagnitude,
  formatUnitOffset,
  isUnitId,
  parseUnitOffset,
  unitRangeText
} from './units'
import { isValidStoredOffset } from './validation'

describe('parseUnitOffset 毫米会话', () => {
  it.each([
    ['0.00', 0],
    ['+0.05', 0.05],
    ['-0.15', -0.15],
    ['2.00', 2],
    ['-2.00', -2]
  ])('接受合法毫米值 %s -> %d mm', (raw, expected) => {
    const r = parseUnitOffset(raw, 'X', 'mm')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBeCloseTo(expected, 10)
  })

  it.each([
    ['', '必填'],
    ['abc', '十进制'],
    ['2.01', '范围'],
    ['-2.01', '范围'],
    ['0.001', '0.01']
  ])('拒绝非法毫米值 %s（%s）', (raw, hint) => {
    const r = parseUnitOffset(raw, 'X', 'mm')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain(hint)
  })

  it('毫米 “-0.00” 归一化为 +0，不保存负零', () => {
    const r = parseUnitOffset('-0.00', 'Y', 'mm')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value).toBe(0)
      expect(Object.is(r.value, -0)).toBe(false)
    }
  })
})

describe('parseUnitOffset 微米会话（10 µm 步进，±2000 µm）', () => {
  it.each([
    ['0', 0],
    ['10', 0.01],
    ['-10', -0.01],
    ['+50', 0.05],
    ['120', 0.12],
    ['-150', -0.15],
    ['2000', 2],
    ['-2000', -2]
  ])('接受合法微米值 %s -> %d mm', (raw, expectedMm) => {
    const r = parseUnitOffset(raw, 'X', 'um')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value).toBeCloseTo(expectedMm, 10)
      // 换算结果必须仍是 0.01 mm 的整数倍，可直接落盘
      expect(isValidStoredOffset(r.value)).toBe(true)
    }
  })

  it('边界 ±2000 µm 恰好在允许范围内', () => {
    expect(parseUnitOffset(String(UM_MAX), 'X', 'um').ok).toBe(true)
    expect(parseUnitOffset(String(UM_MIN), 'X', 'um').ok).toBe(true)
  })

  it.each([
    ['2010', '范围'],
    ['-2010', '范围'],
    ['2005', '范围'],
    ['3000', '范围']
  ])('超出 ±2000 µm 拒绝：%s（%s）', (raw, hint) => {
    const r = parseUnitOffset(raw, 'Y', 'um')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toContain(hint)
      expect(r.reason).toContain('µm')
    }
  })

  it.each([
    ['115', '10 µm 的整数倍'],
    ['-115', '10 µm 的整数倍'],
    ['5', '10 µm 的整数倍'],
    ['1999', '10 µm 的整数倍']
  ])('不是 10 µm 整数倍拒绝：%s（%s）', (raw, hint) => {
    const r = parseUnitOffset(raw, 'X', 'um')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain(hint)
  })

  it.each([
    ['', '必填'],
    ['   ', '必填'],
    ['abc', '整数'],
    ['12.5', '整数'],
    ['0.10', '整数'],
    ['1e2', '整数'],
    ['--100', '整数']
  ])('非整数文本拒绝：%s（%s）', (raw, hint) => {
    const r = parseUnitOffset(raw, 'X', 'um')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain(hint)
  })

  it('微米 “-0” 归一化为 +0，不保存负零', () => {
    const r = parseUnitOffset('-0', 'Y', 'um')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value).toBe(0)
      expect(Object.is(r.value, -0)).toBe(false)
    }
  })

  it('错误信息标明轴名', () => {
    const x = parseUnitOffset('', 'X', 'um')
    const y = parseUnitOffset('5', 'Y', 'um')
    expect(!x.ok && x.reason).toContain('X')
    expect(!y.ok && y.reason).toContain('Y')
  })
})

describe('formatUnitOffset 按会话单位展示（无负零）', () => {
  it.each([
    [0.12, 'um', '+120'],
    [-0.16, 'um', '-160'],
    [0, 'um', '+0'],
    [0.01, 'um', '+10'],
    [-2, 'um', '-2000'],
    [0.12, 'mm', '+0.12'],
    [-0.05, 'mm', '-0.05'],
    [0, 'mm', '+0.00']
  ])('%d mm 按 %s 显示为 %s', (mm, unit, expected) => {
    expect(formatUnitOffset(mm, unit as 'mm' | 'um')).toBe(expected)
  })

  it('负零输入在两种单位下都不显示负号', () => {
    expect(formatUnitOffset(-0, 'um')).toBe('+0')
    expect(formatUnitOffset(-0, 'mm')).toBe('+0.00')
  })
})

describe('formatUnitMagnitude 阈值/步进展示', () => {
  it.each([
    [0.15, 'um', '150'],
    [0.05, 'um', '50'],
    [0.01, 'um', '10'],
    [0.15, 'mm', '0.15'],
    [0.05, 'mm', '0.05'],
    [0.01, 'mm', '0.01']
  ])('%d mm 按 %s 显示为 %s', (mm, unit, expected) => {
    expect(formatUnitMagnitude(mm, unit as 'mm' | 'um')).toBe(expected)
  })
})

describe('单位取值与范围文本', () => {
  it('isUnitId 只接受 mm / um', () => {
    expect(isUnitId('mm')).toBe(true)
    expect(isUnitId('um')).toBe(true)
    expect(isUnitId('MM')).toBe(false)
    expect(isUnitId('')).toBe(false)
    expect(isUnitId('inch')).toBe(false)
    expect(isUnitId(0)).toBe(false)
    expect(isUnitId(null)).toBe(false)
    expect(isUnitId(undefined)).toBe(false)
  })

  it('unitRangeText 给出两种单位的录入范围', () => {
    expect(unitRangeText('mm')).toBe('-2.00 ~ +2.00 mm')
    expect(unitRangeText('um')).toBe(`${UM_MIN} ~ +${UM_MAX} µm`)
  })

  it('微米步进与毫米精度严格等价：10 µm = 0.01 mm', () => {
    expect(UM_STEP / 1000).toBeCloseTo(0.01, 10)
  })
})
