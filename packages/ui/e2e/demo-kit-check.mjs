// @ts-nocheck
/**
 * demo-kit-check —— 四套开发演示合并成一个插件后的真机回归。
 *
 * 合并前它们各有一条 e2e（shell-slots-demo-check / ui-demo-check）。合并后装一次 demo-kit，
 * 至少要能证明：**四套演示都还在，且装/卸是一次性的**。
 *
 * 跑法（packages/ui dev 或 cloud-server 已在运行）：
 *   node packages/ui/e2e/demo-kit-check.mjs
 */
import { chromium } from 'playwright-core'
import { existsSync } from 'node:fs'

const EXE = process.env.CANVAS_E2E_CHROME
  ?? 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const PORT = process.env.CANVAS_PORT ?? 8865
const BASE = 'http://localhost:' + PORT + '/#/canvas/default'

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
await page.waitForSelector('.vue-flow', { timeout: 30000 })
await page.waitForTimeout(1200)

// 装一次 demo-kit：产物是 **UMD**（不是自包含 ESM），所以要走 <script> 全局那条路 ——
// 与「设置 → 插件」的 plugin-manager 完全同款。直接 manager.install({url}) 会当成 ESM 文本读，
// 报「单文件插件需导出 name」。（这条曾把 e2e 自己坑过一次。）
const installed = await page.evaluate(async () => {
  const w = /** @type {any} */ (window)
  const ctx = w.PlumeUI?.getContext?.()
  const manager = w.PlumeUI?.getHost?.()?.manager
  if (!ctx || !manager) return { ok: false, why: 'no host.manager' }
  await new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = '/plugins/plugin-demo-kit/plugin-demo-kit.js'
    el.onload = resolve
    el.onerror = () => reject(new Error('script load failed'))
    document.head.appendChild(el)
  })
  const mod = w.PlumePluginDemoKit
  if (!mod?.name) return { ok: false, why: 'no UMD global' }
  await manager.install(mod)
  return { ok: ctx.listPlugins().includes('demo-kit'), names: ctx.listPlugins() }
})
check('装一次 demo-kit 成功', installed.ok === true, JSON.stringify(installed))

await page.waitForTimeout(1200)

// 四套演示各自的痕迹（任一缺失就说明合并时漏搬了）
const marks = await page.evaluate(() => ({
  hotReload: !!document.querySelector('[data-testid="demo-kit-hot-reload-card"]'),
  shellStatus: !!document.querySelector('.shell-status [data-testid="ssd-status"]'),
  shellDock: !!document.querySelector('.shell-dock [data-testid="ssd-dock-end"]'),
  galleryButton: [...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').includes('组件展厅')),
}))
check('热重载靶子卡片在（并清掉了调试残留）', marks.hotReload === true, JSON.stringify(marks))
check('外壳插槽：状态条徽章', marks.shellStatus === true, JSON.stringify(marks))
check('外壳插槽：底栏按钮', marks.shellDock === true, JSON.stringify(marks))
check('组件展厅入口在', marks.galleryButton === true, JSON.stringify(marks))

// 卸载一次 = 四套一起消失（这是合并最大的收益）
await page.evaluate(async () => {
  await window.PlumeUI.getHost()?.manager.uninstall('demo-kit')
})
await page.waitForTimeout(600)
const after = await page.evaluate(() => ({
  hotReload: !!document.querySelector('[data-testid="demo-kit-hot-reload-card"]'),
  shellStatus: !!document.querySelector('[data-testid="ssd-status"]'),
  shellDock: !!document.querySelector('[data-testid="ssd-dock-end"]'),
  plugins: window.PlumeUI.getContext().listPlugins(),
}))
check('卸载一次四套演示全消失', !after.hotReload && !after.shellStatus && !after.shellDock, JSON.stringify(after))
check('plugin 列表里已无 demo-kit', !after.plugins.includes('demo-kit'), JSON.stringify(after.plugins))
check('零 pageerror', errors.length === 0, errors.join(' | '))

await browser.close()
console.log(failed === 0 ? '\nALL PASS' : '\nFAILED ' + failed)
process.exit(failed === 0 ? 0 : 1)
