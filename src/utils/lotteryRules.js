export const RESTRICTED_JOIN_RE = /(粉丝团|粉丝专属|仅粉丝|仅限粉丝|团员|加团|主播会员|会员可参与|仅会员|会员专属)/
const PHYSICAL_NAME_RE = /(实物|包邮|礼盒|手机|平板|电脑|耳机|手表|鼠标|键盘|洗衣液|纸巾|零食|玩偶|公仔|盲盒|礼品|奖品|抱枕|杯子)/
const VIRTUAL_NAME_RE = /(抖币|钻石|红包|优惠券|代金券|金币|福豆|会员|体验卡|流量|点券)/
const REDPACK_NAME_RE = /(红包|抖币|钻石|现金|元)/

export function hasRestrictedJoinRequirement(lottery) {
  const conditions = Array.isArray(lottery?.conditions) ? lottery.conditions : []
  return conditions.some((c) => {
    const typeNum = Number(c?.type)
    const text = [
      c?.content,
      c?.desc,
      c?.description,
      c?.name,
      c?.title,
      c?.text,
      JSON.stringify(c || {})
    ].filter(Boolean).join(' ')
    return typeNum === 2 || RESTRICTED_JOIN_RE.test(String(text))
  })
}

export function isSupermanJoinableLottery(item) {
  if (!item || !Array.isArray(item.conditions) || item.conditions.length === 0) return false
  if (hasRestrictedJoinRequirement(item)) return false
  const hasType3 = item.conditions.some(c => Number(c?.type) === 3)
  const hasType6 = item.conditions.some(c => Number(c?.type) === 6)
  return hasType3 && hasType6
}

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

function toFiniteNumber(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function firstFinite(...vals) {
  for (const v of vals) {
    const n = toFiniteNumber(v)
    if (n !== null) return n
  }
  return null
}

function extractTotalRedPacketValue(lottery) {
  const prizeInfo = lottery?.prizeInfo || lottery?.prize_info || {}
  const total = firstFinite(
    lottery?.prizeTotalAmount,
    lottery?.total_amount,
    lottery?.totalAmount,
    prizeInfo?.total_amount,
    prizeInfo?.totalAmount,
    prizeInfo?.total_diamond_count,
    prizeInfo?.total_coin_count,
    prizeInfo?.diamond_count_total
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

export function getRedPacketAveragePerWinner(lottery, threshold = 40) {
  if (!lottery || isPhysicalPrizeLottery(lottery)) {
    return { isRedPacket: false, known: false, avgPerWinner: 0, totalValue: 0, isBig: false }
  }

  const winners = firstFinite(lottery?.winningTotal, lottery?.lucky_count)
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

  const totalValue = extractTotalRedPacketValue(lottery)
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
