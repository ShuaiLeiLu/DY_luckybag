<template>
  <n-config-provider :theme-overrides="themeOverrides">
    <n-layout style="height: 100vh">
      <!-- 顶部标题栏 - 响应式字体 -->
      <n-layout-header bordered style="height: 60px; padding: 0 20px; display: flex; align-items: center; justify-content: space-between">
        <h2 style="margin: 0; font-size: clamp(16px, 3vw, 20px)">🎁 抖音福袋助手</h2>
        <n-tag type="info" size="small">v1.0.0</n-tag>
      </n-layout-header>
      
      <n-layout has-sider style="height: calc(100vh - 60px)" :native-scrollbar="false">
        <!-- 左侧面板 - 响应式宽度和折叠 -->
        <n-layout-sider 
          bordered 
          :width="siderWidth"
          :collapsed-width="0"
          :collapsed="isMobile && siderCollapsed"
          collapse-mode="width"
          show-trigger="bar"
          @collapse="siderCollapsed = true"
          @expand="siderCollapsed = false"
          style="padding: 16px; overflow-y: auto"
        >
          <n-space vertical :size="16">
            <n-card title="⚙️ 配置" size="small" :bordered="false">
              <n-space vertical :size="12">
                <!-- 概率筛选 -->
                <div>
                  <div style="display: flex; align-items: center; margin-bottom: 6px;">
                    <n-switch 
                      v-model:value="config.hitRate.enabled" 
                      size="small"
                      style="margin-right: 8px"
                    />
                    <span style="font-size: 13px; color: #666">{{ config.hitRate.label }}</span>
                  </div>
                  <n-input-number 
                    v-model:value="config.hitRate.value" 
                    :min="0.01" 
                    :max="1" 
                    :step="0.01"
                    :disabled="!config.hitRate.enabled"
                    placeholder="0.1"
                    style="width: 100%"
                    :show-button="true"
                    size="small"
                  >
                    <template #suffix>
                      <span style="font-size: 12px; color: #999">{{ (config.hitRate.value * 100).toFixed(0) }}%</span>
                    </template>
                  </n-input-number>
                  <div style="font-size: 11px; color: #999; margin-top: 4px">{{ config.hitRate.description }}</div>
                </div>
                
                <!-- 二次检查 -->
                <div>
                  <div style="display: flex; align-items: center; margin-bottom: 6px;">
                    <n-switch 
                      v-model:value="config.secondInspect.enabled" 
                      size="small"
                      style="margin-right: 8px"
                    />
                    <span style="font-size: 13px; color: #666">{{ config.secondInspect.label }}</span>
                  </div>
                  <n-input-number 
                    v-model:value="config.secondInspect.value" 
                    :min="0.01" 
                    :max="1" 
                    :step="0.01"
                    :disabled="!config.secondInspect.enabled"
                    placeholder="0.05"
                    style="width: 100%"
                    :show-button="true"
                    size="small"
                  >
                    <template #suffix>
                      <span style="font-size: 12px; color: #999">{{ (config.secondInspect.value * 100).toFixed(0) }}%</span>
                    </template>
                  </n-input-number>
                  <div style="font-size: 11px; color: #999; margin-top: 4px">{{ config.secondInspect.description }}</div>
                </div>
                
                <!-- 参与次数 -->
                <div>
                  <div style="display: flex; align-items: center; margin-bottom: 6px;">
                    <n-switch 
                      v-model:value="config.participationCount.enabled" 
                      size="small"
                      style="margin-right: 8px"
                    />
                    <span style="font-size: 13px; color: #666">{{ config.participationCount.label }}</span>
                  </div>
                  <n-input-number 
                    v-model:value="config.participationCount.value" 
                    :min="1" 
                    :max="1000" 
                    :step="1"
                    :disabled="!config.participationCount.enabled"
                    placeholder="80"
                    style="width: 100%"
                    :show-button="true"
                    size="small"
                  />
                  <div style="font-size: 11px; color: #999; margin-top: 4px">{{ config.participationCount.description }}</div>
                </div>
                
                <!-- 运行时长 -->
                <div>
                  <div style="display: flex; align-items: center; margin-bottom: 6px;">
                    <n-switch 
                      v-model:value="config.singleAccountDuration.enabled" 
                      size="small"
                      style="margin-right: 8px"
                    />
                    <span style="font-size: 13px; color: #666">{{ config.singleAccountDuration.label }}</span>
                  </div>
                  <n-input-number 
                    v-model:value="config.singleAccountDuration.value" 
                    :min="0.5" 
                    :max="24" 
                    :step="0.5"
                    :disabled="!config.singleAccountDuration.enabled"
                    placeholder="3"
                    style="width: 100%"
                    :show-button="true"
                    size="small"
                  >
                    <template #suffix>
                      <span style="font-size: 12px; color: #999">小时</span>
                    </template>
                  </n-input-number>
                  <div style="font-size: 11px; color: #999; margin-top: 4px">{{ config.singleAccountDuration.description }}</div>
                </div>
                
                <!-- 停留时长 -->
                <div>
                  <div style="margin-bottom: 6px; font-size: 13px; color: #666">停留时长</div>
                  <n-input-number 
                    v-model:value="config.stayDuration" 
                    :min="0"
                    :step="1"
                    placeholder="5"
                    style="width: 100%"
                    :show-button="true"
                    size="small"
                  >
                    <template #suffix>
                      <span style="font-size: 12px; color: #999">秒</span>
                    </template>
                  </n-input-number>
                  <div style="font-size: 11px; color: #999; margin-top: 4px">参与福袋后在直播间停留的时间</div>
                </div>
                
                <!-- 过滤人数 -->
                <div>
                  <div style="display: flex; align-items: center; margin-bottom: 6px;">
                    <n-switch 
                      v-model:value="config.filterOnline.enabled" 
                      size="small"
                      style="margin-right: 8px"
                    />
                    <span style="font-size: 13px; color: #666">{{ config.filterOnline.label }}</span>
                  </div>
                  <n-input-number 
                    v-model:value="config.filterOnline.value" 
                    :min="100" 
                    :max="100000" 
                    :step="100"
                    :disabled="!config.filterOnline.enabled"
                    placeholder="1000"
                    style="width: 100%"
                    :show-button="true"
                    size="small"
                  />
                  <div style="font-size: 11px; color: #999; margin-top: 4px">{{ config.filterOnline.description }}</div>
                </div>
                
                <!-- 其他开关 -->
                <div style="display: flex; justify-content: space-between; align-items: center">
                  <span style="font-size: 13px; color: #666">启用红包</span>
                  <n-switch v-model:value="config.enableRedPacket" size="small" />
                </div>
                
                <div style="display: flex; justify-content: space-between; align-items: center">
                  <span style="font-size: 13px; color: #666">{{ config.randomInteraction.label }}</span>
                  <n-switch v-model:value="config.randomInteraction.enabled" size="small" />
                </div>
              </n-space>
            </n-card>
            
            <n-button type="primary" block @click="addAccount" size="medium">
              + 添加账号
            </n-button>
            
            <n-button 
              type="info" 
              block 
              @click="manualScan"
              :disabled="accounts.length === 0"
              size="medium"
            >
              🔍 扫描福袋
            </n-button>
            
            <n-card title="📊 统计" size="small" :bordered="false">
              <n-space vertical :size="6">
                <div style="display: flex; justify-content: space-between; font-size: 13px">
                  <span style="color: #666">账号：</span>
                  <span style="font-weight: bold">{{ accounts.length }}</span>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 13px">
                  <span style="color: #666">运行：</span>
                  <span style="font-weight: bold; color: #18a058">{{ runningCount }}</span>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 13px">
                  <span style="color: #666">参与：</span>
                  <span style="font-weight: bold">{{ totalParticipation }}</span>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 13px">
                  <span style="color: #666">中奖：</span>
                  <span style="font-weight: bold; color: #f0a020">{{ totalWinning }}</span>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 13px">
                  <span style="color: #666">钻石：</span>
                  <span style="font-weight: bold; color: #d03050">{{ totalDiamonds }}</span>
                </div>
              </n-space>
            </n-card>
          </n-space>
        </n-layout-sider>
        
        <!-- 右侧内容区 - 响应式布局 -->
        <n-layout-content style="padding: 16px; overflow-y: auto">
          <!-- 移动端菜单按钮 -->
          <n-button 
            v-if="isMobile && siderCollapsed" 
            @click="siderCollapsed = false"
            style="margin-bottom: 12px"
            type="primary"
            size="small"
          >
            ☰ 菜单
          </n-button>
          
          <n-space vertical :size="16">
            <n-card title="👥 账号列表" size="small" :bordered="false">
              <n-empty 
                v-if="accounts.length === 0"
                description="暂无账号"
                style="padding: 30px 0"
                size="small"
              />
              <n-data-table
                v-else
                :columns="responsiveColumns"
                :data="accounts"
                :pagination="false"
                :bordered="false"
                :single-line="false"
                :scroll-x="isMobile ? 700 : undefined"
                size="small"
              />
            </n-card>
            
            <n-card title="📝 日志" size="small" :bordered="false">
              <div ref="logContainer" :style="logStyle">
                <div v-for="(log, index) in logs" :key="index" :style="getLogItemStyle(log)">
                  <span style="color: #999">[{{ log.time }}]</span> 
                  <span>{{ log.message }}</span>
                </div>
              </div>
            </n-card>
          </n-space>
        </n-layout-content>
      </n-layout>
    </n-layout>
  </n-config-provider>
