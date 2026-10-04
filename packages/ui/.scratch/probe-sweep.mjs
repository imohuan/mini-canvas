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
const geom = () => page.evaluate(() => {
  const el = document.querySelector('.vue-flow__node')
  const r = el.getBoundingClientRect()
  return { right: r.right, cy: r.top + r.height / 2 }
})
const probe = () => page.evaluate(() => {
  const anchors = [...document.querySelectorAll('.moving-handle-anchor')]
  return {
    vis: anchors.filter((a) => a.classList.contains('is-visible')).length,
    cls: anchors.map((a) => a.className.split(' ').filter((c) => c.startsWith('is-')).join('|')),
  }
})

for (const mode of ['move', 'hand']) {
  await setMode(mode)
  await reset()
  await page.waitForTimeout(400)
  const g = await geom()
  const line = []
  for (let dx = -30; dx <= 30; dx += 3) {
    await page.mouse.move(5, 5)
    await page.waitForTimeout(60)
    await page.mouse.move(g.right + dx, g.cy)
    await page.waitForTimeout(140)
    const p = await probe()
    const hit = await page.evaluate(([x, y]) => {
      const e = document.elementFromPoint(x, y)
      const c = (e && e.className || '').toString()
      return c.includes('port-follow-zone') ? (c.includes('source') ? 'SRC' : 'TGT') : (c.includes('vue-flow__node') ? 'node' : c.slice(0, 12))
    }, [g.right + dx, g.cy])
    line.push(`${dx >= 0 ? '+' : ''}${dx}:${p.vis}${hit}`)
  }
  console.log('\n' + mode + ' (right=' + Math.round(g.right) + '):')
  console.log('  ' + line.join('  '))
}
await browser.close()
