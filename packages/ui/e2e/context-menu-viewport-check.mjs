// @ts-nocheck
/**
 * context-menu-viewport-check —— 右键菜单 / 二级菜单不得出屏的回归（真实 Chromium）。
 *
 * 用户口径（2026-10-27 截图）：
 *   ① 主菜单与小屏底部完全重合，没有任何间隔；菜单本身要留出内部 padding，
 *      并且整个面板必须待在可视区域内、与边缘保持距离；
 *   ② 二级菜单直接弹到屏幕外（主栏右侧没空间时不翻转）。
 *
 * 跑法（需 packages/ui dev 已在 :5288 运行）：
 *   node packages/ui/e2e/context-menu-viewport-check.mjs
 *
 * 断言的是**真实渲染几何**：每一个 .ctx-menu 面板的四条边都要落在视口内，
 * 且离视口边缘至少 GAP 像素。修复前主菜单底部出屏、二级菜单右侧出屏，两条都红。
 */
import { chromium } from 'playwright-core'
import { existsSync } from 'node:fs'

const EXE = process.env.CANVAS_E2E_CHROME
  ?? 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = `http://localhost:${process.env.CANVAS_PORT ?? 5288}/#/canvas/default`
const GAP = 8

if (!existsSync(EXE)) { console.error('chromium 不存在:', EXE); process.exit(2) }

const VIEWPORTS = [
  { width: 1024, height: 640 },
  { width: 900, height: 600 },
  { width: 1440, height: 900 },
  // 长菜单：窗口矮到主菜单超过可用高度时，面板必须在**自己内部**滚动，不能撑出屏幕
  { width: 1024, height: 460 },
  // 窄到两侧都放不下二级菜单：仍不得出现整块跑出屏幕
  { width: 560, height: 640 },
]

const browser = await chromium.launch({ executablePath: EXE, headless: true })
let failed = 0

async function check(viewport) {
  const page = await browser.newPage({ viewport })
  const log = (...a) => console.log(`[ctx-menu ${viewport.width}x${viewport.height}]`, ...a)
  page.on('pageerror', (e) => log('pageerror:', String(e.message).slice(0, 200)))

  await page.goto(BASE, { waitUntil: 'load' })
  // 等画布真正挂载（首屏冷启动可能超过固定等待；右键落在空白面板上才有效）
  await page.waitForSelector('.vue-flow', { timeout: 30000 })
  await page.waitForTimeout(1200)

  // 右下角空白处右键：用户截图里出问题的位置（菜单没地方往下长）。
  // 排除底栏/状态条/节点，避免右键被别的元素吃掉。
  const anchor = await page.evaluate(({ w, h }) => {
    for (let y = h - 70; y > h * 0.35; y -= 12) {
      for (let x = w - 30; x > w * 0.4; x -= 12) {
        const el = document.elementFromPoint(x, y)
        if (!el) continue
        if (el.closest('.shell-dock, .shell-status, .shell-topbar')) continue
        if (!el.closest('.vue-flow')) continue
        if (el.closest('.vue-flow__node, .vue-flow__edge')) continue
        return { x, y }
      }
    }
    return null
  }, { w: viewport.width, h: viewport.height })
  if (!anchor) {
    log('FAIL 找不到可右键的空白画布')
    failed++
    await page.close()
    return
  }
  await page.mouse.click(anchor.x, anchor.y, { button: 'right' })
  await page.waitForTimeout(500)

  const main = page.locator('.ctx-menu:not(.ctx-submenu)')
  if (await main.count() === 0) {
    log('FAIL 右键没有弹出菜单')
    failed++
    await page.close()
    return
  }
  const mainBox = await main.boundingBox()
  log('主菜单 box =', JSON.stringify(mainBox))

  // 主菜单必须整块在视口内，并留 GAP 间隔
  const mainOk = mainBox
    && mainBox.x >= GAP - 0.5
    && mainBox.y >= GAP - 0.5
    && mainBox.x + mainBox.width <= viewport.width - GAP + 0.5
    && mainBox.y + mainBox.height <= viewport.height - GAP + 0.5
  if (!mainOk) {
    log(`FAIL 主菜单出屏或贴边：bottom=${mainBox ? Math.round(mainBox.y + mainBox.height) : '?'} / vh=${viewport.height}`)
    failed++
  } else {
    log('PASS 主菜单在视口内且留出间隔')
  }

  // 内边距：菜单行不贴着卡片圆角/边框（用户口径：设置一些内部的 padding）
  const padding = await main.evaluate((el) => {
    const s = getComputedStyle(el)
    return { top: parseFloat(s.paddingTop), right: parseFloat(s.paddingRight), bottom: parseFloat(s.paddingBottom), left: parseFloat(s.paddingLeft) }
  })
  const paddingOk = padding.top >= 8 && padding.right >= 8 && padding.bottom >= 8 && padding.left >= 8
  if (!paddingOk) {
    log('FAIL 菜单内部 padding 不足：', JSON.stringify(padding))
    failed++
  } else {
    log('PASS 菜单内部 padding =', JSON.stringify(padding))
  }

  // 内容放不下时：面板自身可滚，且滚动范围藏在面板内部（不把页面/画布顶出滚动条）
  const scrollable = await main.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    overflowY: getComputedStyle(el).overflowY,
  }))
  const needsScroll = scrollable.scrollHeight > scrollable.clientHeight + 1
  const canScroll = /auto|scroll/.test(scrollable.overflowY)
  if (needsScroll && !canScroll) {
    log('FAIL 菜单内容被裁掉且不能滚动：', JSON.stringify(scrollable))
    failed++
  } else if (mainBox && mainBox.height > viewport.height - GAP * 2 + 0.5) {
    log('FAIL 菜单高度撑出视口：', JSON.stringify(scrollable))
    failed++
  } else {
    log(needsScroll ? 'PASS 长菜单在面板内部滚动' : 'PASS 菜单无需滚动')
  }

  // 悬停「节点包」入口行 → 二级菜单
  const subTrigger = main.locator('.ctx-menu-item[aria-haspopup="menu"]', { hasText: '节点包' }).first()
  if (await subTrigger.count() === 0) {
    log('SKIP 当前菜单没有二级入口（节点包插件未装？）')
    await page.close()
    return
  }
  await subTrigger.hover()
  await page.waitForTimeout(600)

  const sub = page.locator('.ctx-menu.ctx-submenu')
  if (await sub.count() === 0) {
    log('FAIL 悬停「节点包」没有展开二级菜单')
    failed++
    await page.close()
    return
  }
  const subBox = await sub.boundingBox()
  log('二级菜单 box =', JSON.stringify(subBox))
  const subOk = subBox
    && subBox.x >= GAP - 0.5
    && subBox.y >= GAP - 0.5
    && subBox.x + subBox.width <= viewport.width - GAP + 0.5
    && subBox.y + subBox.height <= viewport.height - GAP + 0.5
  if (!subOk) {
    log(`FAIL 二级菜单出屏：right=${subBox ? Math.round(subBox.x + subBox.width) : '?'} / vw=${viewport.width}`)
    failed++
  } else {
    log('PASS 二级菜单在视口内')
  }

  await page.close()
}

for (const vp of VIEWPORTS) await check(vp)
await browser.close()
console.log(failed === 0 ? 'RESULT: PASS' : `RESULT: FAIL（${failed} 项）`)
process.exit(failed === 0 ? 0 : 1)