</template>

<script setup>
import { ref, h, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { NButton, NTag, NSpace } from 'naive-ui'
import LotteryManager from './services/LotteryManager-lite'

const themeOverrides = {
  common: {
    primaryColor: '#18a058'
  }
}

// 响应式状态
const windowWidth = ref(window.innerWidth)
const siderCollapsed = ref(false)
const logContainer = ref(null)

// 响应式计算
const isMobile = computed(() => windowWidth.value < 768)
const isTablet = computed(() => windowWidth.value >= 768 && windowWidth.value < 1024)
const siderWidth = computed(() => {
  if (isMobile.value) return 260
  if (isTablet.value) return 280
  return 300
})

const logStyle = computed(() => ({
  height: isMobile.value ? '200px' : '300px',
  overflowY: 'auto',
  fontFamily: "'Monaco', 'Menlo', 'Consolas', monospace",
  fontSize: isMobile.value ? '11px' : '12px',
  background: '#fafafa',
  padding: isMobile.value ? '8px' : '10px',
  borderRadius: '4px',
  border: '1px solid #e0e0e0'
}))

const getLogItemStyle = (log) => ({
  color: log.type === 'error' ? '#d03050' : log.type === 'success' ? '#18a058' : '#333',
  marginBottom: '4px',
  lineHeight: '1.5',
  fontSize: isMobile.value ? '11px' : '12px',
  fontWeight: log.type !== 'info' ? '500' : 'normal'
})

// 监听窗口大小
const handleResize = () => {
  windowWidth.value = window.innerWidth
}

onMounted(async () => {
  window.addEventListener('resize', handleResize)
  
  // 启动时自动加载所有已保存的账号
  await loadAllAccounts()
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
})

// 统计数据
const runningCount = computed(() => accounts.value.filter(a => a.state === 'running').length)
const totalParticipation = computed(() => accounts.value.reduce((sum, a) => sum + a.participationCount, 0))
const totalWinning = computed(() => accounts.value.reduce((sum, a) => sum + a.winningCount, 0))
const totalDiamonds = computed(() => accounts.value.reduce((sum, a) => sum + a.totalDiamonds, 0))

const config = ref({
  // 基础配置
  minProbability: 0.01,      // 最小中奖概率（已有）
  stayDuration: 5,           // 停留时长（已有）
  enableRedPacket: true,     // 启用红包（已有）
  
  // 源码中的配置项
  hitRate: {
    enabled: true,
    label: '概率筛选',
    value: 0.1,              // 只抢预测概率 >= 10% 的福袋
    description: '只参与预测中奖概率大于等于此值的福袋'
  },
  secondInspect: {
    enabled: true,
    label: '二次检查',
    value: 0.05,             // 二次检查概率阈值 5%
    description: '参与前再次检查福袋概率，低于此值则放弃'
  },
  participationCount: {
    enabled: true,
    label: '参与次数',
    value: 80,               // 每个账号最多参与80次
    description: '单个账号最大参与次数，达到后自动停止'
  },
  singleAccountDuration: {
    enabled: true,
    label: '运行时长',
    value: 3,                // 单个账号运行3小时
    description: '单个账号最长运行时间（小时），超时后自动停止'
  },
  filterOnline: {
    enabled: false,
    label: '过滤人数',
    value: 1000,             // 过滤在线人数 > 1000 的直播间
    description: '只参与在线人数小于等于此值的直播间'
  },
  allowMultipleAccount: {
    enabled: false,
    label: '允许多号',
    value: 1,                // 同一直播间允许1个账号
    description: '同一直播间允许参与的账号数量'
  },
  intervalDuration: {
    enabled: true,
    label: '间隔时长',
    value: 2,                // 扫描间隔2秒
    description: '每次扫描请求之间的间隔时间（秒）'
  },
  randomInteraction: {
    enabled: true,
    label: '随机互动',
    value: 1,
    description: '参与福袋时随机进行点赞、评论等互动'
  },
  takeTurnScan: {
    enabled: true,
    label: '轮流扫描',
    value: 1,
    description: '多账号时轮流扫描，避免同时请求'
  },
  priorityType: {
    enabled: true,
    label: '优先类型',
    value: 2,                // 2=按开奖时间排序
    description: '福袋排序方式：1=按概率，2=按开奖时间'
  }
})

const accounts = ref([])
const logs = ref([])
const lotteryManager = new LotteryManager()

// 获取 ipcRenderer
let ipcRenderer = null
try {
  if (window.require) {
    const electron = window.require('electron')
    ipcRenderer = electron.ipcRenderer
  }
} catch (e) {
  console.error('无法加载 electron:', e)
}

// 启动时加载所有已保存的账号
async function loadAllAccounts() {
  if (!ipcRenderer) {
    addLog('⚠️ Electron环境未就绪', 'error')
    return
  }
  
  try {
    const result = await ipcRenderer.invoke('load-all-tokens')
    
    if (result.success && result.tokens) {
      const tokenEntries = Object.entries(result.tokens)
      
      if (tokenEntries.length === 0) {
        addLog('📋 暂无已保存的账号')
        return
      }
      
      addLog(`📋 发现 ${tokenEntries.length} 个已保存的账号`)
      
      for (const [accountId, tokenInfo] of tokenEntries) {
        // 使用存储的真实昵称和用户ID
        const nickname = tokenInfo.nickname || `账号_${accountId}`
        const userId = tokenInfo.userId || accountId
        
        const account = {
          id: accountId,
          nickname: nickname,
          userId: userId,
          state: 'waiting',
          currentRoom: '',
          participationCount: 0,
          winningCount: 0,
          totalDiamonds: 0,
          token: tokenInfo.sessionid || tokenInfo.sessionid_ss
        }
        
        accounts.value.push(account)
        
        addLog(`✅ 已加载账号: ${nickname} (${userId})`)
      }
    }
  } catch (error) {
    addLog(`❌ 加载账号失败: ${error.message}`, 'error')
  }
}

// 响应式表格列
const responsiveColumns = computed(() => {
  const cols = [
    { title: 'ID', key: 'id', width: isMobile.value ? 90 : 110, ellipsis: { tooltip: true } },
    { title: '昵称', key: 'nickname', width: isMobile.value ? 80 : 100 },
    { 
      title: '状态', 
      key: 'state',
      width: isMobile.value ? 70 : 90,
      render: (row) => {
        const stateMap = {
          'waiting': { text: '等待', type: 'default' },
          'opened': { text: '已打开', type: 'info' },
          'running': { text: '运行', type: 'success' },
          'paused': { text: '暂停', type: 'warning' },
          'error': { text: '错误', type: 'error' }
        }
        const state = stateMap[row.state] || stateMap.waiting
        return h(NTag, { type: state.type, size: 'small' }, { default: () => state.text })
      }
    }
  ]
  
  // 添加Token列（仅在非移动端显示）
  if (!isMobile.value) {
    cols.push({
      title: 'Token',
      key: 'token',
      width: 150,
      ellipsis: { tooltip: true },
      render: (row) => {
        if (row.token) {
          return h('span', { 
            style: 'font-family: monospace; font-size: 11px; color: #18a058;' 
          }, row.token.substring(0, 20) + '...')
        }
        return h('span', { style: 'color: #999; font-size: 12px;' }, '未登录')
      }
    })
  }
  
  if (!isMobile.value) {
    cols.push(
      { title: '直播间', key: 'currentRoom', width: 120, ellipsis: { tooltip: true } },
      { title: '参与', key: 'participationCount', width: 60, align: 'center' },
      { title: '中奖', key: 'winningCount', width: 60, align: 'center' },
      { title: '钻石', key: 'totalDiamonds', width: 70, align: 'center' }
    )
  }
  
  cols.push({
    title: '操作', 
    key: 'actions',
    width: isMobile.value ? 150 : 200,
    fixed: 'right',
    render: (row) => {
      return h(NSpace, { size: 6 }, {
        default: () => [
          h(NButton, 
            { 
              size: 'tiny', 
              type: row.state === 'running' ? 'warning' : 'primary',
              onClick: () => toggleAccount(row)
            }, 
            { default: () => row.state === 'running' ? '暂停' : '启动' }
          ),
          h(NButton, 
            { 
              size: 'tiny', 
              type: 'info',
              onClick: () => refreshUserInfo(row.id),
              disabled: !row.token
            }, 
            { default: () => '刷新' }
          ),
          h(NButton, 
            { 
              size: 'tiny', 
              type: 'error',
              onClick: () => removeAccount(row.id)
            }, 
            { default: () => '删除' }
          )
        ]
      })
    }
  })
  
  return cols
})

function addAccount() {
  // 找到最大的账号编号
  let maxNumber = 0
  accounts.value.forEach(acc => {
    const match = acc.id.match(/account_(\d+)/)
    if (match) {
      const num = parseInt(match[1])
      if (num > maxNumber) maxNumber = num
    }
  })
  
  const accountNumber = maxNumber + 1
  
  const account = {
    id: `account_${accountNumber}`,
    nickname: `账号${accountNumber}`,
    state: 'waiting',
    currentRoom: '',
    participationCount: 0,
    winningCount: 0,
    totalDiamonds: 0,
    token: null
  }
  
  accounts.value.push(account)
  
  // 重新排序并更新昵称
  accounts.value.sort((a, b) => {
    const numA = parseInt(a.id.match(/account_(\d+)/)[1])
    const numB = parseInt(b.id.match(/account_(\d+)/)[1])
    return numA - numB
  })
  
  accounts.value.forEach((acc, index) => {
    acc.nickname = `账号${index + 1}`
  })
  
  addLog(`账号 ${account.nickname} 已添加，请在浏览器中扫码登录`)
  
  // 启动浏览器等待扫码
  startAccountWithLogin(account)
}

async function startAccountWithLogin(account) {
  if (!ipcRenderer) {
    addLog('Electron IPC 不可用', 'error')
    return
  }
  
  try {
    addLog(`🚀 正在为 ${account.nickname} 创建独立浏览器环境...`)
    
    // 启动浏览器窗口（每个账号独立的 session）
    const result = await ipcRenderer.invoke('launch-browser', account.id)
    if (!result.success) {
      addLog(`启动浏览器失败: ${result.error}`, 'error')
      return
    }
    
    account.state = 'opened'
    addLog(`✅ 独立浏览器已启动 (${result.partition})`)
    addLog(`📱 请在新窗口中扫码登录`)
    
    // 导航到抖音登录页
    await ipcRenderer.invoke('navigate-to', {
      accountId: account.id,
      url: 'https://www.douyin.com'
    })
    
    // 定期检查登录状态
    const checkInterval = setInterval(async () => {
      const tokenResult = await ipcRenderer.invoke('get-login-token', account.id)
      
      if (tokenResult.success && tokenResult.isLoggedIn) {
        clearInterval(checkInterval)
        
        addLog(`✅ 检测到登录成功，正在获取用户信息...`)
        
        // 主动获取用户信息
        let userInfo = tokenResult.userInfo
        if (!userInfo || !userInfo.nickname) {
          addLog(`🔍 尝试手动获取用户信息...`)
          const userInfoResult = await ipcRenderer.invoke('get-user-info', account.id)
          if (userInfoResult.success) {
            userInfo = userInfoResult.userInfo
            addLog(`✅ 成功获取用户信息: ${userInfo.nickname}`, 'success')
          } else {
            addLog(`⚠️ 无法获取用户信息，将使用默认昵称`)
          }
        } else {
          addLog(`✅ 用户信息: ${userInfo.nickname}`, 'success')
        }
        
        // 保存token到本地（包含用户信息）
        const saveResult = await ipcRenderer.invoke('save-token', {
          accountId: account.id,
          tokenInfo: tokenResult.tokenInfo,
          userInfo: userInfo
        })
        
        if (saveResult.success) {
          addLog(`💾 Token已保存`, 'success')
          
          // 更新账号信息 - 使用真实昵称
          const index = accounts.value.findIndex(a => a.id === account.id)
          if (index !== -1) {
            const realNickname = saveResult.savedInfo?.nickname || account.nickname
            const realUserId = saveResult.savedInfo?.userId || account.id
            accounts.value[index].nickname = realNickname
            accounts.value[index].userId = realUserId
            accounts.value[index].token = tokenResult.tokenInfo.sessionid || tokenResult.tokenInfo.sessionid_ss
            accounts.value[index].state = 'waiting'
            
            if (userInfo && userInfo.nickname) {
              addLog(`📝 账号: ${realNickname} (${realUserId})`, 'success')
            }
          }
        }
      }
    }, 3000)
    
    // 60秒后停止检查
    setTimeout(() => {
      clearInterval(checkInterval)
      addLog(`⏱️ 登录超时，请手动点击"刷新"按钮获取用户信息`)
    }, 60000)
    
  } catch (error) {
    addLog(`启动失败: ${error.message}`, 'error')
  }
}

function toggleAccount(account) {
  console.log('toggleAccount called:', account)
  addLog(`点击了账号 ${account.nickname} 的启动按钮`)
  
  if (account.state === 'running') {
    lotteryManager.pauseAccount(account.id)
    addLog(`账号 ${account.nickname} 已暂停`)
  } else if (account.state === 'paused') {
    lotteryManager.resumeAccount(account.id)
    addLog(`账号 ${account.nickname} 已继续`)
  } else {
    // 启动账号开始扫描
    startAccountScanning(account)
  }
}

async function startAccountScanning(account) {
  console.log('startAccountScanning called:', account)
  
  if (!account.token) {
    addLog(`❌ 账号 ${account.nickname} 未登录，Token为空`, 'error')
    console.log('Token is null or undefined:', account.token)
    return
  }
  
  if (!ipcRenderer) {
    addLog('❌ Electron IPC 不可用', 'error')
    return
  }
  
  addLog(`🚀 启动账号 ${account.nickname}，正在打开浏览器...`)
  
  try {
    // 1. 启动浏览器窗口
    const launchResult = await ipcRenderer.invoke('launch-browser', account.id)
    if (!launchResult.success) {
      addLog(`❌ 启动浏览器失败: ${launchResult.error}`, 'error')
      return
    }
    addLog(`✅ 浏览器已启动`)
    
    // 2. 加载Token
    const tokenResult = await ipcRenderer.invoke('load-token', account.id)
    if (!tokenResult.success || !tokenResult.tokenInfo) {
      addLog(`❌ 加载Token失败: ${tokenResult.error}`, 'error')
      return
    }
    addLog(`✅ Token已加载`)
    
    // 打印 Token 信息用于调试
    console.log('Token信息:', {
      sessionid: tokenResult.tokenInfo.sessionid ? '✓' : '✗',
      sessionid_ss: tokenResult.tokenInfo.sessionid_ss ? '✓' : '✗',
      ttwid: tokenResult.tokenInfo.ttwid ? '✓' : '✗',
      nickname: tokenResult.tokenInfo.nickname,
      userId: tokenResult.tokenInfo.userId
    })
    
    // 3. 设置cookies
    const setCookieResult = await ipcRenderer.invoke('set-cookies', {
      accountId: account.id,
      tokenInfo: tokenResult.tokenInfo
    })
    
    if (!setCookieResult.success) {
      addLog(`❌ 设置Cookies失败: ${setCookieResult.error}`, 'error')
      return
    }
    addLog(`✅ Cookies已设置 (${setCookieResult.count || 0}个)`)
    
    // 4. 导航到抖音
    await ipcRenderer.invoke('navigate-to', {
      accountId: account.id,
      url: 'https://www.douyin.com'
    })
    addLog(`✅ 已进入抖音页面`)
    
    // 5. 更新账号状态
    const index = accounts.value.findIndex(a => a.id === account.id)
    if (index !== -1) {
      accounts.value[index].state = 'running'
    }
    
    // 6. 开始扫描福袋
    addLog(`🔍 开始扫描福袋...`)
    lotteryManager.startAccount(account, config.value, {
      onStatusUpdate: (updatedAccount) => {
        const idx = accounts.value.findIndex(a => a.id === updatedAccount.id)
        if (idx !== -1) {
          accounts.value[idx] = { ...accounts.value[idx], ...updatedAccount }
        }
      },
      onLog: (message, type = 'info') => {
        addLog(message, type)
      }
    })
    
  } catch (error) {
    addLog(`❌ 启动失败: ${error.message}`, 'error')
    console.error('startAccountScanning error:', error)
  }
}

async function removeAccount(accountId) {
  console.log('removeAccount called:', accountId)
  
  if (!ipcRenderer) {
    addLog('❌ Electron IPC 不可用', 'error')
    return
  }
  
  const account = accounts.value.find(a => a.id === accountId)
  const accountName = account ? account.nickname : accountId
  
  addLog(`🗑️ 正在删除账号: ${accountName}`)
  
  // 1. 停止账号运行并关闭浏览器
  lotteryManager.stopAccount(accountId)
  
  // 2. 删除本地存储的Token
  try {
    const deleteResult = await ipcRenderer.invoke('delete-token', accountId)
    if (deleteResult.success) {
      addLog(`✅ Token已删除: ${accountName}`)
    } else {
      addLog(`⚠️ Token删除失败: ${deleteResult.error}`, 'error')
    }
  } catch (error) {
    addLog(`⚠️ Token删除异常: ${error.message}`, 'error')
  }
  
  // 3. 从界面列表中移除
  accounts.value = accounts.value.filter(a => a.id !== accountId)
  
  // 4. 重新计算所有账号的昵称
  accounts.value.forEach((account, index) => {
    account.nickname = `账号${index + 1}`
  })
  
  addLog(`✅ 账号已完全删除: ${accountName}`, 'success')
}

async function refreshUserInfo(accountId) {
  if (!ipcRenderer) {
    addLog('❌ Electron IPC 不可用', 'error')
    return
  }
  
  const account = accounts.value.find(a => a.id === accountId)
  if (!account) return
  
  addLog(`🔄 正在刷新账号信息: ${account.nickname}`)
  
  try {
    // 检查浏览器是否存在
    const checkResult = await ipcRenderer.invoke('check-browser-exists', accountId)
    if (!checkResult.exists) {
      addLog(`⚠️ 请先启动该账号的浏览器`, 'error')
      return
    }
    
    // 获取用户信息
    const result = await ipcRenderer.invoke('get-user-info', accountId)
    
    if (result.success && result.userInfo) {
      const { nickname, userId } = result.userInfo
      
      // 更新本地存储
      const tokenResult = await ipcRenderer.invoke('load-token', accountId)
      if (tokenResult.success) {
        await ipcRenderer.invoke('save-token', {
          accountId,
          tokenInfo: tokenResult.tokenInfo,
          userInfo: result.userInfo
        })
      }
      
      // 更新界面
      const index = accounts.value.findIndex(a => a.id === accountId)
      if (index !== -1) {
        accounts.value[index].nickname = nickname
        accounts.value[index].userId = userId || accountId
      }
      
      addLog(`✅ 用户信息已更新: ${nickname} ${userId ? '(' + userId + ')' : ''}`, 'success')
    } else {
      addLog(`❌ 获取用户信息失败: ${result.error}`, 'error')
    }
  } catch (error) {
    addLog(`❌ 刷新失败: ${error.message}`, 'error')
  }
}

function manualScan() {
  if (accounts.value.length > 0) {
    const firstAccount = accounts.value[0]
    lotteryManager.startCollect(firstAccount.id)
    addLog('🔍 手动扫描...', 'info')
  }
}

function addLog(message, type = 'info') {
  const time = new Date().toLocaleTimeString()
  logs.value.push({ time, message, type })
  if (logs.value.length > 100) {
    logs.value.shift()
  }
  
  // 自动滚动到底部
  nextTick(() => {
    if (logContainer.value) {
      logContainer.value.scrollTop = logContainer.value.scrollHeight
    }
  })
}
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

@media (max-width: 768px) {
  .n-card__header {
    font-size: 14px !important;
    padding: 12px !important;
  }
  
  .n-card__content {
    padding: 12px !important;
  }
}
</style>
