// @ts-nocheck
/**
 * paste-image-probe —— 验「输入框粘贴图片 = 建节点 + 连线 + 插标签」。
 *
 * 用户口径（2026-10-27）：粘贴图片应和点击上传走同一条路，三步缺一不可。
 * 组件只负责把文件交给插件（onPasteFiles），插件负责建节点/连线/回填标签。
 *
 * 跑法：先起服务（8865），再 node packages/ui/e2e/paste-image-probe.mjs
 */
import { chromium } from 'playwright-core'

const EXE = process.env.AGENT_E2E_CHROME
  ?? 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = process.env.AGENT_BASE ?? 'http://127.0.0.1:8865/'
const CANVAS_URL = BASE + '#/canvas/default'

const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
const fails = []
const ok = (name, cond, detail = '') => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  -- ' + detail : ''))
  if (!cond) fails.push(name)
}

await page.goto(CANVAS_URL, { waitUntil: 'load' })
await page.waitForTimeout(5000)

// 造一个图片节点作为「本节点」
await page.evaluate(() => {
  const doc = window.MiniCanvasUI?.getHost?.()?.ctx?.get('doc')
  if (doc && !doc.getNodes().some((n) => n.type === 'image')) {
    doc.addNodes([{ id: 'paste-probe-target', type: 'image', position: { x: 200, y: 200 }, data: {} }])
  }
})
await page.waitForTimeout(1200)

const node = page.locator('.vue-flow__node-image').first()
const nb = await node.boundingBox()
await page.mouse.click(nb.x + nb.width / 2, nb.y + 24)
await page.waitForTimeout(1400)

const editor = page.locator('.nb-shell .ProseMirror').first()
ok('底栏输入框出现', (await editor.count()) > 0)
if ((await editor.count()) === 0) { await browser.close(); process.exit(1) }
await editor.click()
await page.waitForTimeout(300)

const before = await page.evaluate(() => {
  const doc = window.MiniCanvasUI.getHost().ctx.get('doc')
  return { nodes: doc.getNodes().length, edges: (doc.getEdges?.() ?? []).length }
})

// 向编辑器派发带 File 的 paste 事件（模拟复制图片后 Ctrl+V）
await page.evaluate(() => {
  const ed = document.querySelector('.nb-shell .ProseMirror')
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0))
  const file = new File([bytes], 'paste-probe.png', { type: 'image/png' })
  const dt = new DataTransfer()
  dt.items.add(file)
  ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
})
await page.waitForTimeout(3500)

const after = await page.evaluate(() => {
  const doc = window.MiniCanvasUI.getHost().ctx.get('doc')
  const ed = document.querySelector('.nb-shell .ProseMirror')
  return {
    nodes: doc.getNodes().length,
    edges: (doc.getEdges?.() ?? []).length,
    chips: [...(ed?.querySelectorAll('.resource-chip') ?? [])].map((c) => c.getAttribute('data-name')),
    tiles: [...document.querySelectorAll('.nb-shell [data-tile-key]')].map((t) => t.getAttribute('data-tile-key')),
  }
})

ok('粘贴后新建了节点', after.nodes === before.nodes + 1, JSON.stringify({ before, after }))
ok('粘贴后创建了连线', after.edges === before.edges + 1, JSON.stringify({ before, after }))
ok('粘贴后输入框出现标签', after.chips.length >= 1, JSON.stringify(after.chips))
ok('粘贴后参考区出现该格', after.tiles.length >= 1, JSON.stringify(after.tiles))

await page.screenshot({ path: 'packages/ui/e2e/_shots/paste-image.png' })
await browser.close()
if (fails.length) { console.log('失败项：' + JSON.stringify(fails)); process.exit(1) }
console.log('全部通过')

