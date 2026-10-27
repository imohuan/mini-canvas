// @ts-nocheck
/**
 * mention-menu-typing-probe —— 验「@ 菜单开着时打数字不自动转换、不自动选中」。
 *
 * 用户口径（2026-10-27）：输入 @图片 时弹菜单；继续打数字（比如 图片1）只是**过滤**，
 * 菜单留在原地；按回车（或点击）才把选项插进正文。曾经的毛病：数字一敲完，文字被
 * 槽位插件提前转成标签，菜单关闭 —— 视觉上像"菜单自动选了图片1"。
 *
 * 跑法：先起服务（8865），再 node packages/ui/e2e/mention-menu-typing-probe.mjs
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
    doc.addNodes([{ id: 'probe-image-1', type: 'image', position: { x: 120, y: 140 }, data: {} }])
  }
})
await page.waitForTimeout(1200)
const node = page.locator('.vue-flow__node-image').first()
const nb = await node.boundingBox()
await page.mouse.click(nb.x + nb.width / 2, nb.y + 24)
await page.waitForTimeout(1200)

const editor = page.locator('.nb-shell .ProseMirror').first()
ok('底栏输入框出现', (await editor.count()) > 0)
if ((await editor.count()) === 0) { await browser.close(); process.exit(1) }

await editor.click()
await page.evaluate(() => { window.__probeSlot = [] })
await page.evaluate(() => { window.__probeSlotEnter = [] })
await page.evaluate(() => { window.__probeExtRestore = [] })
await page.evaluate(() => { window.__probeMenuSeq = [] })
await page.keyboard.press('Control+a')
await page.keyboard.press('Backspace')
await page.waitForTimeout(300)

// 记录插入瞬间：chip 出现时的时刻与菜单状态
await page.evaluate(() => {
  window.__chipObserver = new MutationObserver(() => {
    window.__chipEvents = window.__chipEvents || []
    window.__chipEvents.push({
      t: Math.round(performance.now()),
      menuVisible: !!document.querySelector('.mention-menu')?.style?.display !== 'none',
      menuDisplay: document.querySelector('.mention-menu')?.style?.display,
      edSel: document.querySelector('.nb-shell .ProseMirror')?.textContent?.slice(0, 24),
    })
  })
  window.__chipObserver.observe(document.querySelector('.nb-shell .ProseMirror'), { childList: true, subtree: true })
})

const menuCount = () => page.locator('.mention-menu').count()
const chipCount = () => page.locator('.nb-shell .resource-chip').count()

// 1) 输入 @图片 → 菜单出现
await page.keyboard.type('@图片')
await page.waitForTimeout(700)
ok('输入 @图片 弹出菜单', (await menuCount()) > 0)
ok('输入 @图片 时尚未转成标签', (await chipCount()) === 0, 'chips=' + (await chipCount()))

// 2) 继续打数字 → 菜单仍在、没有被自动转换
await page.keyboard.type('1')
await page.waitForTimeout(700)
console.log('  槽位探针 = ' + JSON.stringify(await page.evaluate(() => window.__probeSlot ?? null)))
console.log('  插件进入 = ' + JSON.stringify(await page.evaluate(() => window.__probeSlotEnter ?? null)))
console.log('  外部恢复 = ' + JSON.stringify(await page.evaluate(() => window.__probeExtRestore ?? null), null, 1))
console.log('  菜单序列 = ' + JSON.stringify(await page.evaluate(() => window.__probeMenuSeq ?? null)))
ok('打数字后菜单仍在（没有被自动"选中"）', (await menuCount()) > 0)
ok('打数字后没有自动转成标签', (await chipCount()) === 0, 'chips=' + (await chipCount()))
console.log('  chip 事件 = ' + JSON.stringify(await page.evaluate(() => window.__chipEvents ?? null)))

// 3) 按回车 → 才插入
await page.keyboard.press('Enter')
await page.waitForTimeout(700)
const chipsAfterEnter = await chipCount()
ok('回车后才转成标签', chipsAfterEnter >= 1, 'chips=' + chipsAfterEnter)
const text = await editor.textContent()
ok('正文包含图片1', /图片1/.test(text ?? ''), 'text=' + JSON.stringify((text ?? '').slice(0, 60)))

await page.screenshot({ path: 'packages/ui/e2e/_shots/mention-menu-typing.png' })
await browser.close()
if (fails.length) { console.log('失败项：' + JSON.stringify(fails)); process.exit(1) }
console.log('全部通过')

