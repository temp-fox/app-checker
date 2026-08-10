/**
 * 应用信息缓存机制
 * 缓存已查询过的应用信息，避免重复调用 API
 */

import { getStorageAppInfo } from '../storage'

const CACHE_VALID_HOURS = 4 // 缓存有效期：4小时（CI 每2h运行，最多跨2个周期）
const CACHE_VALID_MS = CACHE_VALID_HOURS * 60 * 60 * 1000

export interface CachedAppInfo {
  timestamp: number
  price: number
  formattedPrice: string
  inAppPurchases: Record<string, string>
  inAppPurchasesTimes: number
}

export interface CachedAppMetadata extends CachedAppInfo {
  trackId: number
  trackName: string
  trackViewUrl: string
  description: string
  artworkUrl60: string
  artworkUrl100?: string
  sellerName?: string
  artistName?: string
}

// 进程内存级缓存：每次运行只读一次磁盘，避免为每个 app 重复 IO
let _storageCache: Record<string, any> | null = null
let _storageCacheRegion: string | null = null

export function getStorageCached(region: string): StorageAppInfo {
  if (_storageCache && _storageCacheRegion === region) {
    return _storageCache as StorageAppInfo
  }
  const result = getStorageAppInfo([region as any])
  _storageCache = (result[region as any] || {}) as StorageAppInfo
  _storageCacheRegion = region
  return _storageCache as StorageAppInfo
}

export function isAppMetadataCacheValid(timestamp?: number): boolean {
  if (!timestamp) return false
  return Date.now() - timestamp <= CACHE_VALID_MS
}

/**
 * 获取缓存的应用信息
 * 检查本地存储中是否有该应用的最近记录
 * @param appId 应用ID
 * @param region 地区代码
 * @returns 缓存的应用信息，如果缓存过期或不存在返回 null
 */
export function getCachedAppInfo(appId: number, region: string): CachedAppInfo | null {
  try {
    const storageAppInfo = getStorageCached(region)
    const appIdStr = String(appId)

    if (!storageAppInfo[appIdStr]) {
      return null
    }

    const appData = storageAppInfo[appIdStr]
    const history = appData.history || []

    if (history.length === 0) {
      return null
    }

    // 获取最新的记录
    const latestEntry = history[0] || []
    const latestRecord = latestEntry[0]

    if (!latestRecord) {
      return null
    }

    if (!isAppMetadataCacheValid(latestRecord.timestamp)) {
      return null
    }

    // 返回缓存的应用信息
    return {
      timestamp: latestRecord.timestamp,
      price: latestRecord.price,
      formattedPrice: latestRecord.formattedPrice,
      inAppPurchases: latestRecord.inAppPurchases,
      inAppPurchasesTimes: latestRecord.inAppPurchasesTimes,
    }
  } catch (error) {
    // 缓存读取失败时，忽略错误继续执行
    return null
  }
}

/**
 * 检查应用是否应该使用缓存
 * 对于已存在于 apps.json 中的应用，优先使用缓存以提高性能
 * @param appId 应用ID
 * @returns 是否应该查询缓存
 */
export function shouldUseCache(appId: number): boolean {
  try {
    // 这里可以扩展为检查 apps.json，判断应用是否已被追踪
    // 当前简化实现：所有应用都检查缓存
    return true
  } catch (error) {
    return false
  }
}

export interface CachedScreenshots {
  screenshotUrls: string[]
  ipadScreenshotUrls: string[]
}

export function getCachedAppMetadata(appId: number, region: string): CachedAppMetadata | null {
  try {
    const storageAppInfo = getStorageCached(region)
    const appData = storageAppInfo[String(appId)]
    if (!appData) return null

    const history = appData.history || []
    const latestEntry = history[0] || []
    const latestRecord = latestEntry[0]

    if (!latestRecord || !isAppMetadataCacheValid(latestRecord.timestamp)) {
      return null
    }

    if (
      !appData.trackName ||
      !appData.trackViewUrl ||
      !appData.description ||
      !appData.artworkUrl60
    ) {
      return null
    }

    return {
      trackId: appId,
      trackName: appData.trackName,
      trackViewUrl: appData.trackViewUrl,
      description: appData.description,
      artworkUrl60: appData.artworkUrl60,
      artworkUrl100: appData.artworkUrl100,
      sellerName: appData.sellerName,
      artistName: appData.artistName,
      timestamp: latestRecord.timestamp,
      price: latestRecord.price,
      formattedPrice: latestRecord.formattedPrice,
      inAppPurchases: latestRecord.inAppPurchases,
      inAppPurchasesTimes: latestRecord.inAppPurchasesTimes,
    }
  } catch (error) {
    return null
  }
}

/**
 * 获取存储中缓存的截图（无过期限制，截图不随时间变化）
 */
export function getCachedScreenshots(appId: number, region: string): CachedScreenshots | null {
  try {
    const storageAppInfo = getStorageCached(region)
    const appData = storageAppInfo[String(appId)]
    if (!appData) return null

    const screenshotUrls = appData.screenshotUrls
    const ipadScreenshotUrls = appData.ipadScreenshotUrls

    if (screenshotUrls?.length > 0 || ipadScreenshotUrls?.length > 0) {
      return {
        screenshotUrls: screenshotUrls || [],
        ipadScreenshotUrls: ipadScreenshotUrls || [],
      }
    }
    return null
  } catch (error) {
    return null
  }
}

