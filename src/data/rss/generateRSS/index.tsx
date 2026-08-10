import { writeFileSync } from 'fs'
import { resolve } from 'path'
import { createFeed } from './createFeed'
import addWelcomeFeedItem from './addWelcomeFeedItem'
import addRankingFeedItem from './addRankingFeedItem'
import addDiscountFeedItems from './addDiscountFeedItems'

// 将 RSS XML 中的 UTC 时间（Z 结尾）转换为北京时间（+08:00）
function convertToChinaTime(xml: string): string {
  return xml.replace(
    /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?)Z/g,
    (_, isoStr) => {
      const utcMs = new Date(isoStr + 'Z').getTime()
      const cnMs = utcMs + 8 * 60 * 60 * 1000
      const d = new Date(cnMs)
      const pad = (n: number) => String(n).padStart(2, '0')
      const ms = String(d.getUTCMilliseconds()).padStart(3, '0')
      return (
        `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
        `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${ms}+08:00`
      )
    },
  )
}

export function saveRegionFeed(feeds: RegionFeed) {
  Object.entries(feeds).forEach(([region, feed]) => {
    const filepath = resolve(__dirname, '../../../../rss', `${region}.xml`)
    writeFileSync(filepath, feed, 'utf-8')
  })
}

export function generateRegionFeed(props: {
  timestamp: number
  regionDiscountInfo: RegionDiscountInfo
  appConfig: AppConfig[]
  regionStorageAppInfo: RegionStorageAppInfo
  regionMonthlyDiscountStats: RegionMonthlyDiscountStats
}) {
  const {
    timestamp,
    regionDiscountInfo,
    appConfig,
    regionStorageAppInfo,
    regionMonthlyDiscountStats,
  } = props

  const regionFeed = Object.entries(regionDiscountInfo).reduce(
    (res, [key, discountInfos]) => {
      const latestLength = discountInfos.filter(
        (discountInfo) => discountInfo.timestamp === timestamp,
      ).length

      if (latestLength === 0) return res

      const region = key as Region

      const feed = createFeed(region)

      addWelcomeFeedItem(feed, region)

      addRankingFeedItem({
        feed,
        region,
        appConfig,
        regionStorageAppInfo,
        regionMonthlyDiscountStats,
      })

      addDiscountFeedItems({
        feed,
        discountInfos,
        region,
        appConfig,
      })

      res[region] = convertToChinaTime(feed.atom1())

      return res
    },
    {} as RegionFeed,
  )

  saveRegionFeed(regionFeed)
}
