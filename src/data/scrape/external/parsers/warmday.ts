/**
 * WarmDay 解析器（极简限免）
 * 数据源：https://free.warmday.wang/daily
 * 通过 Bmob 后端 API 获取每日精选限免应用
 */

import crypto from 'crypto'
import fetch from 'node-fetch'
import type { IParser, ParseResult, ExternalAppInfo } from '../types'
import { extractAppId, isValidAppStoreUrl } from '../utils'

// Bmob API 配置
const SECRET_KEY = 'fbd32102704c8b1f'
const SECURITY_CODE = '9Y~[]aX5m[kSbN*w'
const SERVER_VERSION = 10

interface WarmDayAppExt {
  title?: string
  link?: string
  oPrice?: string
  cPrice?: string
  areas?: string
  kind?: number
  type?: string
}

interface WarmDayAppItem {
  ext?: WarmDayAppExt
}

interface WarmDayResult {
  datekey?: number
  appinfo?: {
    free?: WarmDayAppItem[]
    sale?: WarmDayAppItem[]
  }
  game?: {
    free?: WarmDayAppItem[]
    sale?: WarmDayAppItem[]
  }
}

export class WarmDayParser implements IParser {
  private readonly SOURCE_NAME = 'WarmDay'

  async parse(url: string): Promise<ParseResult> {
    try {
      console.log(`[${this.SOURCE_NAME}] 开始抓取...`)

      // 1. 调用 Bmob API 获取最新一天的数据
      const route = '/1/classes/free_newpro'
      const params = {
        limit: '1',
        order: '-datekey',
        keys: 'datekey,appinfo,game'
      }

      const data = await this.bmobGet(url, route, params)

      if (!data || !data.results || data.results.length === 0) {
        console.log(`[${this.SOURCE_NAME}] API 返回空结果`)
        return { success: true, apps: [], source: this.SOURCE_NAME }
      }

      const result = data.results[0] as WarmDayResult
      console.log(`[${this.SOURCE_NAME}] datekey: ${result.datekey}`)

      // 2. 合并所有分类的应用列表
      const allItems: WarmDayAppItem[] = [
        ...(result.appinfo?.free || []),
        ...(result.appinfo?.sale || []),
        ...(result.game?.free || []),
        ...(result.game?.sale || [])
      ]

      // 3. 解析每个应用
      const apps: ExternalAppInfo[] = []
      let invalidCount = 0

      for (const item of allItems) {
        const ext = item.ext
        if (!ext || !ext.link || !ext.title) {
          invalidCount++
          continue
        }

        if (!isValidAppStoreUrl(ext.link)) {
          invalidCount++
          continue
        }

        const appId = extractAppId(ext.link)
        if (!appId) {
          invalidCount++
          continue
        }

        const discountType: 'app' | 'unknown' = ext.cPrice === '0.00' ? 'app' : 'unknown'

        apps.push({
          name: ext.title,
          appStoreUrl: ext.link,
          appId,
          source: this.SOURCE_NAME,
          scrapedAt: new Date(),
          originalUrl: 'https://free.warmday.wang/daily',
          discountType
        })
      }

      console.log(`[${this.SOURCE_NAME}] 有效: ${apps.length}个${invalidCount > 0 ? ` | 无效链接: ${invalidCount}` : ''}`)

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
   * Bmob API GET 请求（带签名认证）
   */
  private async bmobGet(baseUrl: string, route: string, params: Record<string, string>): Promise<any> {
    const timestamp = Math.round(Date.now() / 1000)
    const nonce = this.randomString(16)
    const body = '' // GET 请求 body 为空

    // 签名: MD5(route + timestamp + securityCode + nonce + body + serverVersion)
    const signStr = route + timestamp + SECURITY_CODE + nonce + body + SERVER_VERSION
    const sign = crypto.createHash('md5').update(signStr, 'utf-8').digest('hex')

    const headers = {
      'content-type': 'application/json',
      'X-Bmob-SDK-Type': 'wechatApp',
      'X-Bmob-Safe-Sign': sign,
      'X-Bmob-Safe-Timestamp': String(timestamp),
      'X-Bmob-Noncestr-Key': nonce,
      'X-Bmob-SDK-Version': String(SERVER_VERSION),
      'X-Bmob-Secret-Key': SECRET_KEY
    }

    const qs = new URLSearchParams(params).toString()
    const fullUrl = baseUrl + route + (qs ? '?' + qs : '')

    const response = await fetch(fullUrl, { headers })

    if (!response.ok) {
      throw new Error(`Bmob API HTTP ${response.status}: ${response.statusText}`)
    }

    return response.json()
  }

  /**
   * 生成随机字符串
   */
  private randomString(len: number): string {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
    let result = ''
    for (let i = 0; i < len; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  }
}
