// @ts-nocheck
/**
 * 参考卡片视觉/交互探针（用户 2026-10-29 的反馈）。
 *
 * 断言：
 *   1. 关闭按钮真能断开连线（卡片随之消失）；
 *   2. 图片/音频/文本**没有**右下角类型角标（只有视频有）；
 *   3. 图片卡片不再出现空白方块；
 *
 * 跑法：先起 ui dev（:5288），再 node packages/ui/e2e/ref-card-visual-probe.mjs
 */
import { chromium } from 'playwright-core'

const EXE = process.env.AGENT_E2E_CHROME
  ?? 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = process.env.AGENT_BASE ?? 'http://localhost:5288/'
const CANVAS = BASE + '#/canvas/824e779f34314f86'

const fails = []
const ok = (name, cond, detail = '') => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  -- ' + detail : ''))
  if (!cond) fails.push(name)
}

const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })

await page.goto(CANVAS, { waitUntil: 'load' })
await page.waitForTimeout(6500)

const info = await page.evaluate(() => {
  const host = window.MiniCanvasUI?.getHost?.()
  const doc = host?.ctx?.get?.('doc')
  if (!doc) return { error: 'no doc' }
  const before = new Set(doc.getNodes().map((n) => n.id))
  doc.addNodes([
    { type: 'video', position: { x: 200, y: 200 }, data: { label: '探针-视觉目标' } },
    { type: 'image', position: { x: 0, y: 0 }, data: { label: '天空之城', imageUrl: 'data:image/png;base64,iVBORw0KGgo=' } },
    { type: 'audio', position: { x: 0, y: 200 }, data: { label: '雨声', audioUrl: 'data:audio/mp3;base64,AAAA' } },
    { type: 'text', position: { x: 0, y: 400 }, data: { label: '角色设定', text: '设定' } },
  ])
  const fresh = doc.getNodes().filter((n) => !before.has(n.id))
  const target = fresh[0]
  const ups = fresh.slice(1)
  for (const up of ups) doc.addEdge({ source: up.id, target: target.id })
  host.ctx.get('selection')?.set?.([target.id])
  return { target: target.id, ids: ups.map((n) => n.id) }
})
if (info.error) {
  console.log('SKIP: ' + JSON.stringify(info))
  await browser.close()
  process.exit(0)
}
console.log('样本 = ' + JSON.stringify(info))
await page.waitForTimeout(2500)

const badges = await page.evaluate(() =>
  [...document.querySelectorAll('.nb-shell [data-tile-key]')].map((el) => ({
    name: el.getAttribute('data-tile-name'),
    kindBadges: [...el.querySelectorAll('.nb-card-kind')].map((b) => b.getAttribute('data-kind')),
    fallbacks: [...el.querySelectorAll('.nb-card-fallback')].map((b) => b.getAttribute('data-kind')),
    placeholders: [...el.querySelectorAll('.nb-card-placeholder')].map((b) => b.getAttribute('data-kind')),
  })),
)
console.log('卡片角标 = ' + JSON.stringify(badges))
ok(
  '图片/音频/文本卡片没有右下角类型角标',
  badges.every((b) => b.kindBadges.every((k) => k === 'video')),
  JSON.stringify(badges),
)
ok(
  '图片卡片没有空白方块',
  badges.every((b) => !b.kindBadges.includes('image') && !b.fallbacks.includes('image') && !b.placeholders.includes('image')),
)

const before = await page.locator('.nb-shell [data-tile-key]').count()
// 先把底栏挪进视口（节点在画布下方时按钮落在屏幕外，真实鼠标点不到）
await page.evaluate(() => {
  const host = window.MiniCanvasUI?.getHost?.()
  const vp = host?.view
  const box = document.querySelector('.nb-shell .nb-root')?.getBoundingClientRect()
  if (!vp?.setViewport || !box) return
  const overflow = box.bottom - (window.innerHeight - 30)
  if (overflow > 0) {
    const cur = vp.getViewport?.() ?? { x: 0, y: 0, zoom: 1 }
    vp.setViewport({ x: cur.x, y: cur.y - overflow, zoom: cur.zoom ?? 1 })
  }
})
await page.waitForTimeout(600)
/**
 * 真机点击关闭按钮。用户报的是「点不动」——所以这里用真实 pointer 事件序列，
 * 不是合成 click（合成 click 绕过了浏览器的 pointerdown → click 链路，测不出问题）。
 */
const btnBox = await page.evaluate(() => {
  const btn = document.querySelector('.nb-shell .nb-card .nb-remove')
  if (!btn) return null
  btn.style.opacity = '1'
  btn.style.pointerEvents = 'auto'
  const r = btn.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})
if (btnBox) {
  await page.mouse.move(btnBox.x, btnBox.y)
  await page.mouse.down()
  await page.mouse.up()
}
await page.waitForTimeout(1400)
const after = await page.locator('.nb-shell [data-tile-key]').count()
ok('关闭按钮能断开连线（卡片减少）', after === before - 1, 'before=' + before + ' after=' + after)

await browser.close()
console.log(fails.length === 0 ? '通过' : '失败：' + fails.join(' / '))
process.exit(fails.length === 0 ? 0 : 1)
