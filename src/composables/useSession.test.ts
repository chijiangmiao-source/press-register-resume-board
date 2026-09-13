import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RegistrationStore, type KvStore } from '../registration/store'
import { STORAGE_KEY } from '../registration/steps'
import { useSession } from './useSession'
import type { SessionData } from '../registration/types'

class FakeKv implements KvStore {
  data = new Map<string, string>()
  getItem(key: string) {
    return this.data.has(key) ? (this.data.get(key) as string) : null
  }
  setItem(key: string, value: string) {
    this.data.set(key, value)
  }
  removeItem(key: string) {
    this.data.delete(key)
  }
}

let kv: FakeKv
let store: RegistrationStore

beforeEach(() => {
  kv = new FakeKv()
  store = new RegistrationStore(kv)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('行内错误随字段修正同步消失', () => {
  it('没有旧错误时，合法输入变化不会产生错误提示', async () => {
    store.begin(true)
    const u = useSession(store)

    u.draftX.value = '0.10'
    u.draftY.value = '-0.05'
    await nextTick()

    expect(u.fieldError.x).toBeUndefined()
    expect(u.fieldError.y).toBeUndefined()
  })

  it('提交超范围 X 后把 X 改为合法值，旧错误立即消失，不等待再次提交', async () => {
    store.begin(true)
    const u = useSession(store)

    u.draftX.value = '9'
    u.draftY.value = '0.00'
    u.submitCurrent()
    expect(u.fieldError.x).toBeTruthy()
    expect(u.fieldError.y).toBeUndefined()
    expect(u.nextIndex.value).toBe(0)

    // 只改字段、不再次提交：错误应随合法输入同步消失
    u.draftX.value = '0.10'
    await nextTick()
    expect(u.fieldError.x).toBeUndefined()
  })

  it('双轴报错时只修正一轴，另一轴错误保留', async () => {
    store.begin(true)
    const u = useSession(store)

    u.draftX.value = '9'
    u.draftY.value = 'abc'
    u.submitCurrent()
    expect(u.fieldError.x).toBeTruthy()
    expect(u.fieldError.y).toBeTruthy()

    u.draftX.value = '0.10'
    await nextTick()
    expect(u.fieldError.x).toBeUndefined()
    expect(u.fieldError.y).toBeTruthy()

    u.draftY.value = '-0.05'
    await nextTick()
    expect(u.fieldError.y).toBeUndefined()
  })

  it('字段仍是非法值时旧错误继续保留，提交后以最新原因覆盖', async () => {
    store.begin(true)
    const u = useSession(store)

    u.draftX.value = '9'
    u.draftY.value = '0.00'
    u.submitCurrent()
    const firstReason = u.fieldError.x
    expect(firstReason).toContain('范围')

    // 超范围改为精度非法：错误仍在
    u.draftX.value = '0.001'
    await nextTick()
    expect(u.fieldError.x).toBe(firstReason)

    u.submitCurrent()
    expect(u.fieldError.x).toContain('0.01')
  })
})

describe('开始新会话的确认时机', () => {
  it('浏览器没有任何旧检查点时：不弹确认，直接开始', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const u = useSession(store)

    expect(loadKind(u)).toBe('empty')
    u.startNewSession()

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(u.session.value).toBeDefined()
    expect(u.nextIndex.value).toBe(0)
    expect(kv.getItem(STORAGE_KEY)).not.toBeNull()
  })

  it('确有旧会话时取消确认：旧检查点原样保留，不开始新会话', () => {
    store.begin(true)
    store.advance('0.10', '0.00')
    const beforeText = kv.getItem(STORAGE_KEY)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const u = useSession(store)

    u.startNewSession()

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(u.session.value?.sessionId).toBe(store.getSession()?.sessionId)
    expect(u.nextIndex.value).toBe(1)
    expect(kv.getItem(STORAGE_KEY)).toBe(beforeText)
  })

  it('进行中会话进入起始页后取消确认：回到录入页，进度与草稿不受影响', () => {
    store.begin(true)
    store.advance('0.10', '0.00')
    store.advance('0.20', '0.00')
    const beforeText = kv.getItem(STORAGE_KEY)
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const u = useSession(store)

    u.openStartPanel()
    expect(u.showStartPanel.value).toBe(true)
    u.startNewSession('um')

    // 取消清除确认：回到原会话视图，不停留在起始页
    expect(u.showStartPanel.value).toBe(false)
    expect(u.session.value?.unit).toBe('mm')
    expect(u.nextIndex.value).toBe(2)
    expect(kv.getItem(STORAGE_KEY)).toBe(beforeText)
  })

  it('完成八步后进入起始页再取消确认：恢复原完成结果供继续核对', () => {
    store.begin(true, 'um')
    for (let i = 0; i < 8; i++) store.advance('100', '-50')
    const beforeText = kv.getItem(STORAGE_KEY)
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const u = useSession(store)
    const verdictBefore = u.verdict.value

    u.openStartPanel()
    expect(u.showStartPanel.value).toBe(true)
    u.startNewSession('mm')

    // 取消清除确认：恢复完成结果（结论与诊断仍在），检查点原样保留
    expect(u.showStartPanel.value).toBe(false)
    expect(u.isComplete.value).toBe(true)
    expect(u.verdict.value).toEqual(verdictBefore)
    expect(u.diagnosis.value).toBeDefined()
    expect(u.session.value?.unit).toBe('um')
    expect(kv.getItem(STORAGE_KEY)).toBe(beforeText)
  })

  it('确有旧会话时接受确认：清除旧读数并从第 1 步重新开始', () => {
    store.begin(true)
    store.advance('0.10', '0.00')
    const oldId = store.getSession()?.sessionId
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const u = useSession(store)

    u.startNewSession()

    expect(u.session.value?.sessionId).not.toBe(oldId)
    expect(u.nextIndex.value).toBe(0)
    const persisted = JSON.parse(kv.getItem(STORAGE_KEY) as string) as SessionData
    expect(persisted.values).toEqual([])
    expect(persisted.nextIndex).toBe(0)
  })

  it('损坏记录阻断状态下不弹“清除旧读数”确认（重置走 BlockedPanel 独立确认）', () => {
    kv.data.set(STORAGE_KEY, '{not-json')
    const broken = new RegistrationStore(kv)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const u = useSession(broken)

    u.startNewSession()
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(u.session.value).toBeDefined()
    expect(u.loadState.value.kind).toBe('ready')
  })
})

describe('会话单位选择与锁定', () => {
  it('起始页选择微米开始新会话：单位随检查点落盘并锁定', () => {
    const u = useSession(store)
    u.startNewSession('um')

    expect(u.unit.value).toBe('um')
    expect(u.session.value?.unit).toBe('um')
    const persisted = JSON.parse(kv.getItem(STORAGE_KEY) as string) as SessionData
    expect(persisted.unit).toBe('um')
  })

  it('缺省单位是毫米', () => {
    const u = useSession(store)
    u.startNewSession()
    expect(u.unit.value).toBe('mm')
  })

  it('微米会话：非法微米输入报错，改为合法微米值后错误同步消失', async () => {
    const u = useSession(store)
    u.startNewSession('um')

    u.draftX.value = '115'
    u.draftY.value = '0'
    u.submitCurrent()
    expect(u.fieldError.x).toContain('10 µm')
    expect(u.nextIndex.value).toBe(0)

    // 毫米写法在微米会话中同样非法
    u.draftX.value = '0.10'
    await nextTick()
    expect(u.fieldError.x).toBeTruthy()

    // 改为合法微米值：错误消失，可提交推进
    u.draftX.value = '120'
    await nextTick()
    expect(u.fieldError.x).toBeUndefined()
    u.submitCurrent()
    expect(u.nextIndex.value).toBe(1)
    expect(u.session.value?.values[0]).toEqual({ x: 0.12, y: 0 })
  })

  it('结果页“开始新会话”只返回起始页：检查点原样保留，单位可重新选择', () => {
    store.begin(true, 'um')
    for (let i = 0; i < 8; i++) store.advance('0', '0')
    const beforeText = kv.getItem(STORAGE_KEY)
    const u = useSession(store)

    u.openStartPanel()
    expect(u.showStartPanel.value).toBe(true)
    // 未清除任何数据，旧检查点（含微米单位）原样保留
    expect(kv.getItem(STORAGE_KEY)).toBe(beforeText)
    expect(u.session.value?.unit).toBe('um')

    // 在起始页改选毫米开始新会话
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    u.startNewSession('mm')
    expect(u.showStartPanel.value).toBe(false)
    expect(u.unit.value).toBe('mm')
    expect(u.nextIndex.value).toBe(0)
  })
})

function loadKind(u: ReturnType<typeof useSession>): string {
  return u.loadState.value.kind
}
