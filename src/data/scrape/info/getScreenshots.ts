import nodeFetch from 'node-fetch'
import { chromium, Browser } from 'playwright'

export interface ScreenshotResult {
  screenshotUrls: string[]
  ipadScreenshotUrls: string[]
}

export interface AppMetadataResult {
  screenshotUrls: string[]
  ipadScreenshotUrls: string[]
  hasInAppPurchases: boolean | undefined
}

const EMPTY_RESULT: ScreenshotResult = {
  screenshotUrls: [],
  ipadScreenshotUrls: [],
}

// Module-level token cache — keyed by region.
const tokenCache = new Map<Region, string>()

// Shared Playwright browser instance for token extraction (lightweight, no page rendering).
let tokenBrowser: Browser | null = null

/**
 * Navigate to `url` and wait up to `timeoutMs` for the first amp-api
 * Authorization header.  Returns the bare JWT (without "Bearer "), or null.
 */
async function tryCaptureToken(
  page: any,
  url: string,
  timeoutMs = 15000,
): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    let settled = false

    const done = (value: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }

    const timer = setTimeout(() => done(null), timeoutMs)

    page.on('request', (request: any) => {
      if (settled) return
      const reqUrl = request.url()
      if (
        reqUrl.includes('amp-api') ||
        reqUrl.includes('amp-api-edge') ||
        reqUrl.includes('amp-api-search-edge')
      ) {
        const auth = request.headers()['authorization']
        if (auth && auth.startsWith('Bearer ')) {
          done(auth.slice(7))
        }
      }
    })

    // Fire-and-forget navigation — if it fails we wait for the timeout.
    page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs + 5000 }).catch(() => {
      // Navigation may fail after the token was already captured; that's fine.
    })
  })
}

/**
 * Fetch a real JWT token from Apple's amp-api by launching a headless browser,
 * intercepting the Authorization header from an amp-api request on the App Store
 * page.
 *
 * Apple changed their architecture: the JWT is no longer embedded in any static
 * JS bundle — it is generated dynamically by the browser-side
 * `mediaTokenService.refreshToken()` / `jwtProvider.getNonSearchJwt()` flow.
 *
 * This function captures a real token from a live browser session.
 * Includes anti-detection measures so Apple serves real pages (not challenge pages)
 * on headless CI runners.
 */
export async function initAmpApiToken(region: Region): Promise<boolean> {
  if (tokenCache.has(region)) {
    return true
  }

  let context: any = null
  let page: any = null

  try {
    // Launch a single shared browser if not already running.
    if (!tokenBrowser) {
      tokenBrowser = await chromium.launch({
        headless: true,
        args: [
          // Mask headless-mode signals that Apple's WAF checks.
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
          // CI-friendly flags.
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      })
    }

    context = await tokenBrowser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
      locale: 'zh-CN',
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    })

    page = await context.newPage()

    // Anti-detection: strip every automation signal before any page JS runs.
    await page.addInitScript(() => {
      // Remove the "navigator.webdriver" flag that headless Chrome sets.
      Object.defineProperty(navigator, 'webdriver', { get: () => false })

      // Add a minimal chrome.runtime so bot detectors don't flag it as missing.
      ;(window as any).chrome = { runtime: {} }

      // Suppress "Chrome is being controlled by automated software" infobar.
      const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions)
      window.navigator.permissions.query = (parameters: any) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
          : originalQuery(parameters)
    })

    // ---- first attempt: a specific app page (lightweight, triggers amp-api) ----
    let token = await tryCaptureToken(page, `https://apps.apple.com/${region}/app/id1163682613`)

    // ---- second attempt: a different app on the same region ----
    if (!token) {
      token = await tryCaptureToken(page, `https://apps.apple.com/${region}/app/id835599320`)
    }

    if (token) {
      tokenCache.set(region, token)
      console.log(`amp-api: token 获取成功 (${region}, Playwright, ${token.slice(0, 40)}...)`)
      return true
    }

    console.warn(`amp-api: 两次尝试均未截获 token (${region})`)
    return false
  } catch (error) {
    console.warn(`amp-api: Playwright token 获取失败 (${region}):`, error)
    return false
  } finally {
    if (page) {
      try { await page.close() } catch (_) { /* ignore */ }
    }
    if (context) {
      try { await context.close() } catch (_) { /* ignore */ }
    }
  }
}

/** Cleanup the shared token browser (call once at process exit). */
export async function closeTokenBrowser(): Promise<void> {
  if (tokenBrowser) {
    await tokenBrowser.close()
  }
}

