<template>
  <header class="monitor-card">
    <div class="monitor-left">
      <div class="monitor-icon">
        <n-icon size="20" color="#fff"><gift-outline /></n-icon>
      </div>
      <div class="monitor-copy">
        <div class="monitor-title">监控中心</div>
        <div class="status-pill">
          <span class="dot"></span>
          <span class="status-text">系统运行正常</span>
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
      <div class="tool-group">
        <n-tag :bordered="false" round size="small" type="success" class="version-tag">v1.1.0</n-tag>
      </div>
    </div>
  </header>
</template>

<script setup>
import { computed } from 'vue'
import { NIcon, NTag } from 'naive-ui'
import GiftOutline from '@vicons/ionicons5/es/GiftOutline'

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
  }
})

const successRate = computed(() => {
  if (props.successRate !== null && props.successRate !== undefined && Number.isFinite(Number(props.successRate))) {
    return Number(props.successRate).toFixed(1)
  }
  if (!props.totalParticipation) return '0.0'
  return ((props.totalWinning / props.totalParticipation) * 100).toFixed(1)
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

.dot {
  width: 6px;
  height: 6px;
  background-color: #18a058;
  border-radius: 50%;
}

.status-text {
  font-size: 12px;
  color: #1b8f5c;
  font-weight: 700;
}

.monitor-right {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-left: auto;
  min-width: 0;
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
  padding: 0 8px 0 14px;
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
    width: 100%;
    justify-content: flex-end;
  }
}
</style>
