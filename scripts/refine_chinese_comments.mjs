import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()

const TARGET_DIRS = [
  'src',
  'electron',
  'pool-server-go/cmd',
  'pool-server-go/internal'
]

const customDesc = {
  class: {
    LotteryManager: '负责账号扫描、福袋池管理、参与调度与统计更新的核心控制器。',
    SM3: '实现 SM3 摘要运算状态机，用于签名相关计算。'
  },
  method: {
    constructor: '初始化实例状态、缓存映射和默认配置。',
    formatMetric: '将数值格式化为中文千分位字符串，用于界面展示。',
    clearLoginWatchers: '清理登录轮询与超时定时器，避免重复触发。',
    runTick: '执行一次定时轮询，并按剩余时间决定下一步调度。',
    fetchOne: '抓取单个直播间的福袋详情并返回标准化结果。',
    worker: '并发消费候选列表并汇总抓取成功/失败统计。',
    shouldLog: '判断当前日志级别是否允许输出该条日志。',
    emit: '封装带级别过滤与作用域前缀的日志输出函数。',
    getLevel: '返回当前生效的日志级别。',
    setLevel: '更新并返回新的日志级别。',
    refreshFromWindow: '从窗口配置刷新日志级别，保持前后端一致。',
    refreshFromEnv: '从环境变量刷新日志级别配置。',
    wrapped: '包装 IPC 事件回调，屏蔽原始 event 参数。',
    attemptAttend: '调用参与接口并归一化成功状态与错误信息。',
    safeText: '清洗文本并压缩空白，降低文案匹配误差。',
    extractText: '提取元素及其上下文文本，用于规则匹配。',
    isRestricted: '判断元素是否命中会员/粉丝团等受限规则。',
    safeClick: '以 click/事件回退方式安全触发点击操作。',
    collectFromRoot: '在指定根节点收集可领取红包入口并执行过滤点击。',
    createLogger: '创建带作用域与级别控制的日志器实例。',
    addLog: '追加一条运行日志并驱动日志区域滚动更新。',
    invoke: '向主进程发起白名单 IPC 调用并返回结果。',
    on: '订阅白名单 IPC 事件并返回取消订阅函数。',
    isBlockedExternalProtocol: '判断 URL 是否为需要拦截的外部协议。',
    isHttpLikeUrl: '判断 URL 是否为可导航的 HTTP/HTTPS 地址。',
    isPoolServerEnabled: '判断是否已启用且配置了可用的福袋池服务端地址。',
    isScannerAccount: '判断当前账号是否被分配为本轮扫描账号。',
    shouldLogPoolWarn: '根据冷却时间判断是否允许再次输出池服务告警日志。',
    shouldSkipLottery: '判断指定福袋是否处于临时跳过窗口。',
    isCollectLoading: '判断账号当前是否处于扫描执行中。',
    isPaused: '判断账号是否处于暂停状态。',
    setPaused: '更新账号暂停状态并同步扫描调度标记。',
    start: '启动账号单轮流程：拉池、选袋、参与与下一轮调度。',
    isAttendSuccessLike: '判断参与接口返回是否属于成功或可视作成功。',
    main: '初始化服务配置并启动 HTTP 接口与后台维护任务。',
    UpsertBatch: '批量写入候选福袋数据，并返回新增/更新统计。',
    upsertOne: '写入单条候选福袋并维护过期与索引状态。',
    SweepExpired: '清理已过期候选福袋并同步索引。',
    Close: '关闭服务资源并停止后台任务。',
    get: '按键读取存储中的候选数据副本。',
    set: '按键写入或覆盖存储中的候选数据。',
    delete: '按键删除存储中的候选数据。',
    hasRestrictedJoinRequirement: '判断参与条件中是否包含粉丝团/会员等受限项。',
    isPhysicalPrize: '判断候选福袋是否属于实物奖品。',
    de: '执行签名算法中的位运算辅助逻辑。',
    pe: '执行签名算法中的轮函数计算步骤。',
    he: '执行签名算法中的状态压缩步骤。',
    reset: '重置摘要计算上下文到初始状态。',
    write: '向摘要计算器写入待处理字节数据。',
    sum: '输出当前摘要状态对应的结果字节。',
    _compress: '执行一轮摘要压缩计算。',
    _fill: '补齐摘要块长度并准备最终计算。',
    sign: '生成请求参数签名结果。',
    sign_reply: '生成用于响应回传的签名结果。',
    Len: '返回堆当前元素数量，满足 heap.Interface 要求。',
    Less: '定义堆元素比较规则，决定堆序。',
    Swap: '交换堆中两个元素位置，供堆调整使用。',
    Push: '向堆中压入新元素。',
    Pop: '从堆尾弹出一个元素并返回。'
  }
}

