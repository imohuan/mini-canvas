import { chromium } from 'playwright-core'
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = `http://localhost:${process.env.CANVAS_PORT ?? 5289}/`
const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await page.goto(BASE, { waitUntil: 'load' })
await page.evaluate(() => { try { localStorage.clear() } catch {} })
await page.reload({ waitUntil: 'load' })
await page.waitForTimeout(2500)

const setMode = (m) => page.evaluate((mode) => {
  const s = window.MiniCanvasUI.getHost().ctx.get('settings')
  s.set('panOnDrag', true); s.set('nodesDraggable', mode === 'move')
}, m)

const hit = (x, y) => page.evaluate(([px, py]) => {
  const stack = document.elementsFromPoint(px, py).slice(0, 4).map((e) => (e.className || e.tagName).toString().slice(0, 60))
  return stack
}, [x, y])

const box = () => page.evaluate(() => {
  const el = document.querySelector('.vue-flow__node')
  const r = el.getBoundingClientRect()
  return { right: r.right, cy: r.top + r.height / 2 }
})

await setMode('hand')
await page.waitForTimeout(300)
let b = await box()
console.log('平移前 右缘点命中:', JSON.stringify(await hit(b.right + 10, b.cy)))
await page.mouse.move(b.right + 10, b.cy, { steps: 5 })
await page.waitForTimeout(400)
console.log('平移前 visible:', await page.evaluate(() => document.querySelectorAll('.moving-handle-anchor.is-visible').length))

// 在空白平移
await page.mouse.move(200, 720)
await page.mouse.down()
await page.mouse.move(300, 660, { steps: 10 })
await page.mouse.up()
await page.waitForTimeout(500)
b = await box()
console.log('平移后 右缘点命中:', JSON.stringify(await hit(b.right + 10, b.cy)))
console.log('平移后 节点rect:', JSON.stringify(b))
await page.mouse.move(b.right + 10, b.cy, { steps: 5 })
await page.waitForTimeout(500)
console.log('平移后 visible:', await page.evaluate(() => document.querySelectorAll('.moving-handle-anchor.is-visible').length))
console.log('平移后 zone 数:', await page.evaluate(() => document.querySelectorAll('.port-follow-zone').length))
console.log('平移后 pane class:', await page.evaluate(() => document.querySelector('.vue-flow__pane').className))

await browser.close()
