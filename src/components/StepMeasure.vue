<script setup lang="ts">
import { computed } from 'vue'
import { STEPS, TOLERANCE } from '../registration/steps'
import { cornerLabel, plateLabel } from '../registration/format'
import { formatUnitMagnitude, unitRangeText, UNIT_SYMBOL } from '../registration/units'
import type { UnitId } from '../registration/types'

const props = defineProps<{
  nextIndex: number
  draftX: string
  draftY: string
  fieldError: { x?: string; y?: string }
  unit: UnitId
  undoError?: string
}>()

const emit = defineEmits<{
  'update:draftX': [value: string]
  'update:draftY': [value: string]
  submit: []
  undo: []
}>()

const step = computed(() => STEPS[props.nextIndex])
const canSubmit = computed(() => props.draftX.trim() !== '' && props.draftY.trim() !== '')
/** 仅已有提交且仍处于录入阶段时可撤回最近一次提交。 */
const canUndo = computed(() => props.nextIndex > 0 && props.nextIndex < STEPS.length)
const lastStep = computed(() => STEPS[props.nextIndex - 1])
const symbol = computed(() => UNIT_SYMBOL[props.unit])
const rangeText = computed(() => unitRangeText(props.unit))
const toleranceText = computed(() => formatUnitMagnitude(TOLERANCE, props.unit))
const placeholder = computed(() => (props.unit === 'um' ? '如 50' : '如 0.05'))
const placeholderY = computed(() => (props.unit === 'um' ? '如 -100' : '如 -0.10'))
</script>

<template>
  <section class="panel" data-testid="measure-panel">
    <div class="measure-head">
      <span class="step-no" data-testid="step-no">第 {{ nextIndex + 1 }} / 8 步</span>
      <span class="point-tag" data-testid="current-point">
        {{ plateLabel(step.plate) }} · {{ cornerLabel(step.corner) }}
      </span>
    </div>
    <p class="hint" data-testid="range-hint">录入相对黑版偏移，范围 {{ rangeText }}。</p>

    <form class="offset-form" @submit.prevent="emit('submit')">
      <label class="field">
        <span class="field-label">X 偏移 ({{ symbol }})</span>
        <input
          :value="draftX"
          type="text"
          inputmode="decimal"
          autocomplete="off"
          :placeholder="placeholder"
          data-testid="input-x"
          :aria-invalid="Boolean(fieldError.x)"
          @input="emit('update:draftX', ($event.target as HTMLInputElement).value)"
        />
        <span v-if="fieldError.x" class="field-error" data-testid="error-x">{{ fieldError.x }}</span>
      </label>

      <label class="field">
        <span class="field-label">Y 偏移 ({{ symbol }})</span>
        <input
          :value="draftY"
          type="text"
          inputmode="decimal"
          autocomplete="off"
          :placeholder="placeholderY"
          data-testid="input-y"
          :aria-invalid="Boolean(fieldError.y)"
          @input="emit('update:draftY', ($event.target as HTMLInputElement).value)"
        />
        <span v-if="fieldError.y" class="field-error" data-testid="error-y">{{ fieldError.y }}</span>
      </label>

      <button
        type="submit"
        class="btn btn-primary"
        data-testid="submit-step"
        :disabled="!canSubmit"
      >
        提交并进入下一步
      </button>
    </form>
    <p class="hint tolerance-hint" data-testid="tolerance-hint">
      放行阈值：|X|、|Y| 均 ≤ {{ toleranceText }} {{ symbol }}。
      完成前可撤回最近一次提交，其余已提交步骤不可回改。
    </p>

    <!-- 撤回入口：仅已有提交且仍在录入阶段时出现；确认后回到被撤回的色版角点 -->
    <div v-if="canUndo" class="undo-row">
      <button
        type="button"
        class="btn btn-secondary"
        data-testid="undo-last"
        @click="emit('undo')"
      >
        撤回上一步（{{ plateLabel(lastStep.plate) }} · {{ cornerLabel(lastStep.corner) }}）
      </button>
      <p class="hint undo-hint">
        刚提交的读数抄录有误？可撤回后回到该角点重新录入，会话编号与录入单位不变。
      </p>
      <p v-if="undoError" class="field-error undo-error" data-testid="undo-error" role="alert">
        {{ undoError }}
      </p>
    </div>
  </section>
</template>
