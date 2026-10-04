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

const nodePoint = () => page.evaluate(() => {
  const el = document.querySelector('.vue-flow__node')
  const r = el.getBoundingClientRect()
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, right: r.right, left: r.left, w: r.width, h: r.height }
})

async function probe(tag) {
  const p = await nodePoint()
  // 悬停到节点卡片中部（不进端口 zone）
  await page.mouse.move(p.cx, p.cy)
  await page.waitForTimeout(300)
  const onCard = await page.evaluate(() => {
    const anchors = [...document.querySelectorAll('.moving-handle-anchor')]
    return {
      total: anchors.length,
      visible: anchors.filter((a) => a.classList.contains('is-visible')).length,
      zoneCount: document.querySelectorAll('.port-follow-zone').length,
    }
  })
  // 悬停到右侧端口 zone（source 耳朵）
  await page.mouse.move(p.right + 4, p.cy)
  await page.waitForTimeout(400)
  const onZone = await page.evaluate(() => {
    const anchors = [...document.querySelectorAll('.moving-handle-anchor')]
    const zones = [...document.querySelectorAll('.port-follow-zone')]
    return {
      visible: anchors.filter((a) => a.classList.contains('is-visible')).length,
      hoverNow: zones.map((z) => ({ cls: z.className, hit: z === document.elementFromPoint ? true : false })),
      underCursor: (document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2) || {}).className,
    }
  })
  console.log('[' + tag + '] 卡片中部:', JSON.stringify(onCard), ' 右缘 zone:', JSON.stringify(onZone))
}

await setMode('move')
await page.waitForTimeout(200)
await probe('移动模式')
await setMode('hand')
await page.waitForTimeout(200)
await probe('抓手模式')

// 抓手模式下：元素命中检查（zone 是否被别的元素挡住）
const hit = await page.evaluate(() => {
  const p = document.querySelector('.vue-flow__node')
  const r = p.getBoundingClientRect()
  const x = r.right + 4, y = r.top + r.height / 2
  const stack = document.elementsFromPoint(x, y).slice(0, 5).map((e) => e.className || e.tagName)
  return { x, y, stack }
})
console.log('右缘点命中栈(抓手模式):', JSON.stringify(hit))

await browser.close()
