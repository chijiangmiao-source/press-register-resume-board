<script setup lang="ts">
import { computed } from 'vue'
import { STEPS } from '../registration/steps'
import { cornerLabel, plateLabel } from '../registration/format'
import { formatUnitOffset, UNIT_SYMBOL } from '../registration/units'
import type { Measurement, UnitId } from '../registration/types'

const props = defineProps<{
  values: Measurement[]
  unit: UnitId
}>()

const rows = computed(() =>
  props.values.map((measurement, i) => ({
    index: i,
    step: STEPS[i],
    measurement
  }))
)
const symbol = computed(() => UNIT_SYMBOL[props.unit])
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
          <th class="num">X ({{ symbol }})</th>
          <th class="num">Y ({{ symbol }})</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.index" :data-testid="`history-row-${row.index}`">
          <td>{{ row.index + 1 }}</td>
          <td>{{ plateLabel(row.step.plate) }}</td>
          <td>{{ cornerLabel(row.step.corner) }}</td>
          <td class="num">{{ formatUnitOffset(row.measurement.x, unit) }}</td>
          <td class="num">{{ formatUnitOffset(row.measurement.y, unit) }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
