import { chromium } from 'playwright-core'
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = `http://localhost:${process.env.CANVAS_PORT ?? 5289}/`
const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 })
await page.goto(BASE, { waitUntil: 'load' })
await page.evaluate(() => { try { localStorage.clear() } catch {} })
await page.reload({ waitUntil: 'load' })
await page.waitForTimeout(2500)
const OUT = 'D:/Code/Git/mini-canvas/packages/ui/.scratch'

const setMode = (m) => page.evaluate((mode) => {
  const s = window.MiniCanvasUI.getHost().ctx.get('settings')
  s.set('panOnDrag', true); s.set('nodesDraggable', mode === 'move')
}, m)

const clip = () => page.evaluate(() => {
  const n = document.querySelector('.vue-flow__node')
  const r = n.getBoundingClientRect()
  return { x: r.right - 60, y: r.top - 40, width: 200, height: 220 }
})

for (const mode of ['move', 'hand']) {
  await setMode(mode)
  await page.evaluate(() => window.MiniCanvasUI.getHost().viewport.setViewport({ x: 400, y: 300, zoom: 1 }))
  await page.waitForTimeout(400)
  // 悬停端口耳朵
  const p = await page.evaluate(() => {
    const z = document.querySelector('.vue-flow__node .port-follow-zone--source')
    const r = z.getBoundingClientRect()
    return { x: r.right - 10, y: r.top + r.height / 2 }
  })
  await page.mouse.move(5, 5); await page.waitForTimeout(150)
  await page.mouse.move(p.x, p.y, { steps: 6 })
  await page.waitForTimeout(600)
  const st = await page.evaluate(() => ({
    shown: document.querySelectorAll('.moving-handle-anchor.is-visible').length,
    moving: document.querySelectorAll('.moving-handle-anchor.is-moving').length,
    ballOpacity: [...document.querySelectorAll('.moving-handle-button')].map((b) => getComputedStyle(b).opacity).join(','),
    ballLeft: [...document.querySelectorAll('.moving-handle-button')].map((b) => b.style.left).join(','),
  }))
  console.log(mode + ' 悬停耳朵: ' + JSON.stringify(st))
  await page.screenshot({ path: `${OUT}/ball-${mode}.png`, clip: await clip() })
}
await browser.close()
