import dayjs from 'dayjs'
import { Feed } from 'feed'
import { homepage } from '../../../package.json'
import { getRegionNameMap, regions, regionTimezoneMap } from 'appinfo.config'
import React, { render } from 'jsx-to-md'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { getAppStoreUrl } from '../utils'

export interface generateRSSProps {
  timestamp: number
  logInfo: LogInfo[]
}

function getPercentValue(value1: number, value2: number) {
  if (value2 === 0) {
    return `-%`
  }

  const percent = Math.round((value1 * 100) / value2)

  return `${percent}%`
}

function getStatisticInfo(logInfo: LogInfo) {
  const { regionAppCount, regionAppInfo } = logInfo
  const regionNameMap = getRegionNameMap()

  let allAppCount = 0
  let retryAppCount = 0
  let allRetryTimes = 0
  let failAppCount = 0

  const content = (
    <table>
      <thead>
        <tr>
          <th>{t('区域')}</th>
          <th>{t('应用总数')}</th>
          <th>{t('重新获取应用数')}</th>
          <th>{t('重试总次数')}</th>
          <th>{t('获取失败数')}</th>
        </tr>
      </thead>
      <tbody>
        {regions.map((region) => {
          const regionName = regionNameMap[region]
          const appCount = regionAppCount[region] || 0
          allAppCount += appCount
          const appInfos = regionAppInfo[region] || []
          retryAppCount += appInfos.length
          const regionAllRetryTimes = appInfos.reduce((res, appInfo) => {
            const { inAppPurchasesTimes = 1 } = appInfo
            return res + inAppPurchasesTimes - 1
          }, 0)
          allRetryTimes += regionAllRetryTimes
          const countPercentage = getPercentValue(appInfos.length, appCount)
          const allFailed = appInfos.filter(
            (item) => item.inAppPurchasesFailed,
          ).length
          failAppCount += allFailed
          const failedPercentage = getPercentValue(allFailed, appInfos.length)

          return (
            <tr>
              <td>
                {regionName}（{region.toUpperCase()}）
              </td>
              <td>{appCount}</td>
              <td>
                {appInfos.length || '0'}（{countPercentage}）
              </td>
              <td>
                <b>{regionAllRetryTimes || '0'}</b>
              </td>
              <td>
                <b>
                  {allFailed || '0'}（{failedPercentage}）
                </b>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )

  return {
    statisticContent: content,
    allAppCount,
    retryAppCount,
    allRetryTimes,
    failAppCount,
  }
}

function getDescriptionAndContent(logInfo: LogInfo) {
  const { duration, regionAppInfo } = logInfo
  const regionNameMap = getRegionNameMap()

  const {
    statisticContent,
    allAppCount,
    retryAppCount,
    allRetryTimes,
    failAppCount,
  } = getStatisticInfo(logInfo)

  const durationDesc = `总耗时：${duration}`
  const retryAppRatio = `重新获取应用数占比：${getPercentValue(
    retryAppCount,
    allAppCount,
  )}`
  const avgRetryTimesPerApp = `单个应用重新获取平均次数：${
    retryAppCount === 0 ? 0 : Math.round(allRetryTimes / retryAppCount)
  }`
  const totalRetryTimes = `重新获取总次数：${allRetryTimes}`
  const totalFailApps = `获取失败总应用数：${failAppCount}`
  const failAppRatio = `获取失败应用数占比：${getPercentValue(
    failAppCount,
    retryAppCount,
  )}`

  const content = render(
    <>
      <h1>汇总信息</h1>
      <ul>
        <li>{durationDesc}</li>
        <li>{retryAppRatio}</li>
        <li>{avgRetryTimesPerApp}</li>
        <li>{totalRetryTimes}</li>
        <li>{totalFailApps}</li>
        <li>{failAppRatio}</li>
      </ul>
      <h2>统计信息</h2>
      {statisticContent}
      <h1>各领域内购信息获取排行</h1>
      {regions.map((region) => {
        const regionName = regionNameMap[region]
        const appInfos = regionAppInfo[region] || []

        return (
          <>
            <h2>
              {regionName}（{region.toUpperCase()}）
            </h2>
            <table>
              <thead>
                <tr>
                  <th>{t('名次')}</th>
                  <th>{t('应用')}</th>
                  <th>{t('次数')}</th>
                </tr>
              </thead>
              <tbody>
                {appInfos.map((appInfo, index) => {
                  const {
                    trackId,
                    trackName,
                    inAppPurchasesTimes,
                    inAppPurchasesFailed,
                  } = appInfo

                  return (
                    <tr>
                      <td>
                        <b>{index + 1}</b>
                      </td>
                      <td>
                        <ul>
                          <li>{trackId}</li>
                          <li>
                            <a href={getAppStoreUrl(region, trackId)}>
                              {trackName}
                            </a>
                          </li>
                        </ul>
                      </td>
                      <td>
                        <b>
                          {inAppPurchasesTimes}
                          {inAppPurchasesFailed ? '&nbsp;&nbsp;❌' : ''}
                        </b>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </>
        )
      })}
    </>,
  )

  return {
    description: `${durationDesc}；${retryAppRatio}；${avgRetryTimesPerApp}；${totalRetryTimes}；${totalFailApps}；${failAppRatio}`,
    content,
  }
}

export default function generateRSS(props: generateRSSProps) {
  const { timestamp, logInfo } = props

  const feed = new Feed({
    title: `日志信息`,
    id: `${homepage}/rss/log.xml`,
    copyright: 'Copyright (c) 2024-present Eyelly Wu',
    updated: new Date(timestamp),
    author: {
      name: 'Eyelly wu',
      email: 'eyelly.wu@gmail.com',
      link: 'https://github.com/eyelly-wu',
    },
  })

  logInfo.forEach((logInfoItem) => {
    const {
      timestamp,
      inAppPurchasesScrapeType = 'fetch',
      limitCount = '未知',
    } = logInfoItem

    const { description, content } = getDescriptionAndContent(logInfoItem)

    feed.addItem({
      title: `${dayjs(timestamp)
        .tz(regionTimezoneMap.cn)
        .format(
          'YYYY-MM-DD HH:mm:ss',
        )} - ${inAppPurchasesScrapeType} - ${limitCount}`,
      id: timestamp + '',
      link: homepage,
      date: new Date(timestamp),
      description,
      content,
    })
  })

  const filepath = resolve(__dirname, '../../../rss', `log.xml`)
  writeFileSync(filepath, feed.atom1(), 'utf-8')
}
