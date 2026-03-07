<template>
  <n-card :bordered="false" class="card-container log-card">
    <template #header>
      <div class="card-header">
        <div class="header-title">
          <span class="title-icon"><n-icon size="15" color="#18a058"><terminal-outline /></n-icon></span>
          <span class="title-text">{{ activeTab === 'logs' ? '运行日志' : '学习桶' }}</span>
        </div>
        <div class="header-ops">
          <div class="tab-strip">
            <button class="tab-btn" :class="{ active: activeTab === 'logs' }" @click="activeTab = 'logs'">日志</button>
            <button class="tab-btn" :class="{ active: activeTab === 'learning' }" @click="activeTab = 'learning'">学习</button>
          </div>
          <n-button v-if="activeTab === 'logs'" quaternary circle size="tiny" @click="$emit('clear')"><n-icon><trash-outline /></n-icon></n-button>
        </div>
      </div>
    </template>
    <div v-if="activeTab === 'logs'" ref="logContainer" class="card-inner log-scroll scroll-box">
      <div v-for="(log, index) in logsWithMeta" :key="index" class="log-item" :class="log.type">
        <span class="log-time">{{ log.time }}</span>
        <span class="log-badge" :class="log._badge.className">{{ log._badge.label }}</span>
        <span class="log-msg">{{ log.message }}</span>
      </div>
      <div v-if="logs.length === 0" class="log-empty">
        系统已启动成功，正在等待账号连接...
      </div>
      <div class="log-tail" aria-hidden="true"></div>
    </div>
    <div v-else class="card-inner learning-scroll">
      <div class="learning-summary" :class="{ offline: !learningConnected }">
        <div class="summary-pill">{{ learningConnected ? '学习在线' : '学习离线' }}</div>
        <div class="summary-metric">
          <span class="metric-label">样本</span>
          <span class="metric-value">{{ learningSummary.feedbackCount }}</span>
        </div>
        <div class="summary-metric">
          <span class="metric-label">校准</span>
          <span class="metric-value">{{ formatPercent(learningSummary.calibrationConfidence) }}</span>
        </div>
        <div class="summary-metric">
          <span class="metric-label">全局胜率修正</span>
          <span class="metric-value">{{ formatRatio(learningSummary.globalWinLift) }}</span>
        </div>
      </div>
      <div v-if="learningLoading" class="learning-empty">正在拉取学习桶数据...</div>
      <div v-else-if="!learningConnected && learningError" class="learning-empty">{{ learningError }}</div>
      <div v-else-if="learningRows.length === 0" class="learning-empty">暂无足够反馈样本</div>
      <div v-else class="learning-list">
        <div v-for="row in learningRows" :key="row.key" class="learning-item">
          <div class="learning-item-head">
            <span class="learning-name">{{ row.prizeClass }} / {{ row.remainBucket }}</span>
            <span class="learning-score">{{ row.multiplier }}</span>
          </div>
          <div class="learning-item-sub">
            <span>样本 {{ row.feedbackCount }}</span>
            <span>参与 {{ row.joinSuccess }}/{{ row.joinTotal }}</span>
            <span>开奖 {{ row.drawWon }}/{{ row.drawTotal }}</span>
          </div>
          <div class="learning-item-sub muted">
            <span>{{ row.probBucket }}</span>
            <span>{{ row.onlineBucket }}</span>
            <span>{{ row.crowdBucket }}</span>
          </div>
        </div>
      </div>
    </div>
  </n-card>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, nextTick, computed } from 'vue'
import { NCard, NIcon, NButton } from 'naive-ui'
import TerminalOutline from '@vicons/ionicons5/es/TerminalOutline'
import TrashOutline from '@vicons/ionicons5/es/TrashOutline'

