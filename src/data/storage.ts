import { resolve } from 'node:path'
import { existsSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from 'node:fs'
import { start, end } from './timer'
import * as path from 'node:path'

// ---- 分片参数 ----

/** 每个分片最大字节数（utf-8 编码后），可在 build 时按需调整 */
const SHARD_MAX_BYTES = 20 * 1024 * 1024 // 20 MB

/** 需要进行分片存储的地区（仅大型地区；其他地区直接存一个文件） */
const SHARDED_REGIONS: Set<Region> = new Set(['cn'])

// ---- 文件路径工具 ----

function getFilepath(region: Region) {
  return resolve(__dirname, 'storage', `${region}.json`)
}

function getIndexPath(region: Region) {
  return resolve(__dirname, 'storage', `${region}-index.json`)
}

function getShardPath(region: Region, index: number) {
  return resolve(__dirname, 'storage', `${region}-${index}.json`)
}

// ---- 公开接口（签名 / 返回类型完全不变）----

export function getStorageAppInfo(regions: Region[]) {
  start('getStorageAppInfo')
  const res: RegionStorageAppInfo = {}

  for (let i = 0; i < regions.length; i++) {
    const region = regions[i]
    console.info(`【${i + 1}/${regions.length}】（${region}） `)

    if (SHARDED_REGIONS.has(region)) {
      const merged = readSharded(region)
      if (merged) {
        res[region] = merged
        continue
      }
      // 回退：旧格式 cn.json 不存在就是空对象
    }

    const filepath = getFilepath(region)
    const isExist = existsSync(filepath)
    if (isExist) {
      try {
        res[region] = require(filepath)
      } catch (error) {
        console.error(error)
        res[region] = {}
      }
    } else {
      res[region] = {}
    }
  }
  end('getStorageAppInfo')
  return res
}

export function setStorageAppInfo(
  regions: Region[],
  regionStorageAppInfo: RegionStorageAppInfo,
) {
  start('setStorageAppInfo')
  for (let i = 0; i < regions.length; i++) {
    const region = regions[i]
    const storageAppInfo = regionStorageAppInfo[region]
    console.info(`【${i + 1}/${regions.length}】（${region}）`)
    if (!storageAppInfo || Object.keys(storageAppInfo).length === 0) continue

    if (SHARDED_REGIONS.has(region)) {
      writeSharded(region, storageAppInfo!)
    } else {
      const filepath = getFilepath(region)
      const content = JSON.stringify(storageAppInfo, null, 2)
      writeFileSync(filepath, content, { encoding: 'utf-8' })
    }
  }
  end('setStorageAppInfo')
}

// ---- 内部分片实现 ----

/**
 * 将 `region` 的大型 StorageAppInfo 写入多个 ≤20 MB 的分片 +
 * 一个索引文件 (id → shard 编号)。
 *
 * 每次调用都是全量覆盖：先清旧分片再写新分片保证一致性。
 */
function writeSharded(region: Region, data: StorageAppInfo) {
  cleanOldShards(region)

  const index: Record<string, number> = {}
  const shards: StorageAppInfo[] = []
  let current: StorageAppInfo = {}
  let currentBytes = 2 // "{}"

  for (const [id, app] of Object.entries(data)) {
    const entryJson = JSON.stringify({ [id]: app }, null, 2)
    // 估算字节（utf-8）；Node 的 Buffer.byteLength 是 O(n) 但可接受
    const entryBytes = Buffer.byteLength(entryJson, 'utf-8') + 1 // +1 for comma/newline

    // 如果当前片放不下且非空 → 关片开新片
    if (currentBytes + entryBytes > SHARD_MAX_BYTES && Object.keys(current).length > 0) {
      shards.push(current)
      current = {}
      currentBytes = 2
    }

    current[id] = app
    currentBytes += entryBytes
    index[id] = shards.length
  }

  // 最后一片
  if (Object.keys(current).length > 0) {
    shards.push(current)
  }

  // 写分片 + 索引
  for (let i = 0; i < shards.length; i++) {
    const shardJson = JSON.stringify(shards[i], null, 2)
    writeFileSync(getShardPath(region, i), shardJson, { encoding: 'utf-8' })
    console.info(`  分片 cn-${i}.json: ${Object.keys(shards[i]).length} apps, ${(Buffer.byteLength(shardJson, 'utf-8') / 1024 / 1024).toFixed(1)} MB`)
  }

  const indexJson = JSON.stringify(index)
  writeFileSync(getIndexPath(region), indexJson, { encoding: 'utf-8' })
  console.info(`  索引 cn-index.json: ${Object.keys(index).length} entries`)

  // 可选：额外保存一个合并版 cn.json 作为回退（本地开发用）
  if (process.env.WRITE_MERGED_CN_JSON === 'true') {
    const merged = JSON.stringify(data, null, 2)
    writeFileSync(getFilepath(region), merged, { encoding: 'utf-8' })
  }
}

/** 读取分片并合并为完整 StorageAppInfo */
function readSharded(region: Region): StorageAppInfo | null {
  const indexPath = getIndexPath(region)
  if (!existsSync(indexPath)) {
    return null // 还没有分片数据，回退到旧格式
  }

  try {
    const indexRaw = readFileSync(indexPath, 'utf-8')
    const index: Record<string, number> = JSON.parse(indexRaw)

    // 加载所有分片
    const shardMap = new Map<number, StorageAppInfo>()
    const result: StorageAppInfo = {}

    for (const [id, shardIdx] of Object.entries(index)) {
      let shard = shardMap.get(shardIdx)
      if (!shard) {
        const shardPath = getShardPath(region, shardIdx)
        if (!existsSync(shardPath)) {
          console.warn(`[storage] 分片缺失: ${shardPath}，跳过 ${id}`)
          continue
        }
        shard = JSON.parse(readFileSync(shardPath, 'utf-8')) as StorageAppInfo
        shardMap.set(shardIdx, shard)
      }
      if (shard[id]) {
        result[id] = shard[id]
      }
    }

    return result
  } catch (error) {
    console.error('[storage] 读取分片失败，尝试回退旧格式:', error)
    return null
  }
}

/** 清理该地区的所有旧分片文件 */
function cleanOldShards(region: Region) {
  const dir = resolve(__dirname, 'storage')
  if (!existsSync(dir)) return

  const shardPrefix = `${region}-`
  for (const name of readdirSync(dir)) {
    if (
      name.startsWith(shardPrefix) &&
      /-\d+\.json$/.test(name)
    ) {
      try {
        unlinkSync(path.join(dir, name))
      } catch (_) { /* 忽略 */ }
    }
  }
  // 同时清理索引
  const idx = getIndexPath(region)
  if (existsSync(idx)) {
    try {
      unlinkSync(idx)
    } catch (_) { /* 忽略 */ }
  }
}
