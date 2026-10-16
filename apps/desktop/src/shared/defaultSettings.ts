import rawDefaults from './defaultSettings.json'
import type { DesktopSettings, RequestBackendType } from './models'

/**
 * Default desktop settings — Single Source of Truth.
 *
 * The raw values live in `defaultSettings.json` so both Electron CommonJS
 * code and the renderer TypeScript code can share the same defaults.
 */
export const DEFAULT_DESKTOP_SETTINGS: Readonly<DesktopSettings> = Object.freeze({
  ...rawDefaults,
  requestBackend: 'android' as RequestBackendType,
  hitRate: Object.freeze({ ...rawDefaults.hitRate }),
  secondInspect: Object.freeze({ ...rawDefaults.secondInspect }),
  filterFanClub: Object.freeze({ ...rawDefaults.filterFanClub }),
  onlyRedPacketMode: Object.freeze({ ...rawDefaults.onlyRedPacketMode }),
  onlyPhysicalPrize: Object.freeze({ ...rawDefaults.onlyPhysicalPrize }),
  preferBigRedPacket: Object.freeze({ ...rawDefaults.preferBigRedPacket }),
  filterOnline: Object.freeze({ ...rawDefaults.filterOnline }),
  participationCount: Object.freeze({ ...rawDefaults.participationCount }),
  singleAccountDuration: Object.freeze({ ...rawDefaults.singleAccountDuration }),
  scanConfig: Object.freeze({ ...rawDefaults.scanConfig })
})

export type DesktopSettingsDefaults = typeof DEFAULT_DESKTOP_SETTINGS
