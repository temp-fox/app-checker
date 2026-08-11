import './i18n' // NOTE initial i18n
import 'dotenv/config'
import { regions } from 'appinfo.config'
import { appConfig as existingAppConfig } from 'apps.json'
import { getRegionAppTopInfo, getRegionAppInfo, refreshRssAppInfos, scrapeExternalSources } from './scrape'
import { closeTokenBrowser } from './scrape/info/getScreenshots'
import { getStorageAppInfo, setStorageAppInfo } from './storage'
import calculateLatestRegionStorageAppInfoAndRegionDiscountsInfo, { getPrice } from './calculate'
import updateFeeds from './rss'
import getLastKeepDaysRegionDiscountInfo, { saveRegionDiscountInfo } from './rss/storageDiscountInfo'
import { start, end, summarize } from './timer'
import pushTelegramNotification from './telegram'
// import updateIpCounter from './ip'
import pushDingTalkNotification from './dingtalk'
import updateAppInfoConfig, { updateImpl } from './config'
import updateLog from './log'
import disableApps from './disableApps'
import updateDailyStats from './dailyStats'
import getRegionMonthlyDiscountStats from './rss/storageMonthlyStats'
import { translateDiscountDescriptions } from './translateDescription'

async function controller() {
  start('controller')

  // Step A: 建立已有 app ID 集合（用于过滤外部来源的重复 app）
  const existingAppIdSet = new Set(existingAppConfig.map(c => String(c.id)))
  const mainRegion = regions[0]

  // Step B: 跨 block 变量
  let externalRegionAppInfo: RegionAppInfo = {}
  let newExternalAppIdSet = new Set<string>()

  // 1. 从外部限免网站抓取应用
  console.log('\n=== 步骤 1: 抓取外部限免数据源 ===')
  let externalApps: any[] = []
  try {
    externalApps = await scrapeExternalSources()
  } catch (error) {
    console.error('外部数据源抓取失败:', (error as Error).message)
  }

  // 2. 从 App Store 排行榜获取应用
  console.log('\n=== 步骤 2: 获取 App Store 排行榜 ===')
  const regionAppTopInfo = await getRegionAppTopInfo(regions)

  // Step C: 过滤已有 app，只处理新 app
  const newExternalApps = externalApps.filter(app => !existingAppIdSet.has(String(app.appId)))
  const newExternalAppIds = newExternalApps.map(app => app.appId)

  // Step D: 仅处理真正的新 app
  if (newExternalAppIds.length > 0 && regions.length > 0) {
    const skippedCount = externalApps.length - newExternalApps.length
    console.log(`\n=== 步骤 3: 验证外部新应用 ===`)
    console.log(`新应用: ${newExternalAppIds.length} 个 | 已追踪跳过: ${skippedCount} 个`)

    // Step E: 只查询新外部 app 的价格
    const { regionAppInfo: extRegionAppInfo } = await getRegionAppInfo(
      newExternalAppIds,
      [mainRegion]
    )
    externalRegionAppInfo = extRegionAppInfo
    newExternalAppIdSet = new Set(newExternalApps.map(a => String(a.appId)))

    const externalAppInfos = externalRegionAppInfo[mainRegion] || []
    if (externalAppInfos.length < newExternalAppIds.length) {
      console.log(`API 返回 ${externalAppInfos.length}/${newExternalAppIds.length} 个（${newExternalAppIds.length - externalAppInfos.length} 个不存在或不可用）`)
    }

    // 加载历史数据（unknown 类型兜底使用）
    const extStorageAppInfo = getStorageAppInfo(regions)
    const storageInfo = extStorageAppInfo[mainRegion] || {}

    // Step F: 验证循环 — 所有新 app 均进 appsToTrack，shouldBePaid 决定是否进 RSS
    const appsToTrack: Array<{
      appId: string
      name: string
      shouldBePaid: boolean
      discountType: 'app' | 'iap' | 'unknown'
      reason: string
      externalSource: string
    }> = []

    const externalAppsMap = new Map<string, any>(newExternalApps.map(app => [String(app.appId), app]))

    externalAppInfos.forEach((appInfo) => {
      const externalApp = externalAppsMap.get(String(appInfo.trackId))
      if (!externalApp) return
      const appId = appInfo.trackId.toString()
      const currentPrice = appInfo.price
      const discountType = externalApp.discountType || 'unknown'

      let shouldBePaid = false
      let reason = ''

      if (discountType === 'app') {
        // 本体限免：RSS 已标记，直接确认
        shouldBePaid = true
        reason = 'RSS标记为本体限免'
      } else if (discountType === 'iap') {
        // 内购限免：本体不标记为付费，仅追踪
        // IAP 折扣由后续运行的价格对比检测
        shouldBePaid = false
        if (currentPrice === 0 && !appInfo.inAppPurchasesFailed) {
          const hasZeroIAP = Object.values(appInfo.inAppPurchases).some(
            fp => getPrice(fp, mainRegion) === 0
          )
          reason = hasZeroIAP ? '内购限免（追踪中）' : '所有内购价格均大于0'
        } else if (currentPrice > 0) {
          reason = `本体价格 ${appInfo.formattedPrice}，写入追踪`
        } else {
          reason = '内购数据获取失败，写入追踪'
        }
      } else {
        // unknown：保留原有历史价格检查逻辑
        if (currentPrice > 0) {
          shouldBePaid = true
          reason = `当前价格 ${appInfo.formattedPrice}`
        } else {
          const history = storageInfo[appId]
          if (history?.maxPriceInfo?.price > 0) {
            shouldBePaid = true
            reason = `历史最高价 ${history.maxPriceInfo.formattedPrice}`
          } else {
            reason = '当前免费且无付费历史'
          }
        }
      }

      // 所有新 app 均写入 appsToTrack（不过滤 shouldBePaid）
      appsToTrack.push({
        appId,
        name: appInfo.trackName,
        shouldBePaid,
        discountType,
        reason,
        externalSource: externalApp.source
      })
    })

    const rssCount = appsToTrack.filter(a => a.shouldBePaid).length
    const appTypeCount = appsToTrack.filter(a => a.discountType === 'app').length
    const iapTypeCount = appsToTrack.filter(a => a.discountType === 'iap').length
    const unknownTypeCount = appsToTrack.filter(a => a.discountType === 'unknown').length
    console.log(`外部来源验证完成: ${appsToTrack.length} 个通过验证`)
    console.log(`  ├─ 确认为付费应用（将进入 RSS 限免监控）: ${rssCount} 个`)
    console.log(`  ├─ 本体限免类型: ${appTypeCount} 个 | 内购限免类型: ${iapTypeCount} 个 | 未知类型: ${unknownTypeCount} 个`)
    console.log(`  └─ 全部 ${appsToTrack.length} 个应用将写入追踪名单以持续监控价格变化`)

    // Step G: 推入 regionAppTopInfo，按 shouldBePaid 条件设标签
    if (appsToTrack.length > 0) {
      if (!regionAppTopInfo[mainRegion]) {
        regionAppTopInfo[mainRegion] = []
      }

      appsToTrack.forEach(app => {
        regionAppTopInfo[mainRegion].push({
          id: app.appId,
          name: app.name,
          _externalSource: app.externalSource,
          _externalSourceFirstSeen: Date.now(),
          _discountType: app.discountType,
          ...(app.shouldBePaid ? { _shouldBePaid: true } : {})
        })
      })

      console.log(`已添加 ${appsToTrack.length} 个外部来源应用到本轮抓取列表（本轮排行榜+外部合计: ${regionAppTopInfo[mainRegion].length} 个，是否进入追踪名单由 updateAppInfoConfig 决定）`)
    }
  }

  const appConfig = updateAppInfoConfig(regionAppTopInfo)

  // Step H: 从 appIds 中排除新外部 app（已单独查询，避免重复）
  const testLimit = process.env.TEST_APP_LIMIT ? parseInt(process.env.TEST_APP_LIMIT, 10) : 0
  const appIds = appConfig
    .filter((item) => item.allowNotification !== false && !newExternalAppIdSet.has(String(item.id)))
    .map((item) => item.id)
    .slice(0, testLimit > 0 ? testLimit : undefined)
  const timestamp = Date.now()

  console.log(`\n=== 步骤 4: 获取应用详细信息 ===`)
  console.info(`地区: ${regions.length} | 历史累计追踪应用: ${appIds.length} 个（来自 apps.json，包含所有历次运行发现的应用）`)

  // await updateIpCounter()

  const { regionAppInfo, limitCount, scrapeType } = await getRegionAppInfo(
    appIds,
    regions,
  )

  if (Object.keys(regionAppInfo).length === 0) {
    console.info('No data captured, program execution has ended')
    return
  }

  // Step I: 注入外部 app 数据（已单独查询，不重复请求 API）
  if (mainRegion && externalRegionAppInfo[mainRegion]?.length > 0) {
    if (!regionAppInfo[mainRegion]) regionAppInfo[mainRegion] = []
    regionAppInfo[mainRegion].push(...externalRegionAppInfo[mainRegion])
  }

  // 从 appConfig 恢复各来源的元数据标签到 appInfo（含注入的外部 app）
  const appConfigMap = new Map<number, AppConfig>(appConfig.map(c => [c.id, c]))
  Object.entries(regionAppInfo).forEach(([region, appInfos]) => {
    appInfos.forEach((appInfo) => {
      const cfg = appConfigMap.get(appInfo.trackId)
      if (cfg) {
        // 通用标签：所有来源（排行榜/外部/Issue）均可携带
        if (cfg._shouldBePaid !== undefined) appInfo._shouldBePaid = cfg._shouldBePaid
        if (cfg._externalSourceFirstSeen) appInfo._externalSourceFirstSeen = cfg._externalSourceFirstSeen
        if (cfg._discountType) appInfo._discountType = cfg._discountType

        // 外部来源专属标签
        if (cfg._externalSource) appInfo._externalSource = cfg._externalSource

        // manual（Issue）来源专属标签
        if (cfg.addSource?.startsWith('issue-')) {
          appInfo._manualAdd = true
          appInfo._issueNumber = parseInt(cfg.addSource.replace('issue-', ''))
        }
      }
    })
  })

  // 补充 _shouldBePaid 标签：利用本次已查询的价格，price > 0 且缺少标签的应用自动补充
  {
    let shouldBePaidUpdated = 0
    const mainRegionAppInfos = regionAppInfo[mainRegion] || []
    mainRegionAppInfos.forEach((appInfo) => {
      const cfg = appConfigMap.get(appInfo.trackId)
      if (cfg && !cfg._shouldBePaid && appInfo.price > 0) {
        cfg._shouldBePaid = true
        appInfo._shouldBePaid = true
        shouldBePaidUpdated++
      }
    })
    if (shouldBePaidUpdated > 0) {
      console.log(`补充 _shouldBePaid 标签: ${shouldBePaidUpdated} 个应用（当前价格 > 0）`)
      updateImpl(appConfig)
    }
  }

  const regionStorageAppInfo = getStorageAppInfo(regions)

  const regionDiscountInfo =
    calculateLatestRegionStorageAppInfoAndRegionDiscountsInfo(
      timestamp,
      regions,
      regionAppInfo,
      regionStorageAppInfo,
    )

  const totalNewRssApps = Object.values(regionDiscountInfo).reduce(
    (sum, discountInfos) => sum + discountInfos.length,
    0,
  )
  const newRssAppsByRegion = Object.entries(regionDiscountInfo)
    .map(([region, discountInfos]) => `${region}: ${discountInfos.length}`)
    .join(' | ')
  console.log(`本轮新进入 RSS 应用统计: 总计 ${totalNewRssApps} 个${newRssAppsByRegion ? `（${newRssAppsByRegion}）` : ''}`)

  const fullRegionDiscountInfo = getLastKeepDaysRegionDiscountInfo(
    regionDiscountInfo,
    regionAppInfo,
  )
  const totalFinalRssApps = Object.values(fullRegionDiscountInfo).reduce(
    (sum, discountInfos) => sum + discountInfos.length,
    0,
  )
  const finalRssAppsByRegion = Object.entries(fullRegionDiscountInfo)
    .map(([region, discountInfos]) => `${region}: ${discountInfos.length}`)
    .join(' | ')
  console.log(`最终进入 RSS/Page 应用统计: 总计 ${totalFinalRssApps} 个${finalRssAppsByRegion ? `（${finalRssAppsByRegion}）` : ''}`)

  await refreshRssAppInfos(
    timestamp,
    fullRegionDiscountInfo,
    regionStorageAppInfo,
    regionAppInfo,
  )

  await translateDiscountDescriptions(fullRegionDiscountInfo, regionStorageAppInfo)

  setStorageAppInfo(regions, regionStorageAppInfo)
  saveRegionDiscountInfo(fullRegionDiscountInfo)

  updateDailyStats(regionDiscountInfo)

  const regionMonthlyDiscountStats = getRegionMonthlyDiscountStats(regionDiscountInfo)

  updateFeeds({
    timestamp,
    regionDiscountInfo: fullRegionDiscountInfo,
    appConfig,
    regionStorageAppInfo,
    regionMonthlyDiscountStats,
  })

  await pushTelegramNotification(regionDiscountInfo)

  await pushDingTalkNotification(regionDiscountInfo)

  disableApps({
    appConfig,
    includeAppIds: appIds,
    regionMonthlyDiscountStats,
  })

  end('controller')

  const sum = summarize()

  updateLog({
    timestamp,
    regionAppInfo,
    duration: sum['controller'],
    limitCount,
    scrapeType,
  })

  // 总是释放 token 浏览器，防止孤儿进程阻止 Node 退出
  await closeTokenBrowser()
}

controller()
