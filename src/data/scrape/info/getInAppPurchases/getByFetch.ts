import nodeFetch from 'node-fetch'
import chalk from 'chalk'
import parseInAppPurchases from './parseInAppPurchases'
import { GetInAppPurchasesProps, GetInAppPurchasesResult } from './types'
import { IN_APP_PURCHASE_MAX_TIMES } from './constants'

export default async function getInAppPurchases(
  props: GetInAppPurchasesProps,
): Promise<GetInAppPurchasesResult> {
  const { appInfo, region, log, times = 1 } = props
  const { trackViewUrl } = appInfo
  let inAppPurchasesRes: AppInfo['inAppPurchases'] = {}
  const url = `${trackViewUrl}${
    trackViewUrl.includes('?') ? '&' : '?'
  }timestamp=${Date.now()}`

  function retry(): GetInAppPurchasesResult | Promise<GetInAppPurchasesResult> {
    if (times >= IN_APP_PURCHASE_MAX_TIMES) {
      return {
        inAppPurchases: inAppPurchasesRes,
        times,
        failed: true,
      }
    }
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(
          getInAppPurchases({
            appInfo,
            region,
            log,
            times: times + 1,
          }),
        )
      }, 1000)
    })
  }

  try {
    const tempRes = (await nodeFetch(url, {
      method: 'GET',
      headers: {
        Accept: '*/*',
      },
    }).then((res) => res.text())) as string

    const { inAppPurchases, needRetry } = parseInAppPurchases({
      appInfo,
      region,
      htmlContent: tempRes,
      log,
      times,
    })

    inAppPurchasesRes = inAppPurchases

    if (needRetry) {
      return retry()
    }
  } catch (error) {
    const errMsg = String((error as Error)?.message || error)
    // max-redirect / ETIMEDOUT 是永久性或网络错误，不应重试
    if (errMsg.includes('max-redirect') || errMsg.includes('MAX_REDIRECT') || errMsg.includes('ETIMEDOUT')) {
      return {
        inAppPurchases: inAppPurchasesRes,
        times,
        failed: true,
      }
    }
    if (times >= IN_APP_PURCHASE_MAX_TIMES) {
      console.error(`${log} 内购获取失败: ${errMsg}`)
    }
    return retry()
  }

  return {
    inAppPurchases: inAppPurchasesRes,
    times,
  }
}
