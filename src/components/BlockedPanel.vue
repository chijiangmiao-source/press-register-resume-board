<script setup lang="ts">
defineProps<{
  message: string
}>()

const emit = defineEmits<{
  reset: []
}>()
</script>

<template>
  <section class="panel panel-danger" data-testid="blocked-panel">
    <h2 data-testid="blocked-title">本地检查点不可用，续作已阻断</h2>
    <p class="danger-message" data-testid="blocked-message">
      {{ message }}
    </p>
    <p class="hint">
      为避免漏检色版或重复采用旧读数，系统不会猜测当前进度。
      请核对测量记录后重置，再开始新会话。
    </p>
    <button
      type="button"
      class="btn btn-danger"
      data-testid="reset-checkpoint"
      @click="emit('reset')"
    >
      重置本地检查点
    </button>
  </section>
</template>
