import type { BootstrapSnapshot, DesktopSettings, LotteryHistoryRecord, RecoveryEvent, UpdateSnapshot } from '@shared/models'

declare global {
  interface Window {
    electronAPI: {
      invoke: (channel: string, payload?: unknown) => Promise<any>
      on: (channel: string, handler: (...args: any[]) => void) => () => void
      desktop: {
        getBootstrap: () => Promise<BootstrapSnapshot>
        saveSettings: (settings: Partial<DesktopSettings>) => Promise<{ success: boolean; settings: DesktopSettings }>
        getUpdateState: () => Promise<UpdateSnapshot>
        checkForUpdates: () => Promise<UpdateSnapshot>
        downloadUpdate: () => Promise<UpdateSnapshot>
        installUpdate: () => Promise<{ success: boolean }>
        getHotUpdateState: () => Promise<{
          status: string
          enabled: boolean
          manifestUrl: string
          reloadOnApply: boolean
          currentVersion: string
          latestVersion: string
          message: string
          checkedAt: number
          appliedEntryFile: string
        }>
        checkHotUpdate: () => Promise<{
          status: string
          enabled: boolean
          manifestUrl: string
          reloadOnApply: boolean
          currentVersion: string
          latestVersion: string
          message: string
          checkedAt: number
          appliedEntryFile: string
        }>
        appendEvent: (event: Omit<RecoveryEvent, 'id' | 'createdAt'>) => Promise<{ success: boolean }>
        appendAccountLog: (record: {
          accountId: string
          level?: RecoveryEvent['level'] | 'debug'
          message: string
          scope?: string
          createdAt?: number
        }) => Promise<{ success: boolean; item?: unknown; error?: string }>
        appendHistoryRecord: (record: Partial<LotteryHistoryRecord>) => Promise<{ success: boolean; item?: LotteryHistoryRecord; error?: string }>
        purgeAccountData: (accountId: string) => Promise<{
          success: boolean
          result?: {
            accountId: string
            deletedHistoryRows: number
            deletedAccountLogFiles: number
            deletedAccountLogBytes: number
            deletedJoinJsonlRows: number
            deletedWinJsonlRows: number
          }
          error?: string
        }>
        onUpdateState: (handler: (snapshot: UpdateSnapshot) => void) => () => void
        onHotUpdateState: (handler: (snapshot: {
          status: string
          enabled: boolean
          manifestUrl: string
          reloadOnApply: boolean
          currentVersion: string
          latestVersion: string
          message: string
          checkedAt: number
          appliedEntryFile: string
        }) => void) => () => void
      }
    }
  }
}

export {}
