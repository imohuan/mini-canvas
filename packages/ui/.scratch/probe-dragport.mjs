import { chromium } from 'playwright-core'
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = `http://localhost:${process.env.CANVAS_PORT ?? 5289}/`
const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await page.goto(BASE, { waitUntil: 'load' })
await page.evaluate(() => { try { localStorage.clear() } catch {} })
await page.reload({ waitUntil: 'load' })
await page.waitForTimeout(2500)

const reset = () => page.evaluate(() => {
  const h = window.MiniCanvasUI.getHost()
  h.viewport.setViewport({ x: 400, y: 300, zoom: 1 })
  // 关掉低细节干扰：把阈值调低
  h.ctx.get('settings').set('nodeLodLowDetailZoom', 0.1)
})
const setMode = (m) => page.evaluate((mode) => {
  const s = window.MiniCanvasUI.getHost().ctx.get('settings')
  s.set('panOnDrag', true); s.set('nodesDraggable', mode === 'move')
}, m)

// 端口 zone（耳朵）位置
const zonePos = () => page.evaluate(() => {
  const z = document.querySelector('.vue-flow__node .port-follow-zone--source')
  const r = z.getBoundingClientRect()
  return { x: r.right - 8, y: r.top + r.height / 2 }
})

const state = () => page.evaluate(() => ({
  vp: window.MiniCanvasUI.getHost().viewport.getViewport(),
  edges: window.MiniCanvasUI.getHost().edgeStore.getEdges().length,
  connecting: document.querySelectorAll('.vue-flow__connection, .ef-temp, .vue-flow__connectionline').length,
  visibleHandles: document.querySelectorAll('.moving-handle-anchor.is-visible').length,
}))

for (const mode of ['move', 'hand']) {
  await setMode(mode); await reset(); await page.waitForTimeout(400)
  await page.mouse.move(5, 5); await page.waitForTimeout(200)
  const p = await zonePos()
  const before = await state()
  // 悬停 → 按下 → 往外拖 120px
  await page.mouse.move(p.x, p.y, { steps: 6 })
  await page.waitForTimeout(300)
  await page.mouse.down()
  await page.mouse.move(p.x + 60, p.y + 40, { steps: 6 })
  await page.waitForTimeout(250)
  const during = await state()
  await page.mouse.move(p.x + 140, p.y + 90, { steps: 8 })
  await page.waitForTimeout(250)
  const during2 = await state()
  await page.mouse.up()
  await page.waitForTimeout(350)
  const after = await state()
  console.log('\n### ' + mode)
  console.log('  按下前 : handles=' + before.visibleHandles + ' 临时线=' + before.connecting + ' 边=' + before.edges + ' vp=' + Math.round(before.vp.x) + ',' + Math.round(before.vp.y))
  console.log('  拖动中 : 临时线=' + during.connecting + '/' + during2.connecting + ' vp=' + Math.round(during2.vp.x) + ',' + Math.round(during2.vp.y))
  console.log('  松手后 : 边=' + after.edges + ' vp=' + Math.round(after.vp.x) + ',' + Math.round(after.vp.y))
  console.log('  → 视图' + (Math.abs(after.vp.x - before.vp.x) > 3 || Math.abs(after.vp.y - before.vp.y) > 3 ? '**被平移了**' : '未平移') + '；' + (during2.connecting > 0 || after.edges > before.edges ? '**拉出了连线**' : '未拉出连线'))
}
await browser.close()
