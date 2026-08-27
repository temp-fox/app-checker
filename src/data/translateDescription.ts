import fetch from 'node-fetch'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { buildSummaryDescription, sanitizeDescription } from './calculate'

const TRANSLATE_TIMEOUT_MS = 15_000
const TRANSLATE_MAX_ATTEMPTS = 3
const TRANSLATE_RETRY_DELAY_MS = 1_000
const GOOGLE_TRANSLATE_MAX_CHARS = 600
const MYMEMORY_TRANSLATE_MAX_CHARS = 500
const PROXY_LIST_URLS = [
  'https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/all/data.txt',
  'https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/all/data.txt',
]
const loggedTranslateErrors = new Set<string>()

type ProxyEntry = {
  url: string
  host: string
  protocol: 'http:' | 'https:'
}

type FetchTextOptions = {
  proxy?: ProxyEntry | null
}

type TranslateTextOptions = {
  proxyProvider?: ProxyProvider
}

class HttpStatusError extends Error {
  status: number

  constructor(status: number, statusText: string, body: string) {
    super(`HTTP ${status} ${statusText}: ${summarizeResponse(body)}`)
    this.status = status
  }
}

class ProxyProvider {
  private cursor = 0
  private usedHosts = new Set<string>()
  private consecutiveFailures = 0
  private exhaustedLogged = false

  constructor(
    private proxies: ProxyEntry[],
    private allowDirectFallback: boolean,
  ) {}

  get total() {
    return this.proxies.length
  }

  get usedCount() {
    return this.usedHosts.size
  }

  get directFallbackEnabled() {
    return this.allowDirectFallback
  }

  next(): ProxyEntry | null {
    while (this.cursor < this.proxies.length) {
      const proxy = this.proxies[this.cursor]
      this.cursor++
      if (this.usedHosts.has(proxy.host)) continue

      this.usedHosts.add(proxy.host)
      return proxy
    }

    if (!this.exhaustedLogged) {
      this.exhaustedLogged = true
      console.warn('[translate] 代理池已耗尽，后续翻译才允许回退为无代理直连')
    }
    return null
  }

  markSuccess() {
    this.consecutiveFailures = 0
  }

  markFailure(proxy: ProxyEntry, error: unknown) {
    this.consecutiveFailures++
    logTranslateError(
      `proxy ${proxy.host} failed: ${summarizeErrorMessage(error)}`,
    )
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error)

  const cause = (
    error as Error & { cause?: { code?: string; message?: string } }
  ).cause
  if (cause?.code || cause?.message) {
    return `${error.message}: ${[cause.code, cause.message]
      .filter(Boolean)
      .join(' ')}`
  }

  return error.message
}

function summarizeResponse(text: string): string {
  return text.replace(/\s+/g, ' ').trim().substring(0, 200)
}

/** 去掉错误信息里的完整请求 URL 和超长正文，只保留可读的失败原因 */
function summarizeErrorMessage(error: unknown): string {
  return getErrorMessage(error)
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 120)
}

function logTranslateError(message: string) {
  if (loggedTranslateErrors.has(message)) return
  loggedTranslateErrors.add(message)
  console.warn(`[translate] ${message}`)
}

async function fetchText(
  url: string,
  options: FetchTextOptions = {},
): Promise<string> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TRANSLATE_TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      agent: options.proxy ? new HttpsProxyAgent(options.proxy.url) : undefined,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; app-checker/1.0; +https://github.com/temp-fox/app-checker)',
        Accept: 'application/json,text/plain,*/*',
      },
    })
    const body = await res.text()

    if (!res.ok) {
      throw new HttpStatusError(res.status, res.statusText, body)
    }

    return body
  } finally {
    clearTimeout(timeoutId)
  }
}

function getBooleanEnv(name: string, defaultValue: boolean): boolean {
  const value = process.env[name]
  if (value == null) return defaultValue
  return !['0', 'false', 'no', 'off'].includes(value.toLowerCase())
}

function getNumberEnv(name: string, defaultValue: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : defaultValue
}

function parseProxyList(text: string): ProxyEntry[] {
  const proxies: ProxyEntry[] = []
  const seenHosts = new Set<string>()

  text.split(/\r?\n/).forEach((line) => {
    const value = line.trim()
    if (!value || value.startsWith('#')) return

    try {
      const url = new URL(value)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return
      if (!url.hostname || seenHosts.has(url.hostname)) return

      seenHosts.add(url.hostname)
      proxies.push({
        url: value,
        host: url.hostname,
        protocol: url.protocol,
      })
    } catch {}
  })

  const limit = getNumberEnv('TRANSLATE_PROXY_LIMIT', proxies.length)
  return proxies.slice(0, limit)
}

