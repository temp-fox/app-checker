import { Translate } from 'i18n-pro'

// 原始配置（包含所有地区）
// export const regions: Region[] = ['cn', 'hk', 'mo', 'tw', 'us', 'tr', 'pt']

// 自定义配置：仅监控中国大陆
export const regions: Region[] = ['cn']

/**
 * 注意：这里默认写的是中文，做了多语言支持，以中文为key
 */
export const getRegionNameMap = (tProp?: Translate) => {
  const t = tProp || (global as any).t
  return {
    cn: t('中国大陆'),
    hk: t('中国香港'),
    mo: t('中国澳门'),
    tw: t('中国台湾'),
    us: t('美国'),
    tr: t('土耳其'),
    pt: t('葡萄牙'),
  }
}

/**
 * 注意：这里的 value 值是从浏览器打开应用详情页时，对应的 `App 内购买项目` 的标题
 * 文本内容一定要对得上，不然获取不到应用的内购信息
 */
export const regionInAppPurchasesTextMap: Record<Region, string> = {
  cn: 'App内购买',
  hk: 'App 內購買',
  mo: 'App 內購買',
  tw: 'App內購買',
  us: 'In-App Purchases',
  tr: `In-App Purchases`,
  pt: 'Compras integradas',
}

/**
 * 注意：这里暂时规划是只有中文和英文
 */
export const regionLanguageCodeMap: Record<Region, string> = {
  cn: 'zh-CN',
  hk: 'zh-CN',
  mo: 'zh-CN',
  tw: 'zh-CN',
  us: 'en',
  tr: 'en',
  pt: 'en',
}

/**
 * 国家或地区对应的时区，用途是计算日期分类时，不同时区可以按其当地的时区归类
 * 值需要遵循 https://www.iana.org/time-zones 中的取值
 */
export const regionTimezoneMap: Record<Region, string> = {
  cn: 'Asia/Shanghai',
  hk: 'Asia/Hong_Kong',
  mo: 'Asia/Macau',
  tw: 'Asia/Taipei',
  us: 'America/New_York',
  tr: 'Europe/Istanbul',
  pt: 'Europe/Lisbon',
}
