import { regionInAppPurchasesTextMap } from 'appinfo.config'
import { load } from 'cheerio'
import { isEmpty, pick } from 'lodash'

export type ParseInAppPurchasesProps = {
  appInfo: RequestAppInfo
  region: Region
  htmlContent: string
  log: string
  times: number
}

export type ParseInAppPurchasesReturnType = {
  needRetry: boolean
  inAppPurchases: AppInfo['inAppPurchases']
}

export default function parseInAppPurchases(
  props: ParseInAppPurchasesProps,
): ParseInAppPurchasesReturnType {
  const { htmlContent, region, log, times } = props

  const inAppPurchasesText = regionInAppPurchasesTextMap[region]

  const $ = load(htmlContent)

  const inAppPurchases: AppInfo['inAppPurchases'] = {}
  let informationLoadError = false
  let inAppPurchasesError = false

  const getReturn = () => {
    const res = {
      inAppPurchases,
      informationLoadError,
      inAppPurchasesError,
      needRetry: informationLoadError || inAppPurchasesError,
    }

    return pick(res, [
      'needRetry',
      'inAppPurchases',
    ]) as ParseInAppPurchasesReturnType
  }

  const informationElement = $('#information')

  if (!informationElement?.html()) {
    informationLoadError = true
    return getReturn()
  }

  const inAppPurchasesElement = $(informationElement).find(
    `dt:contains("${inAppPurchasesText}")`,
  )
  inAppPurchasesElement
    ?.parent?.()
    ?.find?.('div.text-pair')
    ?.each((divIndex, div) => {
      let name = ''
      let price = ''
      $(div)
        .find('span')
        .each((spanIndex, span) => {
          const element = $(span)
          if (spanIndex === 0) {
            name = element.text().trim()
          } else if (spanIndex === 1) {
            price = element.text().trim()
          }

          if (name && price) {
            inAppPurchases[name] = price
          }
        })
    })

  if (inAppPurchasesElement?.html() && isEmpty(inAppPurchases)) {
    inAppPurchasesError = true
  }

  return getReturn()
}
