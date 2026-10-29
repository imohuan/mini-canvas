/**
 * 参考卡片的三个视觉问题（用户 2026-10-29 截图）—— 真机探针（脚本内造样本，不依赖某张画布已有内容）：
 *   ① 卡片圆角在（包了主题 Tooltip 之后曾被吃掉）；
 *   ② hover 时预览图在卡片**上方**、气泡在**下方**，两者不重叠；
 *   ③ 卡片底部不再有名称条，hover 时右下角 @ 按钮不被任何东西挡住、字是白的；
 *   ④ 单击卡片不进全屏、双击把视口聚焦到节点。
 *
 * 跑法：先起 ui dev（:5288），再 node packages/ui/e2e/ref-card-tip-preview-check.mjs
 */
import { chromium } from 'playwright-core'

const EXE = process.env.AGENT_E2E_CHROME
  ?? 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = process.env.AGENT_BASE ?? 'http://localhost:5288/'
const SHOT = 'packages/ui/e2e/_ref-card-tip.png'

const fails = []
const ok = (name, cond, detail = '') => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  -- ' + detail : ''))
  if (!cond) fails.push(name)
}

/** 生成一张带文字的示例图（data URL） */
function sampleImage(text) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320">'
    + '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
    + '<stop offset="0" stop-color="#38bdf8"/><stop offset="1" stop-color="#a855f7"/>'
    + '</linearGradient></defs>'
    + '<rect width="480" height="320" fill="url(#g)"/>'
    + '<circle cx="240" cy="150" r="76" fill="#fff" opacity="0.9"/>'
    + '<text x="240" y="160" font-size="30" font-family="sans-serif" fill="#1f2937" text-anchor="middle">' + text + '</text>'
    + '</svg>'
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')
}

const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)))

await page.goto(BASE + '#/canvas/824e779f34314f86', { waitUntil: 'load' })
await page.waitForTimeout(6500)

const seed = await page.evaluate((img) => {
  const host = window.MiniCanvasUI?.getHost?.()
  const doc = host?.ctx?.get?.('doc')
  if (!doc) return { error: 'no doc' }
  const before = new Set(doc.getNodes().map((n) => n.id))
  doc.addNodes([
    { type: 'image', position: { x: 240, y: 120 }, data: { label: '探针-目标' } },
    { type: 'image', position: { x: -420, y: 120 }, data: { label: '场景:天空之城', imageUrl: img } },
  ])
  const fresh = doc.getNodes().filter((n) => !before.has(n.id))
  const [target, up] = fresh
  if (!target || !up) return { error: 'addNodes failed' }
  doc.addEdge({ source: up.id, target: target.id })
  return { target: target.id, up: up.id, total: doc.getNodes().length }
}, sampleImage('sky'))
if (seed.error) {
  console.log('SKIP: ' + JSON.stringify(seed) + ' / ' + errors.join(' | '))
  await browser.close()
  process.exit(0)
}
await page.waitForTimeout(1600)

// 选中目标：点可见的节点元素（selection.set 对刚加的节点不生效）
const tp = await page.evaluate((id) => {
  const el = document.querySelector('.vue-flow__node[data-id="' + id + '"]')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
}, seed.target)
if (!tp) {
  console.log('SKIP: 找不到目标节点 / ' + JSON.stringify(await page.evaluate(() => ({
    nodes: [...document.querySelectorAll('.vue-flow__node')].map((n) => n.getAttribute('data-id')),
    bar: document.querySelectorAll('.nb-shell').length,
    host: typeof window.MiniCanvasUI,
  }))))
  await browser.close()
  process.exit(0)
}
await page.mouse.click(tp.x, tp.y)
await page.waitForTimeout(3200)
console.log('底栏 = ' + JSON.stringify(await page.evaluate(() => ({
  shell: document.querySelectorAll('.nb-shell').length,
  cards: [...document.querySelectorAll('.nb-card')].map((c) => c.getAttribute('data-tile-name')),
  barText: document.querySelector('.nb-root')?.textContent?.slice(0, 80) ?? null,
}))))

