import { Translate } from 'i18n-pro'

declare global {
  type Region = 'cn' | 'hk' | 'mo' | 'tw' | 'us' | 'tr' | 'pt'

  type AppConfig = {
    id: number
    name:
      | string
      | Partial<Record<Region, string>>
      | [string, Partial<Record<Region, string>>]
    allowNotification?: boolean
    addType?: 'manual' | 'auto' | 'external'
    addSource?: string
    _externalSource?: string
    _shouldBePaid?: boolean
    _externalSourceFirstSeen?: number
    _discountType?: 'app' | 'iap' | 'unknown'
  }

  type ResponseResult = {
    resultCount: number
    results: RequestAppInfo[]
    errorMessage?: string
  }

  type RequestAppInfo = {
    isGameCenterEnabled: boolean
    advisories: any[]
    supportedDevices: string[]
    features: string[]
    screenshotUrls: string[]
    ipadScreenshotUrls: string[]
    appletvScreenshotUrls: any[]
    artworkUrl60: string
    artworkUrl512: string
    artworkUrl100: string
    artistViewUrl: string
    kind: string
    currency: string
    trackId: number
    trackName: string
    releaseNotes: string
    price: number
    description: string
    isVppDeviceBasedLicensingEnabled: boolean
    releaseDate: string
    genreIds: string[]
    bundleId: string
    sellerName: string
    primaryGenreName: string
    primaryGenreId: number
    currentVersionReleaseDate: string
    averageUserRating: number
    averageUserRatingForCurrentVersion: number
    trackCensoredName: string
    languageCodesISO2A: string[]
    fileSizeBytes: string
    formattedPrice: string
    contentAdvisoryRating: string
    userRatingCountForCurrentVersion: number
    trackViewUrl: string
    trackContentRating: string
    minimumOsVersion: string
    artistId: number
    artistName: string
    genres: string[]
    version: string
    wrapperType: string
    userRatingCount: number
  }

  type AppInfo = RequestAppInfo & {
    fullDescription?: string
    summaryDescription?: string
    inAppPurchases: Record<string, string>
    inAppPurchasesTimes: number
    inAppPurchasesFailed?: boolean
    _externalSource?: string
    _shouldBePaid?: boolean
    _externalSourceFirstSeen?: number
    _discountType?: 'app' | 'iap' | 'unknown'
    _manualAdd?: boolean
    _issueNumber?: number
  }

  type RegionAppInfo = Partial<Record<Region, AppInfo[]>>

  type TimeStorageAppInfo = {
    timestamp: number
  } & Pick<
    AppInfo,
    'price' | 'formattedPrice' | 'inAppPurchases' | 'inAppPurchasesTimes'
  >

  type DateStorageAppInfo = TimeStorageAppInfo[]

  type PriceInfo = {
    price: number
    formattedPrice: string
    [key: string]: string | number
  }

  type StorageAppInfoItem = {
    name: string
    history: DateStorageAppInfo[]
    maxPriceInfo: PriceInfo
    minPriceInfo: PriceInfo
    screenshotUrls?: string[]
    ipadScreenshotUrls?: string[]
    trackName?: string
    trackViewUrl?: string
    description?: string
    fullDescription?: string
    summaryDescription?: string
    artworkUrl60?: string
    artworkUrl100?: string
    sellerName?: string
    artistName?: string
    _externalSource?: string
    _externalSourceFirstSeen?: number
  }

  type StorageAppInfo = Record<string, StorageAppInfoItem>

  type RegionStorageAppInfo = Partial<Record<Region, StorageAppInfo>>

  type DiscountType = 'price' | 'inAppPurchase'

  type Discount = {
    type: DiscountType
    name: 'price' | string
    from: string
    to: string
    range: string
  }

  type DiscountInfo = AppInfo &
    Pick<TimeStorageAppInfo, 'timestamp'> & {
      discounts: Discount[]
    }

  type RegionDiscountInfo = Record<Region, DiscountInfo[]>

  type RegionFeed = Record<Region, string>

  const t: Translate

  type AppTopInfoResponse = {
    feed: {
      author: {
        name: { label: string }
        uri: { label: string }
      }
      entry: Array<{
        'im:name': { label: string }
        'im:image': Array<{
          label: string
          attributes: { height: string }
        }>
        summary: { label: string }
        'im:price': {
          label: string
          attributes: {
            amount: string
            currency: string
          }
        }
        'im:contentType': {
          attributes: {
            term: string
            label: string
          }
        }
        rights: { label: string }
        title: { label: string }
        link: Array<
          | {
              attributes: {
                rel: string
                type: string
                href: string
                title?: string
                'im:assetType'?: string
              }
              'im:duration'?: { label: string }
            }
          | { attributes: { rel: string; type: string; href: string } }
        >
        id: {
          label: string
          attributes: {
            'im:id': string
            'im:bundleId': string
          }
        }
        'im:artist': {
          label: string
          attributes: {
            href: string
          }
        }
        category: {
          attributes: {
            'im:id': string
            term: string
            scheme: string
            label: string
          }
        }
        'im:releaseDate': {
          label: string
          attributes: { label: string }
        }
      }>
      updated: { label: string }
      rights: { label: string }
      title: { label: string }
      icon: { label: string }
      link: Array<{
        attributes: {
          rel: string
          type?: string
          href: string
        }
      }>
      id: { label: string }
    }
  }

  type AppTopInfo = {
    id: string
    name: string
    addSource?: string                            // 来源标识，如 'paid-top'/'new-release'/'GoFans'/'OODATA'
    _externalSource?: string
    _externalSourceFirstSeen?: number
    _discountType?: 'app' | 'iap' | 'unknown'
    _shouldBePaid?: boolean
  }

  type RegionAppTopInfo = Record<Region, AppTopInfo[]>

  type DiscountStats = Record<
    string,
    {
      /** 总共的次数 */
      all: number
      /** 价格的次数 */
      price: number
      /** app 内购购买项的次数 */
      inAppPurchase: Record<string, number>
    }
  >

  /** 月度榜数据 */
  type RegionMonthlyDiscountStats = Record<Region, DiscountStats> & {
    /** 格式为 YYYY-MM */
    month: string
  }

  export type SponsorType = 'platinum' | 'gold' | 'silver' | 'bronze'

  type Sponsor = {
    name: string
    url: string
    logo: string
    expireTime: string
  }

  type TypeSponsors = {
    type: SponsorType
    sponsors: Sponsor[]
  }

  type Sponsors = TypeSponsors[]

  type InAppPurchasesScrapeType = 'fetch' | 'playwright'

  type LogInfo = {
    timestamp: number
    regionAppInfo: Record<
      Region,
      Array<
        Pick<
          AppInfo,
          | 'trackId'
          | 'trackName'
          | 'inAppPurchasesTimes'
          | 'inAppPurchasesFailed'
        >
      >
    >
    duration: string
    regionAppCount: Record<Region, number>
    limitCount: number
    inAppPurchasesScrapeType: InAppPurchasesScrapeType
  }
}
