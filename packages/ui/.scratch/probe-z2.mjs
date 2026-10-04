import { chromium } from 'playwright-core'
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = `http://localhost:${process.env.CANVAS_PORT ?? 5289}/`
const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await page.goto(BASE, { waitUntil: 'load' })
await page.evaluate(() => { try { localStorage.clear() } catch {} })
await page.reload({ waitUntil: 'load' })
await page.waitForTimeout(2500)
await page.evaluate(() => window.MiniCanvasUI.getHost().viewport.setViewport({ x: 400, y: 300, zoom: 1 }))
await page.waitForTimeout(400)

const dump = await page.evaluate(() => {
  const node = document.querySelector('.vue-flow__node')
  const r = node.getBoundingClientRect()
  const x = r.right - 5, y = r.top + r.height / 2
  const stack = document.elementsFromPoint(x, y).map((e) => {
    const cs = getComputedStyle(e)
    return { cls: (e.className || e.tagName).toString().slice(0, 46), z: cs.zIndex, pos: cs.position, pe: cs.pointerEvents, bg: cs.backgroundColor }
  })
  const zone = node.querySelector('.port-follow-zone--source')
  const zcs = zone ? getComputedStyle(zone) : null
  const zr = zone ? zone.getBoundingClientRect() : null
  return {
    point: { x, y },
    stack: stack.slice(0, 6),
    zone: zcs ? { z: zcs.zIndex, pos: zcs.position, pe: zcs.pointerEvents, clip: zcs.clipPath, left: zr.left, right: zr.right, w: zr.width, top: zr.top } : null,
    nodeRect: { left: r.left, right: r.right },
  }
})
console.log(JSON.stringify(dump, null, 1))
await browser.close()
