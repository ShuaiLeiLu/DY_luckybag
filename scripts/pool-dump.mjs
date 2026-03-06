const baseUrl = (process.env.POOL_SERVER_URL || process.env.DY_POOL_SERVER_URL || 'http://127.0.0.1:9090').replace(/\/+$/, '')
const limit = Number(process.env.POOL_DUMP_LIMIT || 5000)

async function main() {
  const url = `${baseUrl}/pool/top?limit=${Math.max(1, limit)}`
  const res = await fetch(url, { headers: { 'content-type': 'application/json' } }).catch((err) => {
    throw new Error(`请求失败: ${err?.message || err}`)
  })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }
  const data = await res.json().catch(() => {
    throw new Error('响应不是 JSON')
  })
  if (!data?.ok) {
    throw new Error(`接口返回失败: ${data?.error || 'unknown'}`)
  }

  const items = Array.isArray(data.items) ? data.items : []
  const nowSec = Math.floor(Date.now() / 1000)

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`服务器筛选池: ${baseUrl}`)
  console.log(`活跃: ${Number(data.activeCandidates || 0)} | 有效: ${Number(data.validCandidates || 0)} | 返回: ${items.length}`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  items.forEach((item, idx) => {
    const name = item.authorNickname || '未知主播'
    const lottery = item.lotteryName || item.prizeInfo?.name || '未知福袋'
    const prob = Number(item.probability || 0).toFixed(2)
    const endMs = Number(item.endTime || 0)
    const endSec = endMs > 1e12 ? Math.floor(endMs / 1000) : Math.floor(endMs)
    const remain = Math.max(0, endSec - nowSec)
    const join = Number(item.joinTotal || 0)
    const lucky = Number(item.luckyCount || 0)
    console.log(`${idx + 1}. ${name} | ${lottery} | 概率${prob}% | 剩余${remain}s | ${lucky}/${join}`)
  })

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
}

main().catch((err) => {
  console.error(`❌ ${err?.message || err}`)
  process.exit(1)
})
