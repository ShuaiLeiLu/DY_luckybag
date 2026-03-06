<template>
  <n-config-provider :theme-overrides="themeOverrides" class="app-root">
    <div class="desktop-shell">
      <div class="window-frame">
        <div class="app-container">
          <aside class="sidebar">
            <header class="header-base sidebar-header">
              <n-icon size="20" color="#18a058"><settings-outline /></n-icon>
              <h2 class="title-text">参数配置</h2>
            </header>
            <ConfigPanel :config="config" />
          </aside>

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
                  @add="addAccount"
                />
                <LotteryDetail
                  :lotteries="mergedLotteries"
                  :history-records="lotteryHistory"
                  @block="handleBlockRoom"
                />
              </div>

              <div class="column-right">
                <LogPanel :logs="logs" @clear="logs = []" />
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  </n-config-provider>
</template>

<script setup>
import { ref, h, computed, watch, onMounted, onUnmounted } from 'vue'
import { 
  NButton, NTag, NConfigProvider, NIcon
} from 'naive-ui'
import SettingsOutline from '@vicons/ionicons5/es/SettingsOutline'

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
    borderRadius: '12px',
    fontFamily: "'SF Pro Display', 'PingFang SC', 'MiSans', 'Helvetica Neue', sans-serif"
  },
  Card: {
    titleFontSizeMedium: '14px'
  },
  Input: {
    heightSmall: '32px'
  },
  DataTable: {
    thPaddingSmall: '10px 12px',
    tdPaddingSmall: '10px 12px'
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

const lotteryManager = new LotteryManager()
const initialPoolServerConfig = lotteryManager.getPoolServerConfig()

const config = ref({
  minProbability: 0.01,
  stayDuration: 5,
  enableRedPacket: true,
  hitRate: { enabled: true, value: 0.1 },
  secondInspect: { enabled: true, value: 0.05 },
  filterFanClub: { enabled: true },
  onlyPhysicalPrize: { enabled: false },
  preferBigRedPacket: { enabled: true, threshold: 40 },
  participationCount: { enabled: true, value: 80 },
  singleAccountDuration: { enabled: true, value: 3 },
  filterOnline: { enabled: false, value: 1000 },
  randomInteraction: { enabled: true },
  closeLiveStream: { enabled: true },
  poolServer: {
    enabled: initialPoolServerConfig.enabled !== false,
    url: initialPoolServerConfig.url || ''
  }
})

const accounts = ref([])
const logs = ref([])
const lotteriesByAccount = ref({})
const lotteryHistory = ref([])

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
    nickname: normalizeNickname(base.nickname || ''),
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

let ipcRenderer = null
try {
  if (window.electronAPI) {
    ipcRenderer = window.electronAPI
  }
} catch (e) {
  console.error('无法加载 electron:', e)
}

const ipcUnsubscribers = []

// 监听串口大小
const handleResize = () => {
  windowWidth.value = window.innerWidth
}

onMounted(async () => {
  window.addEventListener('resize', handleResize)
  lotteryManager.setScanConfig({ countPerPage: 15, pagesPerCategory: 12, allCount: 24 })
  lotteryManager.setPoolServerConfig(config.value.poolServer, { silent: true })
  await loadAllAccounts()
  if (ipcRenderer) {
    // 监听浏览器窗口关闭事件
    const offBrowserClosed = ipcRenderer.on('browser-closed', ({ accountId }) => {
      const account = accounts.value.find(a => a.id === accountId)
      if (account) {
        lotteryManager.stopAccount(accountId)
        account.state = 'paused'
        addLog(`⚠️ [${account.nickname}] 浏览器窗口已手动关闭，活动已停止`, 'warning')
      }
    })
    ipcUnsubscribers.push(offBrowserClosed)

    const offDouyinResponse = ipcRenderer.on('douyin-response', ({ accountId, type, data }) => {
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
    ipcUnsubscribers.push(offDouyinResponse)
  }
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  ipcUnsubscribers.forEach(off => {
    try { off && off() } catch (_) {}
  })
  ipcUnsubscribers.length = 0
})

watch(
  () => [config.value.poolServer?.enabled, config.value.poolServer?.url],
  ([enabled, url]) => {
    lotteryManager.setPoolServerConfig({
      enabled: enabled !== false,
      url: url || ''
    }, { silent: true })
  }
)

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
          nickname: normalizeNickname(info.nickname || fallbackNickname),
          userId: info.userId || id,
          state: 'waiting',
          token: info.sessionid || info.sessionid_ss
        }))
      })
    }
  } catch (error) { addLog(`❌ 加载账号失败: ${error.message}`, 'error') }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

