<template>
  <n-card :bordered="false" class="card-container log-card">
    <template #header>
      <div class="card-header">
        <div class="header-title">
          <n-icon size="18"><terminal-outline /></n-icon>
          <span>运行日志</span>
        </div>
        <n-button quaternary circle size="tiny" @click="$emit('clear')"><n-icon><trash-outline /></n-icon></n-button>
      </div>
    </template>
    <div ref="logContainer" class="card-inner log-scroll scroll-box hide-scrollbar">
      <div v-for="(log, index) in logs" :key="index" class="log-item" :class="log.type">
        <span class="log-time">{{ log.time }}</span>
        <span class="log-msg">{{ log.message }}</span>
      </div>
      <div v-if="logs.length === 0" class="log-empty">
        系统已启动成功，正在等待账号连接...
      </div>
    </div>
  </n-card>
</template>

<script setup>
import { ref, onMounted, watch, nextTick } from 'vue'
import { NCard, NIcon, NButton } from 'naive-ui'
import { TerminalOutline, TrashOutline } from '@vicons/ionicons5'

const props = defineProps({
  logs: {
    type: Array,
    required: true
  }
})

const emit = defineEmits(['clear'])
const logContainer = ref(null)

const scrollToBottom = () => {
  nextTick(() => {
    if (logContainer.value) {
      const el = logContainer.value
      el.scrollTo({
        top: el.scrollHeight,
        behavior: 'smooth'
      })
    }
  })
}

watch(() => props.logs, () => {
  scrollToBottom()
}, { deep: true })

onMounted(() => {
  scrollToBottom()
})
</script>

<style scoped>
.card-container {
  display: flex;
  flex-direction: column;
  background-color: rgba(255, 255, 255, 0.92);
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(31, 41, 55, 0.08);
  overflow: hidden;
}
.log-card { height: 100%; min-height: 0; flex: 1; }
.card-container :deep(.n-card-header) { flex-shrink: 0; }
.card-container :deep(.n-card__content) {
  display: flex;
  flex: 1;
  min-height: 0;
  padding: 0 !important;
}
.card-header { display: flex; align-items: center; justify-content: space-between; width: 100%; }
.header-title { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; }
.card-inner {
  flex: 1;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  display: block;
}
.scroll-box { overflow-y: auto; display: block; }
.log-scroll { padding: 12px; background-color: #f8fbf9; flex-direction: column; }
.log-item { margin-bottom: 6px; font-size: 12px; font-family: 'JetBrains Mono', monospace; display: flex; gap: 8px; }
.log-time { color: #ccc; flex-shrink: 0; }
.log-msg { color: #555; word-break: break-all; }
.log-item.error .log-msg { color: #ff4d4f; }
.log-item.success .log-msg { color: #18a058; }
.log-empty { color: #ccc; text-align: center; padding-top: 40px; font-size: 12px; }

.hide-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
.hide-scrollbar::-webkit-scrollbar { display: none; }

@media (max-width: 900px) {
  .log-card {
    min-height: 320px;
  }
}
</style>