const props = defineProps({
  logs: {
    type: Array,
    required: true
  },
  learning: {
    type: Object,
    default: () => ({
      connected: false,
      summary: null,
      items: [],
      error: ''
    })
  },
  learningLoading: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['clear'])
const logContainer = ref(null)
const isPinnedToBottom = ref(true)
const activeTab = ref('logs')
const BOTTOM_THRESHOLD = 24
const WIN_RE = /(中奖|恭喜|🎉|🧧.*成功|领取红包成功|中得)/i
const FAIL_RE = /(失败|错误|异常|超时|未中奖|放弃)/i
const WARN_RE = /(风控|告警|警告|降速|冷却)/i

/**
 * resolveBadge 方法：解析并返回目标项。
 */
function resolveBadge(log) {
  const message = String(log?.message || '')
  const type = String(log?.type || 'info')

  if (WIN_RE.test(message)) return { label: '中奖', className: 'badge-win' }
  if (type === 'error' || FAIL_RE.test(message)) return { label: '失败', className: 'badge-fail' }
  if (type === 'warning' || WARN_RE.test(message)) return { label: '告警', className: 'badge-warning' }
  return { label: '运行', className: 'badge-info' }
}

const logsWithMeta = computed(() => {
  return (props.logs || []).map((item) => ({
    ...item,
    _badge: resolveBadge(item)
  }))
})

const learningConnected = computed(() => props.learning?.connected === true)
const learningError = computed(() => String(props.learning?.error || ''))
const learningSummary = computed(() => {
  const source = props.learning?.summary || {}
  return {
    feedbackCount: Number(source.feedbackCount || 0),
    calibrationConfidence: Number(source.calibrationConfidence || 0),
    globalWinLift: Number(source.globalWinLift || 1)
  }
})
const learningRows = computed(() => {
  const source = Array.isArray(props.learning?.items) ? props.learning.items : []
  return source.slice(0, 20).map((item) => {
    const expected = Number(item.expectedWins || 0)
    const actual = Number(item.actualWins || 0)
    const ratio = expected > 0.2 ? (actual / Math.max(expected, 0.2)) : 1
    return {
      key: String(item.key || ''),
      prizeClass: String(item.prizeClass || 'unknown'),
      remainBucket: String(item.remainBucket || '-'),
      probBucket: String(item.probBucket || '-'),
      onlineBucket: String(item.onlineBucket || '-'),
      crowdBucket: String(item.crowdBucket || '-'),
      feedbackCount: Number(item.feedbackCount || 0),
      joinSuccess: Number(item.joinSuccess || 0),
      joinTotal: Number(item.joinSuccess || 0) + Number(item.joinFailed || 0),
      drawWon: Number(item.drawWon || 0),
      drawTotal: Number(item.drawWon || 0) + Number(item.drawLost || 0),
      multiplier: formatRatio(ratio)
    }
  })
})

function formatPercent(value) {
  return `${(Number(value || 0) * 100).toFixed(0)}%`
}

function formatRatio(value) {
  return `${Number(value || 1).toFixed(2)}x`
}

/**
 * updatePinnedState 方法：根据滚动位置更新“是否贴底”状态。
 */
const updatePinnedState = () => {
  const el = logContainer.value
  if (!el) return
  const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
  isPinnedToBottom.value = distanceToBottom <= BOTTOM_THRESHOLD
}

/**
 * scrollToBottom 方法：将日志容器滚动到最底部。
 */
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
  if (activeTab.value === 'logs' && isPinnedToBottom.value) {
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
.tab-strip {
  display: inline-flex;
  padding: 2px;
  border-radius: 999px;
  background: #edf3f9;
  border: 1px solid #deebf7;
}
.tab-btn {
  border: none;
  background: transparent;
  color: #6d7f94;
  font-size: 11px;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 999px;
  cursor: pointer;
}
.tab-btn.active {
  background: #ffffff;
  color: #1f2e42;
  box-shadow: 0 1px 3px rgba(31, 41, 55, 0.08);
}
.card-inner {
  flex: 1;
  height: auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  display: block;
  box-sizing: border-box;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
.scroll-box { overflow-y: auto; display: block; }
.log-scroll {
  margin: 10px 10px 12px;
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
  align-items: flex-start;
  gap: 8px;
  line-height: 1.35;
}
.log-item:last-child {
  margin-bottom: 0;
}
.log-time { color: #7f8ba7; flex-shrink: 0; }
.log-badge {
  flex-shrink: 0;
  min-width: 34px;
  height: 18px;
  line-height: 18px;
  padding: 0 6px;
  border-radius: 9px;
  border: 1px solid transparent;
  text-align: center;
  font-size: 10px;
  font-weight: 700;
}
.badge-win {
  color: #11c27b;
  background: rgba(17, 194, 123, 0.14);
  border-color: rgba(17, 194, 123, 0.34);
}
.badge-fail {
  color: #ff6f7f;
  background: rgba(255, 111, 127, 0.14);
  border-color: rgba(255, 111, 127, 0.36);
}
.badge-warning {
  color: #f5c66b;
  background: rgba(245, 198, 107, 0.14);
  border-color: rgba(245, 198, 107, 0.36);
}
.badge-info {
  color: #87a9e6;
  background: rgba(135, 169, 230, 0.12);
  border-color: rgba(135, 169, 230, 0.3);
}
.log-msg { color: #d8e4ff; word-break: break-all; }
.log-item.error .log-msg { color: #ff7d87; }
.log-item.success .log-msg { color: #2de2a6; }
.log-item.warning .log-msg { color: #f5c66b; }
.log-empty { color: #9aacd1; text-align: center; padding-top: 40px; font-size: 12px; }
.log-tail {
  height: 12px;
}

.learning-scroll {
  margin: 10px 10px 12px;
  padding: 10px;
  border-radius: 14px;
  background: linear-gradient(180deg, #f9fbfe 0%, #f3f7fb 100%);
  border: 1px solid #dce7f3;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.learning-summary {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.learning-summary.offline .summary-pill {
  background: #fff3f3;
  border-color: #ffd7dd;
  color: #cf5368;
}
.summary-pill,
.summary-metric {
  border-radius: 12px;
  border: 1px solid #dde8f3;
  background: #ffffff;
  padding: 8px 10px;
}
.summary-pill {
  grid-column: 1 / -1;
  font-size: 12px;
  font-weight: 700;
  color: #1b8f5c;
  background: #eaf8f0;
  border-color: #d7efdf;
}
.metric-label {
  display: block;
  font-size: 11px;
  color: #7d8da2;
}
.metric-value {
  display: block;
  margin-top: 2px;
  font-size: 18px;
  font-weight: 700;
  color: #1f2e42;
}
.learning-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.learning-item {
  padding: 9px 10px;
  border-radius: 12px;
  background: #ffffff;
  border: 1px solid #e1eaf4;
}
.learning-item-head,
.learning-item-sub {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.learning-item-head {
  margin-bottom: 4px;
}
.learning-name {
  font-size: 12px;
  font-weight: 700;
  color: #213248;
}
.learning-score {
  font-size: 12px;
  font-weight: 700;
  color: #18a058;
}
.learning-item-sub {
  font-size: 11px;
  color: #72839a;
}
.learning-item-sub.muted {
  margin-top: 2px;
  color: #97a6b8;
}
.learning-empty {
  color: #7e90a6;
  text-align: center;
  padding-top: 40px;
  font-size: 12px;
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
