import dayjs from 'dayjs'
import { writeFileSync, readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

const logFilePath = resolve(__dirname, '../storage/log.json')

export function readLogInfo(): LogInfo[] {
  const defaultRegionDiscountInfo: LogInfo[] = []

  if (!existsSync(logFilePath)) return defaultRegionDiscountInfo

  try {
    const data = JSON.parse(readFileSync(logFilePath, 'utf-8')) || []

    const now = dayjs()

    return data.filter(
      (logInfo: LogInfo) => now.diff(dayjs(logInfo.timestamp), 'day') < 7,
    )
  } catch {
    return defaultRegionDiscountInfo
  }
}

function saveRegionDiscountInfo(regionDiscountInfo: LogInfo[]) {
  writeFileSync(
    logFilePath,
    JSON.stringify(regionDiscountInfo, null, 2),
    'utf-8',
  )
}

export default function getLastLogInfo(props: {
  timestamp: number
  regionAppInfo: RegionAppInfo
  duration: string
  limitCount: number
  scrapeType: InAppPurchasesScrapeType
}): LogInfo[] {
  const { timestamp, regionAppInfo, duration, limitCount, scrapeType } = props

  const logInfo: LogInfo = {
    timestamp,
    regionAppInfo: Object.entries(regionAppInfo).reduce(
      (res, [region, discountInfo]) => {
        const appInfo = discountInfo
          .reduce((appInfoRes, appInfo) => {
            const {
              trackId,
              trackName,
              inAppPurchasesTimes,
              inAppPurchasesFailed,
            } = appInfo

            if (inAppPurchasesTimes > 1) {
              appInfoRes.push({
                trackId,
                trackName,
                inAppPurchasesTimes,
                inAppPurchasesFailed,
              })
            }

            return appInfoRes
          }, [])
          .sort((a, b) => b.inAppPurchasesTimes - a.inAppPurchasesTimes)

        res[region] = appInfo
        return res
      },
      {} as LogInfo['regionAppInfo'],
    ),
    duration,
    regionAppCount: Object.entries(regionAppInfo).reduce(
      (res, [region, appInfo]) => {
        res[region] = appInfo.length
        return res
      },
      {} as LogInfo['regionAppCount'],
    ),
    limitCount,
    inAppPurchasesScrapeType: scrapeType,
  }
  const existingInfo = readLogInfo()

  const merged = [logInfo, ...(existingInfo || [])]

  saveRegionDiscountInfo(merged)

  return merged
}
