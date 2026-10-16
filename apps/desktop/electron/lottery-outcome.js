function normalizeLotteryOutcome(raw, expected = {}) {
  const data = raw?.data || raw || {}
  const lotteryId = String(data.lottery_id_str || data.lottery_id || data.lotteryId || data.lottery_info?.lottery_id_str || data.lottery_info?.lottery_id || '')
  if (!lotteryId || lotteryId !== String(expected.lotteryId || '')) return { success: true, resultStatus: 'unknown', reason: 'target_unconfirmed' }
  const userId = String(data.user_id || data.userId || '')
  if (userId && expected.userId && userId !== String(expected.userId)) return { success: true, resultStatus: 'unknown', reason: 'account_mismatch' }
  const explicit = data.is_winner ?? data.isWinner ?? data.won
  const terminal = data.draw_finished === true || data.finished === true || ['won', 'lost'].includes(data.resultStatus)
  if (!terminal || (typeof explicit !== 'boolean' && !['won','lost'].includes(data.resultStatus))) return { success: true, lotteryId, resultStatus: 'unknown', reason: 'result_pending' }
  const won = explicit === true || data.resultStatus === 'won'
  return { success: true, lotteryId, resultStatus: won ? 'won' : 'lost', rewardAmount: won ? Math.max(0, Number(data.reward_amount ?? data.rewardAmount ?? 0)) : 0, reason: 'confirmed_result' }
}
module.exports = { normalizeLotteryOutcome }
