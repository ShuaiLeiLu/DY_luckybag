<template>
  <header class="monitor-card">
    <div class="monitor-left">
      <div class="monitor-icon">
        <n-icon size="20" color="#fff"><gift-outline /></n-icon>
      </div>
      <div class="monitor-copy">
        <div class="monitor-title">监控中心</div>
        <div class="status-pill" :class="licenseClassName">
          <span class="dot"></span>
          <span class="status-text">{{ licenseText }}</span>
        </div>
      </div>
    </div>

    <div class="monitor-right">
      <div class="stat-grid">
        <div class="stat-item">
          <span class="stat-label">今日收益（抖币）</span>
          <span class="stat-value primary">{{ totalDiamonds }}</span>
          <span class="stat-sub">累计参与 {{ totalParticipation }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">成功率</span>
          <span class="stat-value success">{{ successRate }}%</span>
          <span class="stat-sub">累计中奖 {{ totalWinning }}</span>
        </div>
      </div>
      <div v-if="dispatchSummary.enabled" class="dispatch-strip">
        <span class="dispatch-pill" :class="{ offline: !dispatchSummary.connected }">
          {{ dispatchSummary.connected ? '服务端在线' : '服务端离线' }}
        </span>
        <span class="dispatch-pill">池 {{ dispatchSummary.validCandidates }}</span>
        <span class="dispatch-pill">可分配 {{ dispatchSummary.availableCandidates }}</span>
        <span class="dispatch-pill">已租约 {{ dispatchSummary.leaseCount }}</span>
        <span class="dispatch-pill">本端 {{ dispatchSummary.clientLeaseCount }}</span>
      </div>
      <div class="tool-group">
        <button class="license-button" :class="licenseButtonClass" @click="$emit('open-license')">
          {{ licenseButtonText }}
        </button>
        <n-tag :bordered="false" round size="small" type="success" class="version-tag">v2.0</n-tag>
      </div>
    </div>
  </header>
</template>

<script setup>
import { computed } from 'vue'
import { NIcon, NTag } from 'naive-ui'
import GiftOutline from '@vicons/ionicons5/es/GiftOutline'

defineEmits(['open-license'])

const props = defineProps({
  totalDiamonds: {
    type: Number,
    default: 0
  },
  totalParticipation: {
    type: Number,
    default: 0
  },
  totalWinning: {
    type: Number,
    default: 0
  },
  successRate: {
    type: Number,
    default: null
  },
  dispatchSummary: {
    type: Object,
    default: () => ({
      enabled: false,
      connected: false,
      validCandidates: 0,
      availableCandidates: 0,
      leaseCount: 0,
      clientLeaseCount: 0
    })
  },
  licenseStatus: {
    type: Object,
    default: () => ({
      enabled: false,
      available: false,
      authorized: false,
      state: 'disabled',
      message: '未启用授权',
      expireAt: 0
    })
  }
})

const successRate = computed(() => {
  if (props.successRate !== null && props.successRate !== undefined && Number.isFinite(Number(props.successRate))) {
    return Number(props.successRate).toFixed(1)
  }
  if (!props.totalParticipation) return '0.0'
  return ((props.totalWinning / props.totalParticipation) * 100).toFixed(1)
})

const licenseText = computed(() => {
  const info = props.licenseStatus || {}
  if (info.enabled !== true) return '未启用授权'
  if (info.available === false) return info.message || '授权服务不可用'
  if (info.authorized !== true) {
    if (info.state === 'expired') return '授权已过期'
    return info.message || '未授权'
  }
  const expireAt = Number(info.expireAt || 0)
  if (expireAt > 0) {
    const d = new Date(expireAt)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `授权至 ${y}-${m}-${day}`
  }
  return '授权有效'
})

const licenseClassName = computed(() => {
  const info = props.licenseStatus || {}
  if (info.enabled !== true) return 'status-pill--warning'
  if (info.available === false) return 'status-pill--danger'
  if (info.authorized !== true) {
    return info.state === 'expired' ? 'status-pill--danger' : 'status-pill--warning'
  }
  const expireAt = Number(info.expireAt || 0)
  if (expireAt > 0 && (expireAt - Date.now()) <= 7 * 24 * 60 * 60 * 1000) {
    return 'status-pill--warning'
  }
  return 'status-pill--success'
})

const licenseButtonText = computed(() => {
  const info = props.licenseStatus || {}
  if (info.enabled !== true) return '授权'
  if (info.authorized === true) return '续期'
  return '激活'
})

const licenseButtonClass = computed(() => {
  const info = props.licenseStatus || {}
  if (info.enabled !== true || info.authorized !== true) return 'license-button--warning'
  return 'license-button--normal'
})
</script>

<style scoped>
.monitor-card {
  min-height: 84px;
  margin: 14px 16px 0;
  padding: 12px 16px;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  border: 1px solid #e0e8f2;
  border-radius: 16px;
  box-shadow:
    0 1px 0 #fff inset,
    0 12px 24px rgba(30, 41, 59, 0.08);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  box-sizing: border-box;
}

.monitor-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 220px;
}

