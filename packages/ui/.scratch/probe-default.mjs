import { chromium } from 'playwright-core'
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = `http://localhost:${process.env.CANVAS_PORT ?? 5289}/`
const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await page.goto(BASE, { waitUntil: 'load' })
await page.evaluate(() => { try { localStorage.clear() } catch {} })
await page.reload({ waitUntil: 'load' })
await page.waitForTimeout(2800)

// 完全出厂状态：不动任何设置
const before = await page.evaluate(() => ({
  zoomSetting: window.MiniCanvasUI.getHost().ctx.get('settings').get('nodeLodLowDetailZoom'),
  viewport: window.MiniCanvasUI.getHost().viewport.getViewport(),
  nodeLod: [...document.querySelectorAll('.v2-node')].map((n) => n.classList.contains('is-low-detail')),
  zoomLabel: (document.querySelector('button[aria-label="缩放选项"]') || {}).textContent,
}))
console.log('出厂状态: ' + JSON.stringify(before))

// 悬停第一个节点的右缘
const p = await page.evaluate(() => {
  const r = document.querySelector('.vue-flow__node').getBoundingClientRect()
  return { x: r.right + 6, y: r.top + r.height / 2, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }
})
await page.mouse.move(p.cx, p.cy, { steps: 5 })
await page.waitForTimeout(500)
const onCard = await page.evaluate(() => document.querySelectorAll('.moving-handle-anchor.is-visible').length)
await page.mouse.move(p.x, p.y, { steps: 5 })
await page.waitForTimeout(500)
const onPort = await page.evaluate(() => ({
  shown: document.querySelectorAll('.moving-handle-anchor.is-visible').length,
  zoneW: (() => { const z = document.querySelector('.port-follow-zone--source'); if (!z) return null; return Math.round(z.getBoundingClientRect().width) })(),
}))
console.log('悬停卡片 → 端口可见数=' + onCard)
console.log('悬停端口区 → ' + JSON.stringify(onPort))

// 对照：把缩放恢复到 100%
await page.evaluate(() => window.MiniCanvasUI.getHost().viewport.setViewport({ x: 400, y: 300, zoom: 1 }))
await page.waitForTimeout(500)
const p2 = await page.evaluate(() => {
  const z = document.querySelector('.port-follow-zone--source')
  const r = z.getBoundingClientRect()
  return { x: r.right - 6, y: r.top + r.height / 2 }
})
await page.mouse.move(5, 5); await page.waitForTimeout(200)
await page.mouse.move(p2.x, p2.y, { steps: 5 })
await page.waitForTimeout(500)
console.log('100% 下悬停端口区 → 可见数=' + (await page.evaluate(() => document.querySelectorAll('.moving-handle-anchor.is-visible').length)))
await browser.close()
