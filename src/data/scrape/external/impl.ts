/**
 * 外部数据源抓取 - 主实现
 */

import { getEnabledSources } from './config'
import { GoFansParser } from './parsers/gofans'
import { OODataParser } from './parsers/oodata'
import { WarmDayParser } from './parsers/warmday'
import { ITHomeParser } from './parsers/ithome'
import type { IParser, ParseResult, ExternalAppInfo } from './types'
import { writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { getTodayCacheFileName, getChinaDateStr } from './utils'

/**
 * 获取解析器实例（使用动态导入避免加载未使用的依赖）
 */
async function getParser(parserType: string): Promise<IParser | null> {
  switch (parserType) {
    case 'gofans':
      return new GoFansParser()
    case 'oodata':
      return new OODataParser()
    case 'warmday':
      return new WarmDayParser()
    case 'ithome':
      return new ITHomeParser()
    default:
      return null
  }
}

/**
 * 缓存管理
 */
class ExternalCache {
  private cacheDir: string
  private cacheFile: string
  private cachedAppIds: Set<string>
  
  constructor(baseDir: string = '.') {
    this.cacheDir = join(baseDir, 'src', 'data', 'scrape', 'external', '.cache')
    this.cacheFile = join(this.cacheDir, getTodayCacheFileName())
    this.cachedAppIds = new Set()
    this.loadCache()
  }
  
  /**
   * 加载今天的缓存
   */
  private loadCache() {
    try {
      // 创建缓存目录
      if (!existsSync(this.cacheDir)) {
        const fs = require('fs')
        fs.mkdirSync(this.cacheDir, { recursive: true })
      }
      
      if (existsSync(this.cacheFile)) {
        const data = JSON.parse(readFileSync(this.cacheFile, 'utf-8'))
        this.cachedAppIds = new Set(data.appIds || [])
      }
    } catch (error) {
      console.warn('[缓存] 加载缓存失败:', (error as Error).message)
    }
  }
  
  /**
   * 保存缓存
   */
  saveCache(appIds: string[]) {
    try {
      const data = {
        date: getChinaDateStr(),
        appIds: [...new Set([...this.cachedAppIds, ...appIds])],
        updatedAt: new Date().toISOString()
      }
      
      writeFileSync(this.cacheFile, JSON.stringify(data, null, 2), 'utf-8')
    } catch (error) {
      console.warn('[缓存] 保存缓存失败:', (error as Error).message)
    }
  }
  
  /**
   * 检查 App ID 是否已缓存
   */
  isCached(appId: string): boolean {
    return this.cachedAppIds.has(appId)
  }

  /**
   * 已缓存的 App ID 数量
   */
  get cachedCount(): number {
    return this.cachedAppIds.size
  }
  
  /**
   * 过滤出新的应用（未缓存的）
   */
  filterNewApps(apps: ExternalAppInfo[]): ExternalAppInfo[] {
    return apps.filter(app => !this.isCached(app.appId))
  }
}

/**
 * 从所有启用的外部数据源抓取应用
 * @returns 提取到的应用列表
 */
export async function scrapeExternalSources(): Promise<ExternalAppInfo[]> {
  const sources = getEnabledSources()

  if (sources.length === 0) {
    console.log('没有启用的外部数据源')
    return []
  }

  const allApps: ExternalAppInfo[] = []
  const results: ParseResult[] = []

  // 串行处理每个数据源，避免并发过多
  for (const source of sources) {
    const parser = await getParser(source.parser)

    if (!parser) {
      console.warn(`未找到 ${source.name} 的解析器: ${source.parser}`)
      continue
    }

    try {
      const result = await parser.parse(source.url)
      results.push(result)

      if (result.success) {
        allApps.push(...result.apps)
      }

      // 数据源之间延迟 2 秒
      if (sources.indexOf(source) < sources.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000))
      }

    } catch (error) {
      console.error(`${source.name} 抓取失败:`, (error as Error).message)
    }
  }

  // 去重（相同 App ID 只保留第一个）
  const uniqueApps = new Map<string, ExternalAppInfo>()
  allApps.forEach(app => {
    if (!uniqueApps.has(app.appId)) {
      uniqueApps.set(app.appId, app)
    }
  })

  const finalApps = Array.from(uniqueApps.values())

  // 使用缓存过滤今日新发现的应用
  const cache = new ExternalCache()
  const newApps = cache.filterNewApps(finalApps)

  // 统计汇总
  const sourcesSummary = results.map(r => `${r.source}: ${r.success ? r.apps.length : 'failed'}`).join(' | ')
  console.log(`外部数据源: ${sourcesSummary} | 去重后: ${finalApps.length} | 今日新发现: ${newApps.length}${cache.cachedCount > 0 ? ` | 已缓存: ${cache.cachedCount}` : ''}`)

  // 更新缓存
  cache.saveCache(finalApps.map(app => app.appId))

  return newApps
}

/**
 * 将外部应用转换为项目使用的 AppTopInfo 格式
 */
export function convertToAppTopInfo(apps: ExternalAppInfo[]): AppTopInfo[] {
  return apps.map(app => ({
    id: app.appId,
    name: app.name,
    // 外部数据源可能没有详细信息，使用 App Store URL 作为后续查询依据
    _externalSource: app.source,
    _scrapedAt: app.scrapedAt.toISOString()
  }))
}
