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

const info = () => page.evaluate(() => {
  const anchors = [...document.querySelectorAll('.moving-handle-anchor')]
  const first = anchors[0]
  const btns = [...document.querySelectorAll('.moving-handle-button')]
  return {
    anchors: anchors.length,
    anchorClasses: anchors.map((a) => a.className.replace('moving-handle-anchor ', '')),
    btnOpacity: btns.map((b) => getComputedStyle(b).opacity),
    btnLeft: btns.map((b) => b.style.left),
    nodeClasses: [...document.querySelectorAll('.vue-flow__node')].map((n) => n.className),
  }
})

const box = () => page.evaluate(() => {
  const el = document.querySelector('.vue-flow__node')
  const r = el.getBoundingClientRect()
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, right: r.right, h: r.height, left: r.left }
})

for (const mode of ['move', 'hand']) {
  await setMode(mode)
  await page.waitForTimeout(300)
  const b = await box()
  console.log('\n===== ' + mode + ' =====')
  console.log('节点 class:', JSON.stringify((await info()).nodeClasses))

  // 悬停卡片中部
  await page.mouse.move(b.cx, b.cy, { steps: 4 })
  await page.waitForTimeout(350)
  let i = await info()
  console.log('卡中部   : opacity=' + JSON.stringify(i.btnOpacity) + ' anchor=' + JSON.stringify(i.anchorClasses))

  // 移到右缘端口区（耳朵内）
  await page.mouse.move(b.right + 10, b.cy, { steps: 6 })
  await page.waitForTimeout(450)
  i = await info()
  console.log('右缘 zone: opacity=' + JSON.stringify(i.btnOpacity) + ' left=' + JSON.stringify(i.btnLeft) + ' anchor=' + JSON.stringify(i.anchorClasses))

  // 在 zone 内移动，看是否跟随
  await page.mouse.move(b.right + 22, b.cy - 20, { steps: 6 })
  await page.waitForTimeout(450)
  i = await info()
  console.log('zone 内动: opacity=' + JSON.stringify(i.btnOpacity) + ' left=' + JSON.stringify(i.btnLeft) + ' anchor=' + JSON.stringify(i.anchorClasses))
  await page.mouse.move(10, 10)
  await page.waitForTimeout(400)
}
await browser.close()
