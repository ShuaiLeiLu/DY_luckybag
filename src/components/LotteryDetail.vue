<template>
  <n-card :bordered="false" class="card-container lottery-card">
    <template #header>
      <div class="card-header">
        <div class="header-main">
          <div class="header-title">
            <span class="title-icon"><n-icon size="16" color="#18a058"><gift-outline /></n-icon></span>
            <span class="title-text">福袋面板</span>
          </div>
          <div class="header-actions">
            <div class="segmented">
              <button
                class="seg-btn"
                :class="{ active: activeView === 'active' }"
                @click="activeView = 'active'"
              >
                正在参与
                <span class="seg-count">{{ activeRows.length }}</span>
              </button>
              <button
                class="seg-btn"
                :class="{ active: activeView === 'history' }"
                @click="activeView = 'history'"
              >
                历史记录
                <span class="seg-count">{{ historyRows.length }}</span>
              </button>
            </div>
          </div>
        </div>

        <div v-if="recentHistory.length" class="history-quick">
          <span class="quick-label">最近已抢</span>
          <span
            v-for="item in recentHistory"
            :key="`${item.accountId || item._idx}_${item.joinedAt || item._idx}`"
            class="history-chip"
            @click="activeView = 'history'"
          >
            {{ item.accountNickname || '账号' }} · {{ item.lotteryName || '福袋' }}
          </span>
        </div>
      </div>
    </template>
    <div class="card-inner" :class="{ 'center-content': !filteredRows.length }">
      <div v-if="!filteredRows.length" class="panel-empty">
        <div class="empty-icon-wrap">
          <n-icon size="38" color="#b4c0d4"><search-outline /></n-icon>
          <span class="pulse-dot"></span>
        </div>
        <div class="empty-title">{{ activeView === 'active' ? '正在努力寻找福袋...' : '暂无已抢福袋历史记录' }}</div>
        <div class="empty-desc">
          {{ activeView === 'active' ? '当前暂无符合条件的福袋' : '当成功参与福袋后，会自动记录到这里' }}
        </div>
      </div>
      <n-data-table
        v-else
        class="lottery-table"
        size="small"
        :bordered="false"
        :single-line="false"
        :columns="activeView === 'active' ? activeColumns : historyColumns"
        :data="filteredRows"
        :pagination="false"
      />
    </div>
  </n-card>
</template>

<script setup>
import { computed, h, ref } from 'vue'
import { NCard, NIcon, NButton, NDataTable, NTag } from 'naive-ui'
import GiftOutline from '@vicons/ionicons5/es/GiftOutline'
import SearchOutline from '@vicons/ionicons5/es/SearchOutline'

const props = defineProps({
  lotteries: {
    type: Array,
    default: () => []
  },
  historyRecords: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['block'])
const activeView = ref('active')

const activeRows = computed(() => {
  return (props.lotteries || []).map((l, idx) => ({
    _idx: idx + 1,
    ...l
  }))
})

const historyRows = computed(() => {
  return (props.historyRecords || [])
    .filter(item => String(item?.joinStatus || 'success') !== 'failed')
    .map((item, idx) => ({
      _idx: idx + 1,
      ...item
    }))
})

const recentHistory = computed(() => historyRows.value.slice(0, 4))

const filteredRows = computed(() => {
  return activeView.value === 'active' ? activeRows.value : historyRows.value
})

const activeColumns = computed(() => [
  { title: '#', key: '_idx', width: 44 },
  { title: '账号', key: '_scanAccountNickname', width: 104, ellipsis: { tooltip: true } },
  { title: '主播', key: 'authorNickname', width: 104, ellipsis: { tooltip: true } },
  { title: '房间', key: 'webRid', width: 110, ellipsis: { tooltip: true } },
  { title: '福袋', key: 'lotteryName', ellipsis: { tooltip: true } },
  {
    title: '概率',
    key: 'predictedProbability',
    width: 86,
    render: (row) => {
      const p = Number(row.predictedProbability || 0) * 100
      const text = `${p.toFixed(2)}%`
      const type = p >= 10 ? 'success' : p >= 5 ? 'warning' : 'default'
      return h(NTag, { size: 'small', type }, { default: () => text })
    }
  },
  {
    title: '开奖',
    key: 'end_time',
    width: 86,
    render: (row) => {
      if (!row.end_time) return '-'
      const d = new Date(row.end_time * 1000)
      return d.toLocaleTimeString()
    }
  },
  {
    title: '操作',
    key: 'actions',
    width: 70,
    fixed: 'right',
    render: (row) => h(NButton, {
      size: 'tiny',
      quaternary: true,
      type: 'error',
      onClick: () => emit('block', row.roomId)
    }, { default: () => '屏蔽' })
  }
])

const historyColumns = computed(() => [
  { title: '#', key: '_idx', width: 44 },
  { title: '账号', key: 'accountNickname', width: 104, ellipsis: { tooltip: true } },
  { title: '主播', key: 'authorNickname', width: 104, ellipsis: { tooltip: true } },
  { title: '福袋', key: 'lotteryName', ellipsis: { tooltip: true } },
  {
    title: '概率',
    key: 'predictedProbability',
    width: 86,
    render: (row) => {
      const p = Number(row.predictedProbability || 0) * 100
      const text = `${p.toFixed(2)}%`
      const type = p >= 10 ? 'success' : p >= 5 ? 'warning' : 'default'
      return h(NTag, { size: 'small', type }, { default: () => text })
    }
  },
  {
    title: '方式',
    key: 'joinMode',
    width: 72,
    render: (row) => {
      const text = row.joinMode || 'API'
      return h(NTag, { size: 'small', type: text === 'UI' ? 'success' : 'info' }, { default: () => text })
    }
  },
  {
    title: '结果',
    key: 'resultStatus',
    width: 76,
    render: (row) => {
      const status = String(row.resultStatus || 'pending')
      const isWon = status === 'won'
      const isLost = status === 'lost'
      const text = isWon ? '成功' : (isLost ? '失败' : '待开奖')
      const reason = row.resultReason || (isWon ? '中奖' : (isLost ? '未中奖' : '待开奖'))
      return h(
        'span',
        { title: reason },
        [
          h(
            NTag,
            { size: 'small', type: isWon ? 'success' : (isLost ? 'error' : 'default') },
            { default: () => text }
          )
        ]
      )
    }
  },
  {
    title: '参与时间',
    key: 'joinedAt',
    width: 100,
    render: (row) => {
      if (!row.joinedAt) return '-'
      return new Date(row.joinedAt).toLocaleTimeString()
    }
  },
  {
    title: '预计开奖',
    key: 'endTime',
    width: 100,
    render: (row) => {
      if (!row.endTime) return '-'
      return new Date(row.endTime).toLocaleTimeString()
    }
  }
])
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
.lottery-card { flex: 1; min-height: 0; }
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
  overflow: hidden;
}
.card-header {
  display: flex;
  flex-direction: column;
  gap: 9px;
  width: 100%;
}