const tokenMap = {
  get: '获取', set: '设置', create: '创建', update: '更新', normalize: '归一化',
  resolve: '解析并返回', fetch: '请求并获取', search: '搜索', start: '启动', stop: '停止',
  pause: '暂停', resume: '恢复', load: '加载', read: '读取', write: '写入', save: '保存',
  sync: '同步', refresh: '刷新', build: '构建', print: '输出', log: '记录',
  is: '判断', has: '判断', can: '判断', should: '判断',
  ensure: '确保', wait: '等待', join: '执行参与', attend: '执行参与', schedule: '调度',
  pick: '选择', select: '筛选', calculate: '计算', score: '计算', apply: '应用',
  parse: '解析', remove: '移除', delete: '删除', clear: '清理', prune: '裁剪', mark: '标记',
  emit: '触发', handover: '切换', release: '释放', upsert: '新增或更新', sweep: '清理',
  close: '关闭', to: '转换为', default: '返回默认', new: '创建',
  add: '添加', append: '追加', clone: '克隆', dispatch: '分发', extract: '提取',
  handle: '处理', make: '生成', open: '打开', keep: '保持', warn: '告警', check: '检查'
}

const nounMap = {
  today: '今日', key: '键', account: '账号', accounts: '账号列表', model: '模型', daily: '每日', stats: '统计',
  resize: '尺寸', sleep: '延时', nickname: '昵称', lottery: '福袋', outcome: '开奖结果', cache: '缓存',
  history: '历史记录', user: '用户', info: '信息', retry: '重试', metric: '指标',
  seq: '序号', next: '下一项', login: '登录', watchers: '监听器', toggle: '切换', scanning: '扫描',
  block: '屏蔽', blocked: '已屏蔽协议', pool: '福袋池', server: '服务端', config: '配置',
  eligible: '可参与', scanner: '扫描', balanced: '均衡策略', wait: '等待阶段', draw: '开奖',
  candidate: '候选项', candidates: '候选项列表', top: '优选结果', filter: '过滤条件', filters: '过滤配置',
  sync: '同步', refresh: '刷新', list: '列表', unique: '唯一键',
  temporary: '临时', skip: '跳过标记', task: '任务', risk: '风控', adaptive: '自适应',
  deep: '深度', feedback: '反馈', startup: '启动阶段', stagger: '错峰', check: '检查', monitoring: '监控',
  score: '评分', delay: '延迟', finish: '结束流程', round: '轮次', restart: '重启', post: '后置',
  stay: '停留阶段', scan: '扫描', success: '成功事件', red: '红包', packet: '红包', restricted: '受限项',
  role: '角色', loading: '加载状态', timer: '定时器', min: '最小值', end: '结束时间', time: '时间',
  state: '状态', profile: '策略', bool: '布尔值', int: '整数', int64: '64位整数', float: '浮点数',
  body: '请求体', query: '查询参数', map: '映射', string: '字符串', strings: '字符串集合',
  service: '服务', store: '存储', hash: '哈希', shard: '分片', snapshot: '快照', conditions: '参与条件',
  physical: '实物奖品', candidatekey: '候选键', enabled: '启用状态', status: '状态',
  level: '级别', env: '环境变量', window: '窗口配置', json: 'JSON数据', url: 'URL',
  path: '路径', params: '参数', token: 'Token', cookie: 'Cookie', protocol: '协议',
  room: '直播间', live: '直播', id: '标识', page: '分页', loop: '循环',
  rendering: '渲染状态', stream: '推流画面', root: '根节点', text: '文本',
  changed: '变化', finite: '有限值', first: '首个值', all: '全量数据', one: '单项数据',
  bottom: '底部区域', pinned: '固定状态', empty: '空值', random: '随机值', max: '最大值', size: '数量',
  trim: '首尾空白', str: '字符串', file: '文件', http: 'HTTP请求', apis: '接口结果',
  single: '单轮', immediately: '即时流程', awake: '常亮状态', external: '外部协议',
  redis: 'Redis', remote: '远程调用', datail: '详情', douyin: '抖音', warmup: '预热', awakeblocker: '防休眠锁'
}

