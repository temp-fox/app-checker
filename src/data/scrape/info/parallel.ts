import { chunk } from 'lodash'
import pLimit from 'p-limit'
import { start, end } from '../../timer'
import { buildSummaryDescription, sanitizeDescription } from '../../calculate'
import getAppInfo from './getAppInfo'
import { getCachedAppInfo, getCachedAppMetadata, getCachedScreenshots, shouldUseCache } from '../../helper/appCache'
import {
  getByFetch,
  getByPlayWright,
  GetInAppPurchasesResult,
  GetInAppPurchasesProps,
  playWrightBrowserManager,
} from './getInAppPurchases'
import { initAmpApiToken, getScreenshotsByAmpApi, getAppMetadataByAmpApi, getScreenshotsByLookup, getScreenshotsByAppStorePage, AppMetadataResult } from './getScreenshots'

const scrapeTypeImplMap: Record<
  InAppPurchasesScrapeType,
  (
    props: GetInAppPurchasesProps,
  ) => GetInAppPurchasesResult | Promise<GetInAppPurchasesResult>
> = {
  fetch: getByFetch,
  playwright: getByPlayWright,
}

function mergeValue<T>(...values: Array<T | undefined | null>): T | undefined {
  for (const value of values) {
    if (Array.isArray(value)) {
      if (value.length > 0) return value as T
      continue
    }
    if (value !== undefined && value !== null && value !== '') {
      return value as T
    }
  }
  return undefined
}

function getMergedDescriptions(...values: Array<string | undefined | null>) {
  const mergedFullDescription = sanitizeDescription(mergeValue(...values) || '')
  const summaryDescription = buildSummaryDescription(mergedFullDescription)

  return {
    description: mergedFullDescription,
    fullDescription: mergedFullDescription,
    summaryDescription,
  }
}

async function refreshScreenshotsForApps(
  apps: Array<AppInfo | DiscountInfo>,
  region: Region,
  label: string,
) {
  if (apps.length === 0) return

  const totalApps = apps.length
  const tokenOk = await initAmpApiToken(region)
  const appMetadataMap = new Map<number, AppMetadataResult>()

  if (tokenOk) {
    const metadataBatchSize = 50
    const allTrackIds = apps.map((app) => app.trackId)
    for (let b = 0; b < allTrackIds.length; b += metadataBatchSize) {
      const batchIds = allTrackIds.slice(b, b + metadataBatchSize)
      const batchResult = await getAppMetadataByAmpApi(batchIds, region)
      for (const [id, metadata] of batchResult) {
        appMetadataMap.set(id, metadata)
      }
    }
  }

  let ampMetadataHitCount = 0
  apps.forEach((app) => {
    const metadata = appMetadataMap.get(app.trackId)
    if (metadata?.screenshotUrls.length) {
      app.screenshotUrls = metadata.screenshotUrls
    }
    if (metadata?.ipadScreenshotUrls.length) {
      app.ipadScreenshotUrls = metadata.ipadScreenshotUrls
    }
    if (metadata?.screenshotUrls.length || metadata?.ipadScreenshotUrls.length) {
      ampMetadataHitCount++
    }
  })

  const appsNeedLookup = apps.filter(
    (app) =>
      (!app.screenshotUrls || app.screenshotUrls.length === 0) &&
      (!app.ipadScreenshotUrls || app.ipadScreenshotUrls.length === 0),
  )

  let lookupHitCount = 0
  if (appsNeedLookup.length > 0) {
    const lookupMap = await getScreenshotsByLookup(
      appsNeedLookup.map((app) => app.trackId),
      region,
    )

    appsNeedLookup.forEach((app) => {
      const lookupResult = lookupMap.get(app.trackId)
      if (lookupResult?.screenshotUrls.length) {
        app.screenshotUrls = lookupResult.screenshotUrls
      }
      if (lookupResult?.ipadScreenshotUrls.length) {
        app.ipadScreenshotUrls = lookupResult.ipadScreenshotUrls
      }
      if (lookupResult?.screenshotUrls.length || lookupResult?.ipadScreenshotUrls.length) {
        lookupHitCount++
      }
    })
  }

  const appsNeedPageFallback = apps.filter(
    (app) =>
      (!app.screenshotUrls || app.screenshotUrls.length === 0) &&
      (!app.ipadScreenshotUrls || app.ipadScreenshotUrls.length === 0),
  )

  let pageFallbackHitCount = 0
  if (appsNeedPageFallback.length > 0) {
    const pageMap = await getScreenshotsByAppStorePage(
      appsNeedPageFallback.map((app) => app.trackId),
      region,
    )

    appsNeedPageFallback.forEach((app) => {
      const pageResult = pageMap.get(app.trackId)
      if (pageResult?.screenshotUrls.length) {
        app.screenshotUrls = pageResult.screenshotUrls
      }
      if (pageResult?.ipadScreenshotUrls.length) {
        app.ipadScreenshotUrls = pageResult.ipadScreenshotUrls
      }
      if (pageResult?.screenshotUrls.length || pageResult?.ipadScreenshotUrls.length) {
        pageFallbackHitCount++
      }
    })

    console.log(`${label} RSS 页面截图兜底: 成功 ${pageFallbackHitCount}/${appsNeedPageFallback.length} 个`)
  }

  const stillMissingCount = apps.filter(
    (app) =>
      (!app.screenshotUrls || app.screenshotUrls.length === 0) &&
      (!app.ipadScreenshotUrls || app.ipadScreenshotUrls.length === 0),
  ).length

  console.log(`${label} RSS 截图强刷明细:`)
  console.log(`  ├─ 进入最终 RSS 强刷应用: ${totalApps} 个`)
  console.log(`  ├─ amp-api 元数据命中截图: ${ampMetadataHitCount} 个`)
  console.log(`  ├─ 进入 lookup 补图: ${appsNeedLookup.length} 个 | 命中: ${lookupHitCount} 个`)
  console.log(`  ├─ 进入页面 HTML 兜底: ${appsNeedPageFallback.length} 个 | 命中: ${pageFallbackHitCount} 个`)
  console.log(`  └─ 最终仍缺截图: ${stillMissingCount} 个`)
}

