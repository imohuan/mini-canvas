import { chromium } from 'playwright-core'
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = `http://localhost:${process.env.CANVAS_PORT ?? 5289}/`
const OUT = 'D:/Code/Git/mini-canvas/packages/ui/.scratch'
const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1200, height: 720 }, deviceScaleFactor: 2 })
await page.goto(BASE, { waitUntil: 'load' })
await page.evaluate(() => { try { localStorage.clear() } catch {} })
await page.reload({ waitUntil: 'load' })
await page.waitForTimeout(2800)
await page.evaluate(() => window.MiniCanvasUI.getHost().viewport.zoomTo(1))
await page.waitForTimeout(700)
await page.click('button[aria-label="缩放选项"]')
await page.waitForTimeout(400)
await page.screenshot({ path: OUT + '/zoom-menu.png', clip: { x: 0, y: 430, width: 480, height: 290 } })
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
const st = await page.evaluate(() => ({
  label: document.querySelector('button[aria-label="缩放选项"]').textContent.trim(),
  real: window.MiniCanvasUI.getHost().viewport.getViewport().zoom,
}))
console.log('读数=' + st.label + '  真实=' + (st.real * 100).toFixed(0) + '%')
await browser.close()