function normalizeNickname(name) {
  const text = String(name || '').trim()
  if (!text) return ''
  if (text.length >= 2 && text[0] === text[1]) return text.slice(1)
  return text
}

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
  const compact = windowWidth.value < 1480

  const base = [
    {
      title: '昵称',
      key: 'nickname',
      width: isMobile.value ? 82 : 98,
      ellipsis: { tooltip: true },
      render: (row) => {
        const displayName = normalizeNickname(row.nickname || '')
        return h('span', { class: 'account-name-text', title: displayName || '' }, displayName || '未命名账号')
      }
    },
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
      width: compact ? 166 : 228,
      render: (row) => {
        const rate = row.participationCount > 0
          ? ((row.lotteryWinCount / row.participationCount) * 100).toFixed(1)
          : '0.0'
        const todayDiamonds = Number(row.todayEarnedDiamonds || 0)
        const partText = compact
          ? `参 ${row.participationCount} · 中 ${row.lotteryWinCount}`
          : `参与 ${row.participationCount} · 福袋中 ${row.lotteryWinCount} · 红包中 ${row.redPacketWinCount}`
        return h('div', { class: 'account-stats-cell' }, [
          h('div', { class: 'account-stats-main' }, partText),
          h('div', { class: 'account-stats-sub' }, `成功率 ${rate}% · 今日 ${todayDiamonds} 抖币`)
        ])
      }
    }
  ]

  base.push({
    title: '操作',
    key: 'actions',
    width: compact ? 120 : 150,
    fixed: actionFixed,
    render: (row) => h('div', { class: 'account-actions-cell' }, [
      h(NButton, {
        size: compact ? 'tiny' : 'small',
        type: row.state === 'running' ? 'warning' : 'primary',
        secondary: true,
        strong: true,
        onClick: () => toggleAccount(row)
      }, { default: () => row.state === 'running' ? '暂停' : '启动' }),
      h(NButton, {
        size: compact ? 'tiny' : 'small',
        quaternary: true,
        type: 'error',
        onClick: () => removeAccount(row.id)
      }, { default: () => '删除' })
    ])
  })

  return base
})

const accountTableScrollX = computed(() => {
  return responsiveColumns.value.reduce((sum, col) => sum + Number(col.width || 120), 0) + 40
})

function appendLotteryHistory(record) {
  if (!record || typeof record !== 'object') return
  const normalized = {
    accountId: record.accountId || '',
    accountNickname: record.accountNickname || record.accountId || '未知账号',
    roomId: record.roomId || '',
    webRid: record.webRid || '',
    authorNickname: record.authorNickname || '',
    lotteryName: record.lotteryName || '',
    predictedProbability: Number(record.predictedProbability || 0),
    joinMode: record.joinMode || 'API',
    joinStatus: record.joinStatus || 'success',
    resultReason: record.resultReason || '',
    joinedAt: Number(record.joinedAt || Date.now()),
    endTime: Number(record.endTime || 0)
  }
  lotteryHistory.value = [normalized, ...lotteryHistory.value].slice(0, 300)
}

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

        const finalNickname = normalizeNickname(info?.nickname || saveResult.savedInfo?.nickname || account.nickname)
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
  if (account._starting) return
  account._starting = true
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
      onHistoryRecord: (record) => appendLotteryHistory(record),
      onLog: (m, t) => addLog(m, t)
    })
  } catch (e) { addLog(`启动失败: ${e.message}`, 'error') }
  finally { account._starting = false }
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

