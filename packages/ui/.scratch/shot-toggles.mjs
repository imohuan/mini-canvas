import { chromium } from 'playwright-core'
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = `http://localhost:${process.env.CANVAS_PORT ?? 5289}/`
const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1200, height: 700 }, deviceScaleFactor: 2 })
await page.goto(BASE, { waitUntil: 'load' })
await page.evaluate(() => { try { localStorage.clear() } catch {} })
await page.reload({ waitUntil: 'load' })
await page.waitForTimeout(2500)
const out = 'D:/Code/Git/mini-canvas/packages/ui/.scratch'
await page.screenshot({ path: out + '/toggles-on.png' })
// 关掉连线 / 吸附 / 小地图，切抓手，看图标变化
await page.evaluate(() => {
  const s = window.MiniCanvasUI.getHost().ctx.get('settings')
  s.set('edgeVisible', false)
  s.set('snapToGrid', false)
  s.set('miniMapVisible', false)
  s.set('nodesDraggable', false)
})
await page.waitForTimeout(500)
await page.screenshot({ path: out + '/toggles-off.png' })
await browser.close()
