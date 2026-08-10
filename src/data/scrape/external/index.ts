/**
 * 外部限免数据源模块
 * 从第三方限免网站抓取应用信息，补充项目未覆盖的限免 App
 */

export { scrapeExternalSources, convertToAppTopInfo } from './impl'
export { getEnabledSources } from './config'
export type { ExternalAppInfo, ExternalSource, ParseResult } from './types'
