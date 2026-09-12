<script setup lang="ts">
import { computed } from 'vue'
import { STEPS } from '../registration/steps'
import { cornerLabel, formatOffset, plateLabel } from '../registration/format'
import type { Measurement } from '../registration/types'

const props = defineProps<{
  values: Measurement[]
}>()

const rows = computed(() =>
  props.values.map((measurement, i) => ({
    index: i,
    step: STEPS[i],
    measurement
  }))
)
</script>

<template>
  <section class="panel history" data-testid="history-panel">
    <h3>已提交读数（不可回改）</h3>
    <table>
      <thead>
        <tr>
          <th>步</th>
          <th>色版</th>
          <th>角点</th>
          <th class="num">X (mm)</th>
          <th class="num">Y (mm)</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.index" :data-testid="`history-row-${row.index}`">
          <td>{{ row.index + 1 }}</td>
          <td>{{ plateLabel(row.step.plate) }}</td>
          <td>{{ cornerLabel(row.step.corner) }}</td>
          <td class="num">{{ formatOffset(row.measurement.x) }}</td>
          <td class="num">{{ formatOffset(row.measurement.y) }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
