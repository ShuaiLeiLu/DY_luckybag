import { describe, expect, it } from 'vitest'
import {
  hasFanClubJoinRequirement,
  hasMemberJoinRequirement,
  hasRestrictedJoinRequirement,
  isPhysicalPrizeLottery,
  getRedPacketAveragePerWinner
} from './lotteryRules'

describe('lotteryRules helpers', () => {
  it('flags fan club and member conditions when they exist', () => {
    const fanClubLottery = { conditions: [{ type: 2 }, { content: '加群加入粉丝团' }] }
    expect(hasFanClubJoinRequirement(fanClubLottery)).toBe(true)
    expect(hasRestrictedJoinRequirement(fanClubLottery)).toBe(true)

    const memberLottery = { conditions: [{ member_only: true }] }
    expect(hasMemberJoinRequirement(memberLottery)).toBe(true)
    expect(hasRestrictedJoinRequirement(memberLottery)).toBe(true)
  })

  it('recognizes physical prizes by type and name heuristics', () => {
    expect(isPhysicalPrizeLottery({ prizeType: 3 })).toBe(true)
    expect(isPhysicalPrizeLottery({ prize_info: { prize_type: 1 } })).toBe(false)
    expect(isPhysicalPrizeLottery({ prizeInfo: { name: '抖币红包' } })).toBe(false)
  })

  it('calculates average per winner for red packets', () => {
    const lottery = {
      prizeInfo: { totalAmount: 240, name: '抖币红包' },
      winningTotal: 4
    }
    const result = getRedPacketAveragePerWinner(lottery, 30)
    expect(result.known).toBe(true)
    expect(result.avgPerWinner).toBe(60)
    expect(result.isBig).toBe(true)
    expect(result.isRedPacket).toBe(true)
  })

  it('marks unknown red packet statistics when winners are missing', () => {
    const lodge = { prizeInfo: { name: '红包' } }
    const result = getRedPacketAveragePerWinner(lodge)
    expect(result.known).toBe(false)
    expect(result.isRedPacket).toBe(true)
  })

  it('returns defaults for physical prizes', () => {
    const result = getRedPacketAveragePerWinner({ prizeType: 3 })
    expect(result.known).toBe(false)
    expect(result.isRedPacket).toBe(false)
  })
})
