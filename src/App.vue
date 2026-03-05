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
              :scroll-x="accountTableScrollX"
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
import { ref, h, computed, onMounted, onUnmounted } from 'vue'
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
// 响应式计算
const isMobile = computed(() => windowWidth.value < 768)

// 统计数据
const runningCount = computed(() => accounts.value.filter(a => a.state === 'running').length)
const totalParticipation = computed(() => accounts.value.reduce((sum, a) => sum + a.participationCount, 0))
const totalWinning = computed(() => accounts.value.reduce((sum, a) => sum + a.lotteryWinCount, 0))
const totalDiamonds = computed(() => accounts.value.reduce((sum, a) => sum + a.todayEarnedDiamonds, 0))

const mergedLotteries = computed(() => {
  const map = new Map()
  const allLists = Object.values(lotteriesByAccount.value || {})
  const all = allLists
    .flatMap(list => (Array.isArray(list) ? list : []))
    .filter(item => !(config.value.filterFanClub?.enabled && hasFanClubRequirement(item)))

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
  filterFanClub: { enabled: true },
  participationCount: { enabled: true, value: 80 },
  singleAccountDuration: { enabled: true, value: 3 },
  filterOnline: { enabled: false, value: 1000 },
  randomInteraction: { enabled: true },
  closeLiveStream: { enabled: true }
})

const accounts = ref([])
const logs = ref([])
const lotteriesByAccount = ref({})
const lotteryManager = new LotteryManager()

function getTodayKey() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function createAccountModel(base = {}) {
  return {
    id: base.id || '',
    nickname: base.nickname || '',
    userId: base.userId || base.id || '',
    state: base.state || 'waiting',
    currentRoom: base.currentRoom || '',
    token: base.token || null,
    participationCount: Number(base.participationCount || 0),
    lotteryWinCount: Number(base.lotteryWinCount || 0),
    redPacketWinCount: Number(base.redPacketWinCount || 0),
    todayLotteryWinCount: Number(base.todayLotteryWinCount || 0),
    todayRedPacketWinCount: Number(base.todayRedPacketWinCount || 0),
    todayEarnedDiamonds: Number(base.todayEarnedDiamonds || 0),
    totalDiamonds: Number(base.totalDiamonds || 0),
    lastWalletDiamond: base.lastWalletDiamond ?? null,
    statsDateKey: base.statsDateKey || getTodayKey()
  }
}

function ensureDailyStats(account) {
  const todayKey = getTodayKey()
  if (account.statsDateKey !== todayKey) {
    account.todayLotteryWinCount = 0
    account.todayRedPacketWinCount = 0
    account.todayEarnedDiamonds = 0
    account.statsDateKey = todayKey
  }
}

function hasFanClubRequirement(lottery) {
  const conditions = Array.isArray(lottery?.conditions) ? lottery.conditions : []
  return conditions.some(c => {
    const typeNum = Number(c?.type)
    const content = String(c?.content || '')
    return typeNum === 2 || content.includes('粉丝团')
  })
}

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
  lotteryManager.setCategoryList(lotteryManager.getAllCategories().slice(0, 3))
  lotteryManager.setScanConfig({ countPerPage: 12, pagesPerCategory: 4 })
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
      ensureDailyStats(account)
      if (type === 'lottery' && data?.lottery_info?.win_status === 1) {
        account.lotteryWinCount++
        account.todayLotteryWinCount++
        addLog(`🎉 [${account.nickname}] 恭喜！福袋中奖了！`, 'success')
      } else if (type === 'redpacket' && data?.receive_info?.is_win) {
        account.redPacketWinCount++
        account.todayRedPacketWinCount++
        addLog(`🧧 [${account.nickname}] 领取红包成功：${data.receive_info.amount || 0} 钻石`, 'success')
      } else if (type === 'wallet' && data?.diamond !== undefined) {
        const currentWallet = Number(data.diamond || 0)
        if (account.lastWalletDiamond !== null && currentWallet > account.lastWalletDiamond) {
          account.todayEarnedDiamonds += (currentWallet - account.lastWalletDiamond)
        }
        account.lastWalletDiamond = currentWallet
        account.totalDiamonds = currentWallet
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
        const match = id.match(/account_(\d+)/)
        const fallbackNickname = match ? `账号${match[1]}` : `账号_${id}`
        accounts.value.push(createAccountModel({
          id,
          nickname: info.nickname || fallbackNickname,
          userId: info.userId || id,
          state: 'waiting',
          token: info.sessionid || info.sessionid_ss
        }))
      })
    }
  } catch (error) { addLog(`❌ 加载账号失败: ${error.message}`, 'error') }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

