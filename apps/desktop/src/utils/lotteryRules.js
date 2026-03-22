export const FANCLUB_JOIN_RE = /(粉丝团|粉丝专属|仅粉丝|仅限粉丝|铁粉|铁粉专属|团员|加团|加入粉丝团|加入团|粉丝牌|粉团)/
export const MEMBER_JOIN_RE = /(主播会员|会员可参与|仅会员|会员专属|vip|VIP|订阅后可参与|需订阅|订阅可参与|开通会员)/
export const RESTRICTED_JOIN_RE = /(粉丝团|粉丝专属|仅粉丝|仅限粉丝|铁粉|铁粉专属|团员|加团|加入粉丝团|加入团|粉丝牌|粉团|主播会员|会员可参与|仅会员|会员专属|vip|VIP|订阅后可参与|需订阅|订阅可参与|开通会员)/
const PHYSICAL_NAME_RE = /(实物|包邮|礼盒|手机|平板|电脑|耳机|手表|鼠标|键盘|洗衣液|纸巾|零食|玩偶|公仔|盲盒|礼品|奖品|抱枕|杯子)/
const VIRTUAL_NAME_RE = /(抖币|钻石|红包|优惠券|代金券|金币|福豆|会员|体验卡|流量|点券)/
const REDPACK_NAME_RE = /(红包|抖币|钻石|现金|元)/
const EN_FANCLUB_RE = /\b(fan\s*club|fanclub|fans\s*club|fansclub)\b/i
const EN_MEMBER_RE = /\b(member\s*only|subscriber|subscription|subscribe)\b/i

/**
 * 提取参与条件中的可读文本，供规则判断复用。
 * @param {object} condition 单条参与条件
 * @returns {{raw:string, lower:string}}
 */
function extractConditionText(condition) {
  const raw = [
    condition?.content,
    condition?.desc,
    condition?.description,
    condition?.name,
    condition?.title,
    condition?.text,
    condition?.condition_desc,
    condition?.condition_text
  ].filter(Boolean).join(' ')
  return {
    raw: String(raw || ''),
    lower: String(raw || '').toLowerCase()
  }
}

/**
 * 判断条件对象上是否存在显式布尔标记。
 * @param {object} condition 单条参与条件
 * @param {string[]} keys 候选键列表
 * @returns {boolean}
 */
function hasTruthyFlag(condition, keys = []) {
  return keys.some((key) => condition?.[key] === true)
}

/**
 * 判断福袋是否包含粉丝团参与要求（可由前端开关控制是否过滤）。
 * @param {object} lottery 福袋对象
 * @returns {boolean}
 */
export function hasFanClubJoinRequirement(lottery) {
  const conditions = Array.isArray(lottery?.conditions) ? lottery.conditions : []
  return conditions.some((c) => {
    const typeNum = Number(c?.type)
    if (typeNum === 2) return true
    if (hasTruthyFlag(c, [
      'need_fans_club',
      'need_fan_club',
      'fanclub_required',
      'fansclub_required',
      'join_fans_club',
      'join_fan_club'
    ])) {
      return true
    }
    const { raw, lower } = extractConditionText(c)
    return (
      FANCLUB_JOIN_RE.test(raw) ||
      EN_FANCLUB_RE.test(raw) ||
      lower.includes('加入粉丝团')
    )
  })
}

/**
 * 判断福袋是否包含会员参与要求（始终过滤）。
 * @param {object} lottery 福袋对象
 * @returns {boolean}
 */
export function hasMemberJoinRequirement(lottery) {
  const conditions = Array.isArray(lottery?.conditions) ? lottery.conditions : []
  return conditions.some((c) => {
    if (hasTruthyFlag(c, [
      'member_only',
      'need_member',
      'need_subscribe',
      'subscribe_required',
      'subscription_required'
    ])) {
      return true
    }
    const { raw, lower } = extractConditionText(c)
    return (
      MEMBER_JOIN_RE.test(raw) ||
      EN_MEMBER_RE.test(raw) ||
      lower.includes('member_only') ||
      lower.includes('subscription')
    )
  })
}

/**
 * 判断福袋是否带有受限参与条件（兼容：会员或粉丝团任一命中）。
 * @param {object} lottery 福袋对象
 * @returns {boolean}
 */
export function hasRestrictedJoinRequirement(lottery) {
  return hasMemberJoinRequirement(lottery) || hasFanClubJoinRequirement(lottery)
}

/**
 * 判断福袋是否满足“超人模式”的可参与条件（必须同时包含 type=3 和 type=6）。
 * @param {object} item 福袋对象
 * @returns {boolean}
 */
export function isSupermanJoinableLottery(item) {
  if (!item || !Array.isArray(item.conditions) || item.conditions.length === 0) return false
  const hasType3 = item.conditions.some(c => Number(c?.type) === 3)
  const hasType6 = item.conditions.some(c => Number(c?.type) === 6)
  return hasType3 && hasType6
}

