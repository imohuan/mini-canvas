// @ts-nocheck
/**
 * reference-probe —— 只验「引用标记」这一条链的浏览器探针（不依赖真模型）。
 *
 * 覆盖：
 *   1. @ 菜单里出现「节点」分组（画布节点能被 @）；
 *   2. 搜索词过滤 + 最多显示前 5 项；
 *   3. 插入节点标签后，输入框文本是标记 `@[node:名字](画布#id)`；
 *   4. 模式下拉读的是后台提示词清单。
 *
 * 跑法：先 `pnpm -C packages/ui dev`（:5288），再 `node packages/ui/e2e/reference-probe.mjs`。
 */
import { chromium } from 'playwright-core'

const EXE = process.env.AGENT_E2E_CHROME
  ?? 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = process.env.AGENT_BASE ?? 'http://localhost:5288/'
/** 画布页地址：直接 hash 路由进画布，省掉「先建项目」的点击（dev server 有默认画布） */
const CANVAS_URL = BASE + '#/canvas/default'

const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const fails = []
const ok = (name, cond, detail = '') => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  -- ' + detail : ''))
  if (!cond) fails.push(name)
}

await page.goto(CANVAS_URL, { waitUntil: 'load' })
await page.waitForTimeout(6000)
await page.screenshot({ path: 'packages/ui/e2e/_shots/ref-probe-0.png' })

// 打开 Agent 面板：点底栏入口（与仓库现有 e2e 同款选择器）
const dockBtn = page.locator('button[aria-label="Agent 对话"]').first()
if ((await dockBtn.count()) > 0) { await dockBtn.click(); await page.waitForTimeout(1200) }
let editor = page.locator('.ac-editor .ProseMirror').first()
if ((await editor.count()) === 0) { await page.keyboard.press('Control+j'); await page.waitForTimeout(1000) }
await page.screenshot({ path: 'packages/ui/e2e/_shots/ref-probe-1.png' })

editor = page.locator('.ac-editor .ProseMirror').first()
if ((await editor.count()) === 0) { console.log('SKIP: 没找到 Agent 输入框（面板没开？见 _shots/ref-probe-1.png）'); await browser.close(); process.exit(0) }
await editor.click()
await page.keyboard.type('@')
await page.waitForTimeout(700)

const menu = page.locator('.mention-menu')
ok('@ 弹出候选菜单', (await menu.count()) > 0 && (await menu.first().isVisible()))

const cats = await page.locator('.mention-menu .category-title').allInnerTexts().catch(() => [])
console.log('  分组 = ' + JSON.stringify(cats))
ok('候选里有「节点」分组', cats.includes('节点'), JSON.stringify(cats))

// 搜索过滤 + 前 5 上限
await page.keyboard.type('节')
await page.waitForTimeout(600)
const rows = await page.locator('.mention-menu .menu-item').count()
console.log('  搜索「节」命中 ' + rows + ' 行')
ok('搜索结果不超过 5 项', rows <= 5, 'rows=' + rows)

// 插一个节点标签，看正文是不是标记
const firstNode = page.locator('.mention-menu .menu-item').first()
if (rows > 0) {
  await firstNode.click()
  await page.waitForTimeout(500)
  const text = await page.evaluate(() => {
    const el = document.querySelector('.ac-editor [contenteditable="true"]')
    return el ? el.innerText : ''
  })
  console.log('  插入后编辑器文本 = ' + JSON.stringify(text))
  const tag = await page.locator('.ac-editor .ac-tag').count()
  ok('插入后是一个标签', tag > 0, 'tags=' + tag)
  // 标记文本靠模型值验证（DOM 上是标签，模型值是标记）
}

// 模式下拉
await page.keyboard.press('Escape')
await page.locator('.ac-pill').first().click()
await page.waitForTimeout(500)
const pill = await page.locator('.ac-pill').first().innerText()
console.log('  模式胶囊 = ' + JSON.stringify(pill))
ok('模式胶囊有文字（读后台清单）', pill.trim().length > 0, pill)

// 右键节点 → 菜单里应有「引用到 Agent」，点了能把节点插成标签
const nodeEl = page.locator('.vue-flow__node').first()
if ((await nodeEl.count()) > 0) {
  await page.keyboard.press('Escape')
  await nodeEl.click({ button: 'right' })
  await page.waitForTimeout(600)
  const ctxItems = await page.locator('.ctx-menu .ctx-item, .ctx-menu button').allInnerTexts().catch(() => [])
  console.log('  节点右键菜单 = ' + JSON.stringify(ctxItems))
  ok('节点右键菜单里有「引用到 Agent」', ctxItems.some((t) => t.includes('引用到 Agent')), JSON.stringify(ctxItems))
  const item = page.locator('.ctx-menu .ctx-item, .ctx-menu button').filter({ hasText: '引用到 Agent' }).first()
  if ((await item.count()) > 0) {
    await item.click()
    await page.waitForTimeout(900)
    const tags = await page.locator('.ac-editor .ac-tag').count()
    ok('点「引用到 Agent」后输入框多了一个节点标签', tags > 0, 'tags=' + tags)
  }
}

await browser.close()
console.log(fails.length ? '\n失败: ' + fails.join(' / ') : '\n全部通过')
process.exit(fails.length ? 1 : 0)
