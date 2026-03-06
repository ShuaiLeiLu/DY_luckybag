<template>
  <n-card :bordered="false" class="card-container log-card">
    <template #header>
      <div class="card-header">
        <div class="header-title">
          <span class="title-icon"><n-icon size="15" color="#18a058"><terminal-outline /></n-icon></span>
          <span class="title-text">运行日志</span>
        </div>
        <div class="header-ops">
          <n-button quaternary circle size="tiny" @click="$emit('clear')"><n-icon><trash-outline /></n-icon></n-button>
        </div>
      </div>
    </template>
    <div ref="logContainer" class="card-inner log-scroll scroll-box">
      <div v-for="(log, index) in logs" :key="index" class="log-item" :class="log.type">
        <span class="log-time">{{ log.time }}</span>
        <span class="log-msg">{{ log.message }}</span>
      </div>
      <div v-if="logs.length === 0" class="log-empty">
        系统已启动成功，正在等待账号连接...
      </div>
      <div class="log-tail" aria-hidden="true"></div>
    </div>
  </n-card>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { NCard, NIcon, NButton } from 'naive-ui'
import TerminalOutline from '@vicons/ionicons5/es/TerminalOutline'
import TrashOutline from '@vicons/ionicons5/es/TrashOutline'

const props = defineProps({
  logs: {
    type: Array,
    required: true
  }
})

const emit = defineEmits(['clear'])
const logContainer = ref(null)
const isPinnedToBottom = ref(true)
const BOTTOM_THRESHOLD = 24

const updatePinnedState = () => {
  const el = logContainer.value
  if (!el) return
  const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
  isPinnedToBottom.value = distanceToBottom <= BOTTOM_THRESHOLD
}

const scrollToBottom = (behavior = 'smooth') => {
  nextTick(() => {
    if (logContainer.value) {
      const el = logContainer.value
      el.scrollTo({
        top: el.scrollHeight + 9999,
        behavior
      })
    }
  })
}

watch(() => props.logs.length, () => {
  if (isPinnedToBottom.value) {
    scrollToBottom('auto')
  }
})

onMounted(() => {
  const el = logContainer.value
  if (el) {
    el.addEventListener('scroll', updatePinnedState, { passive: true })
  }
  scrollToBottom('auto')
})

onUnmounted(() => {
  const el = logContainer.value
  if (el) {
    el.removeEventListener('scroll', updatePinnedState)
  }
})
</script>

<style scoped>
.card-container {
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96) 0%, rgba(248, 251, 255, 0.95) 100%);
  border: 1px solid #e1e8f1;
  border-radius: 16px;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.75) inset,
    0 14px 26px rgba(31, 41, 55, 0.08);
  overflow: hidden;
}
.log-card { height: 100%; min-height: 0; flex: 1; }
.card-container :deep(.n-card-header) {
  flex-shrink: 0;
  padding: 12px 14px;
  border-bottom: 1px solid #e7eef6;
}
.card-container :deep(.n-card__content) {
  display: flex;
  flex: 1;
  min-height: 0;
  padding: 0 !important;
}
.card-header { display: flex; align-items: center; justify-content: space-between; width: 100%; }
.header-title { display: flex; align-items: center; gap: 8px; }
.title-icon {
  width: 24px;
  height: 24px;
  border-radius: 8px;
  background: #e9f9f1;
  border: 1px solid #d7f1e3;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.title-text {
  font-size: 26px;
  font-weight: 700;
  line-height: 1;
  color: #1f2e42;
}
.header-ops { display: flex; align-items: center; gap: 6px; }
.card-inner {
  flex: 1;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  display: block;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
.scroll-box { overflow-y: auto; display: block; }
.log-scroll {
  margin: 10px;
  padding: 12px 12px 18px;
  border-radius: 14px;
  background:
    radial-gradient(120% 90% at 0% 0%, rgba(56, 107, 255, 0.12), transparent 40%),
    linear-gradient(180deg, #05142c 0%, #071735 100%);
  border: 1px solid #122a4f;
  flex-direction: column;
}
.log-item {
  margin-bottom: 8px;
  font-size: 12px;
  font-family: 'JetBrains Mono', monospace;
  display: flex;
  gap: 8px;
  line-height: 1.35;
}
.log-item:last-child {
  margin-bottom: 0;
}
.log-time { color: #7f8ba7; flex-shrink: 0; }
.log-msg { color: #d8e4ff; word-break: break-all; }
.log-item.error .log-msg { color: #ff7d87; }
.log-item.success .log-msg { color: #2de2a6; }
.log-item.warning .log-msg { color: #f5c66b; }
.log-empty { color: #9aacd1; text-align: center; padding-top: 40px; font-size: 12px; }
.log-tail {
  height: 12px;
}

.log-scroll {
  scrollbar-width: thin;
  scrollbar-color: #40587f transparent;
}

.log-scroll::-webkit-scrollbar {
  width: 8px;
}

.log-scroll::-webkit-scrollbar-thumb {
  background: #3d5478;
  border-radius: 999px;
}

.log-scroll::-webkit-scrollbar-track {
  background: transparent;
}

@media (max-width: 900px) {
  .log-card {
    min-height: 320px;
  }

  .title-text {
    font-size: 20px;
  }
}
</style>
