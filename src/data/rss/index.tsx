import { start, end } from '../timer'
import { generateRegionFeed } from './generateRSS'

export default function updateFeeds(props: {
  timestamp: number
  regionDiscountInfo: RegionDiscountInfo
  appConfig: AppConfig[]
  regionStorageAppInfo: RegionStorageAppInfo
  regionMonthlyDiscountStats: RegionMonthlyDiscountStats
}) {
  start('updateFeeds')
  const {
    timestamp,
    regionDiscountInfo,
    appConfig,
    regionStorageAppInfo,
    regionMonthlyDiscountStats,
  } = props

  generateRegionFeed({
    timestamp,
    regionDiscountInfo,
    appConfig,
    regionStorageAppInfo,
    regionMonthlyDiscountStats,
  })

  end('updateFeeds')

  return {
    regionMonthlyDiscountStats,
  }
}
