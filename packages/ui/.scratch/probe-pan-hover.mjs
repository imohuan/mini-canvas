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
const portPoint = () => page.evaluate(() => {
  const z = document.querySelector('.vue-flow__node .port-follow-zone--source')
  const r = z.getBoundingClientRect()
  return { x: r.right - 8, y: r.top + r.height / 2 }
})
const nodeMid = () => page.evaluate(() => {
  const r = document.querySelector('.vue-flow__node').getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, right: r.right }
})
const st = () => page.evaluate(() => ({
  shown: document.querySelectorAll('.moving-handle-anchor.is-visible').length,
  v2h: document.querySelectorAll('.v2-node.is-pointer-hovered').length,
}))

async function scenario(mode, label, panFrom) {
  await setMode(mode)
  await page.evaluate(() => window.MiniCanvasUI.getHost().viewport.setViewport({ x: 400, y: 300, zoom: 1 }))
  await page.waitForTimeout(400)
  await page.mouse.move(5, 5); await page.waitForTimeout(250)
  const start = panFrom === 'node' ? await nodeMid() : { x: 260, y: 780 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 60, start.y - 40, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  // 松手后指针仍在节点区附近（不平移到远处），直接移到端口
  const p = await portPoint()
  await page.mouse.move(p.x, p.y, { steps: 6 })
  await page.waitForTimeout(500)
  console.log(`  [${mode}] ${label}: ${JSON.stringify(await st())}`)
}

console.log('平移起点=空白')
await scenario('move', '空白平移后悬停端口', 'blank')
await scenario('hand', '空白平移后悬停端口', 'blank')
console.log('平移起点=节点上（抓手模式的典型操作）')
await scenario('move', '节点上拖动后悬停端口', 'node')
await scenario('hand', '节点上拖动后悬停端口', 'node')
await browser.close()
