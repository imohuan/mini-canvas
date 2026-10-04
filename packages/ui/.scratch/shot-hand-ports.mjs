import { chromium } from 'playwright-core'
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = `http://localhost:${process.env.CANVAS_PORT ?? 5289}/`
const OUT = 'D:/Code/Git/mini-canvas/packages/ui/.scratch'
const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 })
await page.goto(BASE, { waitUntil: 'load' })
await page.evaluate(() => { try { localStorage.clear() } catch {} })
await page.reload({ waitUntil: 'load' })
await page.waitForTimeout(2800)

const setMode = (m) => page.evaluate((mode) => {
  const ctx = window.MiniCanvasUI.getHost().ctx
  ctx.get('settings').set('panOnDrag', true)
  ctx.get('settings').set('nodesDraggable', mode === 'move')
}, m)

async function shot(tag) {
  await page.evaluate(() => window.MiniCanvasUI.getHost().viewport.setViewport({ x: 400, y: 300, zoom: 1 }))
  await page.waitForTimeout(400)
  const p = await page.evaluate(() => {
    const z = document.querySelector('.vue-flow__node .port-follow-zone--source')
    const r = z.getBoundingClientRect()
    return { x: r.right - 8, y: r.top + r.height / 2, left: r.left, top: r.top, w: r.width }
  })
  await page.mouse.move(5, 5); await page.waitForTimeout(250)
  await page.mouse.move(p.x, p.y, { steps: 6 })
  await page.waitForTimeout(600)
  const clip = await page.evaluate(() => {
    const r = document.querySelector('.vue-flow__node').getBoundingClientRect()
    return { x: r.right - 70, y: r.top - 30, width: 210, height: 200 }
  })
  await page.screenshot({ path: `${OUT}/handport-${tag}.png`, clip })
}

await setMode('move'); await shot('move')
await setMode('hand'); await shot('hand')
await browser.close()
