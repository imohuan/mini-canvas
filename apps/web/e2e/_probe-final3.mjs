// @ts-nocheck
/** 一次性验收：音频卡片形态 + 视频右上角图标 + 滚到底继续加载。 */
import { chromium } from 'playwright-core'
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const pages = []
const errors = []
page.on('request', (r) => { if (r.url().includes('/api/history')) pages.push(new URL(r.url()).searchParams.get('page')) })
page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)))
await page.goto('http://127.0.0.1:8860/#/canvas/824e779f34314f86', { waitUntil: 'load' })
await page.waitForTimeout(2500)
await page.evaluate(() => { document.title = 'mini-canvas · 音频卡片验收 8860' })
await page.locator('button[aria-label="生成历史"]').first().click()
await page.waitForTimeout(3500)
const clickTab = async (label) => {
  const tab = page.locator('button').filter({ hasText: new RegExp('^' + label) }).first()
  await tab.scrollIntoViewIfNeeded().catch(() => {})
  await tab.click()
}

const out = {}
// 音频
await clickTab('音频')
await page.waitForTimeout(2500)
out.audio = await page.evaluate(() => {
  const media = document.querySelector('.hist-card-media--audio')
  const bar = media?.querySelector('.apv-bar')
  const cs = media && getComputedStyle(media)
  return {
    cards: document.querySelectorAll('.hist-masonry-item').length,
    h: media ? Math.round(media.getBoundingClientRect().height) : null,
    border: cs?.borderTopWidth,
    radius: cs?.borderTopLeftRadius,
    barText: (bar?.textContent || '').replace(/\s+/g, ' ').trim(),
    wave: !!media?.querySelector('.aw-wave'),
  }
})
await page.screenshot({ path: 'apps/web/e2e/_f-audio.png' })

// 视频图标
await clickTab('视频')
await page.waitForTimeout(2500)
out.video = await page.evaluate(() => {
  const d = document.querySelector('.hist-card-detail')
  const svg = d?.querySelector('svg')
  const cs = d && getComputedStyle(d)
  const icon = svg && getComputedStyle(svg)
  return {
    cards: document.querySelectorAll('.hist-masonry-item').length,
    color: cs?.color,
    bg: cs?.backgroundColor,
    iconStroke: icon?.stroke,
    iconVisible: !!svg && svg.getBoundingClientRect().width > 0,
  }
})
await page.screenshot({ path: 'apps/web/e2e/_f-video.png' })

// 滚到底
await clickTab('图片')
await page.waitForTimeout(2500)
const trace = []
for (let i = 0; i < 5; i++) {
  await page.evaluate(() => { const v = document.querySelector('.ax-sa-view'); if (v) v.scrollTop = v.scrollHeight })
  await page.waitForTimeout(1800)
  trace.push(await page.evaluate(() => {
    const v = document.querySelector('.ax-sa-view')
    const sen = document.querySelector('.hist-load-sentinel')
    return {
      cards: document.querySelectorAll('.hist-masonry-item').length,
      atBottom: v ? Math.ceil(v.scrollTop + v.clientHeight) >= v.scrollHeight - 2 : null,
      sentinel: !!sen,
      state: sen?.getAttribute('data-load-state') ?? null,
    }
  }))
}
out.trace = trace
out.pages = [...new Set(pages)]
out.errors = errors.slice(0, 5)
await page.screenshot({ path: 'apps/web/e2e/_f-image.png' })
console.log(JSON.stringify(out, null, 1))
await browser.close()
