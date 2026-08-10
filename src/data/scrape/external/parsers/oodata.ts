/**
 * OODATA RSS 解析器
 * 网站：https://oodata.net/feed/
 * 每日限免应用 RSS 源
 */

import fetch from 'node-fetch'
import type { IParser, ParseResult, ExternalAppInfo } from '../types'
import { extractAppId, isValidAppStoreUrl, normalizeAppStoreUrl } from '../utils'

export class OODataParser implements IParser {
  private readonly SOURCE_NAME = 'OODATA'
  
  // 过滤关键词（VPN、代理、明确的成人内容）
  private readonly BLOCKED_KEYWORDS = [
    // VPN 和代理相关
    'vpn', 'proxy', '代理', '翻墙', 'shadowsocks', 'v2ray', 'trojan',
    // 明确的成人/色情内容
    'porn', 'sex', 'xxx', '色情', '黄色', '成人视频', '成人直播',
    // 约会/交友（可能涉及不良内容）
    '约炮', '一夜情', '激情', '勾搭'
    // 注意：移除了 '成人'、'交友'、'约会'、'dating' 等较宽泛的词
    // 因为这些词可能出现在正常应用中（如成人教育、正常交友）
  ]
  
  async parse(url: string): Promise<ParseResult> {
    try {
      console.log(`[${this.SOURCE_NAME}] 开始抓取: ${url}`)
      
      // 1. 获取 RSS XML
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        }
      })
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      const xmlText = await response.text()

      // 2. 按 <item> 逐条解析，只处理最近 24 小时内的条目
      const items = xmlText.match(/<item>[\s\S]*?<\/item>/gi) || []
      const now = Date.now()
      const oneDayMs = 24 * 60 * 60 * 1000

      const recentItems: string[] = []
      for (const item of items) {
        const pubMatch = item.match(/<pubDate>([^<]+)<\/pubDate>/)
        if (pubMatch) {
          const pubTime = new Date(pubMatch[1]).getTime()
          if (now - pubTime < oneDayMs) {
            recentItems.push(item)
          }
        }
      }

      console.log(`[${this.SOURCE_NAME}] RSS 共 ${items.length} 条，最近 24h 内 ${recentItems.length} 条`)

      // 只从最近的条目中提取链接
      const recentContent = recentItems.join('\n')
      const appStoreLinks: string[] = []
      const linkRegex = /https?:\/\/apps\.apple\.com\/(?:redeem\?[^"'<>]+|app\/id\d+)/gi
      const matches = recentContent.matchAll(linkRegex)

      for (const match of matches) {
        const link = match[0]
        if (!appStoreLinks.includes(link)) {
          appStoreLinks.push(link)
        }
      }

      console.log(`[${this.SOURCE_NAME}] 找到 ${appStoreLinks.length} 个 App Store 链接`)

      // 解析分类标记（本体限免 vs 内购限免）- 只解析最近条目
      const appDiscountTypes = this.parseDiscountTypes(recentContent)
      
      // 3. 过滤并验证每个应用
      const apps: ExternalAppInfo[] = []
      const seenIds = new Set<string>()
      let skippedRedeem = 0
      let skippedInvalid = 0

      // 处理所有链接（移除30个限制）
      const linksToProcess = appStoreLinks

      for (let i = 0; i < linksToProcess.length; i++) {
        const link = linksToProcess[i]

        // 跳过兑换码链接
        if (link.includes('/redeem')) {
          skippedRedeem++
          continue
        }

        const appId = extractAppId(link)
        if (!appId || seenIds.has(appId)) {
          continue
        }

        // 验证应用（中国区 + 内容过滤）
        const appInfo = await this.validateApp(appId)

        if (appInfo) {
          // 添加分类标记
          appInfo.discountType = appDiscountTypes.get(appId) || 'unknown'
          seenIds.add(appId)
          apps.push(appInfo)
        } else {
          skippedInvalid++
        }

        // 延迟避免 API 限制
        if (i < linksToProcess.length - 1 && i % 5 === 4) {
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
      }

      const appCount = apps.filter(a => a.discountType === 'app').length
      const iapCount = apps.filter(a => a.discountType === 'iap').length
      const unknownCount = apps.filter(a => a.discountType === 'unknown').length
      console.log(`[${this.SOURCE_NAME}] 有效: ${apps.length} 个（本体: ${appCount} | 内购: ${iapCount} | 未分类: ${unknownCount}）${skippedRedeem > 0 ? ` | 跳过兑换码: ${skippedRedeem}` : ''}${skippedInvalid > 0 ? ` | 无效: ${skippedInvalid}` : ''}`)
      
      return {
        success: true,
        apps,
        source: this.SOURCE_NAME
      }
      
    } catch (error) {
      const err = error as Error
      console.error(`[${this.SOURCE_NAME}] 错误:`, err.message)
      
      return {
        success: false,
        apps: [],
        error: err.message,
        source: this.SOURCE_NAME
      }
    }
  }
  
  /**
   * 解析 RSS 中的分类标记
   * 识别"本体限免"和"内购限免"段落，为应用 ID 建立映射
   */
  private parseDiscountTypes(xmlText: string): Map<string, 'app' | 'iap'> {
    const map = new Map<string, 'app' | 'iap'>()
    
    // 按段落分割（通过 <p> 标签）
    const paragraphs = xmlText.split(/<\/?p[^>]*>/i)
    
    let currentType: 'app' | 'iap' | null = null
    
    for (const para of paragraphs) {
      // 检测分类标记
      if (para.includes('本体限免')) {
        currentType = 'app'
      } else if (para.includes('内购限免') || para.includes('+ 内购')) {
        currentType = 'iap'
      }
      
      // 提取当前段落中的 App ID
      if (currentType) {
        const idMatches = para.matchAll(/id(\d{9,10})/g)
        for (const match of idMatches) {
          map.set(match[1], currentType)
        }
      }
    }
    
    return map
  }
  
  /**
   * 验证应用是否符合条件
   * 1. 所有国家/地区（不限制中国区）
   * 2. 不包含 VPN/代理/明确成人内容
   * 3. 允许 17+ 应用（不一定是黄色内容）
   */
  private async validateApp(appId: string): Promise<ExternalAppInfo | null> {
    try {
      // 查询全球 iTunes API（不限制国家）
      const apiUrl = `https://itunes.apple.com/lookup?id=${appId}`
      const response = await fetch(apiUrl, { timeout: 10000 })
      
      if (!response.ok) {
        return null
      }
      
      const data = await response.json() as any
      
      // 检查应用是否存在
      if (!data.results || data.results.length === 0) {
        return null
      }
      
      const app = data.results[0]
      const appName = app.trackName || app.bundleId || 'Unknown'
      const appDescription = (app.description || '').toLowerCase()
      const appNameLower = appName.toLowerCase()
      const country = app.country || 'US'
      
      // 内容过滤（只过滤 VPN 和明确的成人内容）
      for (const keyword of this.BLOCKED_KEYWORDS) {
        if (appNameLower.includes(keyword) || appDescription.includes(keyword)) {
          return null
        }
      }
      
      // 移除 17+ 年龄分级检查（允许 17+ 应用）
      // 17+ 不一定是黄色内容，可能是暴力游戏、社交应用等
      
      // 构建 App Store URL（使用应用所在国家）
      const countryCode = country.toLowerCase()
      const appStoreUrl = `https://apps.apple.com/${countryCode}/app/id${appId}`
      
      return {
        name: appName,
        appStoreUrl,
        appId,
        source: this.SOURCE_NAME,
        scrapedAt: new Date(),
        originalUrl: `https://oodata.net/feed/`
      }
      
    } catch (error) {
      // 单个应用验证失败不影响整体
      return null
    }
  }
}