.monitor-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: linear-gradient(140deg, #20c280 0%, #16975e 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 10px 24px rgba(24, 160, 88, 0.26);
}

.monitor-title {
  font-size: 29px;
  font-weight: 700;
  letter-spacing: 0.2px;
  color: #132233;
  line-height: 1;
}

.status-pill {
  margin-top: 6px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  background: #e8f8f0;
  border: 1px solid #d3efdf;
}

.status-pill--success {
  background: #e8f8f0;
  border-color: #d3efdf;
}

.status-pill--warning {
  background: #fff7e8;
  border-color: #f4ddb1;
}

.status-pill--danger {
  background: #fff1f1;
  border-color: #f3cccc;
}

.dot {
  width: 6px;
  height: 6px;
  background-color: #18a058;
  border-radius: 50%;
}

.status-pill--warning .dot {
  background-color: #d99100;
}

.status-pill--danger .dot {
  background-color: #e05252;
}

.status-text {
  font-size: 12px;
  color: #1b8f5c;
  font-weight: 700;
}

.status-pill--warning .status-text {
  color: #b27100;
}

.status-pill--danger .status-text {
  color: #c74646;
}

.monitor-right {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-left: auto;
  min-width: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  min-width: 0;
}

.stat-item {
  min-width: 148px;
  padding: 2px 16px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  border-right: 1px solid #ebeff5;
  gap: 1px;
}

.stat-label {
  font-size: 14px;
  color: #8291a4;
  font-weight: 600;
}

.stat-value {
  font-size: 38px;
  font-weight: 700;
  font-family: 'JetBrains Mono', monospace;
  line-height: 1.05;
}

.stat-value.primary {
  color: #1f2d3d;
}

.stat-value.success {
  color: #18a058;
}

.stat-sub {
  font-size: 12px;
  color: #9aa6b7;
}

.tool-group {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px 0 14px;
}

.license-button {
  border: 1px solid #d8e2ef;
  background: #fff;
  color: #516173;
  border-radius: 999px;
  font-size: 12px;
  line-height: 1;
  padding: 7px 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.18s ease;
}

.license-button:hover {
  border-color: #b8c7d9;
  color: #2f3f52;
}

.license-button--warning {
  background: #fff7e8;
  border-color: #f4ddb1;
  color: #b27100;
}

.license-button--warning:hover {
  border-color: #e9c97d;
  color: #9e6500;
}

.license-button--normal {
  background: #f8fafc;
}

.dispatch-strip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.dispatch-pill {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  background: #eef4fb;
  border: 1px solid #d9e5f2;
  color: #56708b;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.dispatch-pill.offline {
  background: #fff3f0;
  border-color: #ffd6cf;
  color: #d85b46;
}

.version-tag {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  letter-spacing: 0.2px;
}

@media (max-width: 900px) {
  .monitor-card {
    margin: 12px 12px 0;
    padding: 12px;
    flex-wrap: wrap;
    gap: 10px;
  }

  .monitor-title {
    font-size: 26px;
  }

  .monitor-right {
    width: 100%;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
  }

  .stat-grid {
    width: 100%;
  }

  .stat-item {
    min-width: 0;
    border-right: 0;
    padding: 0;
  }

  .stat-value {
    font-size: 24px;
  }

  .tool-group {
    padding: 0;
    justify-content: flex-end;
  }
}
</style>