/** Return the token previously cached by initAmpApiToken or null. */
export function getAmpApiToken(region: Region): string | null {
  return tokenCache.get(region) || null
}

function resolveTemplateUrl(template: string, width: number, height: number): string {
  return template
    .replace('{w}', String(width))
    .replace('{h}', String(height))
    .replace('{c}', 'bb')
    .replace('{f}', 'png')
}

function extractTemplateScreenshotsFromJsonSection(section: string) {
  const templateRegexp = /"template":"(https:\/\/is\d+-ssl\.mzstatic\.com\/image\/thumb\/[^\"]+)","width":(\d+),"height":(\d+)/g
  const screenshotUrls: string[] = []
  let match: RegExpExecArray | null = null

  while ((match = templateRegexp.exec(section))) {
    const [, template, widthStr, heightStr] = match
    const templateUrl = template.replace(/\\\//g, '/')
    const width = parseInt(widthStr, 10)
    const height = parseInt(heightStr, 10)

    if (!Number.isNaN(width) && !Number.isNaN(height)) {
      screenshotUrls.push(resolveTemplateUrl(templateUrl, width, height))
    }
  }

  return screenshotUrls
}

function normalizeScreenshotIdentity(url: string) {
  return url
    .replace(/\/\d+x\d+bb(?:-\d+)?\.(webp|jpg|png)$/i, '')
    .replace(/\/\d+x\d+bb\.(webp|jpg|png)$/i, '')
}

function pickPreferredSrcFromSrcset(srcset: string) {
  const candidates = srcset
    .split(',')
    .map((item) => item.trim().split(' ')[0])
    .filter((url) => url.startsWith('https://is'))

  if (candidates.length === 0) return null

  const webp = candidates.find((url) => url.endsWith('.webp'))
  return webp || candidates[0]
}

function extractSrcsetScreenshotsFromHtmlSection(section: string) {
  const screenshotUrls: string[] = []
  const seen = new Set<string>()
  const itemRegexp = /<li class="shelf-grid__list-item[\s\S]*?<\/li>/g
  let itemMatch: RegExpExecArray | null = null

  while ((itemMatch = itemRegexp.exec(section))) {
    const itemHtml = itemMatch[0]
    if (!itemHtml.includes('<picture')) continue

    const srcsetMatch = itemHtml.match(/<source[^>]+srcset="([^"]+)"[^>]*type="image\/webp"/)
      || itemHtml.match(/<source[^>]+srcset="([^"]+)"[^>]*>/)

    if (!srcsetMatch) continue

    const pickedUrl = pickPreferredSrcFromSrcset(srcsetMatch[1])
    if (!pickedUrl) continue

    const identity = normalizeScreenshotIdentity(pickedUrl)
    if (seen.has(identity)) continue
    seen.add(identity)
    screenshotUrls.push(pickedUrl)
  }

  return screenshotUrls
}

function extractPageScreenshots(html: string, mediaKey: 'product_media_phone_' | 'product_media_pad_') {
  const screenshotUrls: string[] = []

  const jsonKeyIndex = html.indexOf(`"${mediaKey}"`)
  if (jsonKeyIndex !== -1) {
    const nextJsonKeyIndex = html.indexOf('"product_media_', jsonKeyIndex + mediaKey.length)
    const jsonSection = html.slice(
      jsonKeyIndex,
      nextJsonKeyIndex === -1 ? html.length : nextJsonKeyIndex,
    )
    screenshotUrls.push(...extractTemplateScreenshotsFromJsonSection(jsonSection))
  }

  const htmlKey = mediaKey === 'product_media_phone_'
    ? 'shelf-grid__list--grid-type-ScreenshotPhone'
    : 'shelf-grid__list--grid-type-ScreenshotPad'
  const htmlKeyIndex = html.indexOf(htmlKey)
  if (htmlKeyIndex !== -1) {
    const nextHtmlKeyIndex = html.indexOf('shelf-grid__list--grid-type-', htmlKeyIndex + htmlKey.length)
    const htmlSection = html.slice(
      htmlKeyIndex,
      nextHtmlKeyIndex === -1 ? html.length : nextHtmlKeyIndex,
    )
    screenshotUrls.push(...extractSrcsetScreenshotsFromHtmlSection(htmlSection))
  }

  return [...new Set(screenshotUrls)]
}

