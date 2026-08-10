import { regions } from 'appinfo.config'
import { start, end } from './timer'
import { isEmpty } from 'lodash'
import { updateImpl } from './config'

export const monthlyAllowAllMax = 15
export const monthlySingleItemAllowMax = 4

export interface disableAppsProps {
  appConfig: AppConfig[]
  includeAppIds: number[]
  regionMonthlyDiscountStats: RegionMonthlyDiscountStats
}

export default function disableApps(props: disableAppsProps) {
  const label = 'disableApps'
  start(label)
  const { appConfig, includeAppIds, regionMonthlyDiscountStats } = props

  const appIdRecord: Record<string, boolean> = {}
  const includeAppStrIds = includeAppIds.map(String)

  regions.forEach((region) => {
    const discountStats = regionMonthlyDiscountStats[region] || {}
    Object.entries(discountStats).forEach(([appId, stats]) => {
      const { all = 0, price = 0, inAppPurchase = {} } = stats || {}
      const includeAppId = includeAppStrIds.includes(appId)
      const hasRecorded = appIdRecord[appId]

      if (!includeAppId || hasRecorded) return

      if (
        all >= monthlyAllowAllMax ||
        price >= monthlySingleItemAllowMax ||
        Object.values(inAppPurchase).some(
          (count) => count >= monthlySingleItemAllowMax,
        )
      ) {
        appIdRecord[appId] = true
      }
    })
  })

  const appIds = Object.keys(appIdRecord)

  if (appIds.length !== 0) {
    const appIdAppConfigMap: Record<string, AppConfig> = appConfig.reduce(
      (res, appConfig) => {
        res[appConfig.id] = appConfig
        return res
      },
      {},
    )
    appIds.forEach((appId) => {
      const appConfig = appIdAppConfigMap[appId]
      if (!isEmpty(appConfig)) {
        appConfig.allowNotification = false
      }
    })

    updateImpl(appConfig)
  }

  end(label)
}