async function resolveUserInfoWithRetry(accountId, fromLoginToken = null) {
  if (!ipcRenderer) return fromLoginToken || null
  if (fromLoginToken?.nickname) return fromLoginToken

  for (let i = 0; i < 4; i++) {
    try {
      const ur = await ipcRenderer.invoke('get-user-info', accountId)
      if (ur.success && ur.userInfo?.nickname) return ur.userInfo
    } catch (_) {}
    await sleep(1200)
  }
  return fromLoginToken || null
}

const responsiveColumns = computed(() => {
  const actionFixed = isMobile.value ? undefined : 'right'
  const compact = windowWidth.value < 1360

  const base = [
    { title: '昵称', key: 'nickname', width: isMobile.value ? 92 : 120, ellipsis: { tooltip: true } },
    {
      title: '状态', key: 'state', width: isMobile.value ? 74 : 90,
      render: (row) => {
        const map = { waiting: 'default', opened: 'info', running: 'success', paused: 'warning', error: 'error' }
        const text = { waiting: '等待', opened: '已打开', running: '运行', paused: '暂停', error: '错误' }
        return h(NTag, { type: map[row.state] || 'default', size: 'small' }, { default: () => text[row.state] || '等待' })
      }
    },
    {
      title: '统计',
      key: 'stats',
      width: compact ? 160 : 230,
      render: (row) => {
        const rate = row.participationCount > 0
          ? ((row.lotteryWinCount / row.participationCount) * 100).toFixed(1)
          : '0.0'
        const text = compact
          ? `参${row.participationCount} 中${row.lotteryWinCount} 成${rate}% 收¥${(Number(row.todayEarnedDiamonds || 0) / 10).toFixed(2)}`
          : `参与${row.participationCount} 福袋中${row.lotteryWinCount} 红包中${row.redPacketWinCount} 成功率${rate}% 收益¥${(Number(row.todayEarnedDiamonds || 0) / 10).toFixed(2)}`
        return h('span', { style: 'font-family: JetBrains Mono, monospace; font-size: 12px;' }, text)
      }
    }
  ]

  base.push({
    title: '操作',
    key: 'actions',
    width: compact ? 120 : 220,
    fixed: actionFixed,
    render: (row) => compact
      ? h(NButton, {
        size: 'small',
        type: row.state === 'running' ? 'warning' : 'primary',
        onClick: () => toggleAccount(row)
      }, { default: () => row.state === 'running' ? '暂停' : '启动' })
      : h(NSpace, { size: 6 }, {
        default: () => [
          h(NButton, { size: 'tiny', type: row.state === 'running' ? 'warning' : 'primary', onClick: () => toggleAccount(row) }, { default: () => row.state === 'running' ? '暂停' : '启动' }),
          h(NButton, { size: 'tiny', type: 'info', onClick: () => refreshUserInfo(row.id), disabled: !row.token }, { default: () => '刷新' }),
          h(NButton, { size: 'tiny', type: 'error', onClick: () => removeAccount(row.id) }, { default: () => '删除' })
        ]
      })
  })

  return base
})

const accountTableScrollX = computed(() => {
  return responsiveColumns.value.reduce((sum, col) => sum + Number(col.width || 120), 0) + 40
})

