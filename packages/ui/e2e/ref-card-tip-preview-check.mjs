// @ts-nocheck
/**
 * 参考卡片的三个视觉问题（用户 2026-10-29 截图）：
 *   ① 卡片圆角没了；
 *   ② hover 时预览图在上、Tooltip 在下 —— 两个浮层不许互相遮挡；
 *   ③ 卡片底部的名称条盖住了右下角 @ 按钮。
 *
 * 跑法：先起 ui dev（:5288），再 node packages/ui/e2e/ref-card-tip-preview-check.mjs
 */
import { chromium } from 'playwright-core'

const EXE = process.env.AGENT_E2E_CHROME
  ?? 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = process.env.AGENT_BASE ?? 'http://localhost:5299/'
const CANVAS = BASE + '#/canvas/824e779f34314f86'
const SHOT = 'packages/ui/e2e/_ref-card-tip.png'

const fails = []
const ok = (name, cond, detail = '') => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  -- ' + detail : ''))
  if (!cond) fails.push(name)
}

const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

await page.goto(CANVAS, { waitUntil: 'load' })
await page.waitForTimeout(6500)

const seed = await page.evaluate(() => {
  const host = window.MiniCanvasUI?.getHost?.()
  const doc = host?.ctx?.get?.('doc')
  if (!doc) return { error: 'no doc' }
  const before = new Set(doc.getNodes().map((n) => n.id))
  doc.addNodes([
    { type: 'video', position: { x: 160, y: 160 }, data: { label: '探针-目标' } },
    { type: 'image', position: { x: 0, y: 0 }, data: { label: '天空之城', imageUrl: 'data:image/png;base64,iVBORw0KGgo=' } },
    { type: 'text', position: { x: 0, y: 360 }, data: { label: '角色设定', text: '设定' } },
  ])
  const fresh = doc.getNodes().filter((n) => !before.has(n.id))
  const [target, ...ups] = fresh
  for (const up of ups) doc.addEdge({ source: up.id, target: target.id })
  host.ctx.get('selection')?.set?.([target.id])
  return { target: target.id }
})
if (seed.error) {
  console.log('SKIP: ' + JSON.stringify(seed))
  await browser.close()
  process.exit(0)
}
await page.waitForTimeout(2000)
if (errors.length) console.log('页面报错 = ' + JSON.stringify(errors.slice(0, 8), null, 1))
const livePos = await page.evaluate((id) => {
  const node = document.querySelector('.vue-flow__node[data-id="' + id + '"]') ?? document.querySelector('[data-id="' + id + '"]')
  if (!node) return { missing: true, nodes: [...document.querySelectorAll('.vue-flow__node')].map((n) => n.getAttribute('data-id')) }
  const r = node.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }
}, seed.target)
console.log('目标节点位置 = ' + JSON.stringify(livePos))
const barState = await page.evaluate(() => ({
  shell: document.querySelectorAll('.nb-shell').length,
  cards: document.querySelectorAll('.nb-card').length,
  tiles: document.querySelectorAll('[data-tile-key]').length,
  edges: (() => {
    const host = window.MiniCanvasUI?.getHost?.()
    const doc = host?.ctx?.get?.('doc')
    try { return doc?.getEdges?.().length ?? null } catch { return null }
  })(),
}))
console.log('底栏状态 = ' + JSON.stringify(barState))

/**
 * 选中靠**真鼠标点节点**：拖动视口把节点挪到屏幕中间再点。
 * （dev 页面不挂 window.MiniCanvasUI，只能用 DOM。）
 */
const targetPos = await page.evaluate((id) => {
  const el = document.querySelector('.vue-flow__node[data-id="' + id + '"]')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}, seed.target)
if (!targetPos) {
  console.log('SKIP: 找不到目标节点元素')
  await browser.close()
  process.exit(0)
}
await page.mouse.click(targetPos.x, targetPos.y)
await page.waitForTimeout(1800)

