import { STORAGE_KEY, STORAGE_VERSION, STEPS, TOLERANCE } from './steps'
import { restoreFromText } from './persistence'
import { parseUnitOffset } from './units'
import { buildDiagnosis } from './diagnosis'
import type {
  LoadState,
  Measurement,
  SessionData,
  UnitId,
  Verdict,
  Deviation
} from './types'
import type { RegistrationDiagnosis } from './diagnosis'

/**
 * 最小键值存储抽象：浏览器使用 localStorage，单元测试使用内存假实现。
 * setItem 必须是单次原子落盘——一次推进只产生一次写入，
 * 保证刷新后看到的是“推进前”或“推进后”的完整检查点。
 */
export interface KvStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export class RegistrationStore {
  private state: LoadState

  constructor(private readonly kv: KvStore = localStorage) {
    this.state = this.load()
  }

  private load(): LoadState {
    let text: string | null = null
    try {
      text = this.kv.getItem(STORAGE_KEY)
    } catch {
      return {
        kind: 'error',
        reason: 'unparseable',
        message: '无法读取浏览器本地记录（存储可能被禁用），已阻断续作。'
      }
    }
    return restoreFromText(text)
  }

  getState(): LoadState {
    return this.cloneState(this.state)
  }

  /** 当前可继续会话；空仓库或损坏记录时返回 undefined。 */
  getSession(): SessionData | undefined {
    return this.state.kind === 'ready' ? cloneSession(this.state.session) : undefined
  }

  /** 下一步索引直接读取独立落盘字段，不按已提交值数量反推。 */
  get nextIndex(): number {
    return this.state.kind === 'ready' ? this.state.session.nextIndex : -1
  }

  get isComplete(): boolean {
    return (
      this.state.kind === 'ready' && this.state.session.nextIndex === STEPS.length
    )
  }

  /**
   * 开始新会话。必须显式传入 requireConfirm=true，
   * 由界面层完成“确认清除旧检查点”后调用，杜绝误刷新/误操作覆盖旧读数。
   * 录入单位随会话创建锁定并原子落盘，进行中的会话不可中途更改。
   */
  begin(
    requireConfirm: true,
    unit: UnitId = 'mm',
    now: () => number = () => Date.now()
  ): SessionData {
    // 调用方必须显式传入确认标记（界面层先弹确认框），防止误覆盖旧检查点。
    if (requireConfirm !== true) {
      throw new Error('开始新会话前必须先清除并确认旧检查点。')
    }
    const session: SessionData = {
      version: STORAGE_VERSION,
      sessionId: createSessionId(),
      createdAt: now(),
      unit,
      steps: STEPS.map((step) => ({ ...step })),
      values: [],
      nextIndex: 0
    }
    this.persist(session)
    this.state = { kind: 'ready', session }
    return cloneSession(session)
  }

  /**
   * 提交当前步骤的 X、Y 偏移（按会话锁定单位录入的字符串）。
   * 单位层负责把输入校验并换算成毫米；只有两个值都合法时才推进并原子落盘，
   * 任一非法则原地拒绝，不写记录、不前进。
   * 已完成全部八步或记录损坏时拒绝任何提交（已提交步骤不可回改）。
   */
  advance(
    xRaw: string,
    yRaw: string
  ): { ok: true; session: SessionData } | { ok: false; errors: { x?: string; y?: string } } {
    if (this.state.kind !== 'ready') {
      return {
        ok: false,
        errors: { x: '本地检查点不可用，请先重置后开始新会话。' }
      }
    }
    const session = this.state.session
    if (session.nextIndex >= STEPS.length) {
      return { ok: false, errors: { x: '八步测量已全部完成，提交已锁定，不可回改。' } }
    }

    const x = parseUnitOffset(xRaw, 'X', session.unit)
    const y = parseUnitOffset(yRaw, 'Y', session.unit)
    if (!x.ok || !y.ok) {
      return {
        ok: false,
        errors: {
          x: x.ok ? undefined : x.reason,
          y: y.ok ? undefined : y.reason
        }
      }
    }

    const measurement: Measurement = { x: x.value, y: y.value }
    const next: SessionData = {
      ...cloneSession(session),
      values: [...session.values, measurement],
      nextIndex: session.nextIndex + 1
    }
    this.persist(next)
    this.state = { kind: 'ready', session: next }
    return { ok: true, session: cloneSession(next) }
  }

