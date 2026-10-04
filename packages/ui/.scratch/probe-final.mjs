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

const snap = () => page.evaluate(() => {
  const node = document.querySelector('.vue-flow__node')
  const v2 = node.querySelector('.v2-node')
  const rh = node.querySelector('.resize-handle')
  const src = node.querySelector('.moving-handle-anchor--source')
  return {
    v2class: v2 ? v2.className : null,
    resizeOpacity: rh ? getComputedStyle(rh).opacity : null,
    srcClass: src ? src.className.split(' ').filter((c) => c.startsWith('is-')).join('|') : null,
    zoomSetting: window.MiniCanvasUI.getHost().ctx.get('settings').get('nodeLodLowDetailZoom'),
    viewport: window.MiniCanvasUI.getHost().viewport.getViewport(),
  }
})

for (const mode of ['move', 'hand']) {
  await setMode(mode)
  await page.evaluate(() => window.MiniCanvasUI.getHost().viewport.setViewport({ x: 400, y: 300, zoom: 1 }))
  await page.waitForTimeout(400)
  await page.mouse.move(5, 5); await page.waitForTimeout(250)
  const before = await snap()
  const c = await page.evaluate(() => {
    const r = document.querySelector('.vue-flow__node').getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + 30 }
  })
  await page.mouse.move(c.x, c.y, { steps: 5 })
  await page.waitForTimeout(500)
  const after = await snap()
  console.log('\n### ' + mode)
  console.log('  悬停前: ' + JSON.stringify(before))
  console.log('  悬停后: ' + JSON.stringify(after))
}
await browser.close()
