/**
 * 外部数据源工具函数
 */

import dayjs from 'dayjs'
import utcPlugin from 'dayjs/plugin/utc'
import timezonePlugin from 'dayjs/plugin/timezone'

dayjs.extend(utcPlugin)
dayjs.extend(timezonePlugin)

const CHINA_TZ = 'Asia/Shanghai'

/**
 * 从 App Store URL 中提取 App ID
 * @param url App Store URL
 * @returns App ID，如果未找到则返回 null
 */
export function extractAppId(url: string): string | null {
  // 匹配模式：id 后跟 9-10 位数字
  const match = url.match(/id(\d{9,10})/)
  return match ? match[1] : null
}

/**
 * 验证 App Store URL 是否有效
 * @param url URL 字符串
 * @returns 是否为有效的 App Store URL
 */
export function isValidAppStoreUrl(url: string): boolean {
  if (!url) return false
  
  // 支持 apps.apple.com 和 itunes.apple.com
  return (
    url.includes('apps.apple.com') || 
    url.includes('itunes.apple.com')
  ) && extractAppId(url) !== null
}

/**
 * 规范化 App Store URL
 * 移除查询参数，保留核心 URL
 * @param url 原始 URL
 * @returns 规范化后的 URL
 */
export function normalizeAppStoreUrl(url: string): string {
  try {
    // 解码 HTML 实体（如 &amp; -> &）
    let decoded = url.replace(/&amp;/g, '&')
    
    const urlObj = new URL(decoded)
    
    // 只保留 pathname，移除查询参数
    return `${urlObj.origin}${urlObj.pathname}`
  } catch {
    return url
  }
}

/**
 * 检查日期是否为今天（以中国时间判断）
 * @param date 日期对象或字符串
 * @returns 是否为今天
 */
export function isToday(date: Date | string): boolean {
  const checkDate = dayjs(typeof date === 'string' ? new Date(date) : date).tz(CHINA_TZ)
  const today = dayjs().tz(CHINA_TZ)
  return checkDate.format('YYYY-MM-DD') === today.format('YYYY-MM-DD')
}

/**
 * 生成今天的缓存文件名（以中国时间判断）
 * @returns 缓存文件名，如 external_cache_2026-03-01.json
 */
export function getTodayCacheFileName(): string {
  const dateStr = getChinaDateStr()
  return `external_cache_${dateStr}.json`
}

/**
 * 获取当前中国时间的日期字符串
 * @returns 日期字符串，如 2026-03-07
 */
export function getChinaDateStr(): string {
  return dayjs().tz(CHINA_TZ).format('YYYY-MM-DD')
}

/**
 * 检查日期是否在最近 N 天内（以中国时间判断）
 * @param date 日期对象或字符串
 * @param days 天数
 * @returns 是否在范围内
 */
export function isWithinDays(date: Date | string, days: number): boolean {
  const checkDate = dayjs(typeof date === 'string' ? new Date(date) : date).tz(CHINA_TZ)
  const cutoff = dayjs().tz(CHINA_TZ).subtract(days, 'day').startOf('day')
  return checkDate.isAfter(cutoff)
}
