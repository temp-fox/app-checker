import dayjs from 'dayjs'
import parallel, { refreshRssAppInfos } from './parallel'
import { regionTimezoneMap } from 'appinfo.config'

export { refreshRssAppInfos }

export default async function (
  appIds: Array<string | number>,
  regions: Region[],
) {
  const hour = dayjs().tz(regionTimezoneMap.cn).hour()
  const limitCounts = [2, 3, 4, 5, 6]
  const limitCount = limitCounts[Math.floor(Math.random() * limitCounts.length)]
  let scrapeType: InAppPurchasesScrapeType = 'fetch'

  if (hour % 4 === 0) {
    scrapeType = 'playwright'
  }

  const regionAppInfo = await parallel(appIds, regions, limitCount, scrapeType)

  return {
    regionAppInfo,
    limitCount,
    scrapeType,
  }
}
