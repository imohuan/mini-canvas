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

const clipOf = () => page.evaluate(() => {
  const n = document.querySelector('.vue-flow__node')
  const r = n.getBoundingClientRect()
  const pad = 70
  return { x: Math.max(0, r.left - pad), y: Math.max(0, r.top - pad), width: r.width + pad * 2, height: r.height + pad * 2 }
})

// 列出节点内部所有元素，找出各模式下的差异
const desc = () => page.evaluate(() => {
  const n = document.querySelector('.vue-flow__node')
  const out = []
  n.querySelectorAll('*').forEach((e) => {
    const cls = (e.className || '').toString().trim()
    if (!cls) return
    const cs = getComputedStyle(e)
    out.push(`${e.tagName.toLowerCase()}.${cls.split(/\s+/)[0]} d=${cs.display} op=${cs.opacity} pe=${cs.pointerEvents}`)
  })
  return out
})

for (const mode of ['move', 'hand']) {
  await setMode(mode)
  await page.evaluate(() => window.MiniCanvasUI.getHost().viewport.setViewport({ x: 400, y: 300, zoom: 1 }))
  await page.waitForTimeout(400)
  // 悬停卡片中部
  const c = await page.evaluate(() => {
    const r = document.querySelector('.vue-flow__node').getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + 30 }
  })
  await page.mouse.move(c.x, c.y, { steps: 5 })
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/vis-${mode}.png`, clip: await clipOf() })
  const d = await desc()
  console.log('\n### ' + mode + ' 元素数=' + d.length)
  console.log(d.filter((x) => /handle|grip|move|drag|resize|dot/i.test(x)).join('\n') || '(无 handle/drag 相关元素)')
}
await browser.close()
