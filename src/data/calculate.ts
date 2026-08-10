import { isEqual, isEmpty, pick, get } from 'lodash'
import { getRegionDate } from './utils'
import { start, end } from './timer'
import { getTranslate } from './i18n'

const timeStorageAppInfoFields = ['price', 'formattedPrice', 'inAppPurchases']

// 清理描述中会触发 markdown 解析的字符（防止 doocs/md 编辑器误将描述解析为列表）
export function sanitizeDescription(desc?: string): string {
  if (!desc) return ''
  return desc
    .replace(/^[#•·►▸‣⁃*\->\s]+/gm, '')
    .replace(/[\n\r]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function buildSummaryDescription(desc?: string): string {
  return sanitizeDescription(desc)
}

function getNormalizedDescriptions(appInfo: Pick<AppInfo, 'description' | 'fullDescription' | 'summaryDescription'>) {
  const fullDescription = sanitizeDescription(appInfo.fullDescription || appInfo.description)
  const summaryDescription = buildSummaryDescription(
    appInfo.summaryDescription || appInfo.fullDescription || appInfo.description,
  )

  return {
    description: fullDescription,
    fullDescription,
    summaryDescription,
  }
}

export function getPrice(priceStrProp: string, region: Region) {
  let priceStr = priceStrProp
  const lower = priceStr.toLowerCase().trim()

  // "付费"/"paid" 表示"原本是付费应用"，不是具体价格，返回 -1（哨兵值）
  if (lower === '付费' || lower === 'paid') return -1

  // eg: '1.234,56' = 1234.56
  if (['tr', 'pt'].includes(region)) {
    priceStr = priceStr
      .replace('.', 'dot')
      .replace(',', '.')
      .replace('dot', ',')
  }

  priceStr = priceStr.replace(',', '')
  const regexp = /[^0-9]*([0-9]+(\.[0-9]+)?)[^0-9]*/
  const [full, numberStr] = priceStr.match(regexp) || ['', '']
  if (numberStr === '') {
    // 不含数字且不是"付费"→ 各语言的"免费"（免费/free/Gratis/Ücretsiz...），视为 0
    return 0
  }
  return parseFloat(numberStr)
}

function getPriceRange(
  value: number,
  minPriceInfo: PriceInfo,
  maxPriceInfo: PriceInfo,
  region: Region,
  key = 'formattedPrice',
) {
  const min = get(minPriceInfo, key) as string
  const max = get(maxPriceInfo, key) as string

  if (typeof min !== 'undefined' && typeof max !== 'undefined') {
    const minPrice = getPrice(min, region)
    const maxPrice = getPrice(max, region)

    if (value !== minPrice || value !== maxPrice) {
      return `[${min} ~ ${max}]`
    }
  }

  return ''
}

export function getDiscounts(
  region: Region,
  minPriceInfo: PriceInfo,
  maxPriceInfo: PriceInfo,
  newAppInfo: TimeStorageAppInfo,
  oldAppInfo?: TimeStorageAppInfo,
  shouldBePaid?: boolean,
  externalSourceFirstSeen?: number,
) {
  const t = getTranslate(region)
  const { price, formattedPrice, inAppPurchases } = newAppInfo

  const discounts: Discount[] = []

  if (isEmpty(oldAppInfo)) {
    // 检查外部来源标记是否在3天内有效
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000
    const isExternalSourceValid = 
      externalSourceFirstSeen && 
      (Date.now() - externalSourceFirstSeen) < threeDaysMs
    
    // 外部来源 + 3天内 + 付费标记 + 当前限免
    if (isExternalSourceValid && shouldBePaid && price === 0) {
      discounts.push({
        type: 'price',
        name: t('价格'),
        from: t('付费'),  // 显示"付费"而不是具体价格
        to: formattedPrice,
        range: ''
      })
    }
    return discounts
  }

  const {
    price: oldPrice,
    formattedPrice: oldFormattedPrice,
    inAppPurchases: oldInAppPurchases,
  } = oldAppInfo

  if (oldPrice > price) {
    const priceRange = getPriceRange(price, minPriceInfo, maxPriceInfo, region)

    discounts.push({
      type: 'price',
      name: t('价格'),
      from: oldFormattedPrice,
      to: formattedPrice,
      range: priceRange,
    })
  }

  Object.entries(inAppPurchases).forEach(([name, formattedPrice]) => {
    const oldFormattedPrice = oldInAppPurchases[name]
    if (oldFormattedPrice) {
      const oldPrice = getPrice(oldFormattedPrice, region)
      const price = getPrice(formattedPrice, region)

      if (oldPrice != -1 && price != -1 && oldPrice > price) {
        const priceRange = getPriceRange(
          price,
          minPriceInfo,
          maxPriceInfo,
          region,
          name,
        )

        discounts.push({
          type: 'inAppPurchase',
          name,
          from: oldFormattedPrice,
          to: formattedPrice,
          range: priceRange,
        })
      }
    }
  })

  return discounts
}

export function updateRangePriceInfo(
  type: 'min' | 'max',
  priceInfo: PriceInfo,
  appInfo: TimeStorageAppInfo,
  region: Region,
) {
  const { price: oldPrice } = priceInfo
  const {
    price: newPrice,
    formattedPrice: newFormattedPrice,
    inAppPurchases,
  } = appInfo

  if (
    (type === 'max' && newPrice > oldPrice) ||
    (type === 'min' && newPrice < oldPrice)
  ) {
    priceInfo.price = newPrice
    priceInfo.formattedPrice = newFormattedPrice
  }

  Object.entries(inAppPurchases).forEach(([name, formattedPrice]) => {
    const oldFormattedPrice = priceInfo[name]
    if (!oldFormattedPrice) {
      priceInfo[name] = formattedPrice
      return
    }

    const oldPrice = getPrice(oldFormattedPrice as string, region)
    const newPrice = getPrice(formattedPrice, region)

    if (
      (type === 'max' && newPrice > oldPrice) ||
      (type === 'min' && newPrice < oldPrice)
    ) {
      priceInfo[name] = formattedPrice
    }
  })
}

export default function calculateLatestRegionStorageAppInfoAndRegionDiscountsInfo(
  timestamp: number,
  regions: Region[],
  regionAppInfo: RegionAppInfo,
  regionStorageAppInfo: RegionStorageAppInfo,
) {
  start('calculateLatestRegionStorageAppInfoAndRegionDiscountsInfo')
  const regionDiscountInfo = {}

  for (let i = 0; i < regions.length; i++) {
    const region = regions[i]
    const appInfos = regionAppInfo[region] || []
    const date = getRegionDate(region, timestamp)
    const discountInfos: DiscountInfo[] = []

    console.info(`【${i + 1}/${regions.length}】（${region}）`)

    if (appInfos.length > 0) {
      const storageAppInfo = regionStorageAppInfo[region]

      appInfos.forEach((appInfo) => {
        const { trackId, trackName } = appInfo
        const shouldBePaid = appInfo._shouldBePaid || false
        const externalSource = appInfo._externalSource
        const externalSourceFirstSeen = appInfo._externalSourceFirstSeen
        
        const currentStorageAppInfo = storageAppInfo[trackId]
        const dateStorageAppInfo = currentStorageAppInfo?.history || []
        const timeStorageAppInfo = dateStorageAppInfo[0] || []
        const oldAppInfo = timeStorageAppInfo[0]
        const newAppInfo: TimeStorageAppInfo = {
          timestamp,
          ...(pick(appInfo, timeStorageAppInfoFields) as Omit<
            TimeStorageAppInfo,
            'timestamp'
          >),
          inAppPurchases: appInfo.inAppPurchasesFailed
            ? get(oldAppInfo, 'inAppPurchases', {})
            : appInfo.inAppPurchases,
        }
        let maxPriceInfo = (currentStorageAppInfo?.maxPriceInfo ||
          {}) as PriceInfo
        let minPriceInfo = (currentStorageAppInfo?.minPriceInfo ||
          {}) as PriceInfo
        let discounts: Discount[] = []

        const normalizedDescriptions = getNormalizedDescriptions(appInfo)

        if (!oldAppInfo) {
          timeStorageAppInfo.unshift(newAppInfo)
          dateStorageAppInfo.unshift(timeStorageAppInfo)
          minPriceInfo = maxPriceInfo = {
            ...pick(appInfo, ['price', 'formattedPrice']),
            ...appInfo.inAppPurchases,
          } as any

          // 首次发现：传递外部来源标记
          discounts = getDiscounts(
            region,
            minPriceInfo,
            maxPriceInfo,
            newAppInfo,
            undefined,
            shouldBePaid,
            externalSourceFirstSeen
          )
          
          if (discounts.length) {
            discountInfos.push({
              ...appInfo,
              ...normalizedDescriptions,
              timestamp,
              discounts,
            })
          }
        } else {
          const oldDate = getRegionDate(region, oldAppInfo.timestamp)
          const isPriceChange = !isEqual(
            pick(oldAppInfo, timeStorageAppInfoFields),
            pick(newAppInfo, timeStorageAppInfoFields),
          )

          // 已有存储历史，但本次首次检测到外部来源标签（说明该 app 之前仅由排行榜追踪，现在确认是付费应用限免）
          // 仅在 _externalSource 首次写入存储时触发，避免后续运行重复生成折扣
          const isNewExternalDetection =
            !!externalSource &&
            !currentStorageAppInfo?._externalSource &&
            shouldBePaid &&
            appInfo.price === 0

          if (oldDate === date) {
            if (isPriceChange) {
              timeStorageAppInfo.unshift(newAppInfo)
            }
          } else if (isPriceChange) {
            dateStorageAppInfo.unshift([newAppInfo])
          }

          if (isPriceChange) {
            updateRangePriceInfo('max', maxPriceInfo, newAppInfo, region)
            updateRangePriceInfo('min', minPriceInfo, newAppInfo, region)

            // 已存在的应用：读取已保存的外部来源时间戳
            const savedExternalSourceFirstSeen = currentStorageAppInfo?._externalSourceFirstSeen

            discounts = getDiscounts(
              region,
              minPriceInfo,
              maxPriceInfo,
              newAppInfo,
              oldAppInfo,
              shouldBePaid,
              savedExternalSourceFirstSeen
            )

            if (discounts.length) {
              discountInfos.push({
                ...appInfo,
                ...normalizedDescriptions,
                timestamp,
                discounts,
              })
            }
          } else if (isNewExternalDetection) {
            // 以"首次发现"的方式触发外部来源折扣逻辑
            // 传 undefined 作为 oldAppInfo，触发 getDiscounts 中的外部来源路径
            discounts = getDiscounts(
              region,
              minPriceInfo,
              maxPriceInfo,
              newAppInfo,
              undefined,
              shouldBePaid,
              externalSourceFirstSeen,
            )

            if (discounts.length) {
              discountInfos.push({
                ...appInfo,
                ...normalizedDescriptions,
                timestamp,
                discounts,
              })
            }
          }
        }

        storageAppInfo[trackId] = {
          name: trackName,
          trackName,
          maxPriceInfo: maxPriceInfo as PriceInfo,
          minPriceInfo: minPriceInfo as PriceInfo,
          history: dateStorageAppInfo,
          ...(appInfo.trackViewUrl && { trackViewUrl: appInfo.trackViewUrl }),
          ...(normalizedDescriptions.fullDescription && {
            description: normalizedDescriptions.fullDescription,
            fullDescription: normalizedDescriptions.fullDescription,
            summaryDescription: normalizedDescriptions.summaryDescription,
          }),
          ...(appInfo.artworkUrl60 && { artworkUrl60: appInfo.artworkUrl60 }),
          ...(appInfo.artworkUrl100 && { artworkUrl100: appInfo.artworkUrl100 }),
          ...(appInfo.sellerName && { sellerName: appInfo.sellerName }),
          ...(appInfo.artistName && { artistName: appInfo.artistName }),
          // 持久化截图（避免每次 amp-api 重复补充）
          ...(appInfo.screenshotUrls?.length > 0 && { screenshotUrls: appInfo.screenshotUrls }),
          ...(appInfo.ipadScreenshotUrls?.length > 0 && { ipadScreenshotUrls: appInfo.ipadScreenshotUrls }),
          // 保存外部来源标记
          ...(externalSource && { _externalSource: externalSource }),
          ...(externalSourceFirstSeen && { _externalSourceFirstSeen: externalSourceFirstSeen })
        }
      })
    }

    regionDiscountInfo[region] = discountInfos
  }

  end('calculateLatestRegionStorageAppInfoAndRegionDiscountsInfo')
  return regionDiscountInfo as RegionDiscountInfo
}
