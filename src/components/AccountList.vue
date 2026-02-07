<template>
  <n-card :bordered="false" class="card-container account-card">
    <template #header>
      <div class="card-header">
        <div class="header-title">
          <n-icon size="18" color="#3f5efb"><people-outline /></n-icon>
          <span>账号列表</span>
        </div>
        <n-tag :bordered="false" round size="tiny" type="info">{{ runningCount }} 在线</n-tag>
      </div>
    </template>
    <div class="card-inner scroll-box hide-scrollbar">
      <n-empty v-if="accounts.length === 0" description="暂无连接账号" style="margin: auto">
        <template #extra>请点击左下角“添加账号”开始使用</template>
      </n-empty>
      <n-data-table
        v-else
        :columns="columns"
        :data="accounts"
        :pagination="false"
        :bordered="false"
        size="small"
        class="custom-table"
      />
    </div>
  </n-card>
</template>

<script setup>
import { NCard, NIcon, NTag, NEmpty, NDataTable } from 'naive-ui'
import { PeopleOutline } from '@vicons/ionicons5'

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
  }
})
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
.account-card { height: 300px; flex-shrink: 0; }
.card-header { display: flex; align-items: center; justify-content: space-between; width: 100%; }
.header-title { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; }
.card-inner {
  flex: 1;
  overflow: hidden;
  display: flex;
}
.scroll-box { overflow-y: auto; display: block; }
.hide-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
.hide-scrollbar::-webkit-scrollbar { display: none; }

:deep(.custom-table .n-data-table-base-table-body) { scrollbar-width: none; }
:deep(.custom-table .n-data-table-base-table-body::-webkit-scrollbar) { display: none; }
</style>
