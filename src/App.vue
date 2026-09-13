<script setup lang="ts">
import { computed } from 'vue'
import { RegistrationStore } from './registration/store'
import { useSession } from './composables/useSession'
import { STEPS } from './registration/steps'
import { cornerLabel, formatDateTime, plateLabel, shortSessionId } from './registration/format'
import { UNIT_LABEL, UNIT_SYMBOL } from './registration/units'
import StartPanel from './components/StartPanel.vue'
import StepMeasure from './components/StepMeasure.vue'
import HistoryTable from './components/HistoryTable.vue'
import ResultPanel from './components/ResultPanel.vue'
import BlockedPanel from './components/BlockedPanel.vue'

// 整个应用只有这一个 store 实例：构造时即从 localStorage 恢复检查点。
const store = new RegistrationStore()
const {
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
  startNewSession,
  openStartPanel,
  resetCheckpoint,
  submitCurrent
} = useSession(store)

const isBlocked = computed(() => loadState.value.kind === 'error')
const blockedMessage = computed(() =>
  loadState.value.kind === 'error' ? loadState.value.message : ''
)
const currentStep = computed(() => (session.value ? STEPS[nextIndex.value] : undefined))
const progressItems = computed(() =>
  STEPS.map((step, i) => ({
    index: i,
    plate: plateLabel(step.plate),
    corner: cornerLabel(step.corner),
    done: session.value ? i < session.value.nextIndex : false,
    active: session.value !== undefined && i === nextIndex.value && !isComplete.value
  }))
)
</script>

<template>
  <div class="page">
    <header class="app-header">
      <h1>四色套准复测接力板</h1>
      <p class="subtitle">青版 / 品红版 八步复测 · 数据仅保存在本机浏览器，不联网</p>
    </header>

    <BlockedPanel
      v-if="isBlocked"
      :message="blockedMessage"
      @reset="resetCheckpoint"
    />

    <template v-else>
      <StartPanel
        v-if="!session || showStartPanel"
        :has-checkpoint="loadState.kind !== 'empty'"
        @start="startNewSession"
      />

      <template v-else>
        <section class="panel session-meta" data-testid="session-meta">
          <div class="meta-row">
            <span class="meta-label">会话编号</span>
            <code class="session-id" data-testid="session-id" :title="session.sessionId">
              {{ shortSessionId(session.sessionId) }}
            </code>
            <span class="meta-full-id">完整编号：<code>{{ session.sessionId }}</code></span>
          </div>
          <div class="meta-row">
            <span class="meta-label">创建时间</span>
            <span data-testid="session-created">{{ formatDateTime(session.createdAt) }}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">录入单位</span>
            <span data-testid="session-unit">
              {{ UNIT_LABEL[unit] }}（{{ UNIT_SYMBOL[unit] }}），会话期间锁定
            </span>
          </div>
          <div class="meta-row">
            <span class="meta-label">检查点</span>
            <span data-testid="checkpoint-info">
              已完成 {{ session.nextIndex }} / 8 步
              <template v-if="!isComplete && currentStep">
                ，下一步：{{ plateLabel(currentStep.plate) }} · {{ cornerLabel(currentStep.corner) }}
              </template>
            </span>
          </div>
        </section>

        <ol class="progress" data-testid="progress">
          <li
            v-for="item in progressItems"
            :key="item.index"
            class="progress-item"
            :class="{ done: item.done, active: item.active }"
            :data-testid="`progress-${item.index}`"
          >
            <span class="progress-index">{{ item.index + 1 }}</span>
            <span class="progress-label">{{ item.plate }}·{{ item.corner }}</span>
          </li>
        </ol>

        <ResultPanel
          v-if="isComplete && verdict"
          :verdict="verdict"
          :diagnosis="diagnosis"
          :unit="unit"
          @restart="openStartPanel"
        />

        <template v-else>
          <StepMeasure
            :next-index="nextIndex"
            :draft-x="draftX"
            :draft-y="draftY"
            :field-error="fieldError"
            :unit="unit"
            @update:draft-x="draftX = $event"
            @update:draft-y="draftY = $event"
            @submit="submitCurrent"
          />
          <HistoryTable :values="session.values" :unit="unit" />
        </template>
      </template>
    </template>

    <footer class="app-footer">
      刷新或关闭页面不会丢失进度；若本地记录损坏或版本不匹配，将明确阻断续作，绝不猜测进度。
    </footer>
  </div>
</template>
