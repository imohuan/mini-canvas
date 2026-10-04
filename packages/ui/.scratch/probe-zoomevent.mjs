import { chromium } from 'playwright-core'
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = `http://localhost:${process.env.CANVAS_PORT ?? 5289}/`
const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await page.goto(BASE, { waitUntil: 'load' })
await page.evaluate(() => { try { localStorage.clear() } catch {} })
await page.reload({ waitUntil: 'load' })
await page.waitForTimeout(2800)

// 记录 move 事件
await page.evaluate(() => {
  const ctx = window.MiniCanvasUI.getHost().ctx
  window.__log = []
  ctx.on('canvas:viewport:move-start', () => window.__log.push('start'))
  ctx.on('canvas:viewport:move-end', () => window.__log.push('end@' + ctx.get('viewport').getViewport().zoom.toFixed(3)))
})
console.log('初始 zoom=' + (await page.evaluate(() => window.MiniCanvasUI.getHost().viewport.getViewport().zoom.toFixed(3))))

await page.evaluate(() => window.MiniCanvasUI.getHost().viewport.zoomTo(0.5))
await page.waitForTimeout(1200)
console.log('zoomTo(0.5) → zoom=' + (await page.evaluate(() => window.MiniCanvasUI.getHost().viewport.getViewport().zoom.toFixed(3))) + '  事件=' + JSON.stringify(await page.evaluate(() => window.__log)))

await page.evaluate(() => { window.__log = [] })
await page.evaluate(() => window.MiniCanvasUI.getHost().viewport.fitView())
await page.waitForTimeout(1200)
console.log('fitView()    → zoom=' + (await page.evaluate(() => window.MiniCanvasUI.getHost().viewport.getViewport().zoom.toFixed(3))) + '  事件=' + JSON.stringify(await page.evaluate(() => window.__log)))

// 初始 fitView 是何时发生的？看它有没有发事件
await page.evaluate(() => { localStorage.clear() })
await page.evaluate(() => {
  const ctx = window.MiniCanvasUI.getHost().ctx
  window.__log2 = []
  ctx.on('canvas:viewport:move-end', () => window.__log2.push(ctx.get('viewport').getViewport().zoom.toFixed(3)))
})
await page.reload({ waitUntil: 'load' })
await page.waitForTimeout(3000)
console.log('刷新后 初始 fitView: zoom=' + (await page.evaluate(() => window.MiniCanvasUI.getHost().viewport.getViewport().zoom.toFixed(3))) + '  刷新后收到的事件=' + JSON.stringify(await page.evaluate(() => window.__log2 || 'none')))
await browser.close()
