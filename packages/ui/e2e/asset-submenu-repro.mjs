// @ts-nocheck
/**
 * asset-submenu-repro —— 「嵌套菜单点不动」的真机回归（真实鼠标 + 真实点击）。
 *
 * 2026-10-07 事故：二级菜单（移动到 / 更改图标）能展开，但点下去什么也不发生。
 * 根因：二级菜单面板 teleport 到 body，父级下拉的 click-outside（vueuse，window capture 阶段）
 *   只认自己的触发器 + 面板 → 点在二级菜单项上被判「点了外面」→ 父菜单先关、二级面板随父卸载
 *   → click 派发时目标已脱离文档，Vue 的 click 回调不再执行。
 * 修复：浮层写 data-floating-chain（父链 + 自己），点外判定认「整组」（见 hooks/floatingGroup.ts）。
 *
 * 用法：
 *   ASSET_BASE=http://localhost:5291 node packages/ui/e2e/asset-submenu-repro.mjs
 * 断言：点二级菜单的「新建文件夹」后，必须发出一次 PATCH /api/asset-folders/<id>（真动作），
 *       且菜单关掉 —— 修复前这两条都失败。
 */
import { chromium } from 'playwright-core'
import { existsSync } from 'node:fs'

const EXE = process.env.CANVAS_E2E_CHROME
  ?? 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = process.env.ASSET_BASE ?? 'http://127.0.0.1:8865'
const CANVAS_ID = process.env.CANVAS_ID ?? '430c8f1f00bd4aba'
if (!existsSync(EXE)) { console.error('chromium 不存在:', EXE); process.exit(2) }

// vite dev server 可能只监听 ::1 → 统一用 localhost
const origin = (() => {
  try { const u = new URL(BASE); if (u.hostname === '127.0.0.1') u.hostname = 'localhost'; return u.origin }
  catch { return BASE.replace(/\/+$/, '') }
})()

const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
const log = (...a) => console.log('[submenu]', ...a)
page.on('pageerror', (e) => log('pageerror:', String(e.message).slice(0, 200)))

const folderPatches = []
page.on('request', (r) => {
  if (r.method() === 'PATCH' && /\/api\/asset-folders\//.test(r.url())) folderPatches.push(r.url())
})

await page.goto(`${origin}/#/canvas/${CANVAS_ID}`, { waitUntil: 'load' })
await page.waitForTimeout(3000)
await page.getByRole('button', { name: '资产管理' }).first().click()
await page.waitForTimeout(700)
await page.getByRole('tab', { name: '资产' }).click()
await page.waitForTimeout(1200)

const drawer = page.locator('.left-drawer')
// 文件夹行（不是资产行：文件夹行才有「更改图标」）
const folderRow = drawer.locator('[data-asset-row][data-row-kind=folder]').first()
await folderRow.click({ button: 'right' })
await page.waitForTimeout(500)

const menu = page.locator('.dd-menu').last()
const items = await menu.locator('.ax-menu-item').allInnerTexts()
log('右键菜单 =', JSON.stringify(items))

// 悬停「移动到」→ 二级菜单
const moveRow = menu.locator('.ax-sub-row', { hasText: '移动到' }).first()
await moveRow.hover()
await page.waitForTimeout(600)
const sub = page.locator('.dd-menu.ax-sub-menu').last()
const subItems = await sub.locator('.ax-menu-item').allInnerTexts()
log('二级菜单 =', JSON.stringify(subItems))

// 真实鼠标：从行移到二级项（会经过中间空隙），再点
const target = sub.locator('.ax-menu-item').first()
const box = await target.boundingBox()
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 })
await page.waitForTimeout(300)
const stillOpen = await page.locator('.dd-menu.ax-sub-menu').count()
const before = folderPatches.length
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
await page.waitForTimeout(1000)
const fired = folderPatches.length > before
const menusLeft = await page.locator('.dd-menu').count()

log('移到二级项时菜单仍开 =', stillOpen > 0)
log('点击后发出 PATCH /api/asset-folders =', fired)
log('点击后残留浮层 =', menusLeft)
log(fired && stillOpen > 0 && menusLeft === 0 ? 'RESULT: PASS（二级菜单点得动）' : 'RESULT: FAIL（嵌套菜单仍然点不动）')

await browser.close()
process.exit(fired ? 0 : 1)

