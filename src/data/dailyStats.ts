import dayjs from 'dayjs'
import { writeFileSync, readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

const statsFilePath = resolve(__dirname, 'storage/daily-stats.json')

interface DailyStatsApp {
  id: number
  name: string
  type: 'price' | 'iap'
  detail: string
}

interface DailyStatsRegion {
  total: number
  price: number
  iap: number
  apps: DailyStatsApp[]
}

interface DailyStatsEntry {
  timestamp: number
  cn: DailyStatsRegion
}

function readDailyStats(): DailyStatsEntry[] {
  if (!existsSync(statsFilePath)) return []
  try {
    return JSON.parse(readFileSync(statsFilePath, 'utf-8')) || []
  } catch {
    return []
  }
}

function saveDailyStats(entries: DailyStatsEntry[]) {
  writeFileSync(statsFilePath, JSON.stringify(entries, null, 2), 'utf-8')
}

export default function updateDailyStats(
  regionDiscountInfo: RegionDiscountInfo,
) {
  const cnDiscounts = regionDiscountInfo.cn || []
  if (cnDiscounts.length === 0) {
    console.log('每日统计：本次无新折扣')
    return
  }

  const apps: DailyStatsApp[] = []

  cnDiscounts.forEach((info) => {
    const priceDiscount = info.discounts.find((d) => d.type === 'price')
    if (priceDiscount) {
      apps.push({
        id: info.trackId,
        name: info.trackName,
        type: 'price',
        detail: `${priceDiscount.from} → ${priceDiscount.to}`,
      })
    }

    info.discounts
      .filter((d) => d.type === 'inAppPurchase')
      .forEach((d) => {
        apps.push({
          id: info.trackId,
          name: info.trackName,
          type: 'iap',
          detail: `${d.name}: ${d.from} → ${d.to}`,
        })
      })
  })

  const priceCount = apps.filter((a) => a.type === 'price').length
  const iapCount = apps.filter((a) => a.type === 'iap').length

  const entry: DailyStatsEntry = {
    timestamp: Date.now(),
    cn: {
      total: apps.length,
      price: priceCount,
      iap: iapCount,
      apps,
    },
  }

  const existing = readDailyStats()
  const now = dayjs()
  const filtered = existing.filter(
    (e) => now.diff(dayjs(e.timestamp), 'day') < 10,
  )

  const merged = [entry, ...filtered]
  saveDailyStats(merged)

  console.log(
    `每日统计：记录 ${apps.length} 条（本体 ${priceCount} / 内购 ${iapCount}），历史 ${merged.length} 条`,
  )
}
