/**
 * 处理 GitHub Issue 中的应用添加请求
 * 从 Issue 内容中提取 App Store 链接，验证应用合规性和付费状态，自动添加到 apps.json
 */

import fs from 'fs'
import path from 'path'
import fetch from 'node-fetch'
import { extractAppId, isValidAppStoreUrl } from '../scrape/external/utils'

// ==================== 类型定义 ====================

interface ItunesAppResult {
  trackId: number
  trackName: string
  description?: string
  price: number
  formattedPrice: string
  currency?: string
  country?: string
  contentAdvisoryRating?: string
  genres?: string[]
  primaryGenreName?: string
  bundleId?: string
  trackViewUrl: string
  artworkUrl512?: string
}

interface ValidationResult {
  valid: boolean
  reason?: string
  appInfo?: ItunesAppResult
}

export interface ProcessResult {
  status: 'success' | 'no_links' | 'all_failed' | 'all_exists' | 'partial'
  addedCount: number
  addedApps: Array<{ name: string; id: number; formattedPrice: string }>
  failedApps: Array<{ id: string; name?: string; reason: string }>
  existingApps: Array<{ name: string; id: number }>
}

interface AppConfig {
  id: number
  name: { [region: string]: string }
  addType: 'manual' | 'auto' | 'external'
  allowNotification?: boolean
  addSource?: string
}

interface IssueStorageAppInfoItem {
  trackId: number
  trackName: string
  price: number
  formattedPrice: string
  currency?: string
  timestamp: number
  maxPriceInfo?: {
    price: number
    formattedPrice: string
    timestamp: number
  }
  minPriceInfo?: {
    price: number
    formattedPrice: string
    timestamp: number
  }
  _manualAdd?: boolean
  _issueNumber?: number
}

// ==================== 配置 ====================

// 过滤关键词（与 oodata.ts 保持一致）
const BLOCKED_KEYWORDS = [
  // VPN 和代理相关
  'vpn', 'proxy', '代理', '翻墙', 'shadowsocks', 'v2ray', 'trojan', 'clash',
  // 明确的成人/色情内容
  'porn', 'sex', 'xxx', '色情', '黄色', '成人视频', '成人直播', 'adult video',
  // 约会/交友（可能涉及不良内容）
  '约炮', '一夜情', '激情', '勾搭',
  // 反动/政治敏感
  '法轮', '民运', '六四', '天安门', '反共', 'falun', 'epoch times'
]

// 暴力相关关键词（较为宽松，只屏蔽极端暴力）
const VIOLENCE_KEYWORDS = [
  '杀人', '虐待', '血腥', 'gore', 'torture', 'mutilation'
]

// 支持的国家/地区代码
const SUPPORTED_REGIONS = ['cn', 'us', 'hk', 'tw', 'mo', 'tr', 'pt']

// ==================== 核心函数 ====================

/**
 * 从文本中提取所有 App Store 链接
 */
function extractAppStoreLinks(text: string): string[] {
  const links: string[] = []

  // 匹配各种格式的 App Store 链接
  const patterns = [
    /https?:\/\/apps\.apple\.com\/[a-z]{2}\/app\/[^\/\s]+\/id(\d{9,10})/gi,
    /https?:\/\/itunes\.apple\.com\/[a-z]{2}\/app\/[^\/\s]+\/id(\d{9,10})/gi,
    /https?:\/\/apps\.apple\.com\/app\/id(\d{9,10})/gi,
    /https?:\/\/itunes\.apple\.com\/app\/id(\d{9,10})/gi,
  ]

  for (const pattern of patterns) {
    const matches = text.matchAll(pattern)
    for (const match of matches) {
      links.push(match[0])
    }
  }

  return [...new Set(links)] // 去重
}

/**
 * 验证应用是否符合添加条件
 * 1. 合法存在的应用
 * 2. 不包含屏蔽关键词
 * 3. 是付费应用或曾经付费
 */