export async function refreshRssAppInfos(
  timestamp: number,
  regionDiscountInfo: RegionDiscountInfo,
  regionStorageAppInfo: RegionStorageAppInfo,
  regionAppInfo?: RegionAppInfo,
) {
  const refreshedRegionDiscountInfo = regionDiscountInfo
  const refreshTimestamp = timestamp

  for (const [region, discountInfos] of Object.entries(refreshedRegionDiscountInfo) as Array<[Region, DiscountInfo[]]>) {
    if (!discountInfos?.length) continue

    const label = `【RSS 强刷】（${region}）`
    const appIds = discountInfos.map((app) => app.trackId)
    const refreshedAppInfos = await getAppInfo(appIds, region, `${label}getAppInfo`, {
      forceRefresh: true,
    })
    const refreshedMap = new Map<number, RequestAppInfo>(
      refreshedAppInfos.map((app) => [app.trackId, app]),
    )
    const currentMap = new Map<number, AppInfo>(
      (regionAppInfo?.[region] || []).map((app) => [app.trackId, app]),
    )
    const storageMap = regionStorageAppInfo[region] || {}

    const refreshTargets = discountInfos.map((discountInfo) => {
      const refreshed = refreshedMap.get(discountInfo.trackId)
      const current = currentMap.get(discountInfo.trackId)
      const cachedMetadata = getCachedAppMetadata(discountInfo.trackId, region)
      const cachedScreenshots = getCachedScreenshots(discountInfo.trackId, region)
      const storageItem = storageMap[String(discountInfo.trackId)]

      return {
        discountInfo,
        refreshed,
        current,
        cachedMetadata,
        cachedScreenshots,
        storageItem,
      }
    })

    console.log(`${label} 开始强制刷新 ${refreshTimestamp}: ${discountInfos.length} 个应用`)

    await refreshScreenshotsForApps(
      refreshTargets.map(({ discountInfo }) => discountInfo),
      region,
      label,
    )

    refreshTargets.forEach(({ discountInfo, refreshed, current, cachedMetadata, cachedScreenshots, storageItem }) => {
      const mergedDescriptions = getMergedDescriptions(
        refreshed?.fullDescription,
        refreshed?.description,
        discountInfo.fullDescription,
        discountInfo.description,
        current?.fullDescription,
        current?.description,
        cachedMetadata?.description,
        storageItem?.fullDescription,
        storageItem?.description,
      )

      Object.assign(discountInfo, mergedDescriptions)

      discountInfo.artworkUrl60 = mergeValue(
        refreshed?.artworkUrl60,
        discountInfo.artworkUrl60,
        current?.artworkUrl60,
        cachedMetadata?.artworkUrl60,
        storageItem?.artworkUrl60,
      ) || discountInfo.artworkUrl60

      discountInfo.trackViewUrl = mergeValue(
        refreshed?.trackViewUrl,
        discountInfo.trackViewUrl,
        current?.trackViewUrl,
        cachedMetadata?.trackViewUrl,
        storageItem?.trackViewUrl,
      ) || discountInfo.trackViewUrl

      discountInfo.screenshotUrls = mergeValue(
        discountInfo.screenshotUrls,
        current?.screenshotUrls,
        cachedScreenshots?.screenshotUrls,
        storageItem?.screenshotUrls,
      ) || []

      discountInfo.ipadScreenshotUrls = mergeValue(
        discountInfo.ipadScreenshotUrls,
        current?.ipadScreenshotUrls,
        cachedScreenshots?.ipadScreenshotUrls,
        storageItem?.ipadScreenshotUrls,
      ) || []

      if (storageItem) {
        storageItem.name = mergeValue(
          refreshed?.trackName,
          discountInfo.trackName,
          current?.trackName,
          cachedMetadata?.trackName,
          storageItem.name,
        ) || storageItem.name
        storageItem.trackName = mergeValue(
          refreshed?.trackName,
          discountInfo.trackName,
          current?.trackName,
          cachedMetadata?.trackName,
          storageItem.trackName,
        ) || storageItem.trackName
        storageItem.trackViewUrl = mergeValue(
          refreshed?.trackViewUrl,
          discountInfo.trackViewUrl,
          current?.trackViewUrl,
          cachedMetadata?.trackViewUrl,
          storageItem.trackViewUrl,
        ) || storageItem.trackViewUrl
        Object.assign(
          storageItem,
          getMergedDescriptions(
            refreshed?.fullDescription,
            refreshed?.description,
            discountInfo.fullDescription,
            discountInfo.description,
            current?.fullDescription,
            current?.description,
            cachedMetadata?.description,
            storageItem.fullDescription,
            storageItem.description,
          ),
        )
        storageItem.artworkUrl60 = mergeValue(
          refreshed?.artworkUrl60,
          discountInfo.artworkUrl60,
          current?.artworkUrl60,
          cachedMetadata?.artworkUrl60,
          storageItem.artworkUrl60,
        ) || storageItem.artworkUrl60
        storageItem.artworkUrl100 = mergeValue(
          refreshed?.artworkUrl100,
          current?.artworkUrl100,
          cachedMetadata?.artworkUrl100,
          storageItem.artworkUrl100,
        ) || storageItem.artworkUrl100
        storageItem.sellerName = mergeValue(
          refreshed?.sellerName,
          current?.sellerName,
          cachedMetadata?.sellerName,
          storageItem.sellerName,
        ) || storageItem.sellerName
        storageItem.artistName = mergeValue(
          refreshed?.artistName,
          current?.artistName,
          cachedMetadata?.artistName,
          storageItem.artistName,
        ) || storageItem.artistName
        if (discountInfo.screenshotUrls.length > 0) {
          storageItem.screenshotUrls = discountInfo.screenshotUrls
        }
        if (discountInfo.ipadScreenshotUrls.length > 0) {
          storageItem.ipadScreenshotUrls = discountInfo.ipadScreenshotUrls
        }
      }
    })
  }

  return refreshedRegionDiscountInfo
}

