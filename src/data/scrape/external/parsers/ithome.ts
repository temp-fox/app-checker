/**
 * IT之家解析器
 * 数据源：https://www.ithome.com/iosxianmian
 * 通过 API 获取 iOS 限免应用列表
 */

import fetch from 'node-fetch'
import * as cheerio from 'cheerio'
import type { IParser, ParseResult, ExternalAppInfo } from '../types'
import { extractAppId, isWithinDays } from '../utils'

const API_URL = 'https://napi.ithome.com/api/appdiscount/getdiscountapps'

interface ITHomeAppItem {
  name?: string
  originPrice?: number | string
  currentPrice?: number | string
  trackUrl?: string
  rating?: number | string
  dateStr?: string
  updateTime?: string
  hasInAppPurchase?: boolean
}

export class ITHomeParser implements IParser {
  private readonly SOURCE_NAME = 'IT之家'

  async parse(url: string): Promise<ParseResult> {
    try {
      console.log(`[${this.SOURCE_NAME}] 开始抓取...`)

      // 1. 获取 session cookie 和 token
      const { cookie, token } = await this.getSessionAndToken(url)

      // 2. 调用 API 获取应用列表
      const items = await this.fetchApi(cookie, token)
      console.log(`[${this.SOURCE_NAME}] API 返回 ${items.length} 个应用`)

      // 3. 过滤和解析
      const apps: ExternalAppInfo[] = []
      let skippedNotFree = 0
      let skippedNoId = 0
      let skippedOld = 0

      for (const item of items) {
        // 必须有 trackUrl
        if (!item.trackUrl) {
          skippedNoId++
          continue
        }

        const appId = extractAppId(item.trackUrl)
        if (!appId) {
          skippedNoId++
          continue
        }

        // 过滤：确认是限免（当前免费，原价 > 0）
        const currentPrice = Number(item.currentPrice) || 0
        const originPrice = Number(item.originPrice) || 0
        if (currentPrice !== 0 || originPrice <= 0) {
          skippedNotFree++
          continue
        }

        // 过滤：排除陈旧数据（仅保留 7 天内更新的）
        const dateRef = item.updateTime || item.dateStr
        if (dateRef && !isWithinDays(dateRef, 7)) {
          skippedOld++
          continue
        }

        apps.push({
          name: item.name || `App ${appId}`,
          appStoreUrl: item.trackUrl,
          appId,
          source: this.SOURCE_NAME,
          scrapedAt: new Date(),
          originalUrl: url,
          discountType: 'app',
        })
      }

      const skipInfo = [
        skippedNotFree > 0 ? `非限免: ${skippedNotFree}` : '',
        skippedNoId > 0 ? `无ID: ${skippedNoId}` : '',
        skippedOld > 0 ? `过期: ${skippedOld}` : '',
      ].filter(Boolean).join(' | ')

      console.log(`[${this.SOURCE_NAME}] 有效: ${apps.length}个${skipInfo ? ` | ${skipInfo}` : ''}`)

      return {
        success: true,
        apps,
        source: this.SOURCE_NAME,
      }
    } catch (error) {
      const err = error as Error
      console.error(`[${this.SOURCE_NAME}] 错误:`, err.message)

      return {
        success: false,
        apps: [],
        error: err.message,
        source: this.SOURCE_NAME,
      }
    }
  }

  /**
   * 获取 session cookie 和 data-token
   */
  private async getSessionAndToken(pageUrl: string): Promise<{ cookie: string; token: string }> {
    const response = await fetch(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    })

    if (!response.ok) {
      throw new Error(`获取页面失败: HTTP ${response.status}`)
    }

    // 提取 Set-Cookie header
    const setCookies = (response.headers as any).raw?.()?.['set-cookie']
      || [response.headers.get('set-cookie') || '']

    let sessionCookie = ''
    for (const c of setCookies) {
      const match = c.match(/ASP\.NET_SessionId=([^;]+)/)
      if (match) {
        sessionCookie = `ASP.NET_SessionId=${match[1]}`
        break
      }
    }

    // 提取 data-token
    const html = await response.text()
    const $ = cheerio.load(html)
    const token = $('[data-token]').attr('data-token') || ''

    if (!sessionCookie && !token) {
      console.warn(`[${this.SOURCE_NAME}] 未获取到 cookie 和 token，尝试直接调用 API`)
    }

    return { cookie: sessionCookie, token }
  }

  /**
   * 调用 API 获取应用列表
   */
  private async fetchApi(cookie: string, token: string): Promise<ITHomeAppItem[]> {
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Referer': 'https://www.ithome.com/iosxianmian',
    }

    if (cookie) {
      headers['Cookie'] = cookie
    }
    if (token) {
      headers['Token'] = token
    }

    const response = await fetch(API_URL, { headers })

    if (!response.ok) {
      throw new Error(`API 请求失败: HTTP ${response.status}`)
    }

    const json = await response.json() as any

    // 处理两种可能的响应格式
    if (Array.isArray(json)) {
      return json
    }
    if (json.success && Array.isArray(json.data)) {
      return json.data
    }
    if (Array.isArray(json.data)) {
      return json.data
    }

    console.warn(`[${this.SOURCE_NAME}] 未知的 API 响应格式`)
    return []
  }
}
