import { initI18n } from 'i18n-pro'
import docsEn from '../../../docs/src/i18n/en.json'
import en from './en.json'

const { t: initT } = initI18n({
  namespace: 'data',
  langs: {
    en: {
      ...docsEn,
      ...en,
    },
  },
  formatPlural({ keyword, text, payload, locale }) {
    let res = text
    switch (locale) {
      case 'en':
        switch (keyword) {
          case 'App':
            res = `${payload} ${keyword}${(payload as number) > 1 ? 's' : ''}`
            break
        }
        break
    }
    return res
  },
})

Object.defineProperty(global, 't', {
  get() {
    return initT
  },
})

export function getTranslate(region: Region) {
  const { regionLanguageCodeMap } = require('appinfo.config')
  const t = initT.withLocale(regionLanguageCodeMap[region])

  return t
}
