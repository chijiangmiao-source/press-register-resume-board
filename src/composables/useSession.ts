import { computed, reactive, ref } from 'vue'
import { RegistrationStore } from '../registration/store'
import { STEPS, TOLERANCE } from '../registration/steps'
import type { LoadState, SessionData, Verdict } from '../registration/types'

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

  const nextIndex = computed(() => session.value?.nextIndex ?? 0)
  const isComplete = computed(() => session.value?.nextIndex === STEPS.length)
  const verdict = ref<Verdict | undefined>(store.getVerdict())

  function syncFromStore(): void {
    loadState.value = store.getState()
    session.value = store.getSession()
    verdict.value = store.getVerdict()
  }

  /** 新会话：界面必须先经 confirm 确认，才会清除旧检查点。 */
  function startNewSession(): void {
    const confirmed = window.confirm(
      '开始新会话将清除当前本地检查点，未完成的旧读数将无法续作。确定继续吗？'
    )
    if (!confirmed) return
    session.value = store.begin(true)
    draftX.value = ''
    draftY.value = ''
    fieldError.x = undefined
    fieldError.y = undefined
    syncFromStore()
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
    verdict,
    tolerance: TOLERANCE,
    startNewSession,
    resetCheckpoint,
    submitCurrent
  }
}
