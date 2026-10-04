import { chromium } from 'playwright-core'
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = `http://localhost:${process.env.CANVAS_PORT ?? 5289}/`
const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await page.goto(BASE, { waitUntil: 'load' })
await page.evaluate(() => { try { localStorage.clear() } catch {} })
await page.reload({ waitUntil: 'load' })
await page.waitForTimeout(2800)

// 节点挪到画面中偏左下，便于从底栏直接移过去
await page.evaluate(() => {
  const h = window.MiniCanvasUI.getHost()
  h.viewport.setViewport({ x: 300, y: 200, zoom: 0.7 })
})
await page.waitForTimeout(500)

const probe = async (label) => {
  const p = await page.evaluate(() => {
    const z = document.querySelector('.vue-flow__node .port-follow-zone--source')
    const r = z.getBoundingClientRect()
    return { x: r.right - 6, y: r.top + r.height / 2 }
  })
  // 从底栏区域出发，一路移到端口（不经过空白，直接斜向移动）
  await page.mouse.move(700, 862, { steps: 3 })
  await page.waitForTimeout(120)
  await page.mouse.move(p.x, p.y, { steps: 12 })
  await page.waitForTimeout(550)
  const r = await page.evaluate(() => ({
    shown: document.querySelectorAll('.moving-handle-anchor.is-visible').length,
    hovered: document.querySelectorAll('.v2-node.is-pointer-hovered').length,
  }))
  console.log('  ' + label + ': ' + JSON.stringify(r))
}

// 通过真实下拉切成抓手
await page.click('button[aria-label="移动"]')
await page.waitForTimeout(300)
await page.click('button[role="menuitem"]:has-text("移动")')
await page.waitForTimeout(300)
console.log('移动模式:')
await probe('从底栏移向端口')

await page.click('button[aria-label="移动"]')
await page.waitForTimeout(300)
await page.click('button[role="menuitem"]:has-text("抓手工具")')
await page.waitForTimeout(300)
console.log('抓手模式:')
await probe('从底栏移向端口')
await browser.close()
