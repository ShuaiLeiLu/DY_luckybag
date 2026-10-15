import type { UpdateSnapshot } from '@shared/models'

function normalizeKey(value: unknown) {
  return String(value || '').trim().toLowerCase()
}

/**
 * 更新状态文案映射。
 * 兼容不同来源的状态关键字。
 */
export function formatUpdateStatusText(status: UpdateSnapshot['status'] | string) {
  const key = normalizeKey(status)
  if (!key || key === 'disabled') return '未启用'
  if (key.includes('idle')) return '空闲'
  if (key.includes('checking')) return '检查中'
  if (key.includes('available')) return '可更新'
  if (key.includes('downloading')) return '下载中'
  if (key.includes('downloaded') || key.includes('ready')) return '下载完成'
  if (key.includes('error') || key.includes('failed')) return '更新异常'
  return String(status || '未知状态')
}

/**
 * 前端热更新状态文案映射。
 */
export function formatHotUpdateStatusText(status: string) {
  const key = normalizeKey(status)
  if (!key || key === 'disabled') return '未启用'
  if (key.includes('idle')) return '前端已最新'
  if (key.includes('checking')) return '检查中'
  if (key.includes('downloading')) return '更新下载中'
  if (key.includes('applied') || key.includes('ready')) return '前端已更新'
  if (key.includes('error') || key.includes('failed')) return '更新异常'
  return String(status || '未知状态')
}
