import { chromium, Browser, Page } from 'playwright'

const maxPages = 5
let browser: Browser | null = null
let pages: Page[] = []
let pagePool: Page[] = []
let waitingQueue: Array<(page: Page) => void> = []

async function getNewPage(): Promise<Page> {
  const page = await browser?.newPage()
  page?.route('**/*', (route) => {
    const resourceType = route.request().resourceType()

    if (resourceType !== 'document') {
      route.abort()
      return
    }

    route.continue()
  })

  return page
}

async function initialize(): Promise<void> {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
    })

    for (let i = 0; i < maxPages; i++) {
      const page = await getNewPage()
      pages.push(page)
      pagePool.push(page)
    }
  }
}

async function getPage(): Promise<Page> {
  if (!browser) {
    await initialize()
  }

  if (pagePool.length > 0) {
    const page = pagePool.pop() as Page
    return page
  }

  if (pages.length < maxPages * 2) {
    const page = await getNewPage()
    pages.push(page)
    return page
  }

  return new Promise((resolve) => {
    waitingQueue.push(resolve)
  })
}

async function releasePage(page: Page): Promise<void> {
  if (waitingQueue.length > 0) {
    const resolve = waitingQueue.shift()
    if (resolve) {
      resolve(page)
      return
    }
  }

  if (pages.includes(page) && !pagePool.includes(page)) {
    pagePool.push(page)
  }
}

async function close(): Promise<void> {
  if (browser) {
    for (const page of pages) {
      try {
        await page.close()
      } catch (e) {
        console.error('close page error', e)
      }
    }

    // 关闭浏览器
    await browser.close()
    browser = null
    pages = []
    pagePool = []
    waitingQueue = []
  }
}

// 创建单例实例
export default {
  initialize,
  getPage,
  releasePage,
  close,
}
