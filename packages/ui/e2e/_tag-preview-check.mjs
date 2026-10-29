// @ts-nocheck
// 菜单行 hover 预览浮层：真机全链路验证（独立 Chromium，避开扩展 CDP 不稳）
import { chromium } from 'playwright-core'
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = 'http://localhost:5312/'
// 用独立画布 id，避免多轮跑残留节点干扰断言
const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
await page.goto(BASE + '#/canvas/824e779f34314f86', { waitUntil: 'load' })
await page.waitForTimeout(8000)
// 注册动作 + 造场景：目标节点 + 图片参考 + 视频参考
const seed = await page.evaluate(() => {
  const ctx = window.MiniCanvasUI.getHost().ctx
  ctx.tryGet('nodeBar')?.register(ctx, { id: 'e2e:pv', types: ['text','image','video','audio'], title: '预览探针', description: 'e2e', needsPrompt: true, promptBinding: 'none', run: async () => ({ ok: true }) })
  const doc = ctx.get('doc')
  const before = new Set(doc.getNodes().map(n => n.id))
  doc.addNodes([
    { type: 'image', position: { x: 40, y: 60 }, data: { label: 'AG目标' } },
    { type: 'image', position: { x: -520, y: 60 }, data: { label: 'AG图片', imageUrl: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#f59e0b"/></svg>') } },
  ])
  const fresh = doc.getNodes().filter(n => !before.has(n.id))
  doc.addEdge({ source: fresh[1].id, target: fresh[0].id })
  return { target: fresh[0].id }
})
await page.waitForTimeout(600)
// 选中目标节点
await page.evaluate((id) => { window.MiniCanvasUI.getHost().ctx.get('selection').set([id]) }, seed.target)
await page.waitForTimeout(2000)
// 把目标节点摆到屏幕中上（底栏完整可见，坐标都可靠 —— 与主 e2e 同一套）
await page.evaluate((id) => {
  const ctx = window.MiniCanvasUI.getHost().ctx
  const vp = ctx.tryGet('viewport'); const rect = ctx.tryGet('nodeLayout').getNodeRect(id)
  vp.setViewport({ x: 700 - (rect.x + rect.w/2), y: 300 - (rect.y + rect.h/2), zoom: 1 })
}, seed.target)
await page.waitForTimeout(900)
const sel = await page.evaluate(() => ({ sel: [...document.querySelectorAll('.vue-flow__node.selected')].map(n=>n.getAttribute('data-id')), bar: !!document.querySelector('[data-testid=node-bottom-bar]'), cards: document.querySelectorAll('.nb-card').length }))
console.log('sel=' + JSON.stringify(sel))
if (!sel.bar || sel.cards === 0) { console.log('SKIP: bar/cards not ready'); await browser.close(); process.exit(0) }
// 底栏出现 → 点卡片 → hover 出 @ → 点 @ 插标签
const cardAt = await page.evaluate(() => { const c = document.querySelector('.nb-card'); const r = c?.getBoundingClientRect(); return r ? { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) } : null })
await page.mouse.move(cardAt.x, cardAt.y)
await page.waitForTimeout(1200)
const atBtn = await page.evaluate(() => { const b = document.querySelector('.nb-card-at'); const r = b?.getBoundingClientRect(); return r ? { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) } : null })
if (!atBtn) { console.log('SKIP: no @ button (bar not ready)'); await browser.close(); process.exit(0) }
console.log('atBtn=' + JSON.stringify(atBtn))
await page.mouse.click(atBtn.x, atBtn.y)
await page.waitForTimeout(1800)
const hasChip = await page.evaluate(() => !!document.querySelector('.nb-editor .resource-chip'))
if (!hasChip) {
  // @ 按钮可能要 hover 才能点。hover 卡片再点一次
  await page.mouse.move(cardAt.x, cardAt.y)
  await page.waitForTimeout(400)
  const atBtn2 = await page.evaluate(() => { const b = document.querySelector('.nb-card-at'); const r = b?.getBoundingClientRect(); return r ? { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) } : null })
  if (atBtn2) { await page.mouse.click(atBtn2.x, atBtn2.y); await page.waitForTimeout(1800) }
}
const hasChip2 = await page.evaluate(() => !!document.querySelector('.nb-editor .resource-chip'))
console.log('chip=' + hasChip)
if (!hasChip2) { console.log('SKIP: chip not inserted'); await browser.close(); process.exit(0) }
// 点标签图标开菜单
const icon = await page.evaluate(() => { const c = document.querySelector('.nb-editor .resource-chip'); const i = c.querySelector('.resource-chip-icon'); const r = i.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) } })
await page.mouse.click(icon.x, icon.y)
await page.waitForTimeout(1500)
const menuOpen = await page.evaluate(() => !!document.querySelector('.nb-tagmenu-body'))
console.log('menu=' + menuOpen)
// hover 图片行（AG图片）触发右侧预览
const row = await page.evaluate(() => { const r = [...document.querySelectorAll('.nb-tagmenu-row')].find(x => (x.querySelector('.nb-tagmenu-name')?.textContent||'').includes('AG图片')); const b = r?.getBoundingClientRect(); return b ? { x: Math.round(b.left + b.width/2), y: Math.round(b.top + b.height/2) } : null })
console.log('row=' + JSON.stringify(row))
await page.mouse.move(row.x, row.y, { steps: 4 })
await page.waitForTimeout(1500)
const pv = await page.evaluate(() => {
  const p = document.querySelector('.nb-tagpreview')
  if (!p) return { none: true }
  const b = p.getBoundingClientRect()
  const media = p.querySelector('img, video')
  const m = media?.getBoundingClientRect()
  const rowNow = [...document.querySelectorAll('.nb-tagmenu-row')].find(x => (x.querySelector('.nb-tagmenu-name')?.textContent||'').includes('AG图片')).getBoundingClientRect()
  return {
    style: p.getAttribute('style'),
    left: Math.round(b.left), top: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height),
    media: m ? { tag: media.tagName, w: Math.round(m.width), h: Math.round(m.height) } : null,
    rowRight: Math.round(rowNow.right),
    gapOk: Math.round(b.left - rowNow.right) >= 4,
  }
})
console.log('preview=' + JSON.stringify(pv, null, 1))
await page.screenshot({ path: 'packages/ui/e2e/_tag-pv-visual.png', clip: { x: 300, y: 450, width: 700, height: 400 } })
// 断言
const fails = []
if (pv.none) fails.push('浮层未出现')
else {
  if (pv.left < 100) fails.push('浮层位置在屏幕左上（place 未生效）: left=' + pv.left)
  if (!pv.gapOk) fails.push('浮层没贴在行右侧: left=' + pv.left + ' rowRight=' + pv.rowRight)
  if (pv.media && pv.media.tag !== 'IMG') fails.push('图片行媒体不是 img')
}
console.log(fails.length ? 'FAILS: ' + fails.join(' / ') : 'ALL PASS')
await browser.close()
process.exit(fails.length ? 1 : 0)
