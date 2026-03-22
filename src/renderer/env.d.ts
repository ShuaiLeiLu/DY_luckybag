import type { BootstrapSnapshot, DesktopSettings, RecoveryEvent, UpdateSnapshot } from '@shared/models'

declare global {
  interface Window {
    electronAPI: {
      machineFingerprint: string
      invoke: (channel: string, payload?: unknown) => Promise<any>
      on: (channel: string, handler: (...args: any[]) => void) => () => void
      desktop: {
        getBootstrap: () => Promise<BootstrapSnapshot>
        saveSettings: (settings: Partial<DesktopSettings>) => Promise<{ success: boolean; settings: DesktopSettings }>
        showAccountWindow: (accountId: string) => Promise<{ success: boolean }>
        hideAccountWindow: (accountId: string) => Promise<{ success: boolean }>
        setAccountMonitoring: (accountId: string, enabled: boolean) => Promise<{ success: boolean }>
        getUpdateState: () => Promise<UpdateSnapshot>
        checkForUpdates: () => Promise<UpdateSnapshot>
        downloadUpdate: () => Promise<UpdateSnapshot>
        installUpdate: () => Promise<{ success: boolean }>
        appendEvent: (event: Omit<RecoveryEvent, 'id' | 'createdAt'>) => Promise<{ success: boolean }>
        onUpdateState: (handler: (snapshot: UpdateSnapshot) => void) => () => void
      }
    }
  }
}

export {}