function extractScreenshotsFromAttributes(attributes: any): ScreenshotResult {
  const platformAttrs = attributes?.platformAttributes
  const ios = platformAttrs?.ios
  if (!ios?.screenshotsByType) return EMPTY_RESULT

  const screenshotsByType = ios.screenshotsByType
  const screenshotUrls: string[] = []
  const ipadScreenshotUrls: string[] = []

  // iPhone screenshots: prefer iphone_6_5 (6.5"), fallback to iphone6+ (5.5")
  const iphoneKey =
    screenshotsByType.iphone_6_5 ? 'iphone_6_5'
    : screenshotsByType['iphone6+'] ? 'iphone6+'
    : screenshotsByType.iphone_6_7 ? 'iphone_6_7'
    : null

  if (iphoneKey && Array.isArray(screenshotsByType[iphoneKey])) {
    for (const item of screenshotsByType[iphoneKey]) {
      const url = item?.url
      if (typeof url === 'string' && url.includes('{w}')) {
        const { width, height } = item
        screenshotUrls.push(
          resolveTemplateUrl(url, width || 392, height || 696),
        )
      }
    }
  }

  // iPad screenshots: prefer ipadPro_2018, fallback to ipadPro
  const ipadKey =
    screenshotsByType.ipadPro_2018 ? 'ipadPro_2018'
    : screenshotsByType.ipadPro ? 'ipadPro'
    : null

  if (ipadKey && Array.isArray(screenshotsByType[ipadKey])) {
    for (const item of screenshotsByType[ipadKey]) {
      const url = item?.url
      if (typeof url === 'string' && url.includes('{w}')) {
        const { width, height } = item
        ipadScreenshotUrls.push(
          resolveTemplateUrl(url, width || 576, height || 768),
        )
      }
    }
  }

  return { screenshotUrls, ipadScreenshotUrls }
}

/**
 * Batch-fetch screenshots for multiple apps via amp-api.
 * Returns a Map from trackId to ScreenshotResult.
 */
export async function getScreenshotsByAmpApi(
  appIds: Array<string | number>,
  region: Region,
  maxRetries = 2,
): Promise<Map<number, ScreenshotResult>> {
  const result = new Map<number, ScreenshotResult>()

  const token = getAmpApiToken(region)
  if (!token) {
    console.warn('amp-api: token 未初始化，跳过截图获取')
    return result
  }

  const idsParam = appIds.join(',')
  const url = `https://amp-api-edge.apps.apple.com/v1/catalog/${region}/apps?ids=${idsParam}&platform=web&additionalPlatforms=iphone,ipad&extend=screenshotsByType`

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await nodeFetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Origin: 'https://apps.apple.com',
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0',
        },
      })

      if (!response.ok) {
        const text = await response.text()
        if (text.includes('API capacity exceeded') && attempt < maxRetries) {
          console.warn(
            `amp-api: API 容量超限，${3}s 后重试 (${attempt + 1}/${maxRetries})`,
          )
          await new Promise((resolve) => setTimeout(resolve, 3000))
          continue
        }
        console.warn(`amp-api: HTTP ${response.status} - ${text.slice(0, 200)}`)
        return result
      }

      const json = (await response.json()) as any
      const data = json?.data
      if (!Array.isArray(data)) return result

      for (const item of data) {
        const id = parseInt(item.id, 10)
        if (isNaN(id)) continue
        const screenshots = extractScreenshotsFromAttributes(item.attributes)
        if (
          screenshots.screenshotUrls.length > 0 ||
          screenshots.ipadScreenshotUrls.length > 0
        ) {
          result.set(id, screenshots)
        }
      }

      return result
    } catch (error) {
      if (attempt < maxRetries) {
        console.warn(
          `amp-api: 请求失败，${3}s 后重试 (${attempt + 1}/${maxRetries}):`,
          error,
        )
        await new Promise((resolve) => setTimeout(resolve, 3000))
        continue
      }
      console.warn('amp-api: 请求最终失败:', error)
      return result
    }
  }

  return result
}

/**
 * Batch-fetch app metadata (screenshots + hasInAppPurchases) via amp-api.
 * Returns a Map from trackId to AppMetadataResult.
 */
