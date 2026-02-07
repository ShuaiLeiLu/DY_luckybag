<template>
  <n-config-provider :theme-overrides="themeOverrides">
    <div class="app-container">
      <!-- 左侧侧边栏 - 参数配置 -->
      <aside class="sidebar">
        <header class="header-base sidebar-header">
          <n-icon size="20" color="#18a058"><settings-outline /></n-icon>
          <h2 class="title-text">参数配置</h2>
        </header>

        <ConfigPanel :config="config" />

        <footer class="sidebar-footer">
          <n-button type="primary" block size="large" @click="addAccount" class="add-btn">
            <template #icon><n-icon><add-outline /></n-icon></template>
            添加账号
          </n-button>
        </footer>
      </aside>

      <!-- 右侧主体区域 -->
      <main class="main-content">
        <HeaderStats 
          :total-diamonds="totalDiamonds"
          :total-participation="totalParticipation"
          :total-winning="totalWinning"
        />

        <div class="content-body">
          <div class="column-left">
            <AccountList 
              :accounts="accounts"
              :running-count="runningCount"
              :columns="responsiveColumns"
            />
            <LotteryDetail :lotteries="mergedLotteries" @block="handleBlockRoom" />
          </div>

          <div class="column-right">
            <LogPanel :logs="logs" @clear="logs = []" />
          </div>
        </div>
      </main>
    </div>
  </n-config-provider>
</template>

