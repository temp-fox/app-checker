import { writeFileSync, readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { regions } from 'appinfo.config'
import { getPrice } from '../calculate'

const rssFilePath = resolve(__dirname, '../storage/rss.json')

// 记录最近多少天的折扣信息
const keepDays = 3

export function readRegionDiscountInfo(): RegionDiscountInfo {
  // 动态生成 defaultRegionDiscountInfo
  const defaultRegionDiscountInfo: RegionDiscountInfo = regions.reduce(
    (acc, region) => {
      acc[region] = []
      return acc
    },
    {} as RegionDiscountInfo,
  )

  if (!existsSync(rssFilePath)) return defaultRegionDiscountInfo

  try {
    const data = JSON.parse(readFileSync(rssFilePath, 'utf-8'))
    const threeDaysAgo = Date.now() - keepDays * 24 * 60 * 60 * 1000

    return Object.entries(defaultRegionDiscountInfo).reduce(
      (filtered, [region, _]) => {
        const discounts = Array.isArray(data[region]) ? data[region] : []
        const validDiscounts = discounts.filter((discount) => {
          return (
            typeof discount === 'object' &&
            discount !== null &&
            typeof discount.timestamp === 'number' &&
            discount.timestamp >= threeDaysAgo &&
            typeof discount.trackName === 'string' &&
            typeof discount.trackViewUrl === 'string' &&
            Array.isArray(discount.discounts)
          )
        })
        filtered[region as Region] = validDiscounts
        return filtered
      },
      { ...defaultRegionDiscountInfo },
    )
  } catch {
    return defaultRegionDiscountInfo
  }
}

export function saveRegionDiscountInfo(regionDiscountInfo: RegionDiscountInfo) {
  writeFileSync(
    rssFilePath,
    JSON.stringify(regionDiscountInfo, null, 2),
    'utf-8',
  )
}

export default function getLastKeepDaysRegionDiscountInfo(
  newInfo: RegionDiscountInfo,
  regionAppInfo: RegionAppInfo,
): RegionDiscountInfo {
  const existingInfo = readRegionDiscountInfo()

  const merged = Object.entries(newInfo).reduce((res, [region, discounts]) => {
    const allDiscounts = [...(existingInfo[region] || []), ...discounts].sort(
      (a, b) => b.timestamp - a.timestamp,
    )

    // 用当前价格数据过滤已恢复原价的历史记录
    const currentAppInfos = regionAppInfo[region as Region] || []
    const appInfoMap = new Map<number, AppInfo>(
      currentAppInfos.map((info) => [info.trackId, info]),
    )

    let removedCount = 0
    res[region] = allDiscounts.filter((discountInfo) => {
      const currentApp = appInfoMap.get(discountInfo.trackId)
      // 当前轮次未查到的应用，保守保留
      if (!currentApp) return true

      const stillValid = discountInfo.discounts.some((d) => {
        if (d.type === 'price') {
          // 本体折扣：当前价格仍 ≤ 折扣记录中的价格
          return currentApp.price <= getPrice(d.to, region as Region)
        }
        if (d.type === 'inAppPurchase') {
          // 内购折扣：当前内购价格仍 ≤ 折扣记录中的折后价
          const currentIapPrice = currentApp.inAppPurchases[d.name]
          if (currentIapPrice === undefined) return true // 内购项目未找到，保守保留
          return getPrice(currentIapPrice, region as Region) <= getPrice(d.to, region as Region)
        }
        return true
      })

      if (!stillValid) removedCount++
      return stillValid
    })

    if (removedCount > 0) {
      console.log(`[${region}] RSS 记录: 移除 ${removedCount} 条已恢复原价`)
    }

    return res
  }, {} as RegionDiscountInfo)

  return merged
}
