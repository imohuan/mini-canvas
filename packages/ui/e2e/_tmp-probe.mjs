// @ts-nocheck
import { chromium } from 'playwright-core'
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = 'http://localhost:5301/'
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="480" height="320" fill="#7dd3fc"/></svg>'
const img = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')
const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
page.on('pageerror', (e) => console.log('PAGEERROR ' + e))
await page.goto(BASE + '#/canvas/824e779f34314f86', { waitUntil: 'load' })
await page.waitForTimeout(6500)
const seed = await page.evaluate((imgUrl) => {
  const ctx = window.MiniCanvasUI?.getHost?.()?.ctx
  const doc = ctx?.get?.('doc')
  if (!doc) return { error: 'no doc' }
  const before = new Set(doc.getNodes().map((n) => n.id))
  doc.addNodes([
    { type: 'image', position: { x: 40, y: 60 }, data: { label: '目标图片' } },
    { type: 'image', position: { x: -520, y: 60 }, data: { label: '人物肖像保护', imageUrl: imgUrl } },
  ])
  const fresh = doc.getNodes().filter((n) => !before.has(n.id))
  const [target, imgA] = fresh
  doc.addEdge({ source: imgA.id, target: target.id })
  return { target: target.id, img: imgA.id }
}, img)
console.log('seed ' + JSON.stringify(seed))
await page.waitForTimeout(1000)
await page.evaluate(() => {
  const ctx = window.MiniCanvasUI?.getHost?.()?.ctx
  ctx?.tryGet?.('nodeBar')?.register(ctx, {
    id: 'probe:compose', types: ['text','image'], title: '探针生成', description: '探针', needsPrompt: true, promptBinding: 'none', run: async () => ({ ok: true }),
  })
})
await page.waitForTimeout(500)
const tpos = await page.evaluate((id) => {
  const n = document.querySelector('.vue-flow__node[data-id="' + id + '"]')
  const r = n.getBoundingClientRect()
  return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }
}, seed.target)
await page.mouse.click(tpos.x, tpos.y)
await page.waitForTimeout(1500)
await page.evaluate((id) => {
  const ctx = window.MiniCanvasUI?.getHost?.()?.ctx
  const vp = ctx?.tryGet?.('viewport')
  const layout = ctx?.tryGet?.('nodeLayout')
  const rect = layout?.getNodeRect?.(id)
  if (vp && rect) vp.setViewport({ x: 800 - (rect.x + rect.w / 2) * 1, y: 400 - (rect.y + rect.h / 2) * 1, zoom: 1 })
}, seed.target)
await page.waitForTimeout(900)
const st = await page.evaluate(() => {
  const root = document.querySelector('[data-testid="node-bottom-bar"]')
  const inst = root?.__vueParentComponent
  return {
    hasRoot: !!root,
    inst: !!inst,
    setupKeys: inst ? Object.keys(inst.setupState || {}).slice(0, 40) : null,
    editorVal: inst?.setupState?.editorComponentRef ? Object.keys(inst.setupState.editorComponentRef).slice(0,10) : null,
    editorEl: root?.querySelector('.nb-editor .ProseMirror') ? 'yes' : 'no',
  }
})
console.log('state ' + JSON.stringify(st))
const cardPos = await page.evaluate(() => {
  const el = document.querySelector('.nb-card')
  const r = el.getBoundingClientRect()
  return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }
})
await page.mouse.move(cardPos.x, cardPos.y, { steps: 5 })
await page.waitForTimeout(700)
const atInfo = await page.evaluate(() => {
  const at = document.querySelector('.nb-card .nb-card-at')
  const r = at.getBoundingClientRect()
  const cx = r.left + r.width/2, cy = r.top + r.height/2
  const hit = document.elementFromPoint(cx, cy)
  return { rect: {x:cx,y:cy,w:r.width,h:r.height}, hit: hit ? (hit.className || hit.tagName) : null, atOpacity: getComputedStyle(at).opacity, pe: getComputedStyle(at).pointerEvents }
})
console.log('at ' + JSON.stringify(atInfo))
await page.mouse.click(atInfo.rect.x, atInfo.rect.y)
await page.waitForTimeout(1000)
console.log('chips ' + await page.evaluate(() => document.querySelectorAll('.nb-editor .resource-chip').length))
console.log('editorText ' + await page.evaluate(() => document.querySelector('.nb-editor .ProseMirror')?.textContent?.slice(0,80)))
await browser.close()

