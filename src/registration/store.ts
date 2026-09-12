import { STORAGE_KEY, STORAGE_VERSION, STEPS, TOLERANCE } from './steps'
import { restoreFromText } from './persistence'
import { parseOffset } from './validation'
import type {
  LoadState,
  Measurement,
  SessionData,
  Verdict,
  Deviation
} from './types'

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

  get nextIndex(): number {
    return this.state.kind === 'ready' ? this.state.session.values.length : -1
  }

  get isComplete(): boolean {
    return this.state.kind === 'ready' && this.state.session.values.length === STEPS.length
  }

  /**
   * 开始新会话。必须显式传入 requireConfirm=true，
   * 由界面层完成“确认清除旧检查点”后调用，杜绝误刷新/误操作覆盖旧读数。
   */
  begin(requireConfirm: true, now: () => number = () => Date.now()): SessionData {
    // 调用方必须显式传入确认标记（界面层先弹确认框），防止误覆盖旧检查点。
    if (requireConfirm !== true) {
      throw new Error('开始新会话前必须先清除并确认旧检查点。')
    }
    const session: SessionData = {
      version: STORAGE_VERSION,
      sessionId: createSessionId(),
      createdAt: now(),
      steps: STEPS.map((step) => ({ ...step })),
      values: []
    }
    this.persist(session)
    this.state = { kind: 'ready', session }
    return cloneSession(session)
  }

  /**
   * 提交当前步骤的 X、Y 偏移（字符串输入）。
   * 只有两个值都合法时才推进并原子落盘；任一非法则原地拒绝，不写记录、不前进。
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
    if (session.values.length >= STEPS.length) {
      return { ok: false, errors: { x: '八步测量已全部完成，提交已锁定，不可回改。' } }
    }

    const x = parseOffset(xRaw, 'X')
    const y = parseOffset(yRaw, 'Y')
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
      values: [...session.values, measurement]
    }
    this.persist(next)
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
    if (this.state.kind !== 'ready' || this.state.session.values.length !== STEPS.length) {
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

  private persist(session: SessionData): void {
    // 单次 setItem：会话编号、八步定义、已提交值与下一步索引(values.length) 原子写入。
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
    steps: session.steps.map((step) => ({ ...step })),
    values: session.values.map((m) => ({ ...m }))
  }
}

function createSessionId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } }
  if (g.crypto?.randomUUID) return g.crypto.randomUUID()
  // 离线兜底，不访问任何在线服务。
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
