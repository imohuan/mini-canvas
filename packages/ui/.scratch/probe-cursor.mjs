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

const cursors = () => page.evaluate(() => {
  const node = document.querySelector('.vue-flow__node')
  const zone = node.querySelector('.port-follow-zone--source')
  const btn = node.querySelector('.moving-handle-button')
  const pane = document.querySelector('.vue-flow__pane')
  return {
    pane: getComputedStyle(pane).cursor,
    node: getComputedStyle(node).cursor,
    zone: getComputedStyle(zone).cursor,
    btn: getComputedStyle(btn).cursor,
    nodeHasDraggableClass: node.classList.contains('draggable'),
  }
})

for (const mode of ['move', 'hand']) {
  await setMode(mode)
  await page.waitForTimeout(300)
  console.log(mode.padEnd(5) + ': ' + JSON.stringify(await cursors()))
}
await browser.close()
