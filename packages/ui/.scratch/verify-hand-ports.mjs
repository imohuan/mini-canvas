import { chromium } from 'playwright-core'
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = `http://localhost:${process.env.CANVAS_PORT ?? 5289}/`
const results = []
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -- ' + d : ''}`) }

const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(BASE, { waitUntil: 'load' })
await page.evaluate(() => { try { localStorage.clear() } catch {} })
await page.reload({ waitUntil: 'load' })
await page.waitForTimeout(2800)

const setMode = (m) => page.evaluate((mode) => {
  const ctx = window.MiniCanvasUI.getHost().ctx
  ctx.get('settings').set('panOnDrag', true)
  ctx.get('settings').set('nodesDraggable', mode === 'move')
}, m)

// 悬停端口区：先移到远处保证 mouseenter 新鲜触发
const hoverPort = async () => {
  const p = await page.evaluate(() => {
    const z = document.querySelector('.vue-flow__node .port-follow-zone--source')
    const r = z.getBoundingClientRect()
    return { x: r.right - 6, y: r.top + r.height / 2 }
  })
  await page.mouse.move(5, 5); await page.waitForTimeout(250)
  await page.mouse.move(p.x, p.y, { steps: 6 })
  await page.waitForTimeout(500)
  return page.evaluate(() => ({
    shown: document.querySelectorAll('.moving-handle-anchor.is-visible').length,
    ballOpacity: [...document.querySelectorAll('.moving-handle-button')].map((b) => getComputedStyle(b).opacity).join(','),
  }))
}

await setMode('move')
await page.evaluate(() => window.MiniCanvasUI.getHost().viewport.setViewport({ x: 400, y: 300, zoom: 1 }))
await page.waitForTimeout(400)
const inMove = await hoverPort()
check('移动工具：悬停端口区 → 圆球出现', inMove.shown >= 1 && inMove.ballOpacity.includes('1'), JSON.stringify(inMove))

// 不刷新页面，直接热切到抓手（考“实时生效”）
await setMode('hand')
await page.waitForTimeout(400)
const inHand = await hoverPort()
check('抓手工具（同一页面热切）：悬停端口区 → 圆球不出现', inHand.shown === 0 && !inHand.ballOpacity.includes('1'), JSON.stringify(inHand))

// 抓手模式下选中节点，端口也不该常显
await page.evaluate(() => {
  const h = window.MiniCanvasUI.getHost()
  h.selection.set([h.nodeStore.getNodes()[0].id])
})
await page.waitForTimeout(500)
const selectedHand = await page.evaluate(() => ({
  shown: document.querySelectorAll('.moving-handle-anchor.is-visible').length,
  selected: document.querySelectorAll('.v2-node.is-selected').length,
}))
check('抓手工具：选中节点端口也不常显', selectedHand.shown === 0 && selectedHand.selected === 1, JSON.stringify(selectedHand))

// 切回移动（同一页面），选中态下端口应恢复常显
await setMode('move')
await page.waitForTimeout(500)
const backMove = await page.evaluate(() => document.querySelectorAll('.moving-handle-anchor.is-visible').length)
check('切回移动工具：选中态端口恢复常显（实时生效）', backMove >= 1, 'shown=' + backMove)

// 抓手模式下仍然可以拉线？（端口不显示 → 用户不会去拉，这里只确认拖画布仍正常）
await setMode('hand')
await page.evaluate(() => window.MiniCanvasUI.getHost().selection.clear())
await page.waitForTimeout(400)
const v0 = await page.evaluate(() => window.MiniCanvasUI.getHost().viewport.getViewport())
const mid = await page.evaluate(() => {
  const r = document.querySelector('.vue-flow__node').getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})
await page.mouse.move(mid.x, mid.y)
await page.mouse.down()
await page.mouse.move(mid.x + 70, mid.y + 50, { steps: 10 })
await page.mouse.up()
await page.waitForTimeout(400)
const v1 = await page.evaluate(() => window.MiniCanvasUI.getHost().viewport.getViewport())
check('抓手工具：拖节点仍是平移画布（功能未受影响）', Math.abs(v1.x - v0.x) > 5 || Math.abs(v1.y - v0.y) > 5, `vp ${Math.round(v0.x)},${Math.round(v0.y)} -> ${Math.round(v1.x)},${Math.round(v1.y)}`)

check('无页面异常', errors.length === 0, errors.slice(0, 2).join(' | '))
console.log(`\n${results.filter(Boolean).length}/${results.length} 通过`)
await browser.close()
process.exit(results.every(Boolean) ? 0 : 1)
