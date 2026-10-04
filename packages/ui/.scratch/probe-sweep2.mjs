import { chromium } from 'playwright-core'
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = `http://localhost:${process.env.CANVAS_PORT ?? 5289}/`
const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await page.goto(BASE, { waitUntil: 'load' })
await page.evaluate(() => { try { localStorage.clear() } catch {} })
await page.reload({ waitUntil: 'load' })
await page.waitForTimeout(2500)

const reset = () => page.evaluate(() => window.MiniCanvasUI.getHost().viewport.setViewport({ x: 400, y: 300, zoom: 1 }))
const setMode = (m) => page.evaluate((mode) => {
  const s = window.MiniCanvasUI.getHost().ctx.get('settings')
  s.set('panOnDrag', true); s.set('nodesDraggable', mode === 'move')
}, m)
const earPoint = () => page.evaluate(() => {
  const z = document.querySelector('.vue-flow__node .port-follow-zone--source')
  const r = z.getBoundingClientRect()
  return { x: r.right - 6, y: r.top + r.height / 2, zoneW: r.width }
})
const vis = () => page.evaluate(() => document.querySelectorAll('.moving-handle-anchor.is-visible').length)
const hoverEar = async () => { const p = await earPoint(); await page.mouse.move(p.x, p.y, { steps: 5 }); await page.waitForTimeout(400); return await vis() }

for (const mode of ['hand']) {
  await setMode(mode); await reset(); await page.waitForTimeout(400)
  await page.mouse.move(5, 5); await page.waitForTimeout(200)
  console.log('\n### ' + mode)
  console.log('  新页面+悬停耳朵   visible=' + (await hoverEar()))

  // 关键：在节点上按住拖动（移动模式=拖节点；抓手模式=平移画布）
  const np = await page.evaluate(() => {
    const r = document.querySelector('.vue-flow__node').getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await page.mouse.move(np.x, np.y)
  await page.mouse.down()
  await page.mouse.move(np.x + 40, np.y + 30, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  console.log('  在节点上拖拽后悬停耳朵 visible=' + (await hoverEar()))

  // 再在空白处拖拽
  await page.mouse.move(200, 780)
  await page.mouse.down()
  await page.mouse.move(240, 760, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  console.log('  空白拖拽后悬停耳朵   visible=' + (await hoverEar()))

  // 滚轮缩放后再悬停
  await page.mouse.move(700, 450)
  await page.mouse.wheel(0, -200)
  await page.waitForTimeout(600)
  console.log('  滚轮缩放后悬停耳朵   visible=' + (await hoverEar()))
}
await browser.close()
