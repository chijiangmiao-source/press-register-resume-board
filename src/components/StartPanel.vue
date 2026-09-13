<script setup lang="ts">
import { ref } from 'vue'
import { UNIT_LABEL, UNIT_SYMBOL } from '../registration/units'
import type { UnitId } from '../registration/types'

defineProps<{
  hasCheckpoint: boolean
}>()

const emit = defineEmits<{
  start: [unit: UnitId]
}>()

/** 本次会话的录入单位，默认毫米；随“开始新会话”提交后锁定。 */
const selectedUnit = ref<UnitId>('mm')
</script>

<template>
  <section class="panel" data-testid="start-panel">
    <h2>四色套准复测接力板</h2>
    <p class="lead">
      一次会话固定依次测量 <strong>青版</strong>、<strong>品红版</strong>，每版按
      <strong>左上 → 右上 → 右下 → 左下</strong> 提交，共八步。
      录入各色版角点相对黑版的 X、Y 偏移。
    </p>
    <ul class="rules">
      <li>
        毫米：允许范围 −2.00 ~ +2.00 mm，精确到 0.01 mm；
        微米：允许范围 −2000 ~ +2000 µm，精确到 10 µm。两值均合法才能提交推进。
      </li>
      <li>录入单位在开始新会话时选定并锁定，进行中的会话不可中途更改。</li>
      <li>已提交步骤不可回改；每步提交后立即在本机保存检查点。</li>
      <li>刷新或关闭后重开，将停在同一步继续，旧读数不会丢失。</li>
      <li>八步完成后：所有 |X|、|Y| ≤ 0.15 mm（150 µm）显示“可开印”，否则显示“需复调”。</li>
    </ul>
    <fieldset class="unit-select" data-testid="unit-select">
      <legend>本次会话录入单位（开始后锁定）</legend>
      <label class="unit-option">
        <input
          v-model="selectedUnit"
          type="radio"
          name="unit"
          value="mm"
          data-testid="unit-mm"
        />
        {{ UNIT_LABEL.mm }}（{{ UNIT_SYMBOL.mm }}）
      </label>
      <label class="unit-option">
        <input
          v-model="selectedUnit"
          type="radio"
          name="unit"
          value="um"
          data-testid="unit-um"
        />
        {{ UNIT_LABEL.um }}（{{ UNIT_SYMBOL.um }}）
      </label>
    </fieldset>
    <button
      type="button"
      class="btn btn-primary"
      data-testid="start-new"
      @click="emit('start', selectedUnit)"
    >
      {{ hasCheckpoint ? '清除旧检查点并开始新会话' : '开始新会话' }}
    </button>
  </section>
</template>
