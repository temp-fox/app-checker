import nodeFetch from 'node-fetch'
import { buildSummaryDescription, sanitizeDescription } from './calculate'

export function hasChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text)
}

export function needsTranslation(text: string): boolean {
  const normalized = text.trim()
  if (!normalized) return false

  const asciiLetterCount = (normalized.match(/[A-Za-z]/g) || []).length
  if (asciiLetterCount === 0) return false

  const chineseCharCount = (normalized.match(/[\u4e00-\u9fff]/g) || []).length
  if (chineseCharCount === 0) return true

  return asciiLetterCount >= 8
}

export async function translateText(text: string): Promise<string | null> {
  try {
    const truncated = text.substring(0, 600)
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=${encodeURIComponent(truncated)}`
    const res = await nodeFetch(url, { timeout: 8000 })
    const data = (await res.json()) as any
    if (!data || !data[0]) return null
    return data[0]
      .filter((i: any) => i && i[0])
      .map((i: any) => i[0])
      .join('')
  } catch {
    return null
  }
}

export async function translateDescriptions(
  regionAppInfo: RegionAppInfo,
): Promise<void> {
  for (const [region, appInfos] of Object.entries(regionAppInfo)) {
    const toTranslate = appInfos.filter((app) => {
      const desc = (app.fullDescription || app.description || '').trim()
      return needsTranslation(desc)
    })

    if (toTranslate.length === 0) continue

    console.log(
      `[${region}] 检测到 ${toTranslate.length} 个英文描述，开始翻译...`,
    )

    let success = 0
    let fail = 0

    for (let i = 0; i < toTranslate.length; i += 4) {
      const batch = toTranslate.slice(i, i + 4)
      await Promise.all(
        batch.map(async (app) => {
          const sourceDescription = app.fullDescription || app.description
          const translated = await translateText(sourceDescription)
          if (translated) {
            app.description = translated
            app.fullDescription = translated
            app.summaryDescription = buildSummaryDescription(translated)
            success++
          } else {
            fail++
          }
        }),
      )
    }

    console.log(`[${region}] 翻译完成: 成功 ${success}, 失败 ${fail}`)
  }
}

export async function translateDiscountDescriptions(
  regionDiscountInfo: RegionDiscountInfo,
  regionStorageAppInfo: RegionStorageAppInfo,
): Promise<void> {
  let totalTargets = 0
  let totalSuccess = 0
  let totalFail = 0

  for (const [region, discountInfos] of Object.entries(regionDiscountInfo) as Array<[Region, DiscountInfo[]]>) {
    const translationTargets = new Map<string, {
      description: string
      discountInfos: DiscountInfo[]
      storageItems: Array<RegionStorageAppInfo[Region][string]>
    }>()

    discountInfos.forEach((discountInfo) => {
      const description = (discountInfo.fullDescription || discountInfo.description || '').trim()
      if (!needsTranslation(description)) return

      const key = `${discountInfo.trackId}:${description}`
      const existing = translationTargets.get(key)
      const storageItem = regionStorageAppInfo[region]?.[String(discountInfo.trackId)]

      if (existing) {
        existing.discountInfos.push(discountInfo)
        if (storageItem) existing.storageItems.push(storageItem)
        return
      }

      translationTargets.set(key, {
        description,
        discountInfos: [discountInfo],
        storageItems: storageItem ? [storageItem] : [],
      })
    })

    const targets = Array.from(translationTargets.values())
    if (targets.length === 0) continue

    totalTargets += targets.length
    console.log(`[${region}] RSS 描述翻译: ${targets.length} 个应用待处理`)

    let success = 0
    let fail = 0

    for (let i = 0; i < targets.length; i += 4) {
      const batch = targets.slice(i, i + 4)
      await Promise.all(
        batch.map(async (target) => {
          const translated = await translateText(target.description)
          if (!translated) {
            fail++
            return
          }

          const sanitizedTranslated = sanitizeDescription(translated)
          const summaryDescription = buildSummaryDescription(sanitizedTranslated)

          target.discountInfos.forEach((discountInfo) => {
            discountInfo.description = sanitizedTranslated
            discountInfo.fullDescription = sanitizedTranslated
            discountInfo.summaryDescription = summaryDescription
          })
          target.storageItems.forEach((storageItem) => {
            storageItem.description = sanitizedTranslated
            storageItem.fullDescription = sanitizedTranslated
            storageItem.summaryDescription = summaryDescription
          })
          success++
        }),
      )
    }

    totalSuccess += success
    totalFail += fail
    console.log(`[${region}] RSS 描述翻译完成: 成功 ${success}, 失败 ${fail}`)
  }

  console.log(`RSS 描述翻译统计: 待翻译 ${totalTargets} 个应用 | 成功 ${totalSuccess} | 失败 ${totalFail}`)
}
