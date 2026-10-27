// @ts-nocheck
/**
 * shell-slots-demo-check —— 演示插件（plugin-shell-slots-demo）的真实浏览器回归。
 *
 * 与 shell-slots-check（window 手动注册）不同：这条走**真插件装载链路**——
 * 用 dev server 的 catalog 找到 dist 产物 → ctx.get('pluginManager').install({ url })
 * → 断言三类外壳槽（状态条 / 底栏 / 左抽屉页签）都渲染出来 → 卸载 → 全部消失。
 */
import { chromium } from 'playwright-core'
import { existsSync } from 'node:fs'

const EXE = process.env.CANVAS_E2E_CHROME
  ?? 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const PORT = process.env.CANVAS_PORT ?? 8014
const BASE = 'http://localhost:' + PORT + '/#/canvas/shell-slots-demo'

if (!existsSync(EXE)) {
  console.error('chromium 不存在:', EXE)
  process.exit(2)
}

const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e.message)))

let failed = 0
function check(name, ok, detail = '') {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  -- ' + detail : ''))
  if (!ok) failed++
}

await page.goto(BASE, { waitUntil: 'load' })
await page.evaluate(() => { try { localStorage.clear() } catch {} })
await page.reload({ waitUntil: 'load' })
await page.waitForSelector('.vue-flow', { timeout: 30000 })
await page.waitForTimeout(800)

// 1) 经统一安装句柄装演示插件（自包含 ESM 产物，走 fetch → data:URL import）
const installed = await page.evaluate(async () => {
  const ctx = window.MiniCanvasUI.getContext()
  const manager = ctx.get('pluginManager')
  if (!manager) return { ok: false, why: 'no pluginManager' }
  // 组件内取 ctx 优先 Provider inject；自包含包与宿主是两份模块实例、inject 命中不了，
  // 此时兜底 window.MiniCanvasUI.getContext()（与 Provider provide 的是同一个 ctx 对象）。
  await manager.install({ url: '/plugins/plugin-shell-slots-demo/plugin-shell-slots-demo.esm.js' })
  return { ok: ctx.listPlugins().includes('shell-slots-demo') }
})
check('经 pluginManager 安装 shell-slots-demo（ESM 产物）', installed.ok === true, JSON.stringify(installed))

// 2) 三处外壳 UI 出现
await page.waitForSelector('[data-testid="ssd-status"]', { timeout: 10000 })
await page.waitForSelector('[data-testid="ssd-dock-end"]', { timeout: 10000 })
check('状态条出现演示徽章', (await page.locator('.shell-status [data-testid="ssd-status"]').count()) === 1)
check('底栏出现演示按钮', (await page.locator('.shell-dock [data-testid="ssd-dock-end"]').count()) === 1)

// 3) 打开抽屉 → 演示页签在页签行 → 点它出现正文面板
await page.getByRole('button', { name: '资产管理' }).first().click()
await page.waitForSelector('.left-drawer', { timeout: 5000 })
// 抽屉是 0.25s 滑入动画（motion-v），等它完全到位再断言/点击，避免“元素在视口外”。
await page.waitForTimeout(450)
check('页签行出现演示页签', (await page.locator('.left-drawer [data-testid="ssd-drawer-tab"]').count()) === 1)
// 多选 overlay 层（csurface-overlay-item）在画布 z 上压着抽屉页签行，Playwright 的
// 命中判定会被它干扰；实测用手动 MouseEvent 最稳（debug 脚本确认面板会出现）。
await page.evaluate(() => {
  const el = document.querySelector('.left-drawer [data-testid="ssd-drawer-tab"]')
  if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
})
await page.waitForTimeout(700)
check('点演示页签后出现演示面板', (await page.locator('[data-testid="ssd-drawer-panel"]').count()) === 1)

// 4) 面板里的 host 窄接口可用：关闭抽屉按钮真的能关
await page.evaluate(() => {
  const btn = [...(document.querySelectorAll('[data-testid="ssd-drawer-panel"] button') ?? [])]
    .find((b) => (b.textContent ?? '').includes('关闭抽屉'))
  if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
})
await page.waitForTimeout(400)
check('面板里「关闭抽屉」生效', (await page.locator('.left-drawer').count()) === 0)

// 5) 底栏按钮经 shell:open-drawer 命令再开抽屉（不依赖 window 全局）
await page.locator('[data-testid="ssd-dock-end"]').click()
await page.waitForSelector('.left-drawer', { timeout: 5000 })
check('底栏演示按钮经命令打开抽屉', (await page.locator('.left-drawer').count()) === 1)

// 6) 卸载插件 → 三处演示 UI 全部消失；若当前页签是它则回画布
await page.evaluate(async () => {
  const ctx = window.MiniCanvasUI.getContext()
  const manager = ctx.get('pluginManager')
  await manager.uninstall('shell-slots-demo')
})
await page.waitForTimeout(500)
check('卸载后状态条徽章消失', (await page.locator('[data-testid="ssd-status"]').count()) === 0)
check('卸载后底栏按钮消失', (await page.locator('[data-testid="ssd-dock-end"]').count()) === 0)
check('卸载后演示页签消失', (await page.locator('[data-testid="ssd-drawer-tab"]').count()) === 0)
check('卸载后当前页签回画布', (await page.locator('.left-drawer [role=tab][aria-selected=true]').innerText()).includes('画布'))
check('零 pageerror', errors.length === 0, errors.join(' | '))

await browser.close()
process.exit(failed ? 1 : 0)