const radii = await page.evaluate(() =>
  [...document.querySelectorAll('.nb-shell .nb-card')].map((card) => {
    const clip = card.querySelector('.nb-card-clip')
    return {
      name: card.getAttribute('data-tile-name'),
      cardRadius: getComputedStyle(card).borderTopLeftRadius,
      clipRadius: clip ? getComputedStyle(clip).borderTopLeftRadius : null,
    }
  }),
)
console.log('圆角 = ' + JSON.stringify(radii))
ok('卡片与内层裁剪都是 8px 圆角', radii.length > 0 && radii.every((r) => r.cardRadius === '8px' && r.clipRadius === '8px'), JSON.stringify(radii))

const cardBox = await page.evaluate(() => {
  const el = document.querySelector('.nb-shell .nb-card')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
})
if (!cardBox) { console.log('SKIP: 卡片没渲染'); await browser.close(); process.exit(0) }

await page.mouse.move(cardBox.x - 200, cardBox.y, { steps: 5 })
await page.mouse.move(cardBox.x, cardBox.y, { steps: 8 })
await page.waitForTimeout(2000)

const layers = await page.evaluate(() => {
  const bx = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }
  }
  const at = document.querySelector('.nb-card .nb-card-at')
  let atHit = null
  if (at) {
    const r = at.getBoundingClientRect()
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    atHit = el ? (at === el || at.contains(el)) : null
  }
  const cs = at ? getComputedStyle(at) : null
  return {
    card: bx('.nb-card'),
    preview: bx('.nb-hover-preview'),
    tip: bx('.tlt-bubble'),
    tipText: document.querySelector('.tlt-bubble')?.textContent?.trim() ?? null,
    namebars: document.querySelectorAll('.nb-card-namebar').length,
    atHit,
    atColor: cs?.color ?? null,
    atOpacity: cs?.opacity ?? null,
  }
})
console.log('浮层 = ' + JSON.stringify(layers))
ok('hover 预览弹在卡片上方', !!layers.preview && !!layers.card && layers.preview.bottom <= layers.card.top, JSON.stringify(layers.preview))
ok('Tooltip 气泡弹在卡片下方', !!layers.tip && !!layers.card && layers.tip.top >= layers.card.bottom, JSON.stringify(layers.tip))
ok('两个浮层不重叠', !!layers.preview && !!layers.tip && layers.preview.bottom <= layers.tip.top, 'preview.bottom=' + layers.preview?.bottom + ' tip.top=' + layers.tip?.top)
ok('卡片底部不再渲染名称条', layers.namebars === 0, String(layers.namebars))
ok('hover 时 @ 按钮在命中层最上面', layers.atHit === true, String(layers.atHit))
ok('@ 按钮字是白的（不是主题面板色）', layers.atColor === 'rgb(255, 255, 255)', String(layers.atColor))

await page.screenshot({ path: SHOT })
console.log('截图 = ' + SHOT)

// ④ 单击不进全屏、双击聚焦
const paneBefore = await page.evaluate(() => document.querySelector('.vue-flow__transformationpane')?.getAttribute('style') ?? null)
await page.mouse.click(cardBox.x, cardBox.y)
await page.waitForTimeout(600)
const afterClick = await page.evaluate(() => ({
  viewer: document.querySelectorAll('.mv-stage').length,
  pane: document.querySelector('.vue-flow__transformationpane')?.getAttribute('style') ?? null,
}))
ok('单击卡片不进全屏', afterClick.viewer === 0, String(afterClick.viewer))
ok('单击不移动画布', afterClick.pane === paneBefore, afterClick.pane + ' vs ' + paneBefore)

await page.mouse.click(cardBox.x, cardBox.y)
await page.mouse.dblclick(cardBox.x, cardBox.y)
await page.waitForTimeout(900)
const afterDbl = await page.evaluate(() => ({
  pane: document.querySelector('.vue-flow__transformationpane')?.getAttribute('style') ?? null,
  viewer: document.querySelectorAll('.mv-stage').length,
}))
ok('双击卡片把视口聚焦到节点（画布位移变了）', afterDbl.pane !== paneBefore, afterDbl.pane + ' vs ' + paneBefore)
ok('双击也不进全屏', afterDbl.viewer === 0, String(afterDbl.viewer))

await browser.close()
console.log(fails.length === 0 ? '通过' : '失败：' + fails.join(' / '))
process.exit(fails.length === 0 ? 0 : 1)







