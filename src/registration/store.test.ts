import { beforeEach, describe, expect, it } from 'vitest'
import { RegistrationStore, type KvStore } from './store'
import { STORAGE_KEY, STORAGE_VERSION, STEPS } from './steps'
import type { Measurement, SessionData } from './types'

class FakeKv implements KvStore {
  data = new Map<string, string>()
  writes = 0
  removes = 0
  getItem(key: string) {
    return this.data.has(key) ? (this.data.get(key) as string) : null
  }
  setItem(key: string, value: string) {
    this.writes++
    this.data.set(key, value)
  }
  removeItem(key: string) {
    this.removes++
    this.data.delete(key)
  }
  raw(key = STORAGE_KEY): unknown {
    const text = this.getItem(key)
    return text === null ? null : JSON.parse(text)
  }
}

let kv: FakeKv
let store: RegistrationStore

function makeStore(): RegistrationStore {
  return new RegistrationStore(kv)
}

/** 构造一条结构完整的 v2 记录，损坏用例在其上做局部篡改。 */
function validRecord(overrides: Partial<SessionData> = {}): SessionData {
  return {
    version: STORAGE_VERSION,
    sessionId: 's1',
    createdAt: 1,
    steps: STEPS.map((s) => ({ ...s })),
    values: [],
    nextIndex: 0,
    ...overrides
  }
}

beforeEach(() => {
  kv = new FakeKv()
  store = makeStore()
})

describe('空仓库与新会话', () => {
  it('空仓库启动为空状态，无法取得会话', () => {
    expect(store.getState().kind).toBe('empty')
    expect(store.getSession()).toBeUndefined()
    expect(store.nextIndex).toBe(-1)
  })

  it('开始新会话必须显式确认，且创建八步定义、nextIndex=0', () => {
    const session = store.begin(true, () => 1_700_000_000_000)
    expect(session.sessionId).toBeTruthy()
    expect(session.version).toBe(STORAGE_VERSION)
    expect(session.createdAt).toBe(1_700_000_000_000)
    expect(session.steps).toHaveLength(8)
    expect(session.values).toEqual([])
    expect(session.nextIndex).toBe(0)
    expect(store.nextIndex).toBe(0)
    const persisted = kv.raw() as SessionData
    expect(persisted.steps).toHaveLength(8)
    expect(persisted.values).toEqual([])
    expect(persisted.nextIndex).toBe(0)
  })

  it('会话编号、步骤定义与写入落盘', () => {
    store.begin(true)
    const persisted = kv.raw() as SessionData
    expect(persisted.sessionId).toMatch(/.+/)
    expect(persisted.steps.map((s) => `${s.plate}-${s.corner}`)).toEqual([
      'cyan-tl',
      'cyan-tr',
      'cyan-br',
      'cyan-bl',
      'magenta-tl',
      'magenta-tr',
      'magenta-br',
      'magenta-bl'
    ])
    persisted.steps.forEach((s, i) => expect(s.index).toBe(i))
  })
})

describe('状态迁移：八步依次推进', () => {
  beforeEach(() => {
    store.begin(true)
  })

  it('合法双值推进，下一步索引作为独立字段递增且落盘', () => {
    const r = store.advance('0.10', '-0.05')
    expect(r.ok).toBe(true)
    expect(store.nextIndex).toBe(1)
    const persisted = kv.raw() as SessionData
    expect(persisted.values).toEqual([{ x: 0.1, y: -0.05 }])
    expect(persisted.values).toHaveLength(1)
    expect(persisted.nextIndex).toBe(1)
  })

  it('走完八步后完成，nextIndex=8 与 8 条读数同时落盘', () => {
    for (let i = 0; i < 8; i++) {
      const r = store.advance('0.01', '-0.02')
      expect(r.ok, `step ${i} should advance`).toBe(true)
      expect(store.nextIndex).toBe(i + 1)
      expect((kv.raw() as SessionData).nextIndex).toBe(i + 1)
    }
    expect(store.isComplete).toBe(true)
    const persisted = kv.raw() as SessionData
    expect(persisted.values).toHaveLength(8)
    expect(persisted.nextIndex).toBe(8)
  })

  it('每次推进只发生一次原子写入', () => {
    const before = kv.writes
    store.advance('0.00', '0.00')
    expect(kv.writes).toBe(before + 1)
  })

  it('推进返回的是拷贝，外部篡改不影响内部状态', () => {
    const r = store.advance('0.10', '0.10')
    expect(r.ok).toBe(true)
    if (r.ok) {
      r.session.values[0].x = 9.99
      r.session.steps[0].plate = 'magenta'
    }
    const again = store.getSession() as SessionData
    expect(again.values[0].x).toBe(0.1)
    expect(again.steps[0].plate).toBe('cyan')
  })
})