export async function getAppMetadataByAmpApi(
  appIds: Array<string | number>,
  region: Region,
  maxRetries = 2,
): Promise<Map<number, AppMetadataResult>> {
  const result = new Map<number, AppMetadataResult>()

  const token = getAmpApiToken(region)
  if (!token) {
    console.warn('amp-api: token 未初始化，跳过元数据获取')
    return result
  }

  const idsParam = appIds.join(',')
  const url = `https://amp-api-edge.apps.apple.com/v1/catalog/${region}/apps?ids=${idsParam}&platform=web&additionalPlatforms=iphone,ipad&extend=screenshotsByType`

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await nodeFetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Origin: 'https://apps.apple.com',
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0',
        },
      })

      if (!response.ok) {
        const text = await response.text()
        if (text.includes('API capacity exceeded') && attempt < maxRetries) {
          console.warn(
            `amp-api: API 容量超限，${3}s 后重试 (${attempt + 1}/${maxRetries})`,
          )
          await new Promise((resolve) => setTimeout(resolve, 3000))
          continue
        }
        console.warn(`amp-api: HTTP ${response.status} - ${text.slice(0, 200)}`)
        return result
      }

      const json = (await response.json()) as any
      const data = json?.data
      if (!Array.isArray(data)) return result

      for (const item of data) {
        const id = parseInt(item.id, 10)
        if (isNaN(id)) continue

        const attributes = item.attributes
        const ios = attributes?.platformAttributes?.ios
        const screenshots = extractScreenshotsFromAttributes(attributes)
        const hasInAppPurchases: boolean | undefined = ios?.hasInAppPurchases

        result.set(id, {
          screenshotUrls: screenshots.screenshotUrls,
          ipadScreenshotUrls: screenshots.ipadScreenshotUrls,
          hasInAppPurchases,
        })
      }

      return result
    } catch (error) {
      if (attempt < maxRetries) {
        console.warn(
          `amp-api: 请求失败，${3}s 后重试 (${attempt + 1}/${maxRetries}):`,
          error,
        )
        await new Promise((resolve) => setTimeout(resolve, 3000))
        continue
      }
      console.warn('amp-api: 元数据请求最终失败:', error)
      return result
    }
  }

  return result
}

/**
 * Fallback: Batch-fetch screenshots via iTunes Search /lookup API.
 * This API sometimes returns screenshotUrls as direct links.
 * Used when amp-api fails to return screenshots for certain apps.
 */
export async function getScreenshotsByLookup(
  appIds: Array<string | number>,
  region: Region,
): Promise<Map<number, ScreenshotResult>> {
  const result = new Map<number, ScreenshotResult>()

  // iTunes lookup API supports up to 200 IDs per request
  const batchSize = 200
  for (let i = 0; i < appIds.length; i += batchSize) {
    const batchIds = appIds.slice(i, i + batchSize)
    const idsParam = batchIds.join(',')
    const url = `https://itunes.apple.com/lookup?id=${idsParam}&country=${region}`

    try {
      const response = await nodeFetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        },
      })

      if (!response.ok) continue

      const json = (await response.json()) as any
      const results = json?.results
      if (!Array.isArray(results)) continue

      for (const item of results) {
        const id = item.trackId
        if (!id) continue

        const screenshotUrls: string[] = Array.isArray(item.screenshotUrls)
          ? item.screenshotUrls
          : []
        const ipadScreenshotUrls: string[] = Array.isArray(item.ipadScreenshotUrls)
          ? item.ipadScreenshotUrls
          : []

        if (screenshotUrls.length > 0 || ipadScreenshotUrls.length > 0) {
          result.set(id, { screenshotUrls, ipadScreenshotUrls })
        }
      }
    } catch (error) {
      console.warn(`iTunes lookup 截图降级失败 (batch ${i / batchSize + 1}):`, error)
    }
  }

  return result
}

export async function getScreenshotsByAppStorePage(
  appIds: Array<string | number>,
  region: Region,
): Promise<Map<number, ScreenshotResult>> {
  const result = new Map<number, ScreenshotResult>()

  for (const appId of appIds) {
    const url = `https://apps.apple.com/${region}/app/id${appId}`

    try {
      const html = await nodeFetch(url, {
        headers: {
          Accept: 'text/html',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        },
      }).then((res) => res.text())

      const screenshotUrls = extractPageScreenshots(html, 'product_media_phone_')
      const ipadScreenshotUrls = extractPageScreenshots(html, 'product_media_pad_')

      if (screenshotUrls.length > 0 || ipadScreenshotUrls.length > 0) {
        result.set(Number(appId), {
          screenshotUrls,
          ipadScreenshotUrls,
        })
      }
    } catch (error) {
      console.warn(`App Store 页面截图兜底失败 (${region}/${appId}):`, error)
    }
  }

  return result
}