async function validateApp(appId: string, region: string = 'cn'): Promise<ValidationResult> {
  try {
    // 查询 iTunes API
    const apiUrl = `https://itunes.apple.com/lookup?id=${appId}&country=${region}&entity=software`
    const response = await fetch(apiUrl, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    })

    if (!response.ok) {
      return {
        valid: false,
        reason: `iTunes API 请求失败: HTTP ${response.status}`
      }
    }

    const data = await response.json() as any

    // 检查应用是否存在
    if (!data.results || data.results.length === 0) {
      return {
        valid: false,
        reason: `应用在 ${region.toUpperCase()} 区不存在或已下架`
      }
    }

    const app = data.results[0] as ItunesAppResult
    const appName = app.trackName || ''
    const appDescription = app.description || ''
    const genres = app.genres || []

    // 1. 内容合规性检查
    // 检查应用名称
    for (const keyword of BLOCKED_KEYWORDS) {
      if (appName.toLowerCase().includes(keyword.toLowerCase())) {
        return {
          valid: false,
          reason: `应用名称包含屏蔽关键词: ${keyword}`
        }
      }
    }

    // 检查应用描述
    for (const keyword of BLOCKED_KEYWORDS) {
      if (appDescription.toLowerCase().includes(keyword.toLowerCase())) {
        return {
          valid: false,
          reason: `应用描述包含屏蔽关键词: ${keyword}`
        }
      }
    }

    // 检查暴力关键词（更严格）
    for (const keyword of VIOLENCE_KEYWORDS) {
      if (appName.toLowerCase().includes(keyword) || appDescription.toLowerCase().includes(keyword)) {
        return {
          valid: false,
          reason: `应用包含暴力内容关键词: ${keyword}`
        }
      }
    }

    // 2. 价格检查：必须是付费应用
    const price = app.price || 0
    if (price === 0) {
      return {
        valid: false,
        reason: `应用当前是免费的（价格: ${app.formattedPrice || '免费'}）`
      }
    }

    // 3. 流派检查：排除某些不适合的分类
    const blockedGenres = ['Social Networking', '游戏', 'Games']
    for (const genre of genres) {
      if (blockedGenres.some(bg => genre.toLowerCase().includes(bg.toLowerCase()))) {
        // 社交和游戏应用需要更谨慎，但不完全排除
      }
    }

    return {
      valid: true,
      appInfo: app
    }

  } catch (error) {
    return {
      valid: false,
      reason: `验证过程出错: ${(error as Error).message}`
    }
  }
}

/**
 * 读取现有的 apps.json 配置
 */
function readAppsConfig(): { appConfig: AppConfig[]; $schema: string } {
  try {
    const configPath = path.join(__dirname, '../../apps.json')
    const content = fs.readFileSync(configPath, 'utf-8')
    return JSON.parse(content)
  } catch (error) {
    console.error('读取 apps.json 失败:', (error as Error).message)
    return { appConfig: [], $schema: '' }
  }
}

/**
 * 保存 apps.json 配置
 */
function saveAppsConfig(config: { appConfig: AppConfig[]; $schema: string }): void {
  try {
    const configPath = path.join(__dirname, '../../apps.json')
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
  } catch (error) {
    console.error('保存 apps.json 失败:', (error as Error).message)
  }
}

/**
 * 读取存储数据
 */
function readRegionStorage(region: string): Record<string, IssueStorageAppInfoItem> {
  try {
    const storagePath = path.join(__dirname, `../storage/${region}.json`)
    if (!fs.existsSync(storagePath)) {
      return {}
    }
    const content = fs.readFileSync(storagePath, 'utf-8')
    return JSON.parse(content)
  } catch (error) {
    console.warn(`读取 ${region}.json 存储失败:`, (error as Error).message)
    return {}
  }
}

/**
 * 应用是否已在 apps.json 中存在
 */
function appExists(appId: number): boolean {
  const config = readAppsConfig()
  return config.appConfig.some(app => app.id === appId)
}

/**
 * 添加应用到 apps.json
 */
function addAppToConfig(appInfo: ItunesAppResult, issueNumber?: number): boolean {
  const appId = appInfo.trackId

  if (appExists(appId)) {
    console.log(`应用 ${appInfo.trackName} (ID: ${appId}) 已存在于 apps.json`)
    return false
  }

  const config = readAppsConfig()

  // 构建新配置
  const newApp: AppConfig = {
    id: appId,
    name: {
      cn: appInfo.trackName
      // 可以扩展支持多语言
    },
    addType: 'manual', // 手动添加
    allowNotification: true,
    ...(issueNumber ? { addSource: `issue-${issueNumber}` } : {}),
    _shouldBePaid: true,  // Issue 流程要求 price > 0，确认是付费应用
    _discountType: 'app', // Issue 添加的是应用本体
  }

  // 添加到头部
  config.appConfig.unshift(newApp)

  // 保存
  saveAppsConfig(config)

  console.log(`✅ 已添加应用到 apps.json: ${appInfo.trackName} (ID: ${appId})`)
  return true
}

/**
 * 添加或更新历史价格记录
 */
