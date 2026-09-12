import { describe, expect, it } from 'vitest'
import { parseOffset, isValidStoredOffset } from './validation'

describe('parseOffset 偏移录入校验', () => {
  it.each([
    ['0', 0],
    ['0.00', 0],
    ['+0.05', 0.05],
    ['-0.15', -0.15],
    ['2.00', 2],
    ['-2.00', -2],
    ['1', 1],
    ['.5', 0.5],
    ['-.2', -0.2]
  ])('接受合法值 %s -> %d', (raw, expected) => {
    const r = parseOffset(raw, 'X')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBeCloseTo(expected, 10)
  })

  it.each([
    ['', '必填'],
    ['   ', '必填'],
    ['abc', '十进制'],
    ['1e-2', '十进制'],
    ['NaN', '十进制'],
    ['Infinity', '十进制'],
    ['2.01', '范围'],
    ['-2.01', '范围'],
    ['3', '范围'],
    ['0.001', '0.01'],
    ['0.123', '0.01'],
    ['1.2.3', '十进制'],
    ['--1', '十进制']
  ])('拒绝非法值 %s（%s）', (raw, hint) => {
    const r = parseOffset(raw, 'X')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain(hint)
  })

  it('错误信息标明轴名', () => {
    const x = parseOffset('', 'X')
    const y = parseOffset('x', 'Y')
    expect(!x.ok && x.reason).toContain('X')
    expect(!y.ok && y.reason).toContain('Y')
  })

  it('isValidStoredOffset 对恢复值同样严格', () => {
    expect(isValidStoredOffset(0)).toBe(true)
    expect(isValidStoredOffset(-0.15)).toBe(true)
    expect(isValidStoredOffset(2.01)).toBe(false)
    expect(isValidStoredOffset(0.001)).toBe(false)
    expect(isValidStoredOffset('0.1')).toBe(false)
    expect(isValidStoredOffset(NaN)).toBe(false)
    expect(isValidStoredOffset(null)).toBe(false)
  })
})
