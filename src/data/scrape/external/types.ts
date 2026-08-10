/**
 * 外部限免网站抓取模块 - 类型定义
 */

/**
 * 外部数据源配置
 */
export interface ExternalSource {
  /** 数据源名称 */
  name: string
  /** 数据源 URL */
  url: string
  /** 解析器类型 */
  parser: 'gofans' | 'oodata' | 'mergeek' | 'warmday' | 'ithome'
  /** 是否启用 */
  enabled: boolean
  /** 描述 */
  description?: string
}

/**
 * 从外部网站提取的应用信息
 */
export interface ExternalAppInfo {
  /** 应用名称 */
  name: string
  /** App Store 链接（完整 URL） */
  appStoreUrl: string
  /** App ID（从链接中提取） */
  appId: string
  /** 数据来源 */
  source: string
  /** 抓取时间 */
  scrapedAt: Date
  /** 原始链接（外部网站的详情页） */
  originalUrl?: string
  /** 折扣类型：本体限免 | 内购限免 | 未知 */
  discountType?: 'app' | 'iap' | 'unknown'
}

/**
 * 解析器返回结果
 */
export interface ParseResult {
  /** 是否成功 */
  success: boolean
  /** 提取到的应用列表 */
  apps: ExternalAppInfo[]
  /** 错误信息 */
  error?: string
  /** 数据源名称 */
  source: string
}

/**
 * 解析器接口
 */
export interface IParser {
  /**
   * 解析网站数据
   * @param url 网站 URL
   * @returns 解析结果
   */
  parse(url: string): Promise<ParseResult>
}
