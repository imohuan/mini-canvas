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

const ear = () => page.evaluate(() => {
  const z = document.querySelector('.vue-flow__node .port-follow-zone--target')
  const r = z.getBoundingClientRect()
  return { x: r.left + 6, y: r.top + r.height / 2, w: r.width }
})
const vis = () => page.evaluate(() => ({
  n: document.querySelectorAll('.moving-handle-anchor.is-visible').length,
  cls: [...document.querySelectorAll('.moving-handle-anchor')].map((a) => a.className.split(' ').filter((c) => c.startsWith('is-')).join('|')).join(' , '),
}))
const hoverTarget = async () => { const p = await ear(); await page.mouse.move(p.x, p.y, { steps: 6 }); await page.waitForTimeout(450); return await vis() }

console.log('初始(移动) 悬停左端口=' + JSON.stringify(await hoverTarget()))
await page.mouse.move(5, 5); await page.waitForTimeout(200)

// 真实点击流程：移动 → 抓手工具
await page.click('button[aria-label="移动"]')
await page.waitForTimeout(350)
await page.click('button[role="menuitem"]:has-text("抓手工具")')
await page.waitForTimeout(300)
const mode = await page.evaluate(() => ({
  draggable: window.MiniCanvasUI.getHost().ctx.get('settings').get('nodesDraggable'),
  nodeCls: document.querySelector('.vue-flow__node').className,
}))
console.log('切到抓手后:', JSON.stringify(mode))
await page.mouse.move(5, 5); await page.waitForTimeout(250)
console.log('抓手: 悬停左端口=' + JSON.stringify(await hoverTarget()))

// 悬停右侧
await page.mouse.move(5, 5); await page.waitForTimeout(250)
const p2 = await page.evaluate(() => {
  const z = document.querySelector('.vue-flow__node .port-follow-zone--source')
  const r = z.getBoundingClientRect()
  return { x: r.right - 6, y: r.top + r.height / 2 }
})
await page.mouse.move(p2.x, p2.y, { steps: 6 })
await page.waitForTimeout(450)
console.log('抓手: 悬停右端口=' + JSON.stringify(await vis()))

// 回移动
await page.mouse.move(5, 5); await page.waitForTimeout(200)
await page.click('button[aria-label="移动"]')
await page.waitForTimeout(350)
await page.click('button[role="menuitem"]:has-text("移动")')
await page.waitForTimeout(300)
console.log('切回移动: 悬停左端口=' + JSON.stringify(await hoverTarget()))
await browser.close()