describe('拒绝非法推进（不可回改 / 不可猜测）', () => {
  beforeEach(() => {
    store.begin(true)
  })

  it.each([
    ['', '0.00'],
    ['0.00', ''],
    ['2.5', '0.00'],
    ['0.00', '-3'],
    ['abc', '0.00'],
    ['0.001', '0.00'],
    ['0.00', '0.005']
  ])('任一值非法则原地拒绝：(%s, %s)', (x, y) => {
    const writesBefore = kv.writes
    const r = store.advance(x, y)
    expect(r.ok).toBe(false)
    expect(store.nextIndex).toBe(0)
    expect(kv.writes).toBe(writesBefore)
    expect((kv.raw() as SessionData).values).toEqual([])
    expect((kv.raw() as SessionData).nextIndex).toBe(0)
  })

  it('非法推进返回逐轴错误原因', () => {
    const r = store.advance('9', 'bad')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors.x).toBeTruthy()
      expect(r.errors.y).toBeTruthy()
    }
  })

  it('全部完成后拒绝再提交（已提交步骤不可回改）', () => {
    for (let i = 0; i < 8; i++) store.advance('0.00', '0.00')
    const writesBefore = kv.writes
    const r = store.advance('0.00', '0.00')
    expect(r.ok).toBe(false)
    expect(kv.writes).toBe(writesBefore)
    expect(store.nextIndex).toBe(8)
  })
})

describe('刷新/重开后的检查点恢复', () => {
  it('中途刷新：从 localStorage 停在同一检查点，旧读数原样保留', () => {
    store.begin(true)
    store.advance('0.12', '-0.10')
    store.advance('0.03', '0.07')

    const reopened = makeStore()
    const session = reopened.getSession()
    expect(session).toBeDefined()
    expect(session?.values).toEqual([
      { x: 0.12, y: -0.1 },
      { x: 0.03, y: 0.07 }
    ])
    expect(reopened.nextIndex).toBe(2)
    expect(reopened.isComplete).toBe(false)
  })

  it('恢复后可从下一步继续直到完成', () => {
    store.begin(true)
    store.advance('0.00', '0.00')
    const reopened = makeStore()
    for (let i = 0; i < 7; i++) {
      expect(reopened.advance('0.00', '0.00').ok).toBe(true)
    }
    expect(reopened.isComplete).toBe(true)
  })

  it('已完成会话刷新后仍完整，可再次给出结论', () => {
    store.begin(true)
    for (let i = 0; i < 8; i++) store.advance('0.00', '0.00')
    const reopened = makeStore()
    expect(reopened.isComplete).toBe(true)
    expect(reopened.getVerdict()?.pass).toBe(true)
  })

  it('持久化的下一步索引被单独篡改后，恢复必须阻断而非按读数数量反推', () => {
    store.begin(true)
    store.advance('0.10', '0.10')
    store.advance('0.10', '0.10')

    // 直接篡改落盘文本中的 nextIndex（读数仍是 2 条）
    const tampered = JSON.parse(kv.data.get(STORAGE_KEY) as string) as SessionData
    tampered.nextIndex = 5
    kv.data.set(STORAGE_KEY, JSON.stringify(tampered))

    const reopened = makeStore()
    const state = reopened.getState()
    expect(state.kind).toBe('error')
    if (state.kind === 'error') expect(state.message).toContain('不一致')
    expect(reopened.getSession()).toBeUndefined()
    expect(reopened.nextIndex).toBe(-1)
  })
})