<script setup>
import { ref, h, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { 
  NButton, NTag, NSpace, NConfigProvider, NIcon
} from 'naive-ui'
import {
  SettingsOutline, AddOutline
} from '@vicons/ionicons5'

// 导入提取的组件
import ConfigPanel from './components/ConfigPanel.vue'
import HeaderStats from './components/HeaderStats.vue'
import AccountList from './components/AccountList.vue'
import LotteryDetail from './components/LotteryDetail.vue'
import LogPanel from './components/LogPanel.vue'

import LotteryManager from './services/LotteryManager-lite'

const themeOverrides = {
  common: {
    primaryColor: '#18a058',
    primaryColorHover: '#36ad6a',
    borderRadius: '8px'
  },
  Card: {
    titleFontSizeMedium: '14px',
    headerPaddingMedium: '12px 16px'
  }
}

// 响应式状态
const windowWidth = ref(window.innerWidth)
const siderCollapsed = ref(false)

// 响应式计算
const isMobile = computed(() => windowWidth.value < 768)
const isTablet = computed(() => windowWidth.value >= 768 && windowWidth.value < 1024)

// 统计数据
const runningCount = computed(() => accounts.value.filter(a => a.state === 'running').length)
const totalParticipation = computed(() => accounts.value.reduce((sum, a) => sum + a.participationCount, 0))
const totalWinning = computed(() => accounts.value.reduce((sum, a) => sum + a.winningCount, 0))
const totalDiamonds = computed(() => accounts.value.reduce((sum, a) => sum + a.totalDiamonds, 0))

const mergedLotteries = computed(() => {
  const map = new Map()
  const allLists = Object.values(lotteriesByAccount.value || {})
  const all = allLists.flatMap(list => (Array.isArray(list) ? list : []))

  for (const item of all) {
    const roomId = item?.roomId ?? ''
    const lotteryId = item?.lottery_id ?? ''
    const key = `${roomId}_${lotteryId}`
    if (!key) continue

    const prev = map.get(key)
    if (!prev) {
      map.set(key, item)
      continue
    }

    const prevP = Number(prev?.predictedProbability || 0)
    const curP = Number(item?.predictedProbability || 0)
    if (curP > prevP) {
      map.set(key, item)
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    const ta = a?.end_time || 0
    const tb = b?.end_time || 0
    return ta - tb
  })
})

const config = ref({
  minProbability: 0.01,
  stayDuration: 5,
  enableRedPacket: true,
  hitRate: { enabled: true, value: 0.1 },
  secondInspect: { enabled: true, value: 0.05 },
  participationCount: { enabled: true, value: 80 },
  singleAccountDuration: { enabled: true, value: 3 },
  filterOnline: { enabled: false, value: 1000 },
  randomInteraction: { enabled: true }
})

const accounts = ref([])
const logs = ref([])
const lotteriesByAccount = ref({})
const lotteryManager = new LotteryManager()

let ipcRenderer = null
try {
  if (window.require) {
    const electron = window.require('electron')
    ipcRenderer = electron.ipcRenderer
  }
} catch (e) {
  console.error('无法加载 electron:', e)
}

// 监听串口大小
const handleResize = () => {
  windowWidth.value = window.innerWidth
}

onMounted(async () => {
  window.addEventListener('resize', handleResize)
  await loadAllAccounts()
  if (ipcRenderer) {
    // 监听浏览器窗口关闭事件
    ipcRenderer.on('browser-closed', (event, { accountId }) => {
      const account = accounts.value.find(a => a.id === accountId)
      if (account) {
        lotteryManager.stopAccount(accountId)
        account.state = 'paused'
        addLog(`⚠️ [${account.nickname}] 浏览器窗口已手动关闭，活动已停止`, 'warning')
      }
    })

    ipcRenderer.on('douyin-response', (event, { accountId, type, data }) => {
      const account = accounts.value.find(a => a.id === accountId)
      if (!account) return
      if (type === 'lottery' && data?.lottery_info?.win_status === 1) {
        account.winningCount++
        addLog(`🎉 [${account.nickname}] 恭喜！福袋中奖了！`, 'success')
      } else if (type === 'redpacket' && data?.receive_info?.is_win) {
        account.winningCount++
        addLog(`🧧 [${account.nickname}] 领取红包成功：${data.receive_info.amount || 0} 钻石`, 'success')
      } else if (type === 'wallet' && data?.diamond !== undefined) {
        account.totalDiamonds = data.diamond
      }
    })
  }
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
})

async function loadAllAccounts() {
  if (!ipcRenderer) return
  try {
    const result = await ipcRenderer.invoke('load-all-tokens')
    if (result.success && result.tokens) {
      Object.entries(result.tokens).forEach(([id, info]) => {
        accounts.value.push({
          id, nickname: info.nickname || `账号_${id}`, userId: info.userId || id,
          state: 'waiting', currentRoom: '', participationCount: 0, winningCount: 0,
          totalDiamonds: 0, token: info.sessionid || info.sessionid_ss
        })
      })
    }
  } catch (error) { addLog(`❌ 加载账号失败: ${error.message}`, 'error') }
}

const responsiveColumns = computed(() => [
  { title: 'ID', key: 'id', width: 110, ellipsis: { tooltip: true } },
  { title: '昵称', key: 'nickname', width: 100 },
  { 
    title: '状态', key: 'state', width: 90,
    render: (row) => {
      const map = { waiting: 'default', opened: 'info', running: 'success', paused: 'warning', error: 'error' }
      const text = { waiting: '等待', opened: '已打开', running: '运行', paused: '暂停', error: '错误' }
      return h(NTag, { type: map[row.state] || 'default', size: 'small' }, { default: () => text[row.state] || '等待' })
    }
  },
  { 
    title: '操作', key: 'actions', width: 180, fixed: 'right',
    render: (row) => h(NSpace, { size: 6 }, {
      default: () => [
        h(NButton, { size: 'tiny', type: row.state === 'running' ? 'warning' : 'primary', onClick: () => toggleAccount(row) }, { default: () => row.state === 'running' ? '暂停' : '启动' }),
        h(NButton, { size: 'tiny', type: 'info', onClick: () => refreshUserInfo(row.id), disabled: !row.token }, { default: () => '刷新' }),
        h(NButton, { size: 'tiny', type: 'error', onClick: () => removeAccount(row.id) }, { default: () => '删除' })
      ]
    })
  }
])

function addAccount() {
  let max = 0
  accounts.value.forEach(a => { const m = a.id.match(/account_(\d+)/); if(m) max = Math.max(max, parseInt(m[1])) })
  const next = max + 1
  const acc = { id: `account_${next}`, nickname: `账号${next}`, state: 'waiting', currentRoom: '', participationCount: 0, winningCount: 0, totalDiamonds: 0, token: null }
  accounts.value.push(acc)
  addLog(`账号 ${acc.nickname} 已添加，请扫码登录`)
  startAccountWithLogin(acc)
}

async function startAccountWithLogin(account) {
  if (!ipcRenderer) return
  try {
    const res = await ipcRenderer.invoke('launch-browser', account.id)
    if (!res.success) return addLog(`启动失败: ${res.error}`, 'error')
    account.state = 'opened'
    await ipcRenderer.invoke('navigate-to', { accountId: account.id, url: 'https://www.douyin.com' })
    const timer = setInterval(async () => {
      const tr = await ipcRenderer.invoke('get-login-token', account.id)
      if (tr.success && tr.isLoggedIn) {
        clearInterval(timer)
        let info = tr.userInfo
        if (!info?.nickname) {
          const ur = await ipcRenderer.invoke('get-user-info', account.id)
          if (ur.success) info = ur.userInfo
        }
        const sr = await ipcRenderer.invoke('save-token', { accountId: account.id, tokenInfo: tr.tokenInfo, userInfo: info })
        if (sr.success) {
          account.nickname = sr.savedInfo?.nickname || account.nickname
          account.token = tr.tokenInfo.sessionid || tr.tokenInfo.sessionid_ss
          account.state = 'waiting'
        }
      }
    }, 3000)
    setTimeout(() => clearInterval(timer), 60000)
  } catch (e) { addLog(`错误: ${e.message}`, 'error') }
}

function toggleAccount(account) {
  if (account.state === 'running') {
    lotteryManager.stopAccount(account.id)
    account.state = 'paused'
    addLog(`账号 ${account.nickname} 已暂停`)
  } else {
    startAccountScanning(account)
  }
}

async function startAccountScanning(account) {
  if (!account.token || !ipcRenderer) return
  try {
    const lr = await ipcRenderer.invoke('launch-browser', account.id)
    if (!lr.success) return
    const tr = await ipcRenderer.invoke('load-token', account.id)
    if (!tr.success) return
    await ipcRenderer.invoke('set-cookies', { accountId: account.id, tokenInfo: tr.tokenInfo })
    await ipcRenderer.invoke('navigate-to', { accountId: account.id, url: 'https://www.douyin.com' })
    account.state = 'running'
    lotteryManager.startAccount(account, config.value, {
      onStatusUpdate: (upd) => { const i = accounts.value.findIndex(a => a.id === upd.id); if(i !== -1) accounts.value[i] = { ...accounts.value[i], ...upd } },
      onLotteryListUpdate: ({ accountId, list }) => {
        const a = accounts.value.find(acc => acc.id === accountId)
        lotteriesByAccount.value = {
          ...lotteriesByAccount.value,
          [accountId]: (list || []).map(item => ({
          ...item,
          _scanAccountId: accountId,
          _scanAccountNickname: a?.nickname || accountId
          }))
        }
      },
      onLog: (m, t) => addLog(m, t)
    })
  } catch (e) { addLog(`启动失败: ${e.message}`, 'error') }
}

async function removeAccount(id) {
  if (!ipcRenderer) return
  lotteryManager.stopAccount(id)
  await ipcRenderer.invoke('delete-token', id)
  accounts.value = accounts.value.filter(a => a.id !== id)
  if (lotteriesByAccount.value?.[id]) {
    const next = { ...lotteriesByAccount.value }
    delete next[id]
    lotteriesByAccount.value = next
  }
}

function handleBlockRoom(roomId) {
  lotteryManager.addBlockList(roomId)
  // 同时也需要从当前 App 的 lotteriesByAccount 缓存中移除该直播间的福袋，保证 UI 立即更新
  Object.keys(lotteriesByAccount.value).forEach(accId => {
    lotteriesByAccount.value[accId] = lotteriesByAccount.value[accId].filter(l => l.roomId !== roomId)
  })
  addLog(`🚫 已屏蔽直播间: ${roomId}`)
}

async function refreshUserInfo(id) {
  if (!ipcRenderer) return
  try {
    const ir = await ipcRenderer.invoke('get-user-info', id)
    if (ir.success) {
      const a = accounts.value.find(acc => acc.id === id)
      if (a) a.nickname = ir.userInfo.nickname
    }
  } catch (e) {}
}

function addLog(message, type = 'info') {
  logs.value.push({ time: new Date().toLocaleTimeString(), message, type })
  if (logs.value.length > 100) logs.value.shift()
}
</script>

<style scoped>
.app-container {
  display: flex;
  width: 100vw;
  height: 100vh;
  background-color: #f5f7f9;
  overflow: hidden;
}

.header-base {
  height: 64px;
  background-color: #fff;
  border-bottom: 1px solid #efeff5;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  box-sizing: border-box;
}

/* 侧边栏样式 */
.sidebar {
  width: 280px;
  display: flex;
  flex-direction: column;
  background-color: #fff;
  border-right: 1px solid #efeff5;
  box-shadow: 2px 0 8px rgba(0,0,0,0.05);
  z-index: 10;
}
.sidebar-header {
  padding: 0 20px;
  gap: 8px;
}
.title-text {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.sidebar-footer {
  padding: 16px;
  border-top: 1px solid #efeff5;
  background-color: #fff;
  flex-shrink: 0;
}

/* 主体内容样式 */
.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 内容体布局 */
.content-body {
  flex: 1;
  padding: 20px;
  display: flex;
  gap: 20px;
  overflow: hidden;
  box-sizing: border-box;
}
.column-left {
  flex: 14;
  display: flex;
  flex-direction: column;
  gap: 20px;
  height: 100%;
}
.column-right {
  flex: 10;
  height: 100%;
}

.hide-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
.hide-scrollbar::-webkit-scrollbar { display: none; }
</style>
