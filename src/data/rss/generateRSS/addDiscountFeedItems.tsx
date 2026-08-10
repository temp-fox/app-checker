import React, { render } from 'jsx-to-md'
import { Feed } from 'feed'
import { getTranslate } from '@/data/i18n'
import { regionInAppPurchasesTextMap } from 'appinfo.config'
import { Translate } from 'i18n-pro'

function getShowDescription(discountInfo: DiscountInfo) {
  const { discounts } = discountInfo

  const { price, inAppPurchase } = discounts.reduce(
    (res, discount) => {
      const { type, name, from, to } = discount
      if (type === 'price') {
        res.price = `${name}: ${from} → ${to}`
      } else {
        res.inAppPurchase.push(`${name}: ${from} → ${to}`)
      }

      return res
    },
    {
      price: '',
      inAppPurchase: [],
    },
  )

  if (price) {
    inAppPurchase.unshift(price)
  }

  return inAppPurchase.join('<br/>')
}

function getSourceLabel(t: Translate, cfg?: AppConfig): string {
  if (!cfg) return `${t('来源')}：${t('排行榜')}`
  const { addType, addSource } = cfg
  if (addType === 'external' && addSource) {
    return `${t('来源')}：${addSource}`
  }
  if (addType === 'manual') {
    if (addSource?.startsWith('issue-')) {
      const num = addSource.replace('issue-', '')
      return `${t('来源')}：${t('社区用户提交')} (#${num})`
    }
    return `${t('来源')}：${t('社区用户提交')}`
  }
  // auto（排行榜类）：按 addSource 区分具体榜单
  const chartLabels: Record<string, string> = {
    'paid-top': '付费排行榜',
    'paid-top-all': '付费总榜',
    'new-release': '新上架',
  }
  const label = addSource && chartLabels[addSource] ? chartLabels[addSource] : t('排行榜')
  return `${t('来源')}：${label}`
}

function getShowContent(
  region: Region,
  t: Translate,
  discountInfo: DiscountInfo,
  sourceLabel: string,
) {
  const {
    discounts,
    trackViewUrl,
    description,
    fullDescription,
    artworkUrl60,
    screenshotUrls = [],
    ipadScreenshotUrls = [],
    appletvScreenshotUrls = [],
    formattedPrice,
    inAppPurchases,
  } = discountInfo

  const discountInfoContent = (() => {
    const { price, inAppPurchase } = discounts.reduce(
      (res, discount) => {
        const { type, name, from, to, range } = discount
        if (type === 'price') {
          res.price = (
            <>
              <span>{from}</span>
              {` → `}
              <b>
                <strong>{to}</strong>
              </b>
              <span>{range}</span>
            </>
          )
        } else {
          res.inAppPurchase.push(
            <>
              <strong>{name}：</strong>
              <span>{from}</span>
              {` → `}
              <b>
                <strong>{to}</strong>
              </b>
              <span>{range}</span>
            </>,
          )
        }

        return res
      },
      {
        price: '' as any,
        inAppPurchase: [],
      },
    )

    return (
      <>
        {price && (
          <>
            <h2>
              {t('优惠信息')}
              {`（${t('价格')}：${render(price)}）`}
            </h2>
          </>
        )}
        {!price && <h2>{t('优惠信息')}</h2>}
        {inAppPurchase.length && (
          <>
            <h3>{regionInAppPurchasesTextMap[region]}</h3>
            <ul>
              {inAppPurchase.map((content) => (
                <li>{content}</li>
              ))}
            </ul>
          </>
        )}
      </>
    )
  })()

  const priceInfo = (() => {
    const inAppPurchasesInfo = Object.entries(inAppPurchases).reduce(
      (res, [key, value]) => {
        res.push({ name: key, price: value })
        return res
      },
      [],
    )

    return (
      <>
        <h2>{t('全部价格信息')}</h2>
        <p>
          {t('价格')}：<b>{formattedPrice}</b>
        </p>
        {inAppPurchasesInfo.length && (
          <>
            <h3>{regionInAppPurchasesTextMap[region]}</h3>
            <ul>
              {inAppPurchasesInfo.map((item) => {
                const { name, price } = item
                return (
                  <li>
                    {name}：<b>{price}</b>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </>
    )
  })()

  return render(
    <>
      <a href={trackViewUrl}>
        <img src={artworkUrl60} />
      </a>
      <p>
        <small>{sourceLabel}</small>
      </p>
      {discountInfoContent}
      {priceInfo}
      <h2>{t('应用描述')}</h2>
      <p>{fullDescription || description}</p>
      {(screenshotUrls.length ||
        ipadScreenshotUrls.length ||
        appletvScreenshotUrls.length) && (
        <>
          <h2>{t('应用截屏')}</h2>
          {screenshotUrls.length && (
            <>
              <h3>iPhone</h3>
              {screenshotUrls.map((url) => {
                return <img src={url} />
              })}
            </>
          )}
          {ipadScreenshotUrls.length && (
            <>
              <h3>iPad</h3>
              {ipadScreenshotUrls.map((url) => {
                return <img src={url} />
              })}
            </>
          )}
          {appletvScreenshotUrls.length && (
            <>
              <h3>Apple TV</h3>
              {appletvScreenshotUrls.map((url) => {
                return <img src={url} />
              })}
            </>
          )}
        </>
      )}
    </>,
  )
}

export default function addDiscountFeedItems(props: {
  feed: Feed
  discountInfos: DiscountInfo[]
  region: Region
  appConfig: AppConfig[]
}) {
  const { feed, discountInfos, region, appConfig } = props
  const t = getTranslate(region)

  // 构建 O(1) 查找映射
  const cfgMap = new Map<number, AppConfig>(appConfig.map(c => [c.id, c]))

  discountInfos.forEach((discountInfo) => {
    const { timestamp, trackName, trackViewUrl, trackId } = discountInfo
    const cfg = cfgMap.get(trackId)
    const sourceLabel = getSourceLabel(t, cfg)

    feed.addItem({
      title: `${trackName}`,
      id: `${trackName}-${region}-${timestamp}`,
      link: trackViewUrl,
      description: getShowDescription(discountInfo),
      content: getShowContent(region, t, discountInfo, sourceLabel),
      date: new Date(timestamp),
    })
  })
}
