<script setup lang="ts">
import { cornerLabel, formatOffset, plateLabel } from '../registration/format'
import type { Verdict } from '../registration/types'

defineProps<{
  verdict: Verdict
}>()

const emit = defineEmits<{
  restart: []
}>()
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
      八步共 16 个偏移量绝对值均不大于 0.15 mm，四色套准复测通过。
    </p>

    <template v-else>
      <p class="verdict-detail" data-testid="verdict-detail">
        以下色版角点偏移超出 0.15 mm 阈值（按测量顺序）：
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
              <strong :class="Math.abs(d.measurement.x) > 0.15 ? 'axis-bad' : ''">
                X = {{ formatOffset(d.measurement.x) }} mm
              </strong>
            </template>
            <template v-if="d.axes.includes('x') && d.axes.includes('y')">；</template>
            <template v-if="d.axes.includes('y')">
              <strong class="axis-bad">Y = {{ formatOffset(d.measurement.y) }} mm</strong>
            </template>
          </span>
        </li>
      </ul>
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
