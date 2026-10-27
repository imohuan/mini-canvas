// @ts-nocheck
/**
 * shell-slots-check —— 三块外壳插槽 + 左抽屉插件页签的真实浏览器回归。
 *
 * 用户口径（2026-10-27）：状态条、底栏、左抽屉都要能插；抽屉页签要能切、
 * 能回退、不能留空白。这里用 window.MiniCanvasUI 的 ctx.slots 直接登记测试组件，
 * 抓的是真实 DOM 位置与 aria 状态，不碰源码字符串。
 *
 * 跑法（需 packages/ui dev 已在 :5288 运行）：
 *   node packages/ui/e2e/shell-slots-check.mjs
 */
import { chromium } from 'playwright-core'
import { existsSync } from 'node:fs'

const EXE = process.env.CANVAS_E2E_CHROME
  ?? 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = 'http://localhost:' + (process.env.CANVAS_PORT ?? 5288) + '/#/canvas/shell-slots'

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

const registered = await page.evaluate(() => {
  const Vue = window.Vue
  const ctx = window.MiniCanvasUI.getContext()
  if (!Vue || !ctx) return false

  const button = (text) => ({
    render() {
      return Vue.h('button', { 'data-e2e-slot': text, type: 'button' }, text)
    },
  })

  ctx.slots.register('shell.status.end', { id: 'e2e-status', component: button('STATUS') })
  ctx.slots.register('shell.dock.end', { id: 'e2e-dock', component: button('DOCK') })

  const Tab = {
    props: ['active', 'onSelect'],
    render() {
      return Vue.h('button', {
        type: 'button',
        role: 'tab',
        'aria-selected': String(this.active),
        'data-e2e-slot': 'DRAWER_TAB',
        onClick: () => this.onSelect(),
      }, 'DRAWER_TAB')
    },
  }
  const Panel = {
    render() {
      return Vue.h('div', { 'data-e2e-slot': 'DRAWER_PANEL' }, 'DRAWER_PANEL')
    },
  }
  ctx.slots.register('shell.drawer.tabs', {
    id: 'e2e-tab',
    component: Tab,
    meta: { title: 'E2E 页签', panel: Panel },
  })
  return true
})
check('能经 window 注册外壳槽', registered)

await page.waitForSelector('[data-e2e-slot="STATUS"]', { timeout: 5000 })
await page.waitForSelector('[data-e2e-slot="DOCK"]', { timeout: 5000 })
check('状态条出现扩展按钮', (await page.locator('.shell-status [data-e2e-slot="STATUS"]').count()) === 1)
check('底栏出现扩展按钮', (await page.locator('.shell-dock [data-e2e-slot="DOCK"]').count()) === 1)

await page.getByRole('button', { name: '资产管理' }).first().click()
await page.waitForSelector('.left-drawer', { timeout: 5000 })
await page.locator('.left-drawer [data-e2e-slot="DRAWER_TAB"]').click()
await page.waitForSelector('[data-e2e-slot="DRAWER_PANEL"]', { timeout: 5000 })
check('点击插件页签后出现插件面板', (await page.locator('[data-e2e-slot="DRAWER_PANEL"]').count()) === 1)

await page.evaluate(() => {
  const ctx = window.MiniCanvasUI.getContext()
  ctx.slots.remove('shell.status.end', 'e2e-status')
  ctx.slots.remove('shell.dock.end', 'e2e-dock')
  ctx.slots.remove('shell.drawer.tabs', 'e2e-tab')
})
await page.waitForTimeout(300)
check('状态条按钮随槽移除而消失', (await page.locator('[data-e2e-slot="STATUS"]').count()) === 0)
check('底栏按钮随槽移除而消失', (await page.locator('[data-e2e-slot="DOCK"]').count()) === 0)
check(
  '当前插件页签移除后回画布',
  (await page.locator('.left-drawer [role=tab][aria-selected=true]').innerText()).includes('画布'),
)
check('零 pageerror', errors.length === 0, errors.join(' | '))

await browser.close()
process.exit(failed ? 1 : 0)