.header-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.header-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.title-icon {
  width: 26px;
  height: 26px;
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
  color: #1f2e42;
  line-height: 1;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.segmented {
  display: inline-flex;
  align-items: center;
  border-radius: 12px;
  background: #f1f5fb;
  border: 1px solid #dce6f2;
  padding: 3px;
  gap: 4px;
}

.seg-btn {
  height: 31px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: #607188;
  font-size: 12px;
  font-weight: 700;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  transition: all 0.18s ease;
}

.seg-btn.active {
  background: #ffffff;
  color: #203145;
  box-shadow: 0 2px 8px rgba(34, 61, 89, 0.12);
}

.seg-count {
  min-width: 20px;
  height: 18px;
  border-radius: 999px;
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #e8eef8;
  color: #5f7085;
}

.seg-btn.active .seg-count {
  background: #e7f7ef;
  color: #15965f;
}

.history-quick {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 2px;
}

.quick-label {
  flex-shrink: 0;
  color: #7c8ba0;
  font-size: 12px;
  font-weight: 700;
}

.history-chip {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  height: 22px;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-radius: 999px;
  border: 1px solid #dce7f4;
  padding: 0 10px;
  font-size: 11px;
  color: #4a5d74;
  background: #f6f9fd;
  cursor: pointer;
  transition: all 0.16s ease;
}

.history-chip:hover {
  color: #24405f;
  border-color: #c7d7e8;
  background: #eef4fb;
}

.card-inner {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}

.card-inner::-webkit-scrollbar {
  width: 8px;
}

.card-inner::-webkit-scrollbar-thumb {
  background: #d3ddeb;
  border-radius: 999px;
}

.card-inner::-webkit-scrollbar-track {
  background: transparent;
}
.panel-empty {
  margin: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  color: #7e8ca1;
}
.empty-icon-wrap {
  width: 62px;
  height: 62px;
  border-radius: 16px;
  background: #f1f5fb;
  border: 1px solid #e3eaf5;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}
.pulse-dot {
  position: absolute;
  right: 8px;
  top: 8px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #19b377;
  box-shadow: 0 0 0 3px rgba(25, 179, 119, 0.18);
}
.empty-title {
  margin-top: 14px;
  font-size: 16px;
  font-weight: 700;
  color: #415269;
}
.empty-desc {
  margin-top: 8px;
  font-size: 12px;
}
.lottery-table {
  flex: 1;
  min-width: 0;
}
.center-content { align-items: center; justify-content: center; }

:deep(.lottery-table .n-data-table-wrapper) {
  border: 1px solid #e8eef6;
  border-radius: 0 0 12px 12px;
}

:deep(.lottery-table .n-data-table-th) {
  background: #f6f9fd;
  color: #5b6c81;
  font-weight: 700;
}

:deep(.lottery-table .n-data-table-td) {
  border-bottom-color: #edf2f8;
}

:deep(.lottery-table .n-data-table-tr:hover td) {
  background: #f1f8f4 !important;
}

@media (max-width: 900px) {
  .title-text {
    font-size: 20px;
  }

  .header-main {
    flex-direction: column;
    align-items: flex-start;
  }

  .header-actions {
    width: 100%;
    justify-content: space-between;
  }
}
</style>
