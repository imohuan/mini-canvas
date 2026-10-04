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

async function probe(mode, zoom) {
  await setMode(mode)
  await page.evaluate((z) => window.MiniCanvasUI.getHost().viewport.setViewport({ x: 500, y: 420, zoom: z }), zoom)
  await page.waitForTimeout(450)
  const p = await page.evaluate(() => {
    const z = document.querySelector('.vue-flow__node .port-follow-zone--source')
    const r = z.getBoundingClientRect()
    const n = document.querySelector('.vue-flow__node')
    return { ex: r.right - 6, ey: r.top + r.height / 2, lowDetail: n.querySelector('.v2-node').classList.contains('is-low-detail'), zoneW: Math.round(r.width) }
  })
  await page.mouse.move(5, 5); await page.waitForTimeout(150)
  await page.mouse.move(p.ex, p.ey, { steps: 5 })
  await page.waitForTimeout(450)
  const out = await page.evaluate(() => ({
    shown: document.querySelectorAll('.moving-handle-anchor.is-visible').length,
    ballOpacity: [...document.querySelectorAll('.moving-handle-button')].map((b) => getComputedStyle(b).opacity).join(','),
  }))
  console.log(`  ${mode} zoom=${zoom}: lowDetail=${p.lowDetail} zoneW=${p.zoneW} shown=${out.shown} ball=${out.ballOpacity}`)
}

for (const mode of ['move', 'hand']) {
  console.log('### ' + mode)
  for (const z of [1, 0.5, 0.45, 0.39, 0.3]) await probe(mode, z)
}
await browser.close()