describe('损坏 / 版本不匹配记录', () => {
  function seed(text: string): RegistrationStore {
    kv.data.set(STORAGE_KEY, text)
    return makeStore()
  }

  it('JSON 无法解析：明确报错且不暴露会话', () => {
    const broken = seed('{not-json')
    const state = broken.getState()
    expect(state.kind).toBe('error')
    if (state.kind === 'error') {
      expect(state.reason).toBe('unparseable')
      expect(state.message).toContain('损坏')
    }
    expect(broken.getSession()).toBeUndefined()
    expect(broken.nextIndex).toBe(-1)
  })

  it('版本不匹配：明确报版本错误，拒绝猜测进度（含旧版无 nextIndex 的记录）', () => {
    // 模拟 v1 旧记录：没有独立 nextIndex 字段
    const legacy = JSON.stringify({
      version: 1,
      sessionId: 'legacy-session',
      createdAt: 1,
      steps: STEPS.map((s) => ({ ...s })),
      values: [{ x: 0.1, y: 0 }]
    })
    const v = seed(legacy).getState()
    expect(v.kind).toBe('error')
    if (v.kind === 'error') expect(v.message).toContain('版本不匹配')

    // 未来版本同样拒绝
    const future = JSON.stringify(validRecord({ version: 999 }))
    const v2 = seed(future).getState()
    expect(v2.kind).toBe('error')
    if (v2.kind === 'error') expect(v2.message).toContain('版本不匹配')
  })

  it.each([
    ['缺步骤', validRecord({ steps: [] as SessionData['steps'] })],
    ['缺值数组', validRecord({ values: undefined as unknown as Measurement[] })],
    ['缺下一步索引', validRecord({ nextIndex: undefined as unknown as number })],
    [
      '步骤定义被调换',
      validRecord({ steps: STEPS.map((s, i) => ({ ...s, index: 7 - i })) })
    ],
    [
      '读数超范围',
      validRecord({ values: [{ x: 3, y: 0 }], nextIndex: 1 })
    ],
    [
      '读数精度非法',
      validRecord({ values: [{ x: 0.001, y: 0 }], nextIndex: 1 })
    ],
    [
      '已提交值多于八步',
      validRecord({
        values: Array.from({ length: 9 }, () => ({ x: 0, y: 0 })),
        nextIndex: 9
      })
    ],
    [
      '索引领先读数数量（有读数但索引跳号）',
      validRecord({ values: [{ x: 0, y: 0 }], nextIndex: 3 })
    ],
    [
      '索引落后读数数量（读数未丢但索引回退）',
      validRecord({
        values: [
          { x: 0, y: 0 },
          { x: 0, y: 0 }
        ],
        nextIndex: 1
      })
    ],
    [
      '索引为负数',
      validRecord({ nextIndex: -1 })
    ],
    [
      '索引超过八步',
      validRecord({ values: [], nextIndex: 9 })
    ],
    [
      '索引不是整数',
      validRecord({ values: [{ x: 0, y: 0 }], nextIndex: 1.5 })
    ],
    ['会话编号缺失', validRecord({ sessionId: '' })],
    ['创建时间超出日期可表示范围（过大有限数）', validRecord({ createdAt: 1e20 })],
    ['创建时间超出日期可表示范围（过小有限数）', validRecord({ createdAt: -1e20 })],
    ['根节点是数组', []],
    ['根节点是字符串', 'oops']
  ])('%s：报错并阻断', (_name, record) => {
    const s = seed(JSON.stringify(record))
    expect(s.getState().kind).toBe('error')
    expect(s.getSession()).toBeUndefined()
    expect(s.nextIndex).toBe(-1)
    expect(s.advance('0.00', '0.00').ok).toBe(false)
  })

  it('有限但超出 Date 范围的创建时间：报错信息明确指向创建时间，且界面不会拿到非数字时间', () => {
    const s = seed(JSON.stringify(validRecord({ createdAt: 1e20 })))
    const state = s.getState()
    expect(state.kind).toBe('error')
    if (state.kind === 'error') {
      expect(state.message).toContain('创建时间')
      expect(state.message).toContain('范围')
    }
    expect(s.getSession()).toBeUndefined()
  })

  it('创建时间恰在 Date 可表示边界内仍可恢复（边界 8.64e15）', () => {
    const s = seed(JSON.stringify(validRecord({ createdAt: 8.64e15 })))
    expect(s.getState().kind).toBe('ready')
    expect(s.getSession()?.createdAt).toBe(8.64e15)
  })

  it('阻断状态允许重置，重置后为空仓库并可开始新会话', () => {
    const broken = seed('{bad')
    broken.reset()
    expect(broken.getState().kind).toBe('empty')
    expect(kv.getItem(STORAGE_KEY)).toBeNull()
    expect(kv.removes).toBe(1)
    broken.begin(true)
    expect(broken.nextIndex).toBe(0)
  })
})

