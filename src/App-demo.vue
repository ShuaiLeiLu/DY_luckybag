<template>
  <n-config-provider :theme-overrides="themeOverrides">
    <n-layout style="height: 100vh">
      <n-layout-header bordered style="height: 60px; padding: 0 20px; display: flex; align-items: center; justify-content: space-between">
        <h2 style="margin: 0">🎁 抖音福袋自动参与助手</h2>
        <n-tag type="warning">演示模式 - Playwright 浏览器下载中</n-tag>
      </n-layout-header>
      
      <n-layout has-sider style="height: calc(100vh - 60px)">
        <n-layout-sider bordered :width="320" style="padding: 16px; overflow-y: auto">
          <n-space vertical :size="16">
            <n-card title="⚙️ 配置设置" size="small" :bordered="false">
              <n-space vertical :size="14">
                <div>
                  <div style="margin-bottom: 8px; font-size: 14px; color: #666; font-weight: 500">最小在线人数</div>
                  <n-input-number 
                    v-model:value="config.minOnline" 
                    :min="0" 
                    :step="100"
                    placeholder="1000"
                    style="width: 100%"
                    :show-button="true"
                  >
                    <template #suffix>
                      <span style="color: #999; font-size: 12px">人</span>
                    </template>
                  </n-input-number>
                </div>
                <div>
                  <div style="margin-bottom: 8px; font-size: 14px; color: #666; font-weight: 500">最小中奖概率</div>
                  <n-input-number 
                    v-model:value="config.minProbability" 
                    :min="0" 
                    :max="1" 
                    :step="0.01"
                    placeholder="0.01"
                    style="width: 100%"
                    :show-button="true"
                  >
                    <template #suffix>
                      <span style="color: #999; font-size: 12px">%</span>
                    </template>
                  </n-input-number>
                </div>
                <div>
                  <div style="margin-bottom: 8px; font-size: 14px; color: #666; font-weight: 500">停留时长</div>
                  <n-input-number 
                    v-model:value="config.stayDuration" 
                    :min="0"
                    :step="1"
                    placeholder="5"
                    style="width: 100%"
                    :show-button="true"
                  >
                    <template #suffix>
                      <span style="color: #999; font-size: 12px">秒</span>
                    </template>
                  </n-input-number>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0">
                  <span style="font-size: 14px; color: #666; font-weight: 500">启用红包</span>
                  <n-switch v-model:value="config.enableRedPacket" />
                </div>
              </n-space>
            </n-card>
            
            <n-button type="primary" size="large" block @click="addAccount">
              <template #icon>
                <span style="font-size: 18px">+</span>
              </template>
              添加账号
            </n-button>
            
            <n-alert type="info" title="💡 提示" :bordered="false">
              当前为演示模式，请等待 Playwright 浏览器下载完成后重启应用
            </n-alert>
            
            <n-card title="📊 统计信息" size="small" :bordered="false">
              <n-space vertical :size="8">
                <div style="display: flex; justify-content: space-between">
                  <span style="color: #666">账号总数：</span>
                  <span style="font-weight: bold">{{ accounts.length }}</span>
                </div>
                <div style="display: flex; justify-content: space-between">
                  <span style="color: #666">运行中：</span>
                  <span style="font-weight: bold; color: #18a058">{{ runningCount }}</span>
                </div>
                <div style="display: flex; justify-content: space-between">
                  <span style="color: #666">总参与次数：</span>
                  <span style="font-weight: bold">{{ totalParticipation }}</span>
                </div>
                <div style="display: flex; justify-content: space-between">
                  <span style="color: #666">总中奖次数：</span>
                  <span style="font-weight: bold; color: #f0a020">{{ totalWinning }}</span>
                </div>
                <div style="display: flex; justify-content: space-between">
                  <span style="color: #666">总钻石数：</span>
                  <span style="font-weight: bold; color: #d03050">{{ totalDiamonds }}</span>
                </div>
              </n-space>
            </n-card>
          </n-space>
        </n-layout-sider>
        
        <n-layout-content style="padding: 16px; overflow-y: auto">
          <n-grid :cols="2" x-gap="16" y-gap="16">
            <n-grid-item>
              <n-card title="👥 账号列表" size="small" :bordered="false">
                <n-empty 
                  v-if="accounts.length === 0"
                  description="暂无账号，点击左侧按钮添加账号"
                  style="padding: 40px 0"
                />
                <n-data-table
                  v-else
                  :columns="columns"
                  :data="accounts"
                  :pagination="false"
                  :bordered="false"
                  :single-line="false"
                />
              </n-card>
            </n-grid-item>
            
            <n-grid-item>
              <n-card title="📝 运行日志" size="small" :bordered="false">
                <div style="height: 350px; overflow-y: auto; font-family: 'Monaco', 'Menlo', 'Consolas', monospace; font-size: 13px; background: #fafafa; padding: 12px; border-radius: 6px; border: 1px solid #e0e0e0">
                  <div v-for="(log, index) in logs" :key="index" :style="{ 
                    color: log.type === 'error' ? '#d03050' : log.type === 'success' ? '#18a058' : '#333',
                    marginBottom: '6px',
                    lineHeight: '1.6'
                  }">
                    <span style="color: #999; font-weight: 500">[{{ log.time }}]</span> 
                    <span :style="{ fontWeight: log.type !== 'info' ? '500' : 'normal' }">{{ log.message }}</span>
                  </div>
                </div>
              </n-card>
            </n-grid-item>
          </n-grid>
        </n-layout-content>
      </n-layout>
    </n-layout>
  </n-config-provider>
