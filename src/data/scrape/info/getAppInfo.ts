import nodeFetch from 'node-fetch'
import { getCachedAppMetadata } from '../../helper/appCache'

/**
 * https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/Searching.html#//apple_ref/doc/uid/TP40017632-CH5-SW1
 */
const BASE_URL = 'https://itunes.apple.com/lookup'

interface GetAppInfoOptions {
  preferCache?: boolean
  forceRefresh?: boolean
}

function mergeAppInfoWithFallback(
  freshAppInfo: Partial<RequestAppInfo> | undefined,
  fallbackAppInfo: ReturnType<typeof getCachedAppMetadata>,
  appId: string | number,
): RequestAppInfo | null {
  if (!freshAppInfo && !fallbackAppInfo) return null

  const trackId = Number(appId)
  const merged = {
    ...fallbackAppInfo,
    ...freshAppInfo,
    trackId: freshAppInfo?.trackId || fallbackAppInfo?.trackId || trackId,
    trackName: freshAppInfo?.trackName || fallbackAppInfo?.trackName || '',
    trackViewUrl: freshAppInfo?.trackViewUrl || fallbackAppInfo?.trackViewUrl || '',
    description: freshAppInfo?.description || fallbackAppInfo?.description || '',
    artworkUrl60: freshAppInfo?.artworkUrl60 || fallbackAppInfo?.artworkUrl60 || '',
    artworkUrl100: freshAppInfo?.artworkUrl100 || fallbackAppInfo?.artworkUrl100 || '',
    sellerName: freshAppInfo?.sellerName || fallbackAppInfo?.sellerName || '',
    artistName: freshAppInfo?.artistName || fallbackAppInfo?.artistName || '',
    screenshotUrls: freshAppInfo?.screenshotUrls || [],
    ipadScreenshotUrls: freshAppInfo?.ipadScreenshotUrls || [],
  } as RequestAppInfo

  if (!merged.trackId || !merged.trackName) return null

  return merged
}

export function getUrl(appIds: Array<string | number>, region: Region) {
  const url = new URL(BASE_URL)

  const params: Record<string, string> = {
    id: appIds.join(','),
    country: region,
    entity: 'software',
    limit: `${appIds.length}`,
    timestamp: Date.now() + '',
  }
  // 中文区优先请求中文内容
  if (region === 'cn') params.l = 'zh_CN'
  const search = new URLSearchParams(params).toString()
  url.search = search

  return url
}

export async function fetchAppInfoByLookup(
  appIds: Array<string | number>,
  region: Region,
  log: string,
): Promise<RequestAppInfo[]> {
  let res: RequestAppInfo[] = []
  try {
    const tempRes = (await nodeFetch(getUrl(appIds, region), {
      method: 'GET',
      headers: {
        Accept: '*/*',
      },
    }).then((res) => res.json())) as ResponseResult

    const errorMessage = tempRes.errorMessage

    if (errorMessage) {
      throw errorMessage
    }

    res = (tempRes as ResponseResult).results
  } catch (error) {
    console.error('getAppInfo request error:', error)
    const errorMsg = typeof error === 'string' ? error : error?.toString?.() || ''
    if (errorMsg.includes('SyntaxError: Unexpected token < in JSON at position 0')) {
      res = await fetchAppInfoByLookup(appIds, region, log)
    }
  }

  return res
}

export default async function getAppInfo(
  appIds: Array<string | number>,
  region: Region,
  log: string,
  options: GetAppInfoOptions = {},
): Promise<RequestAppInfo[]> {
  const { preferCache = false, forceRefresh = false } = options

  if (appIds.length === 0) return []

  const cachedAppInfoMap = new Map<number, ReturnType<typeof getCachedAppMetadata>>()
  const resultMap = new Map<number, RequestAppInfo>()
  const idsNeedLookup: Array<string | number> = []

  appIds.forEach((appId) => {
    const cached = getCachedAppMetadata(Number(appId), region)
    if (cached) {
      cachedAppInfoMap.set(Number(appId), cached)
    }

    if (preferCache && cached && !forceRefresh) {
      const merged = mergeAppInfoWithFallback(cached, cached, appId)
      if (merged) resultMap.set(merged.trackId, merged)
      return
    }

    idsNeedLookup.push(appId)
  })

  if (idsNeedLookup.length > 0) {
    const remoteAppInfos = await fetchAppInfoByLookup(idsNeedLookup, region, log)
    const remoteMap = new Map<number, RequestAppInfo>()

    remoteAppInfos.forEach((appInfo) => {
      remoteMap.set(appInfo.trackId, appInfo)
      const fallback = cachedAppInfoMap.get(appInfo.trackId) || null
      const merged = mergeAppInfoWithFallback(appInfo, fallback, appInfo.trackId)
      if (merged) resultMap.set(appInfo.trackId, merged)
    })

    if (forceRefresh) {
      idsNeedLookup.forEach((appId) => {
        const numericId = Number(appId)
        if (remoteMap.has(numericId)) return
        const fallback = cachedAppInfoMap.get(numericId) || null
        const merged = mergeAppInfoWithFallback(undefined, fallback, numericId)
        if (merged) resultMap.set(numericId, merged)
      })
    }
  }

  return appIds
    .map((appId) => resultMap.get(Number(appId)))
    .filter(Boolean) as RequestAppInfo[]
}
