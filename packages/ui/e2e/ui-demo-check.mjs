// @ts-nocheck
/**
 * ui-demo-check —— 「图片顶栏插槽 + 下拉按钮/二级菜单 + 同一根栏换内容」的真机回归。
 *
 * 用户口径（2026-10-29）：
 *  ① 顶栏按钮必须插在图片按钮组**内部**（不能是组外第二块面板）；
 *  ② 二级菜单必须是**独立浮层**（不在主面板内部叠一块）；
 *  ③ 进入功能模式只能有**一套**顶栏/底栏（同一根栏换内容，不叠加）。
 *
 * 跑法（packages/ui dev 已在 :5288 运行）：
 *   node packages/ui/e2e/ui-demo-check.mjs
 */
import { chromium } from 'playwright-core'
import { existsSync } from 'node:fs'

const EXE = process.env.CANVAS_E2E_CHROME
  ?? 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const PORT = process.env.CANVAS_PORT ?? 5288
const BASE = 'http://localhost:' + PORT + '/#/canvas/ui-demo'

if (!existsSync(EXE)) {
  console.error('chromium 不存在:', EXE)
  process.exit(2)
}

const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e.message).split('\n')[0]))

let failed = 0
function check(name, ok, detail = '') {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  -- ' + detail : ''))
  if (!ok) failed++
}

await page.goto(BASE, { waitUntil: 'load' })
await page.evaluate(() => { try { localStorage.clear() } catch {} })
await page.reload({ waitUntil: 'load' })
await page.waitForSelector('.vue-flow', { timeout: 30000 })
await page.waitForTimeout(1200)

// 建一个图片节点并选中（走公开命令，和用户点菜单同一条路）
const imageId = await page.evaluate(() => {
  const host = window.MiniCanvasUI.getHost()
  const svg = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#dbeafe"/></svg>')
  const id = host.command.execute('command:create-node', { type: 'image', position: { x: 200, y: 300 }, imageUrl: svg })
  host.selection.set([id])
  return String(id)
})
await page.waitForTimeout(1000)

const slot = await page.evaluate(() => {
  const s = [...document.querySelectorAll('.v2-slot--top')].find((el) => el.children.length > 0)
  if (!s) return null
  return [...s.children].map((el) => ({
    cls: (el.className || '').toString(),
    text: (el.textContent || '').trim(),
  }))
})
check('顶栏插槽只有一个容器（按钮组内部，不是组外第二块）', Array.isArray(slot) && slot.length === 1, JSON.stringify(slot))
check('演示按钮在图片按钮组内部（同一 flex 容器）', !!slot?.[0]?.text?.includes('功能演示'), JSON.stringify(slot))

// 打开下拉 + 二级
await page.getByRole('button', { name: '功能演示' }).first().click()
await page.waitForTimeout(400)
const main = await page.evaluate(() => {
  const m = document.querySelector('[data-toolbar-dropdown-menu="1"]')
  return m ? { rows: [...m.querySelectorAll('button')].map((b) => b.textContent.trim()) } : null
})
check('下拉面板有预设/更多/功能模式条目', !!main && main.rows.some((r) => r.startsWith('更多')) && main.rows.some((r) => r.includes('功能模式 A')), JSON.stringify(main))

await page.getByRole('menuitem', { name: '更多' }).first().hover()
await page.waitForTimeout(400)
const sub = await page.evaluate(() => {
  const s = document.querySelector('[data-toolbar-dropdown-sub="1"]')
  const m = document.querySelector('[data-toolbar-dropdown-menu="1"]')
  if (!s || !m) return null
  const sr = s.getBoundingClientRect()
  const mr = m.getBoundingClientRect()
  return {
    position: getComputedStyle(s).position,
    outsideMain: sr.left >= mr.right - 1,
    // 用户口径 2026-10-29：二级卡片要在主卡片**外面**，两卡片之间留固定间隔（不是贴死/压住）
    gapPx: Math.round(sr.left - mr.right),
    ownPanel: s.classList.contains('tdb-sub'),
    rows: [...s.querySelectorAll('button')].map((b) => b.textContent.trim()),
  }
})
check('二级菜单是独立浮层（position:fixed 且在主面板右侧之外）', !!sub && sub.position === 'fixed' && sub.outsideMain, JSON.stringify(sub))
check('二级菜单与主菜单之间留有明显间隔（12px 定稿）', !!sub && sub.gapPx >= 10 && sub.gapPx <= 15, JSON.stringify(sub))
check('二级菜单有自己的面板与子项', !!sub && sub.ownPanel && sub.rows.includes('子项 1'), JSON.stringify(sub))

// 进入功能模式
await page.getByRole('menuitem', { name: '进入功能模式 A' }).first().click()
await page.waitForTimeout(900)

const mode = await page.evaluate(() => {
  const tops = [...document.querySelectorAll('.v2-slot--top')].filter((el) => el.children.length > 0)
  const bars = [...document.querySelectorAll('[data-testid="node-bottom-bar"]')]
  const feature = document.querySelector('[data-testid="demo-feature-panel"]')
  const legacyTop = !!document.querySelector('[data-testid="demo-top-panel"]')
  return {
    topContainers: tops.length,
    topText: tops.map((t) => (t.textContent || '').trim()),
    bottomBars: bars.length,
    bottomText: bars.map((b) => (b.textContent || '').trim().slice(0, 60)),
    feature: !!feature,
    legacyTop,
    topIsDefault: tops.some((t) => t.querySelector('.it-root') !== null),
  }
})
check('功能模式只有一套顶栏', mode.topContainers === 1, JSON.stringify(mode))
check('顶栏内是功能自己的按钮（不是额外一层）', !!mode.topText?.[0]?.includes('演示功能 A') && !mode.legacyTop, JSON.stringify(mode.topText))
check('功能模式只有一套底栏', mode.bottomBars === 1, JSON.stringify(mode))
check('底栏内容换成功能 panel（不是叠加默认生成 UI）', mode.feature === true, JSON.stringify(mode.bottomText))
check('默认生成 UI 已让位（没有参考/标记输入区）', !mode.bottomText?.[0]?.includes('参考'), JSON.stringify(mode.bottomText))

// 退出
await page.getByRole('button', { name: '退出' }).first().click()
await page.waitForTimeout(700)
const after = await page.evaluate(() => ({
  feature: !!document.querySelector('[data-testid="demo-feature-panel"]'),
  topText: ([...document.querySelectorAll('.v2-slot--top')].find((el) => el.children.length > 0)?.textContent || '').trim(),
  bars: document.querySelectorAll('[data-testid="node-bottom-bar"]').length,
}))
check('退出后回到普通工具栏', after.topText.includes('功能演示') && !after.feature, JSON.stringify(after))
check('退出后底栏恢复正常', after.bars === 1, JSON.stringify(after))

check('控制台无 pageerror', errors.length === 0, errors.join(' | '))

await browser.close()
console.log(failed === 0 ? '\nALL PASS' : '\nFAILED ' + failed)
process.exit(failed === 0 ? 0 : 1)

