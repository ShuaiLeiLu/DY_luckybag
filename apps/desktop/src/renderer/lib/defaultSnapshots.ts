import type { UpdateSnapshot } from '@shared/models'

export type HotUpdateSnapshot = {
  status: string
  enabled: boolean
  manifestUrl: string
  reloadOnApply: boolean
  currentVersion: string
  latestVersion: string
  message: string
  checkedAt: number
  appliedEntryFile: string
}

export const emptyUpdate: UpdateSnapshot = {
  status: 'disabled',
  currentVersion: '0.0.0',
  latestVersion: '',
  progress: 0,
  message: '未配置更新源',
  feedUrl: '',
  checkedAt: 0
}

export const emptyHotUpdate: HotUpdateSnapshot = {
  status: 'disabled',
  enabled: false,
  manifestUrl: '',
  reloadOnApply: false,
  currentVersion: '',
  latestVersion: '',
  message: '热更新未启用',
  checkedAt: 0,
  appliedEntryFile: ''
}
