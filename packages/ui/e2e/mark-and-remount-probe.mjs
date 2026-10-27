// @ts-nocheck
/**
 * mark-and-remount-probe —— 验「文本不自动转标签 / 点标记才转 / 重开底栏标签还在」。
 *
 * 用户口径（2026-10-27）：
 *   ① 输入框里打字**只是文字**，@ 符号本身不解析（避免输入 @图片1 时菜单被"自动选中"）；
 *   ② 只有点「标记」按钮，才把认得出的 @图片N 转成素材标签；
 *   ③ 收起再打开底栏，标签还是标签（不会退回成 @图片1 文字），
 *      参考区也不会因为那串文字凭空长出第 N 格空槽。
 *
 * 跑法：先起服务（8865），再 node packages/ui/e2e/mark-and-remount-probe.mjs
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
await page.evaluate(() => {
  const doc = window.MiniCanvasUI?.getHost?.()?.ctx?.get?.('doc')
  if (doc && !doc.getNodes().some((n) => n.type === 'image')) {
    doc.addNodes([{ id: 'probe-image-1', type: 'image', position: { x: 100, y: 120 }, data: {} }])
  }
})
await page.waitForTimeout(1200)
const node = page.locator('.vue-flow__node-image').first()
const nb = await node.boundingBox()
await page.mouse.click(nb.x + nb.width / 2, nb.y + 24)
await page.waitForTimeout(1300)

const read = () => page.evaluate(() => {
  const ed = document.querySelector('.nb-shell .ProseMirror')
  return {
    chips: [...ed.querySelectorAll('.resource-chip')].map((c) => c.getAttribute('data-name')),
    text: (ed.textContent || '').replace(/\u200B/g, ''),
    tileKeys: [...document.querySelectorAll('.nb-shell [data-tile-key]')].map((t) => t.getAttribute('data-tile-key')),
  }
})

const editor = page.locator('.nb-shell .ProseMirror').first()
ok('底栏输入框出现', (await editor.count()) > 0)
if ((await editor.count()) === 0) { await browser.close(); process.exit(1) }
await editor.click()
await page.keyboard.press('Control+a')
await page.keyboard.press('Backspace')
await page.waitForTimeout(300)

await page.keyboard.type('@图片1 和 @图片2 ')
await page.waitForTimeout(900)
const typed = await read()
ok('打字时只是文字（不自动转标签）', typed.chips.length === 0, JSON.stringify(typed))

await page.click('[data-testid="bar-mark"]')
await page.waitForTimeout(900)
const marked = await read()
ok('点「标记」后转成标签', marked.chips.length === 2, JSON.stringify(marked))
ok('参考区出现两个待输入槽位', marked.tileKeys.length === 2, JSON.stringify(marked.tileKeys))

await page.mouse.click(1250, 800)
await page.waitForTimeout(1000)
await page.mouse.click(nb.x + nb.width / 2, nb.y + 24)
await page.waitForTimeout(1500)
const reopened = await read()
ok('重开底栏后标签还在（没退回文字）', reopened.chips.length === 2, JSON.stringify(reopened))
ok('重开后槽位数量不变（没凭空长空槽）', reopened.tileKeys.length === 2, JSON.stringify(reopened.tileKeys))

await page.screenshot({ path: 'packages/ui/e2e/_shots/mark-and-remount.png' })
await browser.close()
if (fails.length) { console.log('失败项：' + JSON.stringify(fails)); process.exit(1) }
console.log('全部通过')

