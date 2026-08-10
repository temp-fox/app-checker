import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { isEmpty } from 'lodash'
import { start, end } from './timer'
import { $schema, appConfig as oldAppConfig } from 'apps.json'

const contentEncoding = 'utf-8'
const filepath = resolve(__dirname, '../../apps.json')

export function updateImpl(appConfig: AppConfig[]) {
  writeFileSync(
    filepath,
    JSON.stringify(
      {
        $schema,
        appConfig,
      },
      null,
      2,
    ),
    { encoding: contentEncoding },
  )
}

export default function updateAppInfoConfig(
  regionAppTopInfo: Partial<RegionAppTopInfo>,
) {
  start('updateAppInfoConfig')

  const ids = oldAppConfig.map((item) => `${item.id}`)
  // O(1) 查找，避免对 2000+ 条目反复 find
  const oldAppConfigMap = new Map(oldAppConfig.map(app => [`${app.id}`, app]))

  const idNameMap: Record<string, Partial<Record<Region, string>>> = {}
  const idSourceMap: Record<string, { addType: 'auto' | 'external'; addSource?: string }> = {}
  // 统一元数据表：同时支持排行榜标签（_shouldBePaid/_discountType）和外部来源标签
  const idMetaMap: Record<
    string,
    {
      _externalSource?: string
      _shouldBePaid?: boolean
      _externalSourceFirstSeen?: number
      _discountType?: 'app' | 'iap' | 'unknown'
    }
  > = {}
  // 已在 apps.json 的 app 需要补充的缺失标签（可含 addType/addSource 升级）
  const idExistingTagsMap: Record<
    string,
    Partial<Pick<AppConfig, 'addType' | 'addSource' | '_externalSource' | '_shouldBePaid' | '_externalSourceFirstSeen' | '_discountType'>>
  > = {}

  Object.entries(regionAppTopInfo).forEach(([region, appTopInfo]) => {
    appTopInfo.forEach(({ id, name, addSource, _externalSource, _shouldBePaid, _externalSourceFirstSeen, _discountType }) => {
      if (ids.includes(id)) {
        // 已在 apps.json — 不改 addType，但补充缺失标签
        const existingConfig = oldAppConfigMap.get(id)
        if (existingConfig && !idExistingTagsMap[id]) {
          const updates: typeof idExistingTagsMap[string] = {}

          // 优先级1：排行榜条目（无 _externalSource）且现有来源不是 auto → 升级为 auto
          if (!_externalSource && existingConfig.addType !== 'auto') {
            updates.addType = 'auto'
            if (addSource) updates.addSource = addSource
            updates._shouldBePaid = true
            if (_discountType) updates._discountType = _discountType
          }
          // 优先级2：外部来源首次发现（补充完整外部标签，含 _externalSourceFirstSeen 以触发 isNewExternalDetection）
          else if (_externalSource && !existingConfig._externalSource) {
            updates._externalSource = _externalSource
            updates._shouldBePaid = _shouldBePaid ?? true
            updates._externalSourceFirstSeen = _externalSourceFirstSeen ?? Date.now()
            if (_discountType) updates._discountType = _discountType
          }
          // 优先级3：排行榜来源 — 仅补充 _shouldBePaid/_discountType（不补充 _externalSourceFirstSeen）
          else if (_shouldBePaid && !existingConfig._shouldBePaid) {
            updates._shouldBePaid = true
            if (_discountType && !existingConfig._discountType) updates._discountType = _discountType
          }

          if (Object.keys(updates).length > 0) {
            idExistingTagsMap[id] = updates
          }
        }
        return
      }

      const item = idNameMap[id]
      if (item) {
        item[region] = name
      } else {
        idNameMap[id] = { [region]: name }
      }

      // 记录来源：排行榜优先级高于外部来源（先到先得，外部条目不覆盖排行榜 addType）
      if (!idSourceMap[id]) {
        idSourceMap[id] = _externalSource
          ? { addType: 'external', addSource: _externalSource }
          : { addType: 'auto', ...(addSource ? { addSource } : {}) }
      }

      // 元数据：排行榜条目先到时保存 _shouldBePaid/_discountType 等
      // 外部条目后到时，若尚无 _externalSource，则补充之
      if (!idMetaMap[id]) {
        idMetaMap[id] = { _externalSource, _shouldBePaid, _externalSourceFirstSeen, _discountType }
      } else if (_externalSource && !idMetaMap[id]._externalSource) {
        // 排行榜条目先处理（无 _externalSource），外部条目后到时补充
        idMetaMap[id]._externalSource = _externalSource
      }
    })
  })

  // 对已在 apps.json 的 app 补充缺失的标签
  const hasExistingTagUpdates = Object.keys(idExistingTagsMap).length > 0
  const effectiveOldAppConfig = hasExistingTagUpdates
    ? oldAppConfig.map(app => {
        const tags = idExistingTagsMap[`${app.id}`]
        if (!tags) return app
        // 只展开有值的字段，避免用 undefined 覆盖已有值
        const definedTags = Object.fromEntries(
          Object.entries(tags).filter(([, v]) => v !== undefined)
        ) as Partial<AppConfig>
        return { ...app, ...definedTags }
      })
    : oldAppConfig

  if (hasExistingTagUpdates) {
    const externalCount = Object.values(idExistingTagsMap).filter(t => t._externalSource).length
    const chartCount = Object.keys(idExistingTagsMap).length - externalCount
    console.log(`补充已有应用缺失标签：${externalCount} 个来自外部来源，${chartCount} 个来自排行榜`)
  }

  // 统计新应用来源
  const newAppIds = Object.keys(idNameMap)
  if (newAppIds.length > 0) {
    const chartCount = newAppIds.filter(id => idSourceMap[id]?.addType === 'auto').length
    const externalCount = newAppIds.filter(id => idSourceMap[id]?.addType === 'external').length
    console.log(`新应用写入 apps.json 追踪名单: ${newAppIds.length} 个（排行榜来源: ${chartCount} | 外部来源: ${externalCount}）`)
    console.log(`  └─ apps.json 总追踪应用数: ${newAppIds.length + oldAppConfig.length} 个（新增 ${newAppIds.length} + 已有 ${oldAppConfig.length}）`)
  }

  if (isEmpty(idNameMap)) {
    if (hasExistingTagUpdates) {
      updateImpl(effectiveOldAppConfig)
    }
    end('updateAppInfoConfig')
    return effectiveOldAppConfig
  }

  const appConfig: AppConfig[] = Object.entries(idNameMap).reduce(
    (res, [id, regionNameMap]) => {
      const sourceInfo = idSourceMap[id] || { addType: 'auto' }
      const meta = idMetaMap[id]
      const newConfig: AppConfig = {
        id: parseInt(id),
        name: regionNameMap,
        addType: sourceInfo.addType,
        ...(sourceInfo.addSource ? { addSource: sourceInfo.addSource } : {}),
        // 写入所有有值的元数据标签
        ...(meta?._shouldBePaid !== undefined ? { _shouldBePaid: meta._shouldBePaid } : {}),
        ...(meta?._externalSource ? { _externalSource: meta._externalSource } : {}),
        ...(meta?._externalSourceFirstSeen ? { _externalSourceFirstSeen: meta._externalSourceFirstSeen } : {}),
        ...(meta?._discountType ? { _discountType: meta._discountType } : {}),
      }
      res.push(newConfig)
      return res
    },
    [],
  )

  const newAppConfig = [...appConfig, ...effectiveOldAppConfig]

  updateImpl(newAppConfig)

  end('updateAppInfoConfig')

  return newAppConfig
}
