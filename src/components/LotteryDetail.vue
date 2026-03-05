<template>
  <n-card :bordered="false" class="card-container lottery-card">
    <template #header>
      <div class="card-header">
        <div class="header-title">
          <n-icon size="18" color="#ff4d4f"><gift-outline /></n-icon>
          <span>福袋详情</span>
        </div>
        <div class="header-actions">
          <n-input
            v-model:value="searchKeyword"
            size="tiny"
            clearable
            placeholder="搜索主播/房间/福袋..."
            class="search-input"
          >
            <template #prefix><n-icon><search-outline /></n-icon></template>
          </n-input>
          <n-button quaternary circle size="tiny"><n-icon><ellipsis-horizontal-outline /></n-icon></n-button>
        </div>
      </div>
    </template>
    <div class="card-inner" :class="{ 'center-content': !filteredRows.length }">
      <n-empty v-if="!filteredRows.length" description="暂无福袋记录"></n-empty>
      <n-data-table
        v-else
        class="lottery-table"
        size="small"
        :bordered="false"
        :single-line="false"
        :columns="columns"
        :data="filteredRows"
        :pagination="false"
        :max-height="420"
      />
    </div>
  </n-card>
</template>

<script setup>
import { computed, h, ref } from 'vue'
import { NCard, NIcon, NInput, NButton, NEmpty, NDataTable, NTag } from 'naive-ui'
import { GiftOutline, SearchOutline, EllipsisHorizontalOutline } from '@vicons/ionicons5'

const props = defineProps({
  lotteries: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['block'])
const searchKeyword = ref('')

const displayRows = computed(() => {
  return (props.lotteries || []).map((l, idx) => ({
    _idx: idx + 1,
    ...l
  }))
})

const filteredRows = computed(() => {
  const keyword = searchKeyword.value.trim().toLowerCase()
  if (!keyword) return displayRows.value

  return displayRows.value.filter(row => {
    const matchFields = [
      row._scanAccountNickname,
      row.authorNickname,
      row.webRid,
      row.lotteryName,
      row.roomId
    ]
    return matchFields.some(v => String(v || '').toLowerCase().includes(keyword))
  })
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
  background-color: rgba(255, 255, 255, 0.92);
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(31, 41, 55, 0.08);
  overflow: hidden;
}
.lottery-card { flex: 1; min-height: 0; }
.card-header { display: flex; align-items: center; justify-content: space-between; width: 100%; }
.header-title { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; }
.header-actions { display: flex; gap: 8px; }
.search-input { width: 180px; }
.card-inner {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
}
.lottery-table {
  flex: 1;
  min-width: 0;
}
.center-content { align-items: center; justify-content: center; }

@media (max-width: 900px) {
  .search-input { width: 150px; }
  .header-actions { gap: 4px; }
}
</style>
