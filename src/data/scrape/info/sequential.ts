import { start, end } from '../../timer'
import { getByFetch } from './getInAppPurchases'
import getAppInfo from './getAppInfo'

export default async function getRegionAppInfo(
  appIds: Array<string | number>,
  regions: Region[],
) {
  start('sequential getRegionAppInfo')
  const res: RegionAppInfo = {}

  for (let i = 0; i < regions.length; i++) {
    const region = regions[i]
    const label = `【${i + 1}/${regions.length}】（${region}）`
    const appInfos = await getAppInfo(appIds, region, `${label}getAppInfo`)

    if (appInfos.length > 0) {
      const newAppInfos: AppInfo[] = []
      for (let j = 0; j < appInfos.length; j++) {
        const appInfo = appInfos[j]
        const { inAppPurchases, times, failed } = await getByFetch({
          appInfo,
          region,
          log: `${label}【${j + 1}/${appInfos.length}】【${
            appInfo.trackName
          }】`,
        })

        newAppInfos.push({
          ...appInfo,
          inAppPurchases,
          inAppPurchasesTimes: times,
          inAppPurchasesFailed: failed,
        })
      }
      res[region] = newAppInfos
    }
  }
  end('sequential getRegionAppInfo')
  return res
}
