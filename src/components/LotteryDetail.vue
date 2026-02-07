<template>
  <n-card :bordered="false" class="card-container lottery-card">
    <template #header>
      <div class="card-header">
        <div class="header-title">
          <n-icon size="18" color="#ff4d4f"><gift-outline /></n-icon>
          <span>福袋详情</span>
        </div>
        <div class="header-actions">
          <n-input size="tiny" placeholder="搜索直播间..." class="search-input">
            <template #prefix><n-icon><search-outline /></n-icon></template>
          </n-input>
          <n-button quaternary circle size="tiny"><n-icon><ellipsis-horizontal-outline /></n-icon></n-button>
        </div>
      </div>
    </template>
    <div class="card-inner" :class="{ 'center-content': !displayRows.length }">
      <n-empty v-if="!displayRows.length" description="暂无福袋记录"></n-empty>
      <n-data-table
        v-else
        class="lottery-table"
        size="small"
        :bordered="false"
        :single-line="false"
        :columns="columns"
        :data="displayRows"
        :pagination="false"
      />
    </div>
  </n-card>
</template>

<script setup>
import { computed, h } from 'vue'
import { NCard, NIcon, NInput, NButton, NEmpty, NDataTable, NTag } from 'naive-ui'
import { GiftOutline, SearchOutline, EllipsisHorizontalOutline } from '@vicons/ionicons5'

const props = defineProps({
  lotteries: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['block'])

const displayRows = computed(() => {
  return (props.lotteries || []).map((l, idx) => ({
    _idx: idx + 1,
    ...l
  }))
})

const columns = computed(() => [
  { title: '#', key: '_idx', width: 44 },
  { title: '账号', key: '_scanAccountNickname', width: 90, ellipsis: { tooltip: true } },
  { title: '主播', key: 'authorNickname', width: 90, ellipsis: { tooltip: true } },
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
</script>

<style scoped>
.card-container {
  display: flex;
  flex-direction: column;
  background-color: #fff;
  border-radius: 12px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.03);
  overflow: hidden;
}
.lottery-card { flex: 1; }
.card-header { display: flex; align-items: center; justify-content: space-between; width: 100%; }
.header-title { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; }
.header-actions { display: flex; gap: 8px; }
.search-input { width: 140px; }
.card-inner {
  flex: 1;
  overflow: hidden;
  display: flex;
}
.lottery-table {
  flex: 1;
  overflow: hidden;
}
.center-content { align-items: center; justify-content: center; }
</style>
