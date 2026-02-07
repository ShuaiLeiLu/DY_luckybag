<template>
  <header class="header-base main-header">
    <div class="header-left">
      <div class="logo-box">
        <n-icon size="20" color="#fff"><gift-outline /></n-icon>
      </div>
      <div class="title-info">
        <div class="main-title">抖音福袋助手</div>
        <div class="status-indicator">
          <span class="dot"></span>
          <span class="status-text">系统运行正常</span>
        </div>
      </div>
    </div>

    <div class="header-right">
      <div class="stat-item">
        <span class="stat-label">今日收益</span>
        <span class="stat-value primary">¥{{ (totalDiamonds / 10).toFixed(2) }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">成功率</span>
        <span class="stat-value success">{{ totalParticipation > 0 ? ((totalWinning / totalParticipation) * 100).toFixed(1) : '0.0' }}%</span>
      </div>
      <div class="header-tools">
        <n-button quaternary circle size="small"><n-icon size="18"><shield-checkmark-outline /></n-icon></n-button>
        <n-button quaternary circle size="small"><n-icon size="18"><bar-chart-outline /></n-icon></n-button>
        <n-button quaternary circle size="small"><n-icon size="18"><flash-outline /></n-icon></n-button>
        <n-tag :bordered="false" round size="small" type="primary" class="version-tag">v1.0.0</n-tag>
      </div>
    </div>
  </header>
</template>

<script setup>
import { NIcon, NButton, NTag } from 'naive-ui'
import { GiftOutline, ShieldCheckmarkOutline, BarChartOutline, FlashOutline } from '@vicons/ionicons5'

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
  }
})
</script>

<style scoped>
.header-base {
  height: 64px;
  background-color: #fff;
  border-bottom: 1px solid #efeff5;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  box-sizing: border-box;
}
.main-header {
  padding: 0 24px;
  justify-content: space-between;
}
.header-left { display: flex; align-items: center; gap: 12px; }
.logo-box {
  width: 36px; height: 36px; background-color: #ff4d4f;
  border-radius: 8px; display: flex; align-items: center; justify-content: center;
}
.main-title { font-size: 15px; font-weight: 600; line-height: 1.2; }
.status-indicator { display: flex; align-items: center; gap: 4px; }
.dot { width: 6px; height: 6px; background-color: #18a058; border-radius: 50%; }
.status-text { font-size: 11px; color: #999; }

.header-right { display: flex; align-items: center; gap: 24px; }
.stat-item { display: flex; flex-direction: column; align-items: flex-end; }
.stat-label { font-size: 11px; color: #999; text-transform: uppercase; }
.stat-value { font-size: 15px; font-weight: 700; font-family: 'JetBrains Mono', monospace; }
.stat-value.primary { color: #333; }
.stat-value.success { color: #18a058; }
.header-tools { display: flex; align-items: center; gap: 12px; margin-left: 8px; }
.version-tag { font-family: monospace; }
</style>
