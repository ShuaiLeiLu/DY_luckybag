<template>
  <n-card :bordered="false" class="card-container account-card">
    <template #header>
      <div class="card-header">
        <div class="header-title">
          <span class="title-icon"><n-icon size="16" color="#12a268"><people-outline /></n-icon></span>
          <span class="title-text">账号列表</span>
        </div>
        <div class="header-actions">
          <n-tag :bordered="false" round size="small" class="online-tag">{{ runningCount }} 在线</n-tag>
          <n-button type="primary" size="small" class="add-account-btn" @click="$emit('add')">+ 添加账号</n-button>
        </div>
      </div>
    </template>
    <div class="card-inner scroll-box hide-scrollbar">
      <n-empty v-if="accounts.length === 0" description="暂无连接账号" style="margin: auto">
        <template #extra>请点击右上角“添加账号”开始使用</template>
      </n-empty>
      <n-data-table
        v-else
        :columns="columns"
        :data="accounts"
        :pagination="false"
        :bordered="false"
        size="small"
        :scroll-x="scrollX"
        class="custom-table"
      />
    </div>
  </n-card>
</template>

<script setup>
import { NCard, NIcon, NTag, NEmpty, NDataTable, NButton } from 'naive-ui'
import PeopleOutline from '@vicons/ionicons5/es/PeopleOutline'

const props = defineProps({
  accounts: {
    type: Array,
    required: true
  },
  runningCount: {
    type: Number,
    default: 0
  },
  columns: {
    type: Array,
    required: true
  },
  scrollX: {
    type: Number,
    default: 1000
  }
})

defineEmits(['add'])
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

.card-container :deep(.n-card-header) {
  padding: 12px 14px;
  border-bottom: 1px solid #e7eef6;
}

.card-container :deep(.n-card__content) {
  padding: 0 !important;
}

.account-card { height: 326px; flex-shrink: 0; }
.card-header { display: flex; align-items: center; justify-content: space-between; width: 100%; }
.header-title { display: flex; align-items: center; gap: 8px; }
.title-text {
  font-size: 26px;
  font-weight: 700;
  color: #1f2e42;
  line-height: 1;
}
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
.header-actions { display: flex; align-items: center; gap: 10px; }
.add-account-btn { border-radius: 10px; font-weight: 700; padding: 0 14px; height: 32px; }
.online-tag {
  color: #2a67c8;
  background: #e9f2ff;
  font-weight: 700;
}
.card-inner {
  flex: 1;
  overflow: hidden;
  display: flex;
  padding: 0 8px 8px;
}
.scroll-box { overflow-y: auto; display: block; }
.hide-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
.hide-scrollbar::-webkit-scrollbar { display: none; }

:deep(.custom-table .n-data-table-wrapper) {
  border: 1px solid #e6edf6;
  border-radius: 12px;
}

:deep(.custom-table .n-data-table-base-table-body) { scrollbar-width: none; }
:deep(.custom-table .n-data-table-base-table-body::-webkit-scrollbar) { display: none; }
:deep(.custom-table .n-data-table-th) {
  background: #f6f9fd;
  color: #5b6c81;
  font-weight: 700;
}
:deep(.custom-table .n-data-table-td) {
  border-bottom-color: #edf2f8;
}
:deep(.custom-table .n-data-table-tr:hover td) {
  background: #f0f8f4 !important;
}

@media (max-width: 900px) {
  .account-card {
    height: auto;
    min-height: 260px;
  }

  .title-text {
    font-size: 20px;
  }
}
</style>
