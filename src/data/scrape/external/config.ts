/**
 * 外部限免网站配置
 */

import type { ExternalSource } from './types'

/**
 * 外部数据源列表
 * 用户可以在这里添加或移除数据源
 */
export const externalSources: ExternalSource[] = [
  {
    name: 'GoFans',
    url: 'https://gofans.cn/',
    parser: 'gofans',
    enabled: true,
    description: '果粉 GoFans - 每日推荐优质的 macOS、iOS 限免资讯'
  },
  {
    name: 'OODATA',
    url: 'https://oodata.net/feed/',
    parser: 'oodata',
    enabled: true,
    description: 'OODATA - 每日限免应用 RSS（所有国家/地区，自动过滤 VPN、成人内容）'
  },
  {
    name: 'WarmDay',
    url: 'https://api.bmobcloud.com',
    parser: 'warmday',
    enabled: true,
    description: '极简限免 - 每日精选 iOS & macOS 限免 App'
  },
  {
    name: 'IT之家',
    url: 'https://www.ithome.com/iosxianmian',
    parser: 'ithome',
    enabled: true,
    description: 'IT之家 - iOS 限免应用精选列表'
  },
  // 可选：MerGeek（需要额外开发）
  // {
  //   name: 'MerGeek',
  //   url: 'https://mergeek.cn/digital_deals?category=ios_free&locale=zh',
  //   parser: 'mergeek',
  //   enabled: false,
  //   description: 'MerGeek iOS 限免频道'
  // }
]

/**
 * 获取已启用的外部数据源
 */
export function getEnabledSources(): ExternalSource[] {
  return externalSources.filter(source => source.enabled)
}
