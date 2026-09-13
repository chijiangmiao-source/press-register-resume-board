import { beforeEach, describe, expect, it } from 'vitest'
import { RegistrationStore, type KvStore } from './store'
import { STORAGE_KEY, STORAGE_VERSION, STEPS } from './steps'
import type { Measurement, SessionData } from './types'

class FakeKv implements KvStore {
  data = new Map<string, string>()
  writes = 0
  removes = 0
  /** 置为 true 时 setItem 抛错，模拟本地写入失败（如存储被禁用/限额）。 */
  throwOnWrite = false
  getItem(key: string) {
    return this.data.has(key) ? (this.data.get(key) as string) : null
  }
  setItem(key: string, value: string) {
    if (this.throwOnWrite) throw new Error('模拟本地写入失败')
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
    unit: 'mm',
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
    const session = store.begin(true, 'mm', () => 1_700_000_000_000)
    expect(session.sessionId).toBeTruthy()
    expect(session.version).toBe(STORAGE_VERSION)
    expect(session.createdAt).toBe(1_700_000_000_000)
    expect(session.unit).toBe('mm')
    expect(session.steps).toHaveLength(8)
    expect(session.values).toEqual([])
    expect(session.nextIndex).toBe(0)
    expect(store.nextIndex).toBe(0)
    const persisted = kv.raw() as SessionData
    expect(persisted.unit).toBe('mm')
    expect(persisted.steps).toHaveLength(8)
    expect(persisted.values).toEqual([])
    expect(persisted.nextIndex).toBe(0)
  })

  it('开始新会话缺省单位为毫米，并随检查点原子落盘', () => {
    const session = store.begin(true)
    expect(session.unit).toBe('mm')
    expect((kv.raw() as SessionData).unit).toBe('mm')
  })

  it('可选择微米开始新会话，单位随检查点一次原子写入', () => {
    const writesBefore = kv.writes
    const session = store.begin(true, 'um')
    expect(session.unit).toBe('um')
    expect(kv.writes).toBe(writesBefore + 1)
    const persisted = kv.raw() as SessionData
    expect(persisted.unit).toBe('um')
    expect(persisted.version).toBe(STORAGE_VERSION)
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

describe('撤回最近一次提交（undoLast）', () => {
  beforeEach(() => {
    store.begin(true)
  })

  it('删除末条读数、回退下一步索引，并以一次原子写入替换检查点', () => {
    store.advance('0.10', '0.00')
    store.advance('0.20', '0.00')
    store.advance('0.30', '-0.10')
    const sessionId = store.getSession()?.sessionId
    const writesBefore = kv.writes

    const r = store.undoLast()
    expect(r.ok).toBe(true)
    expect(store.nextIndex).toBe(2)
    // 整个撤回只产生一次 setItem：刷新后只会看到撤回前或撤回后的完整检查点
    expect(kv.writes).toBe(writesBefore + 1)

    const persisted = kv.raw() as SessionData
    expect(persisted.values).toEqual([
      { x: 0.1, y: 0 },
      { x: 0.2, y: 0 }
    ])
    expect(persisted.nextIndex).toBe(2)
    // 会话编号与锁定单位原样保留
    expect(persisted.sessionId).toBe(sessionId)
    expect(persisted.unit).toBe('mm')
    expect(store.getSession()?.sessionId).toBe(sessionId)
  })

  it('撤回返回的是拷贝，外部篡改不影响内部状态', () => {
    store.advance('0.10', '0.00')
    store.advance('0.20', '0.00')
    const r = store.undoLast()
    expect(r.ok).toBe(true)
    if (r.ok) {
      r.session.values[0].x = 9.99
      r.session.nextIndex = 7
    }
    expect(store.getSession()?.values[0].x).toBe(0.1)
    expect(store.nextIndex).toBe(1)
  })

  it('撤回后可按原顺序重新录入，放行结论与色版诊断只基于新的八步数据', () => {
    store.advance('0.20', '0.00')
    store.advance('0.20', '0.00')
    // 误录：若该值残留，青版将角点不一致且结论不同
    store.advance('0.01', '0.00')
    expect(store.undoLast().ok).toBe(true)
    // 按原顺序重新录入第三步，随后完成八步
    store.advance('0.20', '0.00')
    for (let i = 0; i < 5; i++) store.advance('0.20', '0.00')

    expect(store.isComplete).toBe(true)
    const persisted = kv.raw() as SessionData
    expect(persisted.values).toHaveLength(8)
    expect(persisted.values.every((m) => m.x === 0.2 && m.y === 0)).toBe(true)

    const verdict = store.getVerdict()
    expect(verdict?.pass).toBe(false)
    expect(verdict?.deviations.map((d) => d.step.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])

    const diag = store.getDiagnosis()
    expect(diag?.plates[0].uniform).toBe(true)
    expect(diag?.plates[0].advice).toEqual({ x: -0.2, y: 0 })
    expect(diag?.plates[1].uniform).toBe(true)
    expect(diag?.plates[1].advice).toEqual({ x: -0.2, y: 0 })
  })

  it('重新提交仍经过既有范围与精度校验', () => {
    store.advance('0.10', '0.00')
    expect(store.undoLast().ok).toBe(true)
    // 越界与精度不足的输入在撤回后的步骤上同样被原地拒绝
    expect(store.advance('2.50', '0.00').ok).toBe(false)
    expect(store.advance('0.001', '0.00').ok).toBe(false)
    expect(store.nextIndex).toBe(0)
    expect(store.advance('0.05', '0.00').ok).toBe(true)
    expect(store.nextIndex).toBe(1)
  })

  it('尚未提交任何读数时不可撤回，不产生写入', () => {
    const writesBefore = kv.writes
    const r = store.undoLast()
    expect(r.ok).toBe(false)
    expect(kv.writes).toBe(writesBefore)
    expect(store.nextIndex).toBe(0)
    expect((kv.raw() as SessionData).values).toEqual([])
  })

  it('八步全部完成后不可撤回（结论已锁定），不产生写入', () => {
    for (let i = 0; i < 8; i++) store.advance('0.00', '0.00')
    const writesBefore = kv.writes
    const r = store.undoLast()
    expect(r.ok).toBe(false)
    expect(kv.writes).toBe(writesBefore)
    expect(store.nextIndex).toBe(8)
    expect(store.isComplete).toBe(true)
    expect((kv.raw() as SessionData).values).toHaveLength(8)
  })

  it('空仓库或损坏记录下不可撤回', () => {
    const emptyKv = new FakeKv()
    const empty = new RegistrationStore(emptyKv)
    expect(empty.undoLast().ok).toBe(false)

    emptyKv.data.set(STORAGE_KEY, '{not-json')
    const broken = new RegistrationStore(emptyKv)
    expect(broken.undoLast().ok).toBe(false)
    expect(broken.nextIndex).toBe(-1)
  })

  it('检查点写入失败：返回明确原因，内存状态与落盘记录都保持原进度', () => {
    store.advance('0.10', '0.00')
    store.advance('0.20', '0.00')
    const textBefore = kv.getItem(STORAGE_KEY)
    const writesBefore = kv.writes

    kv.throwOnWrite = true
    const r = store.undoLast()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('检查点')
    // 内存状态不变：仍是两步、停在第 3 步
    expect(store.nextIndex).toBe(2)
    expect(store.getSession()?.values).toEqual([
      { x: 0.1, y: 0 },
      { x: 0.2, y: 0 }
    ])
    // 落盘记录不变，也没有半途中断的写入
    expect(kv.getItem(STORAGE_KEY)).toBe(textBefore)
    expect(kv.writes).toBe(writesBefore)

    // 恢复写入能力后可正常撤回
    kv.throwOnWrite = false
    expect(store.undoLast().ok).toBe(true)
    expect(store.nextIndex).toBe(1)
  })

  it('微米会话撤回：单位与既有读数原样保留，重新提交仍按微米校验', () => {
    store.begin(true, 'um')
    store.advance('120', '-50')
    store.advance('200', '0')

    expect(store.undoLast().ok).toBe(true)
    const persisted = kv.raw() as SessionData
    expect(persisted.unit).toBe('um')
    expect(persisted.values).toEqual([{ x: 0.12, y: -0.05 }])
    expect(persisted.nextIndex).toBe(1)

    // 非法微米输入仍被原地拒绝；合法值重新提交并换算落盘
    expect(store.advance('15', '0').ok).toBe(false)
    expect(store.nextIndex).toBe(1)
    expect(store.advance('-30', '40').ok).toBe(true)
    expect(store.getSession()?.values[1]).toEqual({ x: -0.03, y: 0.04 })
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

  it('创建时间超出 Date 可表示范围：判损阻断，不恢复会话、不展示 NaN 时间', () => {
    // 1e20 是有限数，但超出 Date 可表示范围（±8.64e15 ms），恢复后只能显示 NaN 时间
    for (const createdAt of [1e20, -1e20, 8.64e15 + 1, -(8.64e15 + 1)]) {
      const s = seed(JSON.stringify(validRecord({ createdAt })))
      const state = s.getState()
      expect(state.kind, `createdAt=${createdAt}`).toBe('error')
      if (state.kind === 'error') expect(state.message).toContain('创建时间')
      expect(s.getSession()).toBeUndefined()
      expect(s.nextIndex).toBe(-1)
    }
  })

  it('创建时间在 Date 可表示范围边界（±8.64e15）仍可正常恢复', () => {
    for (const createdAt of [8.64e15, -8.64e15, 0]) {
      const s = seed(JSON.stringify(validRecord({ createdAt })))
      expect(s.getState().kind, `createdAt=${createdAt}`).toBe('ready')
      expect(s.getSession()?.createdAt).toBe(createdAt)
    }
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
      '读数非百分之一毫米精度（浮点噪声级以外的微小偏差）',
      validRecord({ values: [{ x: 0.1200000001, y: 0 }], nextIndex: 1 })
    ],
    [
      '读数为非 0.01 整数倍的微小量',
      validRecord({ values: [{ x: 0, y: 1e-10 }], nextIndex: 1 })
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

  it('合法读数的浮点表示（如 0.1+0.2、干净小数 0.29）恢复时不误判为损坏', () => {
    const s = seed(
      JSON.stringify(
        validRecord({
          values: [
            { x: 0.1 + 0.2, y: 0.29 },
            { x: -1.91, y: 2 }
          ],
          nextIndex: 2
        })
      )
    )
    expect(s.getState().kind).toBe('ready')
    expect(s.nextIndex).toBe(2)
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
    // v2 结构固定为这七个字段（含录入单位），诊断不允许落盘任何新字段。
    expect(Object.keys(parsedBefore).sort()).toEqual(
      ['createdAt', 'nextIndex', 'sessionId', 'steps', 'unit', 'values', 'version'].sort()
    )
    expect(parsedBefore.version).toBe(STORAGE_VERSION)

    store.getDiagnosis()
    store.getDiagnosis()
    expect(kv.getItem(STORAGE_KEY)).toBe(before)
  })
})

describe('微米会话：录入校验与毫米换算', () => {
  beforeEach(() => {
    store.begin(true, 'um')
  })

  it('微米输入按 10 µm 步进校验并换算成毫米落盘（0.01 mm 精度）', () => {
    const r = store.advance('120', '-50')
    expect(r.ok).toBe(true)
    expect(store.nextIndex).toBe(1)
    const persisted = kv.raw() as SessionData
    // 落盘只有毫米：120 µm -> 0.12 mm，-50 µm -> -0.05 mm
    expect(persisted.values).toEqual([{ x: 0.12, y: -0.05 }])
    expect(persisted.unit).toBe('um')
    expect(persisted.nextIndex).toBe(1)
  })

  it('边界 ±2000 µm 恰好可提交，换算为 ±2 mm', () => {
    expect(store.advance('2000', '-2000').ok).toBe(true)
    expect((kv.raw() as SessionData).values).toEqual([{ x: 2, y: -2 }])
  })

  it.each([
    ['115', '0', '10 µm'],
    ['0', '-5', '10 µm'],
    ['2010', '0', '范围'],
    ['0', '-2010', '范围'],
    ['0.10', '0', '整数'],
    ['abc', '0', '整数'],
    ['', '0', '必填'],
    ['0', '']
  ])('微米非法输入原地拒绝：(%s, %s)', (x, y, hint?: string) => {
    const writesBefore = kv.writes
    const r = store.advance(x, y)
    expect(r.ok).toBe(false)
    if (!r.ok && hint) {
      expect(r.errors.x ?? r.errors.y).toContain(hint)
    }
    // 不推进、不写盘：刷新后仍停在原步骤
    expect(store.nextIndex).toBe(0)
    expect(kv.writes).toBe(writesBefore)
    const persisted = kv.raw() as SessionData
    expect(persisted.values).toEqual([])
    expect(persisted.nextIndex).toBe(0)
  })

  it('单位锁定：微米会话中毫米写法（小数）一律拒绝', () => {
    const r = store.advance('0.10', '0.10')
    expect(r.ok).toBe(false)
    expect(store.nextIndex).toBe(0)
  })

  it('微米会话走完八步，结论与诊断仍按毫米计算且数值等价', () => {
    // 与毫米用例完全相同的物理量：青版四角一致 +0.20 mm，品红版三角 +0.01 mm、末角 +0.20 mm
    const inputs: Array<[string, string]> = [
      ['200', '0'],
      ['200', '0'],
      ['200', '0'],
      ['200', '0'],
      ['10', '0'],
      ['10', '0'],
      ['10', '0'],
      ['200', '0']
    ]
    for (const [x, y] of inputs) expect(store.advance(x, y).ok).toBe(true)

    const verdict = store.getVerdict()
    expect(verdict?.pass).toBe(false)
    expect(verdict?.deviations.map((d) => d.step.index)).toEqual([0, 1, 2, 3, 7])
    expect(verdict?.deviations[0].measurement).toEqual({ x: 0.2, y: 0 })

    const diag = store.getDiagnosis()
    expect(diag?.plates[0].uniform).toBe(true)
    expect(diag?.plates[0].advice).toEqual({ x: -0.2, y: 0 })
    expect(diag?.plates[1].uniform).toBe(false)
    expect(diag?.plates[1].advice).toBeNull()
  })
})

describe('单位随检查点恢复', () => {
  it('微米会话中途刷新：单位、读数（毫米）与下一步索引原样恢复', () => {
    store.begin(true, 'um')
    store.advance('120', '-50')
    store.advance('0', '200')

    const reopened = makeStore()
    const session = reopened.getSession()
    expect(session?.unit).toBe('um')
    expect(session?.values).toEqual([
      { x: 0.12, y: -0.05 },
      { x: 0, y: 0.2 }
    ])
    expect(reopened.nextIndex).toBe(2)
  })

  it('恢复后的微米会话继续按微米校验推进', () => {
    store.begin(true, 'um')
    store.advance('100', '0')
    const reopened = makeStore()
    // 非法微米输入仍被拒绝
    expect(reopened.advance('15', '0').ok).toBe(false)
    expect(reopened.nextIndex).toBe(1)
    // 合法输入继续推进并换算落盘
    expect(reopened.advance('-30', '40').ok).toBe(true)
    expect(reopened.getSession()?.values[1]).toEqual({ x: -0.03, y: 0.04 })
  })

  it('未含 unit 字段的旧有效记录按毫米载入，版本号不变', () => {
    const legacy: Record<string, unknown> = {
      ...validRecord({ values: [{ x: 0.1, y: -0.05 }], nextIndex: 1 })
    }
    delete legacy.unit
    kv.data.set(STORAGE_KEY, JSON.stringify(legacy))

    const reopened = makeStore()
    const state = reopened.getState()
    expect(state.kind).toBe('ready')
    const session = reopened.getSession()
    expect(session?.unit).toBe('mm')
    expect(session?.version).toBe(STORAGE_VERSION)
    expect(session?.values).toEqual([{ x: 0.1, y: -0.05 }])
    expect(reopened.nextIndex).toBe(1)
    // 按毫米继续推进
    expect(reopened.advance('0.05', '0.00').ok).toBe(true)
    expect(reopened.nextIndex).toBe(2)
  })

  it.each([['inch'], ['UM'], [''], [0], [null], [true]])(
    'unit 取值非法（%s）：报错并阻断，不猜测单位',
    (badUnit) => {
      const record: Record<string, unknown> = {
        ...validRecord({ values: [{ x: 0, y: 0 }], nextIndex: 1 })
      }
      record.unit = badUnit
      kv.data.set(STORAGE_KEY, JSON.stringify(record))

      const reopened = makeStore()
      const state = reopened.getState()
      expect(state.kind).toBe('error')
      if (state.kind === 'error') expect(state.message).toContain('单位')
      expect(reopened.getSession()).toBeUndefined()
      expect(reopened.nextIndex).toBe(-1)
      expect(reopened.advance('0.10', '0.10').ok).toBe(false)
    }
  )
})
