import type { DesktopSettings } from '@shared/models'

/**
 * 兼容既有 LotteryManager 的配置适配层。
 * 在彻底迁移前，这里负责把新版设置结构转换为 legacy 结构。
 */
export function buildLegacyConfig(settings: DesktopSettings) {
  return {
    stayDuration: settings.stayDuration,
    enableRedPacket: settings.enableRedPacket,
    onlyRedPacketMode: settings.onlyRedPacketMode,
    hitRate: settings.hitRate,
    secondInspect: settings.secondInspect,
    filterFanClub: settings.filterFanClub,
    onlyPhysicalPrize: settings.onlyPhysicalPrize,
    preferBigRedPacket: settings.preferBigRedPacket,
    filterOnline: settings.filterOnline,
    randomInteraction: { enabled: settings.randomInteraction },
    participationCount: settings.participationCount,
    singleAccountDuration: settings.singleAccountDuration,
    poolServer: { url: settings.poolServerUrl }
  }
}