const stopWords = new Set(['by', 'with', 'for', 'from', 'and', 'as', 'if', 'on', 'in', 'of', 'all', 'one', 'ms', 'ui', 'api', 'v2'])

function splitName(name) {
  return String(name || '')
    .replace(/^#+/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(s => s.toLowerCase())
}

function translateTokens(tokens) {
  const parts = []
  for (const t of tokens) {
    if (!t || stopWords.has(t)) continue
    const mapped = nounMap[t]
    if (mapped) parts.push(mapped)
  }
  return parts.join('')
}

function autoDesc(name, kind, filePath) {
  const tokens = splitName(name)
  if (tokens.length === 0) return '补充方法职责说明。'

  if (kind === '类') {
    const domain = filePath.includes('pool-server-go')
      ? '福袋池服务端'
      : filePath.includes('electron')
        ? 'Electron 主进程与浏览器控制'
        : '客户端监控与参与流程'
    return `封装${domain}相关的核心逻辑。`
  }

  const first = tokens[0]
  const action = tokenMap[first] || '处理'
  const noun = translateTokens(tokens.slice(1))

  if (action === '判断') return `判断${noun || '当前条件'}。`
  if (action === '返回默认') return `返回默认${noun || '配置'}。`
  if (action === '转换为') return `将输入转换为${noun || '目标格式'}。`
  if (action === '确保') return `确保${noun || '目标状态'}满足预期。`
  if (action === '等待') return `等待${noun || '目标状态'}达到可执行条件。`
  if (action === '处理') return `处理${translateTokens(tokens) || '相关逻辑'}。`

  const suffix = noun || (
    action === '启动' || action === '停止' || action === '暂停' || action === '恢复' || action === '调度'
      ? '流程'
      : action === '创建'
        ? '实例'
        : action === '写入' || action === '保存' || action === '新增或更新'
          ? '数据'
          : action === '获取' || action === '读取'
            ? '结果'
            : '目标项'
  )
  return `${action}${suffix}。`
}

function buildDesc(name, kind, filePath) {
  if (kind === '类' && customDesc.class[name]) return customDesc.class[name]
  if (kind !== '类' && customDesc.method[name]) return customDesc.method[name]
  return autoDesc(name, kind, filePath)
}

function listFiles(dir) {
  const out = []
  const stack = [dir]
  while (stack.length) {
    const curr = stack.pop()
    if (!fs.existsSync(curr)) continue
    for (const ent of fs.readdirSync(curr, { withFileTypes: true })) {
      const fp = path.join(curr, ent.name)
      if (ent.isDirectory()) stack.push(fp)
      else out.push(fp)
    }
  }
  return out
}

const files = TARGET_DIRS
  .flatMap(d => listFiles(path.join(ROOT, d)))
  .filter(fp => /\.(js|vue|go)$/.test(fp))

let touched = 0
let total = 0

for (const fp of files) {
  const rel = path.relative(ROOT, fp)
  let src = fs.readFileSync(fp, 'utf8')
  let changed = false

  src = src.replace(
    /^(\s*\*\s+)([A-Za-z0-9_$#]+)\s+(方法|类)：.*$/gm,
    (_, p1, name, kind) => {
      changed = true
      total += 1
      return `${p1}${name} ${kind}：${buildDesc(name, kind, rel)}`
    }
  )

  src = src.replace(
    /^(\s*\/\/\s+)([A-Za-z0-9_$#]+)\s+(方法|类)：.*$/gm,
    (_, p1, name, kind) => {
      changed = true
      total += 1
      return `${p1}${name} ${kind}：${buildDesc(name, kind, rel)}`
    }
  )

  if (changed) {
    fs.writeFileSync(fp, src)
    touched += 1
    console.log(rel)
  }
}

console.log(`TOUCHED_FILES=${touched}`)
console.log(`REPLACED_COMMENTS=${total}`)
