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

// 复位视口，保证节点在屏幕中央
const reset = () => page.evaluate(() => window.MiniCanvasUI.getHost().viewport.setViewport({ x: 400, y: 300, zoom: 1 }))
const setMode = (m) => page.evaluate((mode) => {
  const s = window.MiniCanvasUI.getHost().ctx.get('settings')
  s.set('panOnDrag', true); s.set('nodesDraggable', mode === 'move')
}, m)

const box = () => page.evaluate(() => {
  const el = document.querySelector('.vue-flow__node')
  const r = el.getBoundingClientRect()
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height }
})

const visible = () => page.evaluate(() => ({
  n: document.querySelectorAll('.moving-handle-anchor.is-visible').length,
  btns: [...document.querySelectorAll('.moving-handle-button')].map((b) => getComputedStyle(b).opacity).join(','),
}))

for (const mode of ['move', 'hand']) {
  await setMode(mode)
  await reset()
  await page.waitForTimeout(400)
  const b = await box()
  // 悬停到卡片右缘内侧（rect 部分）
  const spots = [
    ['卡内右缘内侧', b.right - 6, b.cy],
    ['卡缘正上', b.right, b.cy],
    ['卡外 6px', b.right + 6, b.cy],
    ['卡外 14px', b.right + 14, b.cy],
    ['卡中部', b.cx, b.cy],
  ]
  console.log('\n### ' + mode + ' (node right=' + Math.round(b.right) + ', cy=' + Math.round(b.cy) + ')')
  for (const [label, x, y] of spots) {
    await page.mouse.move(x, y, { steps: 4 })
    await page.waitForTimeout(350)
    const v = await visible()
    console.log('  ' + label.padEnd(14) + ' visible=' + v.n + ' opacities=' + v.btns)
    await page.screenshot({ path: OUT + '/hand-' + mode + '-' + label + '.png' })
  }
}
await browser.close()
