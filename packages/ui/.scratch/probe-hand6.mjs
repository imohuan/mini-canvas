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

const reset = () => page.evaluate(() => window.MiniCanvasUI.getHost().viewport.setViewport({ x: 400, y: 300, zoom: 1 }))
const setMode = (m) => page.evaluate((mode) => {
  const s = window.MiniCanvasUI.getHost().ctx.get('settings')
  s.set('panOnDrag', true); s.set('nodesDraggable', mode === 'move')
}, m)
const box = () => page.evaluate(() => {
  const el = document.querySelector('.vue-flow__node')
  const r = el.getBoundingClientRect()
  return { left: Math.round(r.left), right: Math.round(r.right), cy: Math.round(r.top + r.height / 2) }
})
const st = () => page.evaluate(() => ({
  visible: document.querySelectorAll('.moving-handle-anchor.is-visible').length,
  hovered: document.querySelectorAll('.vue-flow__node.is-pointer-hovered').length,
  nodeRects: [...document.querySelectorAll('.vue-flow__node')].map((n) => { const r = n.getBoundingClientRect(); return Math.round(r.left) + '..' + Math.round(r.right) + '@' + Math.round(r.top + r.height / 2) }),
}))

async function hoverRightEdge(label) {
  const b = await box()
  await page.mouse.move(b.right - 2, b.cy, { steps: 6 })
  await page.waitForTimeout(400)
  console.log('    ' + label + ' → ' + JSON.stringify(await st()))
}

for (const mode of ['move', 'hand']) {
  await setMode(mode)
  await reset()
  await page.waitForTimeout(400)
  console.log('\n### ' + mode)
  console.log('  复位后 node:', JSON.stringify(await box()))
  await hoverRightEdge('复位后悬停端口')

  // 小幅平移（30px，不越界）
  await page.mouse.move(300, 750)
  await page.mouse.down()
  await page.mouse.move(330, 730, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  console.log('  平移后 node:', JSON.stringify(await box()))
  await hoverRightEdge('平移后悬停端口')
  await page.screenshot({ path: OUT + '/pan-' + mode + '.png' })

  // 鼠标移到远处再回来
  await page.mouse.move(1350, 60)
  await page.waitForTimeout(300)
  await hoverRightEdge('移开再回悬停端口')
}
await browser.close()