</template>

<script setup>
import { ref, h, computed } from 'vue'
import { NButton, NTag, NSpace } from 'naive-ui'

const themeOverrides = {
  common: {
    primaryColor: '#18a058'
  }
}

// 计算统计数据
const runningCount = computed(() => {
  return accounts.value.filter(a => a.state === 'running').length
})

const totalParticipation = computed(() => {
  return accounts.value.reduce((sum, a) => sum + a.participationCount, 0)
})

const totalWinning = computed(() => {
  return accounts.value.reduce((sum, a) => sum + a.winningCount, 0)
})

const totalDiamonds = computed(() => {
  return accounts.value.reduce((sum, a) => sum + a.totalDiamonds, 0)
})

const config = ref({
  minOnline: 1000,
  minProbability: 0.01,
  stayDuration: 5,
  enableRedPacket: true
})

const accounts = ref([])
const logs = ref([
  { time: new Date().toLocaleTimeString(), message: '欢迎使用抖音福袋助手', type: 'info' },
  { time: new Date().toLocaleTimeString(), message: '正在等待 Playwright 浏览器下载...', type: 'info' },
  { time: new Date().toLocaleTimeString(), message: '下载完成后请重启应用以使用完整功能', type: 'info' }
])

const columns = [
  { title: 'ID', key: 'id', width: 120, ellipsis: { tooltip: true } },
  { title: '昵称', key: 'nickname', width: 130 },
  { 
    title: '状态', 
    key: 'state',
    width: 100,
    render: (row) => {
      const stateMap = {
        'waiting': { text: '等待中', type: 'default' },
        'running': { text: '运行中', type: 'info' },
        'paused': { text: '已暂停', type: 'warning' },
        'error': { text: '错误', type: 'error' }
      }
      const state = stateMap[row.state] || stateMap.waiting
      return h(NTag, { type: state.type, size: 'small' }, { default: () => state.text })
    }
  },
  { title: '当前直播间', key: 'currentRoom', width: 140, ellipsis: { tooltip: true } },
  { title: '参与', key: 'participationCount', width: 70, align: 'center' },
  { title: '中奖', key: 'winningCount', width: 70, align: 'center' },
  { title: '钻石', key: 'totalDiamonds', width: 80, align: 'center' },
  { 
    title: '操作', 
    key: 'actions',
    width: 160,
    fixed: 'right',
    render: (row) => {
      return h(NSpace, { size: 8 }, {
        default: () => [
          h(NButton, 
            { 
              size: 'small', 
              type: row.state === 'running' ? 'warning' : 'primary',
              onClick: () => toggleAccount(row)
            }, 
            { default: () => row.state === 'running' ? '暂停' : '启动' }
          ),
          h(NButton, 
            { 
              size: 'small', 
              type: 'error',
              onClick: () => removeAccount(row.id)
            }, 
            { default: () => '删除' }
          )
        ]
      })
    }
  }
]

let accountIdCounter = 1

function addAccount() {
  const account = {
    id: `account_${accountIdCounter++}`,
    nickname: `演示账号${accountIdCounter - 1}`,
    state: 'waiting',
    currentRoom: '',
    participationCount: 0,
    winningCount: 0,
    totalDiamonds: 0
  }
  
  accounts.value.push(account)
  addLog(`账号 ${account.nickname} 已添加（演示模式）`)
  
  // 模拟运行
  setTimeout(() => {
    account.state = 'running'
    account.currentRoom = '测试直播间'
    addLog(`${account.nickname} 开始运行`)
  }, 2000)
}

function toggleAccount(account) {
  if (account.state === 'running') {
    account.state = 'paused'
    addLog(`账号 ${account.nickname} 已暂停`)
  } else {
    account.state = 'running'
    addLog(`账号 ${account.nickname} 已启动`)
  }
}

function removeAccount(accountId) {
  const account = accounts.value.find(a => a.id === accountId)
  accounts.value = accounts.value.filter(a => a.id !== accountId)
  addLog(`账号 ${account.nickname} 已删除`)
}

function addLog(message, type = 'info') {
  const time = new Date().toLocaleTimeString()
  logs.value.push({ time, message, type })
  if (logs.value.length > 100) {
    logs.value.shift()
  }
}
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}
</style>
