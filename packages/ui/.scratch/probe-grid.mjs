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

async function grid(mode) {
  await setMode(mode)
  await page.evaluate(() => window.MiniCanvasUI.getHost().viewport.setViewport({ x: 400, y: 300, zoom: 1 }))
  await page.waitForTimeout(400)
  const rect = await page.evaluate(() => {
    const r = document.querySelector('.vue-flow__node').getBoundingClientRect()
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
  })
  const rows = []
  for (let fy = 0.08; fy <= 0.92; fy += 0.21) {
    let row = ''
    for (let x = rect.left - 20; x <= rect.right + 36; x += 14) {
      await page.mouse.move(5, 5); await page.waitForTimeout(30)
      await page.mouse.move(x, rect.top + (rect.bottom - rect.top) * fy)
      await page.waitForTimeout(85)
      const n = await page.evaluate(() => document.querySelectorAll('.moving-handle-anchor.is-visible').length)
      row += n > 0 ? '#' : '.'
    }
    rows.push(row)
  }
  return { span: `x=${Math.round(rect.left - 24)}..${Math.round(rect.right + 40)} step8, y 从顶到底`, rows }
}

const g1 = await grid('move')
const g2 = await grid('hand')
console.log('\n' + g1.span)
console.log('移动:'); g1.rows.forEach((r) => console.log('  ' + r))
console.log('抓手:'); g2.rows.forEach((r) => console.log('  ' + r))
console.log('\n逐行一致: ' + g1.rows.every((r, i) => r === g2.rows[i]))
await browser.close()