async function loadProxyPool(): Promise<ProxyEntry[]> {
  if (!getBooleanEnv('TRANSLATE_PROXY_ENABLED', true)) {
    console.log('[translate] 代理翻译已禁用，使用无代理直连')
    return []
  }

  let lastError = ''
  for (const url of PROXY_LIST_URLS) {
    try {
      const body = await fetchText(url)
      const proxies = parseProxyList(body)
      console.log(
        `[translate] 代理列表加载成功: ${url} | HTTP/HTTPS 去重后 ${proxies.length} 个 IP`,
      )
      return proxies
    } catch (error) {
      lastError = getErrorMessage(error)
      logTranslateError(`load proxy list failed from ${url}: ${lastError}`)
    }
  }

  logTranslateError(`load proxy list failed, fallback to direct: ${lastError}`)
  return []
}

function isProxyRetryableError(error: unknown): boolean {
  if (error instanceof HttpStatusError) return error.status === 429

  const message = getErrorMessage(error).toLowerCase()
  return [
    'abort',
    'timeout',
    'timed out',
    'econnreset',
    'econnrefused',
    'etimedout',
    'socket',
    'proxy',
    'fetch failed',
  ].some((keyword) => message.includes(keyword))
}

function isInvalidTranslatedText(text: string): boolean {
  const normalized = text.trim().toLowerCase()
  return (
    !normalized ||
    normalized.includes('<html') ||
    normalized.includes('<!doctype')
  )
}

async function translateByGoogle(
  text: string,
  proxy?: ProxyEntry | null,
): Promise<string> {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=${encodeURIComponent(
    text,
  )}`
  const body = await fetchText(url, { proxy })
  const data = JSON.parse(body) as any

  if (!data || !data[0]) {
    throw new Error(`google unexpected response: ${summarizeResponse(body)}`)
  }

  const translated = data[0]
    .filter((i: any) => i && i[0])
    .map((i: any) => i[0])
    .join('')

  if (!translated || isInvalidTranslatedText(translated)) {
    throw new Error(`google empty translation: ${summarizeResponse(body)}`)
  }

  return translated
}

async function translateByMyMemory(text: string): Promise<string> {
  const truncated = text.substring(0, MYMEMORY_TRANSLATE_MAX_CHARS)
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
    truncated,
  )}&langpair=en|zh-CN`
  const body = await fetchText(url)
  const data = JSON.parse(body) as any
  const translated = data?.responseData?.translatedText

  if (data?.responseStatus !== 200 || !translated) {
    throw new Error(`mymemory unexpected response: ${summarizeResponse(body)}`)
  }

  return translated
}

export function hasChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text)
}

export function needsTranslation(text: string): boolean {
  const normalized = text.trim()
  if (!normalized) return false

  const asciiLetterCount = (normalized.match(/[A-Za-z]/g) || []).length
  if (asciiLetterCount === 0) return false

  const chineseCharCount = (normalized.match(/[\u4e00-\u9fff]/g) || []).length
  if (chineseCharCount === 0) return true

  return asciiLetterCount >= 8
}

export async function translateText(
  text: string,
  options: TranslateTextOptions = {},
): Promise<string | null> {
  const googleText = text.substring(0, GOOGLE_TRANSLATE_MAX_CHARS)
  let googleError = ''
  let myMemoryError = ''

  for (let attempt = 1; attempt <= TRANSLATE_MAX_ATTEMPTS; attempt++) {
    while (true) {
      const proxy = options.proxyProvider?.next()
      const canUseDirect =
        !options.proxyProvider || options.proxyProvider.directFallbackEnabled

      if (!proxy && !canUseDirect) break

      try {
        const translated = await translateByGoogle(googleText, proxy)
        options.proxyProvider?.markSuccess()
        return translated
      } catch (error) {
        googleError = summarizeErrorMessage(error)

        if (proxy) {
          options.proxyProvider?.markFailure(proxy, error)
          if (
            isProxyRetryableError(error) ||
            options.proxyProvider?.directFallbackEnabled
          )
            continue
        }

        break
      }
    }

    if (!options.proxyProvider || options.proxyProvider.directFallbackEnabled) {
      try {
        return await translateByMyMemory(text)
      } catch (error) {
        myMemoryError = summarizeErrorMessage(error)
      }
    }

    if (attempt < TRANSLATE_MAX_ATTEMPTS) {
      await sleep(TRANSLATE_RETRY_DELAY_MS * attempt)
    }
  }

  logTranslateError(
    `failed after ${TRANSLATE_MAX_ATTEMPTS} attempts: google=${googleError}; mymemory=${myMemoryError}`,
  )
  return null
}

