import { chromium } from 'playwright-core'
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = `http://localhost:${process.env.CANVAS_PORT ?? 5289}/`
const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await page.goto(BASE, { waitUntil: 'load' })
await page.evaluate(() => { try { localStorage.clear() } catch {} })
await page.reload({ waitUntil: 'load' })
await page.waitForTimeout(2800)

const setMode = (m) => page.evaluate((mode) => {
  const s = window.MiniCanvasUI.getHost().ctx.get('settings')
  s.set('panOnDrag', true); s.set('nodesDraggable', mode === 'move')
}, m)

async function panThenHover(mode, big) {
  await setMode(mode)
  await page.evaluate(() => window.MiniCanvasUI.getHost().viewport.setViewport({ x: 400, y: 300, zoom: 1 }))
  await page.waitForTimeout(400)
  await page.mouse.move(5, 5); await page.waitForTimeout(200)
  // 在空白处大幅平移
  await page.mouse.move(250, 780)
  await page.mouse.down()
  const d = big ? 300 : 40
  await page.mouse.move(250 + d, 780 - d / 2, { steps: 16 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  // 悬停端口
  const p = await page.evaluate(() => {
    const z = document.querySelector('.vue-flow__node .port-follow-zone--source')
    if (!z) return null
    const r = z.getBoundingClientRect()
    return { x: r.right - 6, y: r.top + r.height / 2, w: Math.round(r.width) }
  })
  let shown = -1
  if (p) {
    await page.mouse.move(p.x, p.y, { steps: 6 })
    await page.waitForTimeout(500)
    shown = await page.evaluate(() => document.querySelectorAll('.moving-handle-anchor.is-visible').length)
  }
  const info = await page.evaluate(() => ({
    vp: window.MiniCanvasUI.getHost().viewport.getViewport(),
    lowDetail: [...document.querySelectorAll('.v2-node')].filter((n) => n.classList.contains('is-low-detail')).length,
    nodes: document.querySelectorAll('.vue-flow__node').length,
    zoneW: (() => { const z = document.querySelector('.port-follow-zone--source'); return z ? Math.round(z.getBoundingClientRect().width) : null })(),
  }))
  console.log(`  ${mode} ${big ? '大幅' : '小幅'}平移 → 悬停端口: shown=${shown} zoneW=${p ? p.w : 'n/a'} 真实zoneW=${info.zoneW} zoom=${info.vp.zoom.toFixed(2)} lowDetail节点=${info.lowDetail}/${info.nodes}`)
}

for (const mode of ['move', 'hand']) {
  await panThenHover(mode, false)
  await panThenHover(mode, true)
}
await browser.close()
