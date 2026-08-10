export type GetInAppPurchasesProps = {
  appInfo: RequestAppInfo
  region: Region
  log: string
  times?: number
}

export type GetInAppPurchasesResult = {
  inAppPurchases: AppInfo['inAppPurchases']
  times: number
  failed?: boolean
}
