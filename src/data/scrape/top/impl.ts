import nodeFetch from 'node-fetch'
import { searchKeywordApps } from './keywordSearch'

// 自定义配置：每个分类前200名（API 最大限制）
const limit = 200

type ChartType = 'toppaidapplications'

interface ChartConfig {
  chart: ChartType
  addSourceGenre: string   // 分类榜 addSource
  addSourceAll: string     // 总榜 addSource
  shouldBePaid?: boolean   // 付费榜 true
  discountType: 'app' | 'unknown'
  label: string            // 日志中文名
}

const chartConfigs: ChartConfig[] = [
  {
    chart: 'toppaidapplications',
    addSourceGenre: 'paid-top',
    addSourceAll: 'paid-top-all',
    shouldBePaid: true,
    discountType: 'app',
    label: '付费排行榜',
  },
]

// App Store 所有主要分类
const genres = {
  business: 6000,        // 商务
  weather: 6001,         // 天气
  utilities: 6002,       // 工具
  travel: 6003,          // 旅游
  sports: 6004,          // 体育
  socialNetworking: 6005, // 社交
  reference: 6006,       // 参考
  productivity: 6007,    // 效率
  photoVideo: 6008,      // 摄影与录像
  news: 6009,            // 新闻
  navigation: 6010,      // 导航
  music: 6011,           // 音乐
  lifestyle: 6012,       // 生活
  healthFitness: 6013,   // 健康健美
  games: 6014,           // 游戏
  finance: 6015,         // 财务
  entertainment: 6016,   // 娱乐
  education: 6017,       // 教育
  books: 6018,           // 图书
  stickers: 6019,        // 贴纸
  medical: 6020,         // 医疗
  magazinesNewspapers: 6021, // 杂志与报纸
  catalogs: 6022,        // 商品指南
  foodDrink: 6023,       // 美食佳饮
  shopping: 6024,        // 购物
}

function getUrl(region: Region, chart: ChartType, genreId?: number) {
  if (genreId) {
    return `https://itunes.apple.com/${region}/rss/${chart}/limit=${limit}/genre=${genreId}/json`
  }
  return `https://itunes.apple.com/${region}/rss/${chart}/limit=${limit}/json`
}

async function fetchApps(
  region: Region,
  config: ChartConfig,
  genreName?: string,
  genreId?: number,
): Promise<AppTopInfo[]> {
  const res: AppTopInfo[] = []
  const displayName = genreName ?? `${config.label}总榜`
  const addSource = genreName ? config.addSourceGenre : config.addSourceAll

  try {
    const response = await nodeFetch(getUrl(region, config.chart, genreId), {
      method: 'GET',
      headers: {
        Accept: '*/*',
        'User-Agent': 'iTunes/12.0 (Macintosh; OS X 10.15) AppleWebKit/600.1.25',
      },
    })

    // 检查响应状态
    if (!response.ok) {
      console.error(`  ✗ ${displayName}: HTTP ${response.status} ${response.statusText}`)
      return res
    }

    const tempRes = (await response.json()) as AppTopInfoResponse

    // 检查是否有 entry 数组
    if (tempRes.feed?.entry && Array.isArray(tempRes.feed.entry)) {
      tempRes.feed.entry.forEach((appInfo) => {
        const name = appInfo['im:name'].label
        const id = appInfo['id'].attributes['im:id']

        if (name && id) {
          res.push({
            id,
            name,
            addSource,
            _shouldBePaid: config.shouldBePaid,
            _discountType: config.discountType,
            _externalSourceFirstSeen: Date.now(),
          })
        }
      })
    } else {
      // 该分类可能没有应用，静默处理
    }

  } catch (error) {
    console.error(`  ✗ ${displayName} 获取失败:`, error)
  }

  return res
}

// 延迟函数
function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function getAppTopInfo(
  region: Region,
  log: string,
): Promise<AppTopInfo[]> {
  console.log(log)

  const allApps: AppTopInfo[] = []
  const appIdSet = new Set<string>() // 用于去重

  // 每种榜的统计
  const stats: { label: string; total: number; newCount: number }[] = []

  for (const config of chartConfigs) {
    // —— 总榜 ——
    console.log(`获取${config.label}总榜（前 ${limit} 名）`)
    const allChartApps = await fetchApps(region, config)
    let allTotal = allChartApps.length
    let allNew = 0
    allChartApps.forEach((app) => {
      if (!appIdSet.has(app.id)) {
        appIdSet.add(app.id)
        allApps.push(app)
        allNew++
      }
    })
    stats.push({ label: `${config.label}总榜`, total: allTotal, newCount: allNew })

    await delay(2000)

    // —— 分类榜 ——
    const genreEntries = Object.entries(genres)
    const batchSize = 3
    console.log(`获取${config.label}分类榜（${genreEntries.length} 个分类，每分类前 ${limit} 名，每批 ${batchSize} 个）`)

    let genreTotal = 0
    let genreNew = 0
    const failedGenres: string[] = []

    for (let i = 0; i < genreEntries.length; i += batchSize) {
      const batch = genreEntries.slice(i, i + batchSize)

      const batchPromises = batch.map(([name, id]) =>
        fetchApps(region, config, name, id)
      )

      const batchResults = await Promise.all(batchPromises)

      batchResults.forEach((apps, idx) => {
        if (apps.length === 0) {
          failedGenres.push(batch[idx][0])
        }
        genreTotal += apps.length
        apps.forEach((app) => {
          if (!appIdSet.has(app.id)) {
            appIdSet.add(app.id)
            allApps.push(app)
            genreNew++
          }
        })
      })

      // 如果不是最后一批，等待 2 秒
      if (i + batchSize < genreEntries.length) {
        await delay(2000)
      }
    }

    stats.push({ label: `${config.label}分类`, total: genreTotal, newCount: genreNew })

    if (failedGenres.length > 0) {
      console.log(`  ${config.label}失败分类: ${failedGenres.join(', ')}`)
    }

    // 榜单之间等待
    await delay(2000)
  }

  // —— 关键词搜索高评分付费应用 ——
  try {
    const keywordApps = await searchKeywordApps(region)
    let keywordNew = 0
    for (const app of keywordApps) {
      if (!appIdSet.has(app.id)) {
        appIdSet.add(app.id)
        allApps.push(app)
        keywordNew++
      }
    }
    if (keywordNew > 0) {
      stats.push({ label: '关键词搜索', total: keywordApps.length, newCount: keywordNew })
    }
  } catch (error) {
    console.error('关键词搜索失败:', (error as Error).message)
  }

  // 输出汇总
  console.log(`排行榜抓取完成: 共发现 ${allApps.length} 个不重复应用（以下为各来源明细）`)
  stats.forEach((s) => {
    console.log(`  ${s.label}: 抓取 ${s.total} 个，去重后新增 ${s.newCount} 个（与前面来源去重，非与追踪名单去重）`)
  })

  return allApps
}
