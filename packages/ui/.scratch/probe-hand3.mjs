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
  s.set('panOnDrag', true)
  s.set('nodesDraggable', mode === 'move')
}, m)

const box = () => page.evaluate(() => {
  const el = document.querySelector('.vue-flow__node')
  const r = el.getBoundingClientRect()
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, right: r.right }
})

const shown = () => page.evaluate(() => {
  const anchors = [...document.querySelectorAll('.moving-handle-anchor')]
  const btns = [...document.querySelectorAll('.moving-handle-button')]
  return {
    visible: anchors.filter((a) => a.classList.contains('is-visible')).length,
    opacity: btns.map((b) => getComputedStyle(b).opacity).join(','),
    draggable: [...document.querySelectorAll('.vue-flow__node')].map((n) => n.classList.contains('draggable')),
    isNodeDraggingFlag: (() => {
      const n = document.querySelector('.vue-flow__node')
      return n ? n.className : ''
    })(),
  }
})

async function hoverPort(b) {
  await page.mouse.move(b.right + 10, b.cy, { steps: 6 })
  await page.waitForTimeout(500)
  return shown()
}

// —— 抓手模式：先平移画布，再悬停节点端口
await setMode('hand')
await page.waitForTimeout(300)
let b = await box()
console.log('抓手-平移前 悬停端口:', JSON.stringify(await hoverPort(b)))

// 在空白处拖动平移画布（避开节点）
await page.mouse.move(200, 700)
await page.mouse.down()
await page.mouse.move(320, 640, { steps: 10 })
await page.mouse.up()
await page.waitForTimeout(400)
b = await box()
console.log('抓手-平移后 悬停端口:', JSON.stringify(await hoverPort(b)))

// 再平移一次（连续平移）
await page.mouse.move(200, 700)
await page.mouse.down()
await page.mouse.move(260, 690, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(400)
b = await box()
console.log('抓手-连续平移后 悬停端口:', JSON.stringify(await hoverPort(b)))

// —— 对照：移动模式
await setMode('move')
await page.waitForTimeout(300)
b = await box()
await page.mouse.move(200, 700)
await page.mouse.down()
await page.mouse.move(280, 660, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(400)
b = await box()
console.log('移动-平移后 悬停端口:', JSON.stringify(await hoverPort(b)))

await browser.close()
