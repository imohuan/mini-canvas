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

// 悬停端口：先移到远处保证 mouseenter 新鲜触发
const hoverPort = async () => {
  const p = await page.evaluate(() => {
    const z = document.querySelector('.vue-flow__node .port-follow-zone--source')
    const r = z.getBoundingClientRect()
    return { x: r.right - 6, y: r.top + r.height / 2, left: r.left, right: r.right, top: r.top, bottom: r.bottom }
  })
  await page.mouse.move(5, 5); await page.waitForTimeout(250)
  await page.mouse.move(p.x, p.y, { steps: 8 })
  await page.waitForTimeout(500)
  const shown = await page.evaluate(() => document.querySelectorAll('.moving-handle-anchor.is-visible').length)
  return { shown, zone: p }
}

for (const mode of ['move', 'hand']) {
  await setMode(mode)
  await page.evaluate(() => window.MiniCanvasUI.getHost().viewport.setViewport({ x: 400, y: 300, zoom: 1 }))
  await page.waitForTimeout(450)
  console.log('\n### ' + mode)
  console.log('  平移前: ' + JSON.stringify(await hoverPort()))

  // 空白处平移 300px（指针最后停在 (550,630)）
  await page.mouse.move(250, 780)
  await page.mouse.down()
  await page.mouse.move(550, 630, { steps: 16 })
  await page.mouse.up()
  await page.waitForTimeout(600)
  const r = await hoverPort()
  console.log('  大幅平移后: shown=' + r.shown + ' zone=[' + Math.round(r.zone.left) + '..' + Math.round(r.zone.right) + '] y=' + Math.round(r.zone.top) + '..' + Math.round(r.zone.bottom))
  console.log('  指针平移终点=(550,630) 是否落在zone内: ' + (550 >= r.zone.left && 550 <= r.zone.right && 630 >= r.zone.top && 630 <= r.zone.bottom))
}
await browser.close()