function addLog(message, type = 'info') {
  logs.value.push({ time: new Date().toLocaleTimeString(), message, type })
  if (logs.value.length > 300) logs.value.shift()
}
</script>

<style>
html,
body,
#app {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
}

body {
  overflow: hidden;
  background: #e8edf4;
}
</style>

<style scoped>
.app-root {
  width: 100%;
  height: 100%;
}

.desktop-shell {
  --shell-bg-start: #f1f4f8;
  --shell-bg-end: #e5ebf3;
  --card-border: #e2e9f2;
  --card-shadow: rgba(15, 23, 42, 0.08);
  --card-shadow-strong: rgba(15, 23, 42, 0.12);
  width: 100%;
  height: 100vh;
  min-height: 100vh;
  padding: 0;
  box-sizing: border-box;
  background:
    radial-gradient(900px 500px at -12% -14%, rgba(24, 160, 88, 0.16), transparent 70%),
    radial-gradient(1040px 620px at 112% -8%, rgba(77, 144, 255, 0.13), transparent 66%),
    linear-gradient(180deg, var(--shell-bg-start) 0%, var(--shell-bg-end) 100%);
}

.window-frame {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: 0;
  border: 0;
  box-shadow: none;
  overflow: hidden;
  background: #eef3f7;
  font-family: 'SF Pro Display', 'PingFang SC', 'MiSans', 'Helvetica Neue', sans-serif;
}

.app-container {
  display: flex;
  flex: 1;
  min-height: 0;
  background:
    radial-gradient(1200px 560px at -8% -18%, rgba(24, 160, 88, 0.14), transparent 67%),
    radial-gradient(980px 640px at 112% -4%, rgba(68, 132, 255, 0.12), transparent 64%),
    linear-gradient(180deg, #f9fbfe 0%, #eef3f8 100%);
  overflow: hidden;
}

.header-base {
  height: 66px;
  background-color: rgba(255, 255, 255, 0.9);
  border-bottom: 1px solid #e3e9f1;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  box-sizing: border-box;
}

/* 侧边栏样式 */
.sidebar {
  width: 278px;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.93) 0%, rgba(250, 252, 255, 0.91) 100%);
  border-right: 1px solid #d8e1ed;
  box-shadow: 8px 0 18px rgba(31, 41, 55, 0.045);
  backdrop-filter: blur(10px);
  z-index: 10;
}
.sidebar-header {
  padding: 0 16px;
  gap: 10px;
}
.title-text {
  margin: 0;
  font-size: 29px;
  font-weight: 700;
  color: #203247;
  letter-spacing: 0.3px;
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
  padding: 14px 16px 16px;
  display: grid;
  grid-template-columns: minmax(0, 1.63fr) minmax(308px, 0.86fr);
  gap: 14px;
  overflow: hidden;
  box-sizing: border-box;
  min-height: 0;
}
.column-left {
  display: flex;
  flex-direction: column;
  gap: 14px;
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
    grid-template-rows: minmax(320px, auto) minmax(280px, 40vh);
  }
}

@media (max-width: 900px) {
  .desktop-shell {
    padding: 0;
  }

  .window-frame {
    border-radius: 0;
    border: 0;
    box-shadow: none;
  }

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

.account-name-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
  color: #2b3a4c;
}

.account-stats-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.account-stats-main {
  font-size: 12px;
  color: #314155;
  font-family: 'JetBrains Mono', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-stats-sub {
  font-size: 11px;
  color: #7d8ba0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-actions-cell {
  display: flex;
  align-items: center;
  gap: 4px;
}

.hide-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
.hide-scrollbar::-webkit-scrollbar { display: none; }
</style>
