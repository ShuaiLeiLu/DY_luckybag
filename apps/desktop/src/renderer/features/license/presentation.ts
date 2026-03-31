import type { LicenseSnapshot, UpdateSnapshot } from '@shared/models'

function normalizeKey(value: unknown) {
  return String(value || '').trim().toLowerCase()
}

/**
 * 授权模式文案映射。
 * 兼容服务端扩展值（如 unrestricted_server / unrestricted (server)）。
 */
export function formatAccessModeText(accessMode: LicenseSnapshot['accessMode'] | string) {
  const key = normalizeKey(accessMode)
  if (!key || key === 'disabled') return '未启用'
  if (key.includes('unrestricted')) return '服务端免授权'
  if (key.includes('licensed') || key.includes('pro')) return '正式授权'
  if (key.includes('trial')) return '试用中'
  if (key.includes('locked') || key.includes('forbidden')) return '已锁定'
  return String(accessMode || '未知模式')
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
 * 授权计划文案映射。
 */
export function formatLicensePlanText(license: LicenseSnapshot) {
  const raw = String(license?.licensePlan || '').trim()
  const key = raw.toLowerCase()
  if (!key) {
    return license.authorized ? formatAccessModeText(license.accessMode) : '未授权'
  }
  if (key.includes('unrestricted')) return '服务端免授权'
  if (key.includes('trial')) return '3天试用'
  if (key.includes('licensed') || key.includes('pro')) return '正式授权'
  return raw
}