/** 底栏可能在屏幕外：先推进视口，保证鼠标能真实落上去 */
await page.evaluate(() => {
  const host = window.MiniCanvasUI?.getHost?.()
  const vp = host?.ctx?.tryGet?.('viewport') ?? host?.ctx?.get?.('viewport')
  const box = document.querySelector('.nb-shell .nb-root')?.getBoundingClientRect()
  if (!vp?.setViewport || !box) return
  const overflow = box.bottom - (window.innerHeight - 40)
  if (overflow > 0) {
    const cur = vp.getViewport?.() ?? { x: 0, y: 0, zoom: 1 }
    vp.setViewport({ x: cur.x, y: cur.y - overflow, zoom: cur.zoom ?? 1 })
  }
})
await page.waitForTimeout(800)

// ① 圆角：卡片的四个角在视觉上是圆的（读内层裁剪层的实际圆角）
const radii = await page.evaluate(() =>
  [...document.querySelectorAll('.nb-shell .nb-card')].map((card) => {
    const clip = card.querySelector('.nb-card-clip')
    const cs = clip ? getComputedStyle(clip) : null
    return {
      name: card.getAttribute('data-tile-name'),
      cardRadius: getComputedStyle(card).borderTopLeftRadius,
      clipRadius: cs?.borderTopLeftRadius ?? null,
    }
  }),
)
console.log('圆角 = ' + JSON.stringify(radii))
ok(
  '卡片与内层裁剪都是 8px 圆角（不再被 Tooltip 外壳吃掉）',
  radii.length > 0 && radii.every((r) => r.cardRadius === '8px' && r.clipRadius === '8px'),
  JSON.stringify(radii),
)

const cardBox = await page.evaluate(() => {
  const el = document.querySelector('.nb-shell .nb-card')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom }
})
if (!cardBox) {
  console.log('SKIP: 底栏没渲染出来')
  await browser.close()
  process.exit(0)
}

await page.mouse.move(cardBox.x, cardBox.y)
await page.waitForTimeout(1400) // 600ms 预览 + Tooltip 220ms，都出来了

const layers = await page.evaluate(() => {
  const box = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }
  }
  const bubble = document.querySelector('.tlt-bubble')
  return {
    preview: box('.nb-hover-preview'),
    tip: box('.tlt-bubble'),
    tipText: bubble?.textContent?.trim() ?? null,
    cardBottom: Math.round(document.querySelector('.nb-shell .nb-card').getBoundingClientRect().bottom),
    cardTop: Math.round(document.querySelector('.nb-shell .nb-card').getBoundingClientRect().top),
    namebars: document.querySelectorAll('.nb-card-namebar').length,
    atVisible: (() => {
      const at = document.querySelector('.nb-card .nb-card-at')
      if (!at) return null
      const r = at.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), hit: hit?.className ?? null, own: at === hit || at.contains(hit) }
    })(),
  }
})
console.log('浮层 = ' + JSON.stringify(layers))

ok('hover 预览弹在卡片上方', !!layers.preview && layers.preview.bottom <= layers.cardTop, JSON.stringify(layers.preview))
ok('Tooltip 气泡弹在卡片下方（与预览一上一下）', !!layers.tip && layers.tip.top >= layers.cardBottom, JSON.stringify(layers.tip))
ok('两个浮层不重叠', !!layers.preview && !!layers.tip && layers.preview.bottom <= layers.tip.top, 'preview.bottom=' + layers.preview?.bottom + ' tip.top=' + layers.tip?.top)
ok('卡片底部不再渲染名称条', layers.namebars === 0, 'count=' + layers.namebars)
ok('hover 时 @ 按钮在命中层最上面（没被任何东西挡）', !!layers.atVisible && layers.atVisible.own === true, JSON.stringify(layers.atVisible))

await page.screenshot({ path: SHOT })
console.log('截图 = ' + SHOT)

await browser.close()
console.log(fails.length === 0 ? '通过' : '失败：' + fails.join(' / '))
process.exit(fails.length === 0 ? 0 : 1)
