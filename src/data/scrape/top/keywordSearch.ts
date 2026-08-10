/**
 * 关键词搜索高评分付费应用
 * 通过 iTunes Search API 搜索特定关键词，筛选高评分付费应用加入追踪
 */

import nodeFetch from 'node-fetch'

const SEARCH_KEYWORDS = ['pro', '专业', 'professional', 'premium', 'plus', '高级']

const MIN_RATING = 4.7

interface ITunesSearchResult {
  resultCount: number
  results: ITunesApp[]
}

interface ITunesApp {
  trackId: number
  trackName: string
  price: number
  averageUserRating?: number
  userRatingCount?: number
  formattedPrice?: string
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 搜索关键词付费高评分应用
 * 严格规则：
 * 1. 必须是付费应用（price > 0）
 * 2. 评分 ≥ 4.7
 */
export async function searchKeywordApps(region: Region): Promise<AppTopInfo[]> {
  console.log(`关键词搜索: ${SEARCH_KEYWORDS.length} 个关键词`)

  const seenIds = new Set<string>()
  const allApps: AppTopInfo[] = []

  for (let i = 0; i < SEARCH_KEYWORDS.length; i++) {
    const keyword = SEARCH_KEYWORDS[i]

    try {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(keyword)}&country=${region}&media=software&limit=200`

      const response = await nodeFetch(url, {
        headers: {
          'User-Agent': 'iTunes/12.0 (Macintosh; OS X 10.15) AppleWebKit/600.1.25',
        },
      })

      if (!response.ok) {
        console.log(`  关键词 "${keyword}": HTTP ${response.status}`)
        continue
      }

      const data = (await response.json()) as ITunesSearchResult
      const results = data.results || []

      // 严格过滤
      let paidCount = 0
      let qualifiedCount = 0

      for (const app of results) {
        // 条件 1：必须是付费应用
        if (!app.price || app.price <= 0) continue
        paidCount++

        // 条件 2：评分 ≥ 4.7
        if (!app.averageUserRating || app.averageUserRating < MIN_RATING) continue
        qualifiedCount++

        const appId = String(app.trackId)
        if (seenIds.has(appId)) continue
        seenIds.add(appId)

        allApps.push({
          id: appId,
          name: app.trackName,
          addSource: 'keyword-search',
          _shouldBePaid: true,
          _discountType: 'app',
          _externalSourceFirstSeen: Date.now(),
        })
      }

      console.log(`  关键词 "${keyword}": ${results.length} 个结果, 付费 ${paidCount}, 符合条件 ${qualifiedCount}`)
    } catch (error) {
      console.error(`  关键词 "${keyword}" 搜索失败:`, (error as Error).message)
    }

    // 关键词间延迟 2s
    if (i < SEARCH_KEYWORDS.length - 1) {
      await delay(2000)
    }
  }

  console.log(`关键词搜索完成: ${allApps.length} 个不重复的高评分付费应用`)

  return allApps
}