export async function translateDescriptions(
  regionAppInfo: RegionAppInfo,
): Promise<void> {
  for (const [region, appInfos] of Object.entries(regionAppInfo)) {
    const toTranslate = appInfos.filter((app) => {
      const desc = (app.fullDescription || app.description || '').trim()
      return needsTranslation(desc)
    })

    if (toTranslate.length === 0) continue

    console.log(
      `[${region}] 检测到 ${toTranslate.length} 个英文描述，开始翻译...`,
    )

    let success = 0
    let fail = 0

    for (let i = 0; i < toTranslate.length; i += 4) {
      const batch = toTranslate.slice(i, i + 4)
      await Promise.all(
        batch.map(async (app) => {
          const sourceDescription = app.fullDescription || app.description
          const translated = await translateText(sourceDescription)
          if (translated) {
            app.description = translated
            app.fullDescription = translated
            app.summaryDescription = buildSummaryDescription(translated)
            success++
          } else {
            fail++
          }
        }),
      )
    }

    console.log(`[${region}] 翻译完成: 成功 ${success}, 失败 ${fail}`)
  }
}

export async function translateDiscountDescriptions(
  regionDiscountInfo: RegionDiscountInfo,
  regionStorageAppInfo: RegionStorageAppInfo,
): Promise<void> {
  let totalTargets = 0
  let totalSuccess = 0
  let totalFail = 0
  let proxyProvider: ProxyProvider | null = null

  for (const [region, discountInfos] of Object.entries(
    regionDiscountInfo,
  ) as Array<[Region, DiscountInfo[]]>) {
    const translationTargets = new Map<
      string,
      {
        trackId: number
        description: string
        discountInfos: DiscountInfo[]
        storageItems: Array<RegionStorageAppInfo[Region][string]>
      }
    >()

    discountInfos.forEach((discountInfo) => {
      const description = (
        discountInfo.fullDescription ||
        discountInfo.description ||
        ''
      ).trim()
      if (!needsTranslation(description)) return

      const key = `${discountInfo.trackId}:${description}`
      const existing = translationTargets.get(key)
      const storageItem =
        regionStorageAppInfo[region]?.[String(discountInfo.trackId)]

      if (existing) {
        existing.discountInfos.push(discountInfo)
        if (storageItem) existing.storageItems.push(storageItem)
        return
      }

      translationTargets.set(key, {
        trackId: discountInfo.trackId,
        description,
        discountInfos: [discountInfo],
        storageItems: storageItem ? [storageItem] : [],
      })
    })

    const targets = Array.from(translationTargets.values())
    if (targets.length === 0) continue

    totalTargets += targets.length
    console.log(`[${region}] RSS 描述翻译: ${targets.length} 个应用待处理`)

    if (!proxyProvider) {
      const proxies = await loadProxyPool()
      proxyProvider = new ProxyProvider(
        proxies,
        getBooleanEnv('TRANSLATE_PROXY_DIRECT_FALLBACK', true),
      )
      console.log(
        `[translate] 代理策略: 可用唯一 IP ${
          proxyProvider.total
        } 个 | 直连回退 ${
          proxyProvider.directFallbackEnabled ? '开启' : '关闭'
        }`,
      )
    }

    let success = 0
    let fail = 0

    for (let i = 0; i < targets.length; i += 4) {
      const batch = targets.slice(i, i + 4)
      await Promise.all(
        batch.map(async (target) => {
          const translated = await translateText(target.description, {
            proxyProvider: proxyProvider || undefined,
          })
          if (!translated) {
            fail++
            return
          }

          const sanitizedTranslated = sanitizeDescription(translated)
          const summaryDescription =
            buildSummaryDescription(sanitizedTranslated)

          target.discountInfos.forEach((discountInfo) => {
            discountInfo.description = sanitizedTranslated
            discountInfo.fullDescription = sanitizedTranslated
            discountInfo.summaryDescription = summaryDescription
          })
          target.storageItems.forEach((storageItem) => {
            storageItem.description = sanitizedTranslated
            storageItem.fullDescription = sanitizedTranslated
            storageItem.summaryDescription = summaryDescription
          })
          success++
        }),
      )
    }

    totalSuccess += success
    totalFail += fail
    console.log(`[${region}] RSS 描述翻译完成: 成功 ${success}, 失败 ${fail}`)
  }

  console.log(
    `RSS 描述翻译统计: 待翻译 ${totalTargets} 个应用 | 成功 ${totalSuccess} | 失败 ${totalFail}${
      proxyProvider
        ? ` | 已消耗代理 IP ${proxyProvider.usedCount}/${proxyProvider.total}`
        : ''
    }`,
  )
}