export default async function getRegionAppInfo(
  appIds: Array<string | number>,
  regions: Region[],
  limitCount: number,
  scrapeType: InAppPurchasesScrapeType,
) {
  const label = `parallel getRegionAppInfo(${limitCount})`
  start(label)
  const res: RegionAppInfo = {}
  const limit = pLimit(limitCount)
  const chunkAppIds = chunk(appIds, 200)

  try {
    if (scrapeType === 'playwright') {
      await playWrightBrowserManager.initialize()
    }
    const scrapeImpl = scrapeTypeImplMap[scrapeType]

    for (let i = 0; i < regions.length; i++) {
      const region = regions[i]
      const label = `【${i + 1}/${regions.length}】（${region}）`

      const appInfos = (
        await Promise.all(
          chunkAppIds.map((appIds, i) => {
            const label2 = `${label}【${i + 1}/${chunkAppIds.length}】`
            return getAppInfo(appIds, region, `${label2}getAppInfo`, {
              preferCache: true,
            })
          }),
        )
      ).reduce((res, appInfos) => {
        res.push(...appInfos)
        return res
      }, [] as RequestAppInfo[])

      const queriedCount = appIds.length
      if (appInfos.length === 0) {
        console.log(`${label} API 返回 0 个结果（查询 ${queriedCount} 个）`)
      }

      if (appInfos.length > 0) {
        const appMetadataMap = new Map<number, AppMetadataResult>()
        const tokenOk = await initAmpApiToken(region)
        if (tokenOk) {
          const metadataBatchSize = 50
          const allTrackIds = appInfos.map((app) => app.trackId)
          for (let b = 0; b < allTrackIds.length; b += metadataBatchSize) {
            const batchIds = allTrackIds.slice(b, b + metadataBatchSize)
            const batchResult = await getAppMetadataByAmpApi(batchIds, region)
            for (const [id, metadata] of batchResult) {
              appMetadataMap.set(id, metadata)
            }
          }
          console.log(`${label} amp-api 元数据: 获取 ${appMetadataMap.size}/${allTrackIds.length} 个应用`)
        } else {
          console.warn(`${label} amp-api 元数据: 跳过（token 获取失败），所有应用走原有爬取路径`)
        }

        let cacheHitCount = 0
        let cacheMissCount = 0
        let skipCount = 0
        let appMetadataCacheHitCount = 0

        const inAppPurchasesArr: GetInAppPurchasesResult[] = await Promise.all(
          appInfos.map((appInfo, j) => {
            if (getCachedAppMetadata(appInfo.trackId, region)) {
              appMetadataCacheHitCount++
            }

            let cachedData = null
            if (shouldUseCache(appInfo.trackId)) {
              cachedData = getCachedAppInfo(appInfo.trackId, region)
            }

            if (cachedData) {
              cacheHitCount++
              return Promise.resolve({
                inAppPurchases: cachedData.inAppPurchases,
                times: cachedData.inAppPurchasesTimes,
                failed: false,
              })
            }

            const metadata = appMetadataMap.get(appInfo.trackId)
            if (metadata?.hasInAppPurchases === false) {
              skipCount++
              return Promise.resolve({
                inAppPurchases: {},
                times: 0,
                failed: false,
              })
            }

            cacheMissCount++
            return limit(() =>
              scrapeImpl({
                appInfo,
                region,
                log: `${label}【${j + 1}/${appInfos.length}】【${
                  appInfo.trackName
                }】【by ${scrapeType}】`,
              }),
            )
          }),
        )

        const iapFailedCount = inAppPurchasesArr.filter(r => r.failed).length
        console.log(`${label} 内购价格获取统计:`)
        console.log(`  ├─ 基础信息缓存命中: ${appMetadataCacheHitCount} 个`)
        console.log(`  ├─ iTunes API 返回基础信息: ${appInfos.length} 个应用`)
        console.log(`  ├─ 内购数据缓存复用（无需重新爬取）: ${cacheHitCount} 个`)
        console.log(`  ├─ 确认无内购跳过（amp-api 判定）: ${skipCount} 个`)
        console.log(`  ├─ 需要爬取内购价格: ${cacheMissCount} 个`)
        if (iapFailedCount > 0) console.log(`  └─ ⚠️ 内购爬取失败（超时/被封/页面异常）: ${iapFailedCount} 个`)

        res[region] = appInfos.reduce((res, appInfo, j) => {
          const { inAppPurchases, times, failed } = inAppPurchasesArr[j]
          res.push({
            ...appInfo,
            inAppPurchases,
            inAppPurchasesTimes: times,
            inAppPurchasesFailed: failed,
          })
          return res
        }, [] as AppInfo[])

        let cacheRestoredCount = 0
        res[region].forEach((app) => {
          if (
            (!app.screenshotUrls || app.screenshotUrls.length === 0) &&
            (!app.ipadScreenshotUrls || app.ipadScreenshotUrls.length === 0)
          ) {
            const cached = getCachedScreenshots(app.trackId, region)
            if (cached) {
              if (cached.screenshotUrls.length > 0) app.screenshotUrls = cached.screenshotUrls
              if (cached.ipadScreenshotUrls.length > 0) app.ipadScreenshotUrls = cached.ipadScreenshotUrls
              cacheRestoredCount++
            }
          }
        })

        if (appMetadataMap.size > 0) {
          let screenshotSuccessCount = 0
          const appsNeedScreenshots = res[region].filter(
            (app) =>
              (!app.screenshotUrls || app.screenshotUrls.length === 0) &&
              (!app.ipadScreenshotUrls || app.ipadScreenshotUrls.length === 0),
          )

          for (const app of appsNeedScreenshots) {
            const metadata = appMetadataMap.get(app.trackId)
            if (metadata) {
              if (metadata.screenshotUrls.length > 0) {
                app.screenshotUrls = metadata.screenshotUrls
              }
              if (metadata.ipadScreenshotUrls.length > 0) {
                app.ipadScreenshotUrls = metadata.ipadScreenshotUrls
              }
              if (metadata.screenshotUrls.length > 0 || metadata.ipadScreenshotUrls.length > 0) {
                screenshotSuccessCount++
              }
            }
          }

          if (cacheRestoredCount > 0 || appsNeedScreenshots.length > 0) {
            console.log(`${label} 截图补充统计:`)
            console.log(`  ├─ 从本地缓存恢复截图: ${cacheRestoredCount} 个`)
            console.log(`  ├─ 仍缺截图的应用: ${appsNeedScreenshots.length} 个`)
            console.log(`  └─ amp-api 成功补充截图: ${screenshotSuccessCount} 个，失败: ${appsNeedScreenshots.length - screenshotSuccessCount} 个`)
          }
        } else {
          const appsNeedScreenshots = res[region].filter(
            (app) =>
              (!app.screenshotUrls || app.screenshotUrls.length === 0) &&
              (!app.ipadScreenshotUrls || app.ipadScreenshotUrls.length === 0),
          )

          if (appsNeedScreenshots.length > 0 && tokenOk) {
            let screenshotSuccessCount = 0

            const batchSize = 50
            for (let b = 0; b < appsNeedScreenshots.length; b += batchSize) {
              const batch = appsNeedScreenshots.slice(b, b + batchSize)
              const batchIds = batch.map((app) => app.trackId)
              const screenshotsMap = await getScreenshotsByAmpApi(batchIds, region)

              for (const app of batch) {
                const result = screenshotsMap.get(app.trackId)
                if (result) {
                  if (result.screenshotUrls.length > 0) {
                    app.screenshotUrls = result.screenshotUrls
                  }
                  if (result.ipadScreenshotUrls.length > 0) {
                    app.ipadScreenshotUrls = result.ipadScreenshotUrls
                  }
                  screenshotSuccessCount++
                }
              }
            }

            console.log(`${label} 截图补充(降级): 缓存恢复: ${cacheRestoredCount} | amp-api: ${screenshotSuccessCount}/${appsNeedScreenshots.length}`)
          }

          const stillMissingScreenshots = res[region].filter(
            (app) =>
              (!app.screenshotUrls || app.screenshotUrls.length === 0) &&
              (!app.ipadScreenshotUrls || app.ipadScreenshotUrls.length === 0),
          )
          if (stillMissingScreenshots.length > 0) {
            const missingIds = stillMissingScreenshots.map((app) => app.trackId)
            const lookupMap = await getScreenshotsByLookup(missingIds, region)
            let lookupSuccessCount = 0
            for (const app of stillMissingScreenshots) {
              const lookupResult = lookupMap.get(app.trackId)
              if (lookupResult) {
                if (lookupResult.screenshotUrls.length > 0) app.screenshotUrls = lookupResult.screenshotUrls
                if (lookupResult.ipadScreenshotUrls.length > 0) app.ipadScreenshotUrls = lookupResult.ipadScreenshotUrls
                lookupSuccessCount++
              }
            }
            if (lookupSuccessCount > 0 || stillMissingScreenshots.length > 0) {
              console.log(`${label} 截图降级补充（iTunes lookup API）: 成功 ${lookupSuccessCount}/${stillMissingScreenshots.length} 个`)
            }
          }
        }
      }
    }
  } finally {
    await playWrightBrowserManager.close()
  }

  end(label)
  return res
}
