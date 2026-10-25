// @ts-nocheck
// composer-enter-check —— 「回车优先给 @ 下拉」的真机验证（用户口径 2026-10-26）。
//
// 用户报的场景：全局设置选「回车」提交后，输入 @ 弹出下拉，此时按回车
// **既选中了菜单项又把消息发送了**。根因是组件在冒泡阶段读 menuOpen，
// 而菜单选中后已把自己关掉 —— 判定被时序骗过。修法是捕获阶段判定。
//
// 跑法：
//   1) 起后台：pnpm -C packages/cloud-server serve   （:8865，托管 ui/dist）
//   2) node packages/ui/e2e/composer-enter-check.mjs
import { chromium } from 'playwright-core'
import { existsSync } from 'node:fs'

const EXE = process.env.CANVAS_E2E_CHROME
  ?? 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = process.env.CANVAS_BASE ?? 'http://127.0.0.1:8865'
if (!existsSync(EXE)) { console.error('chromium 不存在:', EXE); process.exit(2) }

const results = []
const check = (n, ok, d = '') => { results.push({ n, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -- ' + d : ''}`) }

const browser = await chromium.launch({ executablePath: EXE, headless: true })
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } })
const page = await ctx.newPage()

await page.goto(BASE + '/#/canvas/default', { waitUntil: 'load' })
await page.waitForTimeout(3000)

// 把发送键设置成「回车」（同源可直接写 KV），**写完刷新**才能保证组件挂载时读到新值
// （组件只在挂载时读一次；写完不刷新，submitKeyMode 还是默认的 ctrl-enter —— 上面探针抓到的就是它）
await page.evaluate(() => fetch('/api/kv/config/agentComposerPrefs', {
  method: 'PUT', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ value: { submitKeyMode: 'enter' } }),
}))
await page.reload({ waitUntil: 'load' })
await page.waitForTimeout(3000)

// 打开 Agent 面板
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').includes('Agent 对话'))
  if (btn) btn.click()
})
await page.waitForSelector('.ProseMirror', { timeout: 20000 })
for (let i = 0; i < 40; i++) {
  const w = await page.evaluate(() => document.querySelector('.ProseMirror')?.getBoundingClientRect().width ?? 0)
  if (w > 0) break
  await page.waitForTimeout(200)
}

const pm = page.locator('.ProseMirror')
await pm.click()

// 输入 @，等下拉出来
await page.keyboard.type('@')
await page.waitForTimeout(900)
const menuItems = await page.evaluate(() => document.querySelectorAll('.mention-menu .menu-item').length)
check('@ 下拉已弹出（菜单开着）', menuItems > 0, `menuItems=${menuItems}`)

// 记录发送前的消息数，然后按回车
const before = await page.evaluate(() => document.querySelectorAll('.ac-msg').length)
await page.keyboard.press('Enter')
await page.waitForTimeout(900)

const after = await page.evaluate(() => ({
  msgs: document.querySelectorAll('.ac-msg').length,
  menuLeft: document.querySelectorAll('.mention-menu .menu-item').length,
  editorText: document.querySelector('.ProseMirror')?.textContent ?? '',
  tags: document.querySelectorAll('.ProseMirror .ac-tag').length,
}))

// 核心断言：只选了菜单，**没有发送**
check('回车没有触发发送（消息数不变）', after.msgs === before, `before=${before} after=${after.msgs}`)
check('回车后菜单已收起（被选中处理掉）', after.menuLeft === 0, `menuLeft=${after.menuLeft}`)

// 再按一次回车（菜单已关）→ 这次应该真的发送
// 先确认输入框里有内容（若上一步选中的是「动作项」，正文可能被清空）
const hasText = await page.evaluate(() => (document.querySelector('.ProseMirror')?.textContent ?? '').trim().length > 0)
if (!hasText) {
  await pm.click()
  await page.keyboard.type('回车发送测试')
  await page.waitForTimeout(200)
}
// 等菜单真的从 DOM 里撤掉（选中后动画收尾需要几帧）
for (let i = 0; i < 25; i++) {
  const left = await page.evaluate(() => document.querySelectorAll('.mention-menu .menu-item').length)
  if (left === 0) break
  await page.waitForTimeout(200)
}
const textBefore = await page.evaluate(() => document.querySelector('.ProseMirror')?.textContent ?? '')
// 探针：回车到底走到哪一层（捕获/冒泡）、有没有被拦
await page.evaluate(() => {
  window.__probe = []
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return
    window.__probe.push({ phase: 'capture-doc', dp: e.defaultPrevented })
  }, true)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return
    window.__probe.push({ phase: 'bubble-doc', dp: e.defaultPrevented })
  }, false)
})
await page.keyboard.press('Enter')
await page.waitForTimeout(1200)
const after2 = await page.evaluate(() => document.querySelectorAll('.ac-msg').length)
const probe = await page.evaluate(() => window.__probe)
// 直接问组件：编辑器的 menuOpen 此刻是多少、submitKeyMode 是多少
const state = await page.evaluate(async () => {
  const kv = await fetch('/api/kv/config/agentComposerPrefs', { headers: { accept: 'application/json' } }).then((r) => r.json())
  return { kvValue: kv?.value, menuEl: !!document.querySelector('.mention-menu') }
})
// 问 Vue 组件：submitKeyMode 的真值（排除「设置没读到 → 静默回落默认」这类静默失配）
const compState = await page.evaluate(() => {
  // Vue 3 在元素上挂的实例指针名带随机后缀；扫一遍 expando 找 __vueParentComponent
  const el = document.querySelector('.prose-mirror-editor')
  if (!el) return { hasEl: false }
  const keys = Object.keys(el)
  const inst = el.__vueParentComponent || null
  let submitKeyMode = null
  let cur = inst
  for (let hop = 0; cur && hop < 6; hop++) {
    const ss = cur.setupState || {}
    if ('submitKeyMode' in ss) { submitKeyMode = ss.submitKeyMode; break }
    cur = cur.parent
  }
  // 无论能不能摸到组件，都把「真的发请求了吗」记下来：提交会 POST /api/agent/*
  if (!window.__reqs) {
    window.__reqs = []
    const of = window.fetch
    window.fetch = function (u, init) {
      const url = String(u)
      if (init && init.method === 'POST' && /agent/.test(url)) window.__reqs.push(url)
      return of.call(window, u, init)
    }
  }
  return { hasEl: true, hasInst: !!inst, submitKeyMode: typeof submitKeyMode === 'object' && submitKeyMode ? submitKeyMode.value : submitKeyMode }
})
const reqs = await page.evaluate(() => window.__reqs || [])
check('菜单关着时回车 = 发送（有 agent 请求或消息数增加）', after2 > after.msgs || reqs.length > 0, `text=${textBefore} after=${after.msgs} after2=${after2} reqs=${JSON.stringify(reqs)} probe=${JSON.stringify(probe)} comp=${JSON.stringify(compState)} state=${JSON.stringify(state)}`)

// 恢复默认设置
await page.evaluate(() => fetch('/api/kv/config/agentComposerPrefs', {
  method: 'PUT', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ value: { submitKeyMode: 'ctrl-enter' } }),
}))

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(failed.length ? `\n${results.length - failed.length}/${results.length} 通过` : `\n${results.length}/${results.length} 全部通过`)
process.exit(failed.length ? 1 : 0)
