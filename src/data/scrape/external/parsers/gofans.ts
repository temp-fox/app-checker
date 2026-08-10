/**
 * GoFans 解析器
 * 网站：https://gofans.cn/
 */

import fetch from 'node-fetch'
import * as cheerio from 'cheerio'
import type { IParser, ParseResult, ExternalAppInfo } from '../types'
import { extractAppId, isValidAppStoreUrl, normalizeAppStoreUrl } from '../utils'

export class GoFansParser implements IParser {
  private readonly SOURCE_NAME = 'GoFans'
  
  async parse(url: string): Promise<ParseResult> {
    try {
      console.log(`[${this.SOURCE_NAME}] 开始抓取: ${url}`)
      
      // 1. 获取首页 HTML
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        }
      })
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      const html = await response.text()
      const $ = cheerio.load(html)
      
      // 2. 提取应用详情页链接
      const appLinks: string[] = []
      $('a[href^="/app/"]').each((_, element) => {
        const href = $(element).attr('href')
        if (href && href.startsWith('/app/')) {
          const fullUrl = `https://gofans.cn${href}`
          if (!appLinks.includes(fullUrl)) {
            appLinks.push(fullUrl)
          }
        }
      })
      
      console.log(`[${this.SOURCE_NAME}] 找到 ${appLinks.length} 个应用链接`)

      if (appLinks.length === 0) {
        return {
          success: true,
          apps: [],
          source: this.SOURCE_NAME
        }
      }
      
      // 3. 访问每个详情页提取 App Store 链接
      const apps: ExternalAppInfo[] = []
      
      // 限制并发数量，避免被封
      const BATCH_SIZE = 3
      const DELAY = 2000 // 2秒延迟
      
      for (let i = 0; i < appLinks.length; i += BATCH_SIZE) {
        const batch = appLinks.slice(i, i + BATCH_SIZE)
        const batchResults = await Promise.all(
          batch.map(link => this.parseDetailPage(link))
        )
        
        // 过滤掉失败的结果
        const validResults = batchResults.filter(app => app !== null) as ExternalAppInfo[]
        apps.push(...validResults)

        // 延迟避免请求过快
        if (i + BATCH_SIZE < appLinks.length) {
          await new Promise(resolve => setTimeout(resolve, DELAY))
        }
      }

      console.log(`[${this.SOURCE_NAME}] 成功提取 ${apps.length}/${appLinks.length} 个应用`)
      
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
   * 解析单个应用详情页
   */
  private async parseDetailPage(url: string): Promise<ExternalAppInfo | null> {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        timeout: 10000
      })
      
      if (!response.ok) {
        return null
      }
      
      const html = await response.text()
      const $ = cheerio.load(html)
      
      // 查找 App Store 链接
      let appStoreUrl: string | null = null
      let appName: string | null = null
      
      $('a[href*="apps.apple.com"], a[href*="itunes.apple.com"]').each((_, element) => {
        const href = $(element).attr('href')
        if (href && isValidAppStoreUrl(href)) {
          appStoreUrl = normalizeAppStoreUrl(href)
          return false // 找到第一个就停止
        }
      })
      
      if (!appStoreUrl) {
        return null
      }
      
      // 提取应用名称（尝试多种选择器）
      appName = $('h1').first().text().trim() ||
                $('title').text().trim().split('-')[0].trim() ||
                'Unknown'
      
      const appId = extractAppId(appStoreUrl)
      if (!appId) {
        return null
      }
      
      return {
        name: appName,
        appStoreUrl,
        appId,
        source: this.SOURCE_NAME,
        scrapedAt: new Date(),
        originalUrl: url,
        discountType: 'app'  // GoFans 网站的应用默认为本体限免
      }
      
    } catch (error) {
      // 单个详情页失败不影响整体流程
      return null
    }
  }
}
