import { computed, reactive, ref, watch } from 'vue'
import { RegistrationStore } from '../registration/store'
import { STEPS, TOLERANCE } from '../registration/steps'
import { parseUnitOffset } from '../registration/units'
import type { LoadState, SessionData, UnitId, Verdict } from '../registration/types'
import type { RegistrationDiagnosis } from '../registration/diagnosis'

export interface FieldError {
  x?: string
  y?: string
}

/**
 * 页面与 RegistrationStore 之间的桥：
 * 持有刷新后恢复出的状态、当前草稿输入与行内校验错误。
 * Store 内部保证每次推进原子落盘，这里只负责交互。
 */
export function useSession(store: RegistrationStore) {
  const loadState = ref<LoadState>(store.getState())
  const session = ref<SessionData | undefined>(store.getSession())
  const draftX = ref('')
  const draftY = ref('')
  const fieldError = reactive<FieldError>({})
  /**
   * 结果页“开始新会话”只切回起始页（不清除旧检查点），
   * 让调机员在起始页重新选择录入单位后再真正开始。
   */
  const showStartPanel = ref(false)

  const nextIndex = computed(() => session.value?.nextIndex ?? 0)
  const isComplete = computed(() => session.value?.nextIndex === STEPS.length)
  /** 会话锁定的录入单位；无会话时按毫米展示起始页。 */
  const unit = computed<UnitId>(() => session.value?.unit ?? 'mm')
  const verdict = ref<Verdict | undefined>(store.getVerdict())
  const diagnosis = ref<RegistrationDiagnosis | undefined>(store.getDiagnosis())

  // 字段恢复合法时，上一次提交留下的行内错误必须同步消失，不残留旧提示。
  // 校验口径跟随会话锁定的单位（毫米 0.01 步进 / 微米 10 步进）。
  watch(draftX, (text) => {
    if (fieldError.x !== undefined && parseUnitOffset(text, 'X', unit.value).ok) {
      fieldError.x = undefined
    }
  })
  watch(draftY, (text) => {
    if (fieldError.y !== undefined && parseUnitOffset(text, 'Y', unit.value).ok) {
      fieldError.y = undefined
    }
  })

  function syncFromStore(): void {
    loadState.value = store.getState()
    session.value = store.getSession()
    verdict.value = store.getVerdict()
    diagnosis.value = store.getDiagnosis()
  }

  /**
   * 新会话：仅当确有旧检查点（可续作会话）时才弹确认，防止误覆盖旧读数；
   * 空仓库（无任何旧记录）直接开始，不打扰调机员。
   * 所选录入单位随会话创建锁定，进行中的会话不可更改。
   * 取消清除确认时回到之前的会话视图（进行中的录入页或八步完成后的结论页），
   * 不把调机员留在起始页。
   */
  function startNewSession(unitChoice: UnitId = 'mm'): void {
    if (loadState.value.kind === 'ready') {
      const confirmed = window.confirm(
        '开始新会话将清除当前本地检查点，未完成的旧读数将无法续作。确定继续吗？'
      )
      if (!confirmed) {
        // 旧检查点原样保留，恢复原会话视图（完成结果供继续核对 / 录入页继续测量）。
        showStartPanel.value = false
        return
      }
    }
    session.value = store.begin(true, unitChoice)
    draftX.value = ''
    draftY.value = ''
    fieldError.x = undefined
    fieldError.y = undefined
    showStartPanel.value = false
    syncFromStore()
  }

  /** 返回起始页选择单位；旧检查点保持不动，刷新后仍可续作或查看原结论。 */
  function openStartPanel(): void {
    showStartPanel.value = true
  }

  function resetCheckpoint(): void {
    const confirmed = window.confirm('确定清除损坏的本地检查点吗？该操作不可恢复。')
    if (!confirmed) return
    store.reset()
    draftX.value = ''
    draftY.value = ''
    syncFromStore()
  }

  /** 提交当前步骤：两值均合法才由 store 推进；否则显示逐轴错误，不前进、不落盘。 */
  function submitCurrent(): void {
    const result = store.advance(draftX.value, draftY.value)
    if (!result.ok) {
      fieldError.x = result.errors.x
      fieldError.y = result.errors.y
      return
    }
    fieldError.x = undefined
    fieldError.y = undefined
    draftX.value = ''
    draftY.value = ''
    syncFromStore()
  }

  return {
    store,
    loadState,
    session,
    draftX,
    draftY,
    fieldError,
    nextIndex,
    isComplete,
    unit,
    showStartPanel,
    verdict,
    diagnosis,
    tolerance: TOLERANCE,
    startNewSession,
    openStartPanel,
    resetCheckpoint,
    submitCurrent
  }
}
