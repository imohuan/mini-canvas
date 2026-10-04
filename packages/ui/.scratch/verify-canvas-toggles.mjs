// 临时验证脚本：真实浏览器点按钮，看画布有没有真的变。
// 跑法：node packages/ui/.scratch/verify-canvas-toggles.mjs  （先起 dev，端口见 CANVAS_PORT）
import { chromium } from 'playwright-core'

const EXE = process.env.CANVAS_E2E_CHROME
  ?? 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = `http://localhost:${process.env.CANVAS_PORT ?? 5289}/`

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`)
}

const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(BASE, { waitUntil: 'load' })
await page.evaluate(() => { try { localStorage.clear() } catch {} })
await page.reload({ waitUntil: 'load' })
await page.waitForTimeout(2500)

const setting = (k) => page.evaluate((key) => window.MiniCanvasUI.getHost().ctx.get('settings').get(key), k)

// 1) 隐藏节点连线
check('初始 edgeVisible=true', (await setting('edgeVisible')) === true)
await page.click('button[aria-label="隐藏节点连线"]')
await page.waitForTimeout(150)
check('点按钮后 edgeVisible=false（写进设置）', (await setting('edgeVisible')) === false)
const edgesHidden = await page.evaluate(() => {
  // 边视觉元素全被移除或不可见 = 真隐藏
  const paths = [...document.querySelectorAll('.vue-flow__edge path, .vue-flow__edge .ef-base')]
  return paths.length === 0 || paths.every((p) => {
    const r = p.getBoundingClientRect()
    const cs = getComputedStyle(p)
    return r.width === 0 || cs.display === 'none' || cs.visibility === 'hidden'
  })
})
check('画布连线真的看不见了', edgesHidden)
await page.click('button[aria-label="显示节点连线"]')
await page.waitForTimeout(150)
check('再点一次恢复 edgeVisible=true', (await setting('edgeVisible')) === true)

// 2) 网格吸附
const snap0 = await setting('snapToGrid')
await page.click('button[aria-label="开启网格吸附"], button[aria-label="关闭网格吸附"]')
await page.waitForTimeout(150)
const snap1 = await setting('snapToGrid')
check('网格吸附按钮切换了 snapToGrid', snap0 !== snap1, `${snap0} -> ${snap1}`)

// 3) 抓手工具（底栏「移动」下拉里的两项）
const jsMode = async () => page.evaluate(() => {
  const s = window.MiniCanvasUI.getHost().ctx.get('settings')
  return { draggable: s.get('nodesDraggable'), pan: s.get('panOnDrag') }
})
const beforeMode = await jsMode()
check('初始为移动态（节点可拖 + 拖空白平移）', beforeMode.draggable === true && beforeMode.pan === true, JSON.stringify(beforeMode))
await page.click('button[aria-label="移动"]')
await page.waitForTimeout(300)
await page.click('button[role="menuitem"]:has-text("抓手工具")')
await page.waitForTimeout(200)
const handMode = await jsMode()
check('选抓手后 nodesDraggable=false（节点不会被拖走，拖哪都平移）', handMode.draggable === false && handMode.pan === true, JSON.stringify(handMode))
await page.click('button[aria-label="移动"]')
await page.waitForTimeout(300)
await page.click('button[role="menuitem"]:has-text("移动")')
await page.waitForTimeout(200)
const moveMode = await jsMode()
check('选回移动后 nodesDraggable=true', moveMode.draggable === true, JSON.stringify(moveMode))

// 4) 整理画布：真跑自动布局
const positions = () => page.evaluate(() => window.MiniCanvasUI.getHost().nodeStore.getNodes().map((n) => `${n.position.x},${n.position.y}`))
// 先手动把两个节点挪到同一处，再整理，看是否被重新排布
await page.evaluate(() => {
  const doc = window.MiniCanvasUI.getHost().doc
  const ids = doc.getNodes().map((n) => n.id)
  if (ids.length >= 2) doc.updateNodes(ids.slice(0, 2).map((id) => ({ id, patch: { position: { x: 0, y: 0 } } })))
})
await page.waitForTimeout(200)
const beforeOrganize = await positions()
await page.click('button[aria-label^="整理画布"]')
await page.waitForTimeout(600)
const afterOrganize = await positions()
check('整理画布真的重排了节点', JSON.stringify(beforeOrganize) !== JSON.stringify(afterOrganize))

// 3b) 真拖拽验证：移动态拖节点 → 节点动；抓手态拖节点 → 节点不动、视图平移
const nodeBox = () => page.evaluate(() => {
  const el = document.querySelector('.vue-flow__node')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + Math.min(24, r.height / 2) }
})
const nodePos = () => page.evaluate(() => {
  const n = window.MiniCanvasUI.getHost().nodeStore.getNodes()[0]
  return { x: Math.round(n.position.x), y: Math.round(n.position.y) }
})
const viewportPos = () => page.evaluate(() => window.MiniCanvasUI.getHost().viewport.getViewport())

// 移动态：拖节点，节点位置应改变
await page.click('button[aria-label="移动"]')
await page.waitForTimeout(250)
await page.click('button[role="menuitem"]:has-text("移动")')
await page.waitForTimeout(200)
let b = await nodeBox()
let p0 = await nodePos()
await page.mouse.move(b.x, b.y)
await page.mouse.down()
await page.mouse.move(b.x + 60, b.y + 40, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(250)
let p1 = await nodePos()
check('移动态：拖节点真的把节点拖走了', p0.x !== p1.x || p0.y !== p1.y, `${p0.x},${p0.y} -> ${p1.x},${p1.y}`)

// 抓手态：拖同样位置，节点不该动，视图应平移
await page.click('button[aria-label="移动"]')
await page.waitForTimeout(250)
await page.click('button[role="menuitem"]:has-text("抓手工具")')
await page.waitForTimeout(200)
b = await nodeBox()
p0 = await nodePos()
const v0 = await viewportPos()
await page.mouse.move(b.x, b.y)
await page.mouse.down()
await page.mouse.move(b.x + 60, b.y + 40, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(300)
p1 = await nodePos()
const v1 = await viewportPos()
check('抓手态：拖节点不会移动节点', p0.x === p1.x && p0.y === p1.y, `${p0.x},${p0.y} -> ${p1.x},${p1.y}`)
check('抓手态：拖的是画布（视图平移了）', Math.abs(v1.x - v0.x) > 5 || Math.abs(v1.y - v0.y) > 5, `vp ${Math.round(v0.x)},${Math.round(v0.y)} -> ${Math.round(v1.x)},${Math.round(v1.y)}`)
const paneCursor = await page.evaluate(() => {
  const pane = document.querySelector('.vue-flow__pane')
  return pane ? getComputedStyle(pane).cursor : ''
})
check('抓手态画布光标是 grab（看得见的手）', paneCursor === 'grab', paneCursor)
// 回到移动态，别影响后面的用例
await page.click('button[aria-label="移动"]')
await page.waitForTimeout(250)
await page.click('button[role="menuitem"]:has-text("移动")')
await page.waitForTimeout(200)

// 5) 小地图开关
const minimapVisible = () => page.evaluate(() => {
  const ctx = window.MiniCanvasUI.getHost().ctx
  return ctx.get('settings').get('miniMapVisible')
})
const mm0 = await minimapVisible()
await page.click('button[aria-label="切换小地图"]')
await page.waitForTimeout(300)
const mm1 = await minimapVisible()
check('小地图按钮切换 miniMapVisible', mm0 !== mm1, `${mm0} -> ${mm1}`)
const mmGone = await page.evaluate(() => !document.querySelector('.mini-map, [class*="mini-map"]'))
check('关掉后小地图浮层不在 DOM 里', mmGone)

// 6) 设置面板改 → 按钮图标跟着变（单一事实来源）
await page.evaluate(() => window.MiniCanvasUI.getHost().ctx.get('settings').set('edgeVisible', false))
await page.waitForTimeout(250)
const linkOffBtn = await page.locator('button[aria-label="显示节点连线"]').count()
check('设置面板改 edgeVisible 后，按钮图标变成「显示节点连线」（状态同源）', linkOffBtn === 1)

check('无页面异常', errors.length === 0, errors.slice(0, 3).join(' | '))

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
await browser.close()
process.exit(failed.length ? 1 : 0)