function updatePriceHistory(
  appInfo: ItunesAppResult,
  region: string,
  issueNumber?: number
): void {
  const storage = readRegionStorage(region)
  const appId = String(appInfo.trackId)
  const timestamp = Date.now()

  const existingInfo = storage[appId]

  if (!existingInfo) {
    // 新应用，创建初始记录
    storage[appId] = {
      trackId: appInfo.trackId,
      trackName: appInfo.trackName,
      price: appInfo.price,
      formattedPrice: appInfo.formattedPrice,
      currency: appInfo.currency,
      timestamp,
      maxPriceInfo: {
        price: appInfo.price,
        formattedPrice: appInfo.formattedPrice,
        timestamp,
      },
      minPriceInfo: {
        price: appInfo.price,
        formattedPrice: appInfo.formattedPrice,
        timestamp,
      },
      _manualAdd: true,
      _issueNumber: issueNumber,
    }
  } else {
    // 更新现有记录
    existingInfo.price = appInfo.price
    existingInfo.formattedPrice = appInfo.formattedPrice
    existingInfo.timestamp = timestamp
    existingInfo._manualAdd = true
    existingInfo._issueNumber = issueNumber

    // 更新最高/最低价格记录
    if (appInfo.price > (existingInfo.maxPriceInfo?.price || 0)) {
      existingInfo.maxPriceInfo = {
        price: appInfo.price,
        formattedPrice: appInfo.formattedPrice,
        timestamp,
      }
    }
    if (appInfo.price < (existingInfo.minPriceInfo?.price || Infinity)) {
      existingInfo.minPriceInfo = {
        price: appInfo.price,
        formattedPrice: appInfo.formattedPrice,
        timestamp,
      }
    }
  }

  // 保存存储数据
  try {
    const storagePath = path.join(__dirname, `../storage/${region}.json`)
    fs.writeFileSync(storagePath, JSON.stringify(storage, null, 2), 'utf-8')
  } catch (error) {
    console.warn(`保存 ${region}.json 存储失败:`, (error as Error).message)
  }
}

/**
 * 处理 GitHub Issue 中的应用添加请求
 */
export async function processIssueRequest(
  issueBody: string,
  issueNumber: number,
  region: string = 'cn'
): Promise<ProcessResult> {
  console.log(`\n处理 Issue #${issueNumber}...`)

  const addedApps: ProcessResult['addedApps'] = []
  const failedApps: ProcessResult['failedApps'] = []
  const existingApps: ProcessResult['existingApps'] = []

  // 1. 从 Issue 内容提取 App Store 链接
  const links = extractAppStoreLinks(issueBody)

  if (links.length === 0) {
    console.log('❌ Issue 中未找到有效的 App Store 链接')
    return { status: 'no_links', addedCount: 0, addedApps, failedApps, existingApps }
  }

  console.log(`✓ 从 Issue 中提取 ${links.length} 个 App Store 链接`)

  // 预先读取一次 apps.json，避免循环内重复读取
  const { appConfig: currentAppConfig } = readAppsConfig()

  // 2. 逐个验证
  for (const link of links) {
    const appId = extractAppId(link)

    if (!appId) {
      console.log(`⚠ 无效链接: ${link}`)
      failedApps.push({ id: link, reason: '无法从链接中提取 App ID，请检查链接格式' })
      continue
    }

    // 先检查是否已在追踪列表，避免无谓的 API 调用
    const existingEntry = currentAppConfig.find(a => a.id === parseInt(appId))
    if (existingEntry) {
      const name =
        existingEntry.name?.cn ||
        (existingEntry.name ? Object.values(existingEntry.name)[0] : undefined) ||
        `App ${appId}`
      console.log(`ℹ 应用 "${name}" (ID: ${appId}) 已在追踪列表`)
      existingApps.push({ id: parseInt(appId), name })
      continue
    }

    const validation = await validateApp(appId, region)

    if (validation.valid && validation.appInfo) {
      const appInfo = validation.appInfo
      console.log(`✅ ${appInfo.trackName} (ID: ${appId}) - 验证通过`)
      if (addAppToConfig(appInfo, issueNumber)) {
        updatePriceHistory(appInfo, region, issueNumber)
        addedApps.push({ name: appInfo.trackName, id: appInfo.trackId, formattedPrice: appInfo.formattedPrice })
      }
    } else {
      console.log(`❌ ${appId} - ${validation.reason}`)
      failedApps.push({ id: appId, reason: validation.reason || '验证失败' })
    }

    // 避免 API 限流
    await new Promise(resolve => setTimeout(resolve, 500))
  }

  // 3. 汇总状态
  let status: ProcessResult['status']
  if (addedApps.length > 0 && failedApps.length === 0 && existingApps.length === 0) {
    status = 'success'
  } else if (addedApps.length > 0) {
    status = 'partial'
  } else if (existingApps.length > 0 && failedApps.length === 0) {
    status = 'all_exists'
  } else {
    status = 'all_failed'
  }

  console.log(`\n处理完成: 新增 ${addedApps.length} 个，失败 ${failedApps.length} 个，已存在 ${existingApps.length} 个`)
  return { status, addedCount: addedApps.length, addedApps, failedApps, existingApps }
}

export default processIssueRequest
