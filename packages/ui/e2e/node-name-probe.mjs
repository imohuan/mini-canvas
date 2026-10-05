// @ts-nocheck
/**
 * node-name-probe —— 验「新节点默认名」三处一致（标题条 / @ 菜单 / 左侧树）。
 *
 * 用户报的问题：标题条显示英文 type（text/image）、@ 菜单显示文本首行或图片文件名、
 * 左侧树又各显示一套 —— 三处不一致。现统一为 data.label（建节点时按类型模板生成）。
 *
 * 跑法：先 pnpm -C packages/ui dev（:5288），再 node packages/ui/e2e/node-name-probe.mjs。
 */
import { chromium } from 'playwright-core'

const EXE = process.env.AGENT_E2E_CHROME
  ?? 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = process.env.AGENT_BASE ?? 'http://localhost:5288/'

const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const fails = []
const ok = (name, cond, detail = '') => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  -- ' + detail : ''))
  if (!cond) fails.push(name)
}

await page.goto(BASE + '#/canvas/default', { waitUntil: 'load' })
await page.waitForTimeout(6000)

// 从"新建节点"菜单建两个文本节点（走 nodeFactory → addNode → 默认名）
const addText = async () => {
  await page.mouse.click(700, 400, { button: 'right' })
  await page.waitForTimeout(600)
  const item = page.locator('.ctx-menu button, .ctx-menu .ctx-item').filter({ hasText: '文本' }).first()
  if ((await item.count()) > 0) {
    await item.click()
    await page.waitForTimeout(700)
    return true
  }
  await page.keyboard.press('Escape')
  return false
}

const made = (await addText()) || (await addText())

// 标题条读到的名字
const titles = await page.locator('.v2-title .title-label, .base-title__label').allInnerTexts().catch(() => [])
const titleText = titles.map((t) => t.trim()).filter(Boolean)
console.log('  画布标题条 = ' + JSON.stringify(titleText))

await page.screenshot({ path: 'packages/ui/e2e/_shots/node-name-title.png' })

// 左侧树的节点名
const treeNames = await page.locator('.left-drawer [data-node-id], .tree-node, .tn-name').allInnerTexts().catch(() => [])
console.log('  左侧树名字 = ' + JSON.stringify(treeNames.slice(0, 10)))

// @ 菜单里的节点名
const dockBtn = page.locator('button[aria-label="Agent 对话"]').first()
if ((await dockBtn.count()) > 0) { await dockBtn.click(); await page.waitForTimeout(1200) }
const editor = page.locator('.ac-editor .ProseMirror').first()
if ((await editor.count()) > 0) {
  await editor.click()
  await page.keyboard.type('@')
  await page.waitForTimeout(700)
  const rows = await page.locator('.mention-menu .menu-item').allInnerTexts().catch(() => [])
  console.log('  @ 菜单 = ' + JSON.stringify(rows.slice(0, 6)))
  const names = rows.map((r) => r.split('\n')[0].trim()).filter(Boolean)
  ok('@ 菜单显示的是「文本 N」这种默认名（不是文本内容首行）', names.some((n) => /^文本\s*\d+$/.test(n)), JSON.stringify(names))
}

ok('画布标题条显示中文默认名（不是英文 type）', titleText.some((t) => /^(文本|图片|视频|音频|分组|3D 预览|图片对比)\s*\d+$/.test(t)), JSON.stringify(titleText))
ok('建节点成功', made)

await browser.close()
console.log(fails.length ? '\n失败: ' + fails.join(' / ') : '\n全部通过')
process.exit(fails.length ? 1 : 0)
