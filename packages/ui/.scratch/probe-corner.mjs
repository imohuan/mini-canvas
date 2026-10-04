import { chromium } from 'playwright-core'
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = `http://localhost:${process.env.CANVAS_PORT ?? 5289}/`
const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 3 })
await page.goto(BASE, { waitUntil: 'load' })
await page.evaluate(() => { try { localStorage.clear() } catch {} })
await page.reload({ waitUntil: 'load' })
await page.waitForTimeout(2500)
const OUT = 'D:/Code/Git/mini-canvas/packages/ui/.scratch'

const setMode = (m) => page.evaluate((mode) => {
  const s = window.MiniCanvasUI.getHost().ctx.get('settings')
  s.set('panOnDrag', true); s.set('nodesDraggable', mode === 'move')
}, m)

const report = () => page.evaluate(() => {
  const node = document.querySelector('.vue-flow__node')
  const rh = node.querySelector('.resize-handle')
  const r = node.getBoundingClientRect()
  const rr = rh ? rh.getBoundingClientRect() : null
  const cs = rh ? getComputedStyle(rh) : null
  return {
    nodeRect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
    has: !!rh,
    rect: rr ? [Math.round(rr.left), Math.round(rr.top), Math.round(rr.width), Math.round(rr.height)] : null,
    display: cs?.display, opacity: cs?.opacity, visibility: cs?.visibility, pe: cs?.pointerEvents,
    transform: cs?.transform,
  }
})

for (const mode of ['move', 'hand']) {
  await setMode(mode)
  await page.evaluate(() => window.MiniCanvasUI.getHost().viewport.setViewport({ x: 400, y: 300, zoom: 1 }))
  await page.waitForTimeout(400)
  const r = await report()
  console.log(mode + ': ' + JSON.stringify(r))
  // 右下角 90x90 放大截图
  const clip = await page.evaluate(() => {
    const b = document.querySelector('.vue-flow__node').getBoundingClientRect()
    return { x: b.right - 80, y: b.bottom - 80, width: 120, height: 120 }
  })
  await page.screenshot({ path: `${OUT}/corner-${mode}.png`, clip })
}
await browser.close()
