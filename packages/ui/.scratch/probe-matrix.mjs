import { chromium } from 'playwright-core'
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = `http://localhost:${process.env.CANVAS_PORT ?? 5289}/`
const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await page.goto(BASE, { waitUntil: 'load' })
await page.evaluate(() => { try { localStorage.clear() } catch {} })
await page.reload({ waitUntil: 'load' })
await page.waitForTimeout(2500)

// 模拟用户会话：把低细节阈值调到 0.1（39% 也不进低细节）
await page.evaluate(() => {
  const s = window.MiniCanvasUI.getHost().ctx.get('settings')
  s.set('nodeLodLowDetailZoom', 0.1)
  s.set('panOnDrag', true)
})

const setMode = (m) => page.evaluate((mode) => {
  window.MiniCanvasUI.getHost().ctx.get('settings').set('nodesDraggable', mode === 'move')
}, m)

async function probe(zoom, selected) {
  const row = []
  for (const mode of ['move', 'hand']) {
    await setMode(mode)
    await page.evaluate((z) => window.MiniCanvasUI.getHost().viewport.setViewport({ x: 620, y: 500, zoom: z }), zoom)
    await page.waitForTimeout(400)
    if (selected) {
      const ids = await page.evaluate(() => window.MiniCanvasUI.getHost().nodeStore.getNodes().map((n) => n.id))
      await page.evaluate((i) => window.MiniCanvasUI.getHost().selection.set([i]), ids[0])
    } else {
      await page.evaluate(() => window.MiniCanvasUI.getHost().selection.clear())
    }
    await page.waitForTimeout(300)
    const p = await page.evaluate(() => {
      const z = document.querySelector('.vue-flow__node .port-follow-zone--source')
      if (!z) return null
      const r = z.getBoundingClientRect()
      return { x: r.right - 5, y: r.top + r.height / 2 }
    })
    if (!p) { row.push(mode + '=无zone'); continue }
    await page.mouse.move(5, 5); await page.waitForTimeout(200)
    await page.mouse.move(p.x, p.y, { steps: 5 })
    await page.waitForTimeout(450)
    const n = await page.evaluate(() => document.querySelectorAll('.moving-handle-anchor.is-visible').length)
    row.push(mode + '=' + (n > 0 ? '显示' : '不显示'))
  }
  console.log(`zoom=${zoom} 选中=${selected ? '是' : '否'}  →  ` + row.join('   '))
}

for (const z of [1, 0.6, 0.39]) {
  await probe(z, false)
  await probe(z, true)
}
await browser.close()