function addAccount() {
  let max = 0
  accounts.value.forEach(a => { const m = a.id.match(/account_(\d+)/); if(m) max = Math.max(max, parseInt(m[1])) })
  const next = max + 1
  const acc = createAccountModel({
    id: `account_${next}`,
    nickname: `账号${next}`,
    state: 'waiting',
    token: null
  })
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
        const info = await resolveUserInfoWithRetry(account.id, tr.userInfo)
        const fallbackInfo = {
          nickname: account.nickname,
          userId: account.userId || account.id
        }
        let saveResult = await ipcRenderer.invoke('save-token', { accountId: account.id, tokenInfo: tr.tokenInfo, userInfo: info })
        if (!saveResult.success) {
          saveResult = await ipcRenderer.invoke('save-token', { accountId: account.id, tokenInfo: tr.tokenInfo, userInfo: fallbackInfo })
        }

        const finalNickname = info?.nickname || saveResult.savedInfo?.nickname || account.nickname
        const finalUserId = info?.userId || saveResult.savedInfo?.userId || account.userId || account.id
        account.nickname = finalNickname
        account.userId = finalUserId
        account.token = tr.tokenInfo.sessionid || tr.tokenInfo.sessionid_ss
        account.state = 'waiting'

        if (saveResult.success) {
          addLog(`✅ [${finalNickname}] 登录成功`, 'success')
        } else {
          addLog(`⚠️ [${finalNickname}] 登录成功，但本地保存信息不完整`, 'warning')
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
        const filteredList = (list || []).filter(item => !(config.value.filterFanClub?.enabled && hasFanClubRequirement(item)))
        lotteriesByAccount.value = {
          ...lotteriesByAccount.value,
          [accountId]: filteredList.map(item => ({
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
      if (a) {
        a.nickname = ir.userInfo.nickname
        if (ir.userInfo.userId) a.userId = ir.userInfo.userId
      }
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
  background:
    radial-gradient(1200px 500px at -10% -20%, rgba(24, 160, 88, 0.14), transparent 65%),
    radial-gradient(900px 600px at 110% 0%, rgba(255, 122, 24, 0.1), transparent 60%),
    linear-gradient(180deg, #f7faf8 0%, #f2f5f3 100%);
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
  width: 292px;
  display: flex;
  flex-direction: column;
  background-color: rgba(255, 255, 255, 0.92);
  border-right: 1px solid #e7ece8;
  box-shadow: 0 10px 30px rgba(31, 41, 55, 0.08);
  backdrop-filter: blur(8px);
  z-index: 10;
}
.sidebar-header {
  padding: 0 18px;
  gap: 8px;
}
.title-text {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.sidebar-footer {
  padding: 14px 16px 18px;
  border-top: 1px solid #eef2ef;
  background-color: rgba(255, 255, 255, 0.9);
  flex-shrink: 0;
}

/* 主体内容样式 */
.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

/* 内容体布局 */
.content-body {
  flex: 1;
  padding: 16px 18px 18px;
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(320px, 1fr);
  gap: 16px;
  overflow: hidden;
  box-sizing: border-box;
  min-height: 0;
}
.column-left {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  min-width: 0;
  min-height: 0;
}
.column-right {
  display: flex;
  min-width: 0;
  height: 100%;
  min-height: 0;
}

@media (max-width: 1200px) {
  .content-body {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(300px, auto) minmax(280px, 38vh);
  }
}

@media (max-width: 900px) {
  .app-container {
    flex-direction: column;
    height: auto;
    min-height: 100vh;
    overflow: auto;
  }

  .sidebar {
    width: 100%;
    border-right: 0;
    border-bottom: 1px solid #e7ece8;
  }

  .main-content {
    min-height: 0;
  }

  .content-body {
    padding: 12px;
    gap: 12px;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto auto;
    overflow: visible;
  }

  .column-left,
  .column-right {
    height: auto;
    min-height: 320px;
  }
}

.hide-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
.hide-scrollbar::-webkit-scrollbar { display: none; }
</style>