  /**
   * 撤回最近一次提交（仅尚未完成的录入阶段可撤回）。
   * 删除末条读数、回退独立落盘的下一步索引，并用一次原子 setItem
   * 替换整个检查点；会话编号与锁定单位原样保留。
   * 写入失败时内存状态与旧检查点都不动，返回原因由界面提示，可重试。
   */
  undoLast(): { ok: true; session: SessionData } | { ok: false; reason: string } {
    if (this.state.kind !== 'ready') {
      return { ok: false, reason: '本地检查点不可用，无法撤回，请先重置后开始新会话。' }
    }
    const session = this.state.session
    if (session.nextIndex <= 0) {
      return { ok: false, reason: '尚未提交任何读数，没有可撤回的步骤。' }
    }
    if (session.nextIndex >= STEPS.length) {
      return { ok: false, reason: '八步测量已全部完成，结论已生成，不可再撤回。' }
    }

    const next: SessionData = {
      ...cloneSession(session),
      values: session.values.slice(0, -1),
      nextIndex: session.nextIndex - 1
    }
    try {
      this.persist(next)
    } catch {
      // 落盘失败（如存储被禁用/限额）：保留原进度，内存状态不变。
      return { ok: false, reason: '撤回未能写入本地检查点，已保留原进度，请重试。' }
    }
    this.state = { kind: 'ready', session: next }
    return { ok: true, session: cloneSession(next) }
  }

  /** 清除损坏/过期检查点，回到空仓库状态。 */
  reset(): void {
    this.kv.removeItem(STORAGE_KEY)
    this.state = { kind: 'empty' }
  }

  /** 八步全部完成后的放行结论；未完成不给出结论。 */
  getVerdict(): Verdict | undefined {
    if (this.state.kind !== 'ready' || this.state.session.nextIndex !== STEPS.length) {
      return undefined
    }
    const deviations: Deviation[] = []
    this.state.session.values.forEach((measurement, i) => {
      const axes: Array<'x' | 'y'> = []
      if (Math.abs(measurement.x) > TOLERANCE) axes.push('x')
      if (Math.abs(measurement.y) > TOLERANCE) axes.push('y')
      if (axes.length > 0) {
        deviations.push({ step: STEPS[i], measurement, axes })
      }
    })
    return { pass: deviations.length === 0, deviations }
  }

  /**
   * 八步全部完成后的复调诊断（整版平移 / 角点不一致 + 校正建议）。
   * 仅基于既有只读测量值现场生成，不写检查点、不改变任何既有字段；
   * 未完成会话或记录损坏时返回 undefined。
   */
  getDiagnosis(): RegistrationDiagnosis | undefined {
    if (this.state.kind !== 'ready' || this.state.session.nextIndex !== STEPS.length) {
      return undefined
    }
    return buildDiagnosis(this.state.session.values)
  }

  private persist(session: SessionData): void {
    // 单次 setItem：会话编号、录入单位、八步定义、已提交值与下一步索引 原子写入。
    this.kv.setItem(STORAGE_KEY, JSON.stringify(session))
  }

  private cloneState(state: LoadState): LoadState {
    return state.kind === 'ready' ? { kind: 'ready', session: cloneSession(state.session) } : { ...state }
  }
}

function cloneSession(session: SessionData): SessionData {
  return {
    version: session.version,
    sessionId: session.sessionId,
    createdAt: session.createdAt,
    unit: session.unit,
    steps: session.steps.map((step) => ({ ...step })),
    values: session.values.map((m) => ({ ...m })),
    nextIndex: session.nextIndex
  }
}

function createSessionId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } }
  if (g.crypto?.randomUUID) return g.crypto.randomUUID()
  // 离线兜底，不访问任何在线服务。
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
