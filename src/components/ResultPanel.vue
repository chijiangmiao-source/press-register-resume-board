<script setup lang="ts">
import { computed } from 'vue'
import { TOLERANCE } from '../registration/steps'
import { RESIDUAL_LIMIT, ADJUST_STEP } from '../registration/diagnosis'
import { cornerLabel, plateLabel } from '../registration/format'
import { formatUnitMagnitude, formatUnitOffset, UNIT_SYMBOL } from '../registration/units'
import type { UnitId, Verdict } from '../registration/types'
import type { RegistrationDiagnosis } from '../registration/diagnosis'

const props = defineProps<{
  verdict: Verdict
  diagnosis?: RegistrationDiagnosis
  unit: UnitId
}>()

const emit = defineEmits<{
  restart: []
}>()

const symbol = computed(() => UNIT_SYMBOL[props.unit])
const toleranceText = computed(() => formatUnitMagnitude(TOLERANCE, props.unit))
const residualLimitText = computed(() => formatUnitMagnitude(RESIDUAL_LIMIT, props.unit))
const adjustStepText = computed(() => formatUnitMagnitude(ADJUST_STEP, props.unit))
</script>

<template>
  <section class="panel result" data-testid="result-panel">
    <h2
      class="verdict"
      :class="verdict.pass ? 'verdict-pass' : 'verdict-fail'"
      data-testid="verdict-title"
    >
      {{ verdict.pass ? '可开印' : '需复调' }}
    </h2>

    <p v-if="verdict.pass" class="verdict-detail" data-testid="verdict-detail">
      八步共 16 个偏移量绝对值均不大于 {{ toleranceText }} {{ symbol }}，四色套准复测通过。
    </p>

    <template v-else>
      <p class="verdict-detail" data-testid="verdict-detail">
        以下色版角点偏移超出 {{ toleranceText }} {{ symbol }} 阈值（按测量顺序）：
      </p>
      <ul class="deviation-list" data-testid="deviation-list">
        <li
          v-for="d in verdict.deviations"
          :key="d.step.index"
          class="deviation-item"
          :data-testid="`deviation-${d.step.index}`"
        >
          <span class="deviation-point">
            第 {{ d.step.index + 1 }} 步 · {{ plateLabel(d.step.plate) }} ·
            {{ cornerLabel(d.step.corner) }}
          </span>
          <span class="deviation-values">
            <template v-if="d.axes.includes('x')">
              <strong :class="Math.abs(d.measurement.x) > TOLERANCE ? 'axis-bad' : ''">
                X = {{ formatUnitOffset(d.measurement.x, unit) }} {{ symbol }}
              </strong>
            </template>
            <template v-if="d.axes.includes('x') && d.axes.includes('y')">；</template>
            <template v-if="d.axes.includes('y')">
              <strong class="axis-bad">Y = {{ formatUnitOffset(d.measurement.y, unit) }} {{ symbol }}</strong>
            </template>
          </span>
        </li>
      </ul>

      <!-- 逐版复调诊断：区分整版平移（给反方向建议量）与角点不一致（不给建议量） -->
      <section
        v-if="diagnosis"
        class="diagnosis"
        data-testid="plate-diagnosis"
        aria-label="逐版校正建议"
      >
        <h3 class="diagnosis-title">
          逐版校正建议（四角平均偏移与残差判定，残差阈值 {{ residualLimitText }} {{ symbol }}）
        </h3>
        <ul class="diagnosis-list">
          <li
            v-for="p in diagnosis.plates"
            :key="p.plate"
            class="diagnosis-item"
            :class="p.uniform ? 'diagnosis-uniform' : 'diagnosis-inconsistent'"
            :data-testid="`diagnosis-${p.plate}`"
          >
            <p class="diagnosis-plate">
              <strong>{{ plateLabel(p.plate) }}</strong>
              <span class="diagnosis-mean" :data-testid="`diagnosis-mean-${p.plate}`">
                四角平均偏移：X = {{ formatUnitOffset(p.meanX, unit) }} {{ symbol }}，Y = {{ formatUnitOffset(p.meanY, unit) }} {{ symbol }}
              </span>
            </p>
            <p v-if="p.uniform" class="diagnosis-advice">
              <span class="diagnosis-kind" :data-testid="`diagnosis-kind-${p.plate}`">
                判定：整版平移。
              </span>
              建议整版
              <span class="advice-axis" :data-testid="`advice-x-${p.plate}`">
                X 调 {{ formatUnitOffset(p.advice!.x, unit) }} {{ symbol }}
              </span>
              、
              <span class="advice-axis" :data-testid="`advice-y-${p.plate}`">
                Y 调 {{ formatUnitOffset(p.advice!.y, unit) }} {{ symbol }}
              </span>
              （与平均偏移方向相反，按 {{ adjustStepText }} {{ symbol }} 给出）。
            </p>
            <p v-else class="diagnosis-advice">
              <span class="diagnosis-kind" :data-testid="`diagnosis-kind-${p.plate}`">
                判定：角点不一致，需逐角复测
              </span>
            </p>
          </li>
        </ul>
      </section>
    </template>

    <button
      type="button"
      class="btn btn-secondary"
      data-testid="restart-after-finish"
      @click="emit('restart')"
    >
      开始新会话
    </button>
  </section>
</template>