/**
 * 判断福袋是否为实物奖品。
 * @param {object} lottery 福袋对象
 * @returns {boolean}
 */
export function isPhysicalPrizeLottery(lottery) {
  const typeCandidates = [
    lottery?.prizeType,
    lottery?.prize_info?.type,
    lottery?.prize_info?.prize_type,
    lottery?.prizeInfo?.type,
    lottery?.prizeInfo?.prize_type
  ].filter(v => v !== undefined && v !== null)

  for (const t of typeCandidates) {
    const n = Number(t)
    if (Number.isFinite(n)) {
      if (n === 3) return true
      if (n === 1 || n === 2 || n === 4) return false
    }
    const text = String(t)
    if (/实物|physical/i.test(text)) return true
    if (/diamond|coin|coupon|virtual|红包|抖币|钻石/i.test(text)) return false
  }

  const name = [
    lottery?.lotteryName,
    lottery?.prize_name,
    lottery?.prizeInfo?.name,
    lottery?.prize_info?.name
  ].filter(Boolean).join(' ')

  if (!name) return false
  if (VIRTUAL_NAME_RE.test(name) && !PHYSICAL_NAME_RE.test(name)) return false
  return PHYSICAL_NAME_RE.test(name)
}

/**
 * 将值转为有限数字，不可用时返回 null。
 * @param {*} v 原始值
 * @returns {number|null}
 */
function toFiniteNumber(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * 从多个候选值中返回第一个有效数字。
 * @param  {...any} vals 候选值
 * @returns {number|null}
 */
function firstFinite(...vals) {
  for (const v of vals) {
    const n = toFiniteNumber(v)
    if (n !== null) return n
  }
  return null
}

/**
 * 提取福袋总价值（用于计算人均福袋价值）。
 * @param {object} lottery 福袋对象
 * @returns {number|null}
 */
function extractLotteryTotalValue(lottery) {
  const prizeInfo = lottery?.prizeInfo || lottery?.prize_info || {}
  const total = firstFinite(
    lottery?.lotteryTotal,
    lottery?.lottery_total,
    lottery?.prizeTotalAmount,
    lottery?.rewardAmount,
    lottery?.total_amount,
    lottery?.totalAmount,
    prizeInfo?.total_amount,
    prizeInfo?.totalAmount,
    prizeInfo?.total_diamond_count,
    prizeInfo?.total_coin_count,
    prizeInfo?.diamond_count_total,
    prizeInfo?.reward_amount
  )
  if (total !== null) return total

  const unitValue = firstFinite(
    prizeInfo?.diamond_count,
    prizeInfo?.coin_count,
    prizeInfo?.amount,
    prizeInfo?.value
  )
  const prizeCount = firstFinite(lottery?.lotteryTotal, lottery?.prize_count)
  if (unitValue !== null && prizeCount !== null) {
    return unitValue * prizeCount
  }

  const name = [
    lottery?.lotteryName,
    lottery?.prize_name,
    prizeInfo?.name
  ].filter(Boolean).join(' ')
  const m = name.match(/(\d+(?:\.\d+)?)\s*(抖币|钻石|元)/)
  if (m) return Number(m[1])

  return null
}

/**
 * 计算福袋人均价值并判断是否达到“大红包”阈值。
 * @param {object} lottery 福袋对象
 * @param {number} threshold 大红包阈值
 * @returns {{isRedPacket:boolean, known:boolean, avgPerWinner:number, totalValue:number, isBig:boolean}}
 */
export function getRedPacketAveragePerWinner(lottery, threshold = 40) {
  if (!lottery || isPhysicalPrizeLottery(lottery)) {
    return { isRedPacket: false, known: false, avgPerWinner: 0, totalValue: 0, isBig: false }
  }

  const winners = firstFinite(
    lottery?.winningTotal,
    lottery?.luckyCount,
    lottery?.lucky_count,
    lottery?.winnerCount,
    lottery?.winner_count,
    lottery?.prizeInfo?.winner_count,
    lottery?.prize_info?.winner_count
  )
  const name = [
    lottery?.lotteryName,
    lottery?.prize_name,
    lottery?.prizeInfo?.name,
    lottery?.prize_info?.name
  ].filter(Boolean).join(' ')
  const isRedPacketLike = REDPACK_NAME_RE.test(name)

  if (!winners || winners <= 0) {
    return { isRedPacket: isRedPacketLike, known: false, avgPerWinner: 0, totalValue: 0, isBig: false }
  }

  const totalValue = extractLotteryTotalValue(lottery)
  if (totalValue === null) {
    return { isRedPacket: isRedPacketLike, known: false, avgPerWinner: 0, totalValue: 0, isBig: false }
  }

  const avgPerWinner = totalValue / winners
  return {
    isRedPacket: isRedPacketLike || totalValue > 0,
    known: true,
    avgPerWinner,
    totalValue,
    isBig: avgPerWinner >= Number(threshold || 40)
  }
}