describe('放行结论（阈值 0.15mm）', () => {
  beforeEach(() => {
    store.begin(true)
  })

  it('未完成时不给结论', () => {
    store.advance('2.00', '2.00')
    expect(store.getVerdict()).toBeUndefined()
  })

  it('全部 |X|、|Y| ≤ 0.15 才可开印（边界 0.15 放行）', () => {
    for (let i = 0; i < 8; i++) store.advance(i % 2 ? '-0.15' : '0.15', '0.00')
    const verdict = store.getVerdict()
    expect(verdict?.pass).toBe(true)
    expect(verdict?.deviations).toEqual([])
  })

  it('任一读数绝对值超过 0.15 则需复调，并按测量顺序列出超差点与轴', () => {
    // 0 青左上: 合格；1 青右上 X 超差；4 品红左上 Y 超差；7 品红左下 双轴超差
    const inputs: Array<[string, string]> = [
      ['0.10', '0.10'],
      ['0.16', '0.10'],
      ['-0.05', '0.02'],
      ['0.00', '-0.15'],
      ['0.10', '-0.16'],
      ['0.01', '0.02'],
      ['0.15', '-0.15'],
      ['2.00', '-0.20']
    ]
    for (const [x, y] of inputs) expect(store.advance(x, y).ok).toBe(true)

    const verdict = store.getVerdict()
    expect(verdict?.pass).toBe(false)
    expect(verdict?.deviations.map((d) => d.step.index)).toEqual([1, 4, 7])
    expect(verdict?.deviations[0]).toMatchObject({
      step: { plate: 'cyan', corner: 'tr' },
      measurement: { x: 0.16, y: 0.1 },
      axes: ['x']
    })
    expect(verdict?.deviations[1].axes).toEqual(['y'])
    expect(verdict?.deviations[2].axes).toEqual(['x', 'y'])
  })
})

describe('复调诊断（八步完成后基于只读测量值生成）', () => {
  beforeEach(() => {
    store.begin(true)
  })

  it('未完成会话不生成诊断', () => {
    store.advance('0.20', '0.20')
    expect(store.getDiagnosis()).toBeUndefined()
  })

  it('损坏/旧检查点不生成诊断', () => {
    const legacy = JSON.stringify({
      version: 1,
      sessionId: 'legacy-session',
      createdAt: 1,
      steps: STEPS.map((s) => ({ ...s })),
      values: [{ x: 0.1, y: 0 }]
    })
    kv.data.set(STORAGE_KEY, legacy)
    const reopened = makeStore()
    expect(reopened.getDiagnosis()).toBeUndefined()
  })

  it('完成后逐版诊断：青版整版平移给建议，品红版角点不一致不给建议', () => {
    const inputs: Array<[string, string]> = [
      // 青版四角一致 +0.20（超差但平移）
      ['0.20', '0.00'],
      ['0.20', '0.00'],
      ['0.20', '0.00'],
      ['0.20', '0.00'],
      // 品红版角点不一致（第四角 X 突出）
      ['0.01', '0.00'],
      ['0.01', '0.00'],
      ['0.01', '0.00'],
      ['0.20', '0.00']
    ]
    for (const [x, y] of inputs) expect(store.advance(x, y).ok).toBe(true)

    const diag = store.getDiagnosis()
    expect(diag?.plates).toHaveLength(2)
    const cyan = diag?.plates[0]
    const magenta = diag?.plates[1]
    expect(cyan?.plate).toBe('cyan')
    expect(cyan?.uniform).toBe(true)
    expect(cyan?.advice).toEqual({ x: -0.2, y: 0 })
    expect(magenta?.plate).toBe('magenta')
    expect(magenta?.uniform).toBe(false)
    expect(magenta?.advice).toBeNull()
  })

  it('诊断为只读派生结果：调用前后检查点字段与版本结构完全不变', () => {
    for (let i = 0; i < 8; i++) store.advance('0.20', '0.00')
    const before = kv.getItem(STORAGE_KEY)
    const parsedBefore = JSON.parse(before as string) as Record<string, unknown>
    // 既有 v2 结构只有这六个字段，诊断不允许落盘任何新字段。
    expect(Object.keys(parsedBefore).sort()).toEqual(
      ['createdAt', 'nextIndex', 'sessionId', 'steps', 'values', 'version'].sort()
    )
    expect(parsedBefore.version).toBe(STORAGE_VERSION)

    store.getDiagnosis()
    store.getDiagnosis()
    expect(kv.getItem(STORAGE_KEY)).toBe(before)
  })
})
