// @ts-nocheck
/**
 * mark-normalize-probe —— 复现/验证三个问题（用户 2026-10-28 截图）：
 *   ① 点「标记」后正文出现 图片100 这种序号（归一化没生效？）；
 *   ② 某些标签缩略图是空白（应该是图标或图）；
 *   ③ 粘贴图片后没有在光标处插入标签。
 *
 * 跑法：先起独立端口服务（8012），再
 *   AGENT_BASE=http://127.0.0.1:8012/ node packages/ui/e2e/mark-normalize-probe.mjs
 */
import { chromium } from 'playwright-core'

const EXE = process.env.AGENT_E2E_CHROME
  ?? 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = process.env.AGENT_BASE ?? 'http://127.0.0.1:8012/'
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

await page.evaluate(() => {
  document.title = '[DEBUG 标记归一化] mini-canvas'
  const doc = window.MiniCanvasUI?.getHost?.()?.ctx?.get?.('doc')
  if (doc && !doc.getNodes().some((n) => n.type === 'image')) {
    doc.addNodes([{ id: 'mk-probe-1', type: 'image', position: { x: 120, y: 140 }, data: {} }])
  }
})
await page.waitForTimeout(1200)

const node = page.locator('.vue-flow__node-image').first()
const nb = await node.boundingBox()
await page.mouse.click(nb.x + nb.width / 2, nb.y + 24)
await page.waitForTimeout(1300)

const editor = page.locator('.nb-shell .ProseMirror').first()
ok('底栏输入框出现', (await editor.count()) > 0)
if ((await editor.count()) === 0) { await browser.close(); process.exit(1) }
await editor.click()
await page.keyboard.press('Control+a')
await page.keyboard.press('Backspace')
await page.waitForTimeout(300)

const read = () => page.evaluate(() => {
  const ed = document.querySelector('.nb-shell .ProseMirror')
  return {
    chips: [...ed.querySelectorAll('.resource-chip')].map((c) => ({
      name: c.getAttribute('data-name'),
      id: c.getAttribute('data-id'),
      state: c.className.includes('is-pending') ? 'pending' : 'filled',
      thumb: c.querySelector('.resource-chip-thumb') ? 'img' : (c.querySelector('.resource-chip-icon') ? 'icon' : 'none'),
    })),
    text: (ed.textContent || '').replace(/\u200B/g, ''),
  }
})

await page.keyboard.type('@图片1 和 @图片100 和 @图片10 ')
await page.waitForTimeout(900)
await page.click('[data-testid="bar-mark"]')
await page.waitForTimeout(1200)
const marked = await read()
console.log('标记后 = ' + JSON.stringify(marked, null, 1))
ok('① 归一化：没有 图片100 这种序号', !marked.chips.some((c) => /100/.test(c.name ?? '')), JSON.stringify(marked.chips.map((c) => c.name)))
ok('② 每颗标签都有图标或缩略图', marked.chips.every((c) => c.thumb !== 'none'), JSON.stringify(marked.chips.map((c) => [c.name, c.thumb])))

await page.keyboard.press('Control+End')
await page.evaluate(() => {
  const ed = document.querySelector('.nb-shell .ProseMirror')
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0))
  const file = new File([bytes], 'paste-norm.png', { type: 'image/png' })
  const dt = new DataTransfer()
  dt.items.add(file)
  ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
})
await page.waitForTimeout(3500)
const after = await read()
console.log('粘贴后 = ' + JSON.stringify(after, null, 1))
console.log('pasteDbg = ' + JSON.stringify(await page.evaluate(() => window.__pasteDbg ?? null)))
console.log('tiles = ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.nb-shell [data-tile-key]')].map((t) => t.getAttribute('data-tile-key')))))
ok('③ 粘贴后出现新标签', after.chips.length > marked.chips.length, JSON.stringify(after.chips.map((c) => c.name)))
ok('③ 粘贴的标签带图标/缩略图', after.chips.every((c) => c.thumb !== 'none'), JSON.stringify(after.chips.map((c) => [c.name, c.thumb])))

await page.screenshot({ path: 'packages/ui/e2e/_shots/mark-normalize.png' })
await browser.close()
if (fails.length) { console.log('失败项：' + JSON.stringify(fails)); process.exit(1) }
console.log('全部通过')

