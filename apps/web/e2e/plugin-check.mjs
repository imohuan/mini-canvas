#!/usr/bin/env node
/**
 * plugin-check —— 插件回归测试的统一入口（真实浏览器，无头）。
 *
 * 为什么需要它：仓库里 30 多个插件，每改一次都要人工点一遍不现实，临时脚本又各写各的。
 * 这个脚本把「开页面 / 登录 / 打开画布 / 选中节点 / 读服务与 DOM / 断言」收敛成几个小函数，
 * 以后加一个插件的检查只需要写一个 suite 函数，不用再抄一套启动代码。
 *
 * 用法（服务先起着：`pnpm start`，默认 8865）：
 *
 *   node apps/web/e2e/plugin-check.mjs                     # 全部 suite
 *   node apps/web/e2e/plugin-check.mjs bottom-bar layout   # 只跑名字里含这些词的
 *   node apps/web/e2e/plugin-check.mjs --url http://127.0.0.1:8866
 *   node apps/web/e2e/plugin-check.mjs --canvas <画布id> --shots .tmp/shots
 *
 * 退出码：全部通过 0；有失败 1（可直接接进 CI 或 pre-push）。
 *
 * 约定：
 * - 每个 suite 自带 setup/断言，**不共享**可变状态；
 * - 断言失败不中断其它 suite（一次跑完能看全貌）；
 * - 截图写到 --shots 目录（默认 apps/web/e2e/out），失败时更方便定位。
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

// ------------------------------- 参数 -------------------------------
function parseArgs(argv) {
  const opts = {
    url: process.env.PLUME_E2E_URL ?? 'http://127.0.0.1:8865',
    canvas: process.env.PLUME_E2E_CANVAS ?? '',
    password: process.env.PLUME_E2E_PASSWORD ?? 'plume-test-123',
    shots: process.env.PLUME_E2E_SHOTS ?? 'apps/web/e2e/out',
    headless: process.env.PLUME_E2E_HEADED !== '1',
    filters: [],
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const take = () => {
      const v = argv[++i]
      if (v === undefined) throw new Error(a + ' 后面缺少值')
      return v
    }
    if (a === '--url') opts.url = take()
    else if (a === '--canvas') opts.canvas = take()
    else if (a === '--password') opts.password = take()
    else if (a === '--shots') opts.shots = take()
    else if (a === '--headed') opts.headless = false
    else if (a === '--help' || a === '-h') {
      console.log('node apps/web/e2e/plugin-check.mjs [suite 过滤词...] [--url URL] [--canvas ID] [--shots 目录] [--headed]')
      process.exit(0)
    } else if (a.startsWith('-')) throw new Error('未知参数: ' + a)
    else opts.filters.push(a)
  }
  return opts
}

// --------------------------- 断言与结果 ---------------------------
const results = []
let currentSuite = ''

function check(name, ok, detail = '') {
  results.push({ suite: currentSuite, name, ok: !!ok, detail: String(detail ?? '') })
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${currentSuite}] ${name}${detail ? '  -- ' + detail : ''}`)
  return !!ok
}

function eq(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  return check(name, ok, ok ? '' : `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
}

function truthy(name, value, detail = '') {
  return check(name, !!value, detail || (value ? '' : '实际为空'))
}

// --------------------------- 页面小工具 ---------------------------
function makeTools(page, opts) {
  const shots = path.resolve(opts.shots)
  mkdirSync(shots, { recursive: true })

  const shot = async (name) => {
    const file = path.join(shots, name.replace(/[^\w\u4e00-\u9fa5-]+/g, '_') + '.png')
    await page.screenshot({ path: file })
    return file
  }

  /** 打开首页 -> 首次登录（若有密码框）-> 进画布（给了 canvas 直接进，否则点第一个项目） */
  const open = async (canvasId) => {
    let target = canvasId ? `${opts.url}/#/canvas/${canvasId}` : `${opts.url}/`
    await page.goto(target, { waitUntil: 'load' })
    await page.waitForTimeout(2200)
    const pw = page.locator('input[type="password"]')
    if (await pw.count() >= 2) {
      await pw.nth(0).fill(opts.password)
      await pw.nth(1).fill(opts.password)
      await page.getByRole('button', { name: '设置并进入' }).click()
      await page.waitForTimeout(3500)
      if (canvasId) await page.goto(target, { waitUntil: 'load' })
    }
    if (!canvasId) {
      // 不指定画布时：用「节点最多的那张」（内容丰富的画布才测得出布局/分页这类问题）
      const best = await page.evaluate(async () => {
        try {
          const r = await fetch('/api/canvases', { credentials: 'include' })
          const j = await r.json()
          // 这个接口回的是**画布 id 字符串数组**（不是对象数组）；按对象取 id 会拿到 undefined
          const list = (j.canvases ?? []).map((c) => (typeof c === 'string' ? c : c?.id)).filter(Boolean)
          let bestId = ''
          let bestCount = -1
          for (const id of list) {
            const d = await (await fetch('/api/canvases/' + id, { credentials: 'include' })).json()
            const n = (d.nodes ?? []).length
            if (n > bestCount) { bestCount = n; bestId = id }
          }
          return bestId
        } catch (err) {
          console.warn('[plugin-check] 自动选画布失败：' + err)
          return ''
        }
      })
      if (best) {
        target = `${opts.url}/#/canvas/${best}`
        await page.goto(target, { waitUntil: 'load' })
        await page.waitForTimeout(8000)
        return page.evaluate(() => !!window.PlumeUI)
      }
      const openBtn = page.getByRole('button', { name: /打开项目/ }).first()
      if (await openBtn.count()) {
        await openBtn.click()
        await page.waitForTimeout(7000)
      }
    } else {
      await page.waitForTimeout(8000)
    }
    return page.evaluate(() => !!window.PlumeUI)
  }

  const ctxEval = (fn, arg) => page.evaluate(fn, arg)

  /** 画布上下文里的服务 / 节点快照（断言常用） */
  const snapshot = () => page.evaluate(() => {
    const api = window.PlumeUI
    if (!api) return null
    const ctx = api.getContext()
    const nodes = api.getNodeStore().getNodes()
    return {
      plugins: api.listPlugins(),
      services: ctx.injectedServices ? ctx.injectedServices() : [],
      nodes: nodes.map((n) => ({ id: n.id, type: n.type, position: { ...n.position }, size: n.size ? { ...n.size } : null, label: n.data?.label })),
      selected: [...ctx.get('selection').ids],
    }
  })

  const select = async (ids) => {
    await page.evaluate((list) => window.PlumeUI.getContext().get('selection').set(list), ids)
    await page.waitForTimeout(900)
  }

  const runCommand = async (id, payload) => page.evaluate(
    ([cid, p]) => window.PlumeUI.getContext().get('canvas').runCommand(cid, p),
    [id, payload],
  )

  /**
   * 读写设置。
   *
   * 未声明的键**不写**（内核会抛「setting not defined」）——直接跳过并返回 undefined，
   * 让 suite 自己决定是 warning 还是失败。这样脚本能对「插件没装」的情况给出清楚信息，
   * 而不是把内核异常伪装成 suite 崩溃。
   */
  const setting = async (key, value) => page.evaluate(
    ([k, v]) => {
      const s = window.PlumeUI.getContext().get('settings')
      const defined = typeof s.has === 'function' ? s.has(k) : s.get(k) !== undefined
      if (v === undefined) return s.get(k)
      if (!defined) return { skipped: true, key: k }
      s.set(k, v)
      return s.get(k)
    },
    [key, value],
  )

  const visibleButton = (label) => page.locator(`button[aria-label="${label}"], button[title="${label}"]`).first()

  return { shot, open, ctxEval, snapshot, select, runCommand, setting, visibleButton, page }
}

// --------------------------- 测试套件 ---------------------------
/**
 * 每个 suite 形如：
 *   { name, needsCanvas: boolean, run: async (t) => void }
 * t = { page, shot, open, snapshot, select, runCommand, setting, visibleButton }
 */
const suites = []

function suite(name, needsCanvas, run) {
  suites.push({ name, needsCanvas, run })
}

// 1. 画布骨架：插件都装上、服务齐
suite('canvas-boot', true, async (t) => {
  const s = await t.snapshot()
  truthy('PlumeUI 可用', s)
  if (!s) return
  truthy('装了小地图', s.plugins.includes('mini-map'), s.plugins.join(','))
  truthy('装了自动布局', s.plugins.includes('auto-layout'))
  truthy('装了底栏', s.plugins.includes('bottom-bar'))
  // settings 不是「注入服务」——它是内核自带的设置存储，用 ctx.get('settings') 取，
  // 不出现在 injectedServices() 里；这里单独判它可读。
  const settingsOk = await t.page.evaluate(() => typeof window.PlumeUI.getContext().get('settings')?.get === 'function')
  truthy('设置存储可读', settingsOk)
  for (const name of ['doc', 'selection', 'canvas', 'nodeToolbar']) {
    truthy('服务 ' + name, s.services.includes(name))
  }
  truthy('画布里有节点', s.nodes.length > 0, '节点数 ' + s.nodes.length)
})

// 2. 底栏输入框：只竖向滚动、长文本自动换行（用户 2026-11-13 截图）
suite('bottom-bar editor', true, async (t) => {
  const s = await t.snapshot()
  const node = s.nodes.find((n) => ['text', 'image', 'audio', 'video'].includes(n.type))
  if (!check('画布里有可选中节点', !!node)) return
  await t.select([node.id])
  const box = await t.page.evaluate(() => {
    const ed = document.querySelector('.nb-editor')
    const pm = ed?.querySelector('.ProseMirror')
    if (!ed || !pm) return { missing: true }
    const wrapEl = ed.querySelector('.prose-mirror-editor') ?? ed
    const cs = getComputedStyle(pm)
    const wrapCs = getComputedStyle(wrapEl)
    return {
      ws: cs.whiteSpace,
      ox: wrapCs.overflowX,
      // 真正会出横向滚动条的是外层滚动容器：两边都量，任何一边溢出都算失败
      overflow: Math.max(pm.scrollWidth - pm.clientWidth, wrapEl.scrollWidth - wrapEl.clientWidth),
      wrapScrollW: wrapEl.scrollWidth,
      wrapClientW: wrapEl.clientWidth,
    }
  })
  truthy('底栏出现输入框', !box.missing, JSON.stringify(box))
  if (box.missing) return
  eq('正文不再被 nowrap 撑成一行', box.ws, 'pre-wrap')
  truthy('没有横向溢出（正文与滚动容器都是）', box.overflow <= 0, 'scrollWidth-clientWidth=' + box.overflow)
  eq('外层不吃横向滚动', box.ox, 'hidden')
  await t.shot('bottom-bar-editor')
})

// 3. 自动布局：标题高度开关会改变实际间距
suite('auto-layout', true, async (t) => {
  const before = await t.snapshot()
  if (!check('有至少两个节点', before.nodes.length >= 2)) return
  const layout = (over) => t.page.evaluate(async (cfg) => {
    const api = window.PlumeUI
    const ctx = api.getContext()
    const s = ctx.get('settings')
    for (const [k, v] of Object.entries(cfg)) {
      // 未声明的键不写（内核会抛）；插件没装时 layout 命令本身也是 no-op
      if (typeof s.has === 'function' ? s.has(k) : s.get(k) !== undefined) s.set(k, v)
    }
    ctx.get('canvas').runCommand('auto-layout:run')
    await new Promise((r) => setTimeout(r, 1200))
    return api.getNodeStore().getNodes().map((n) => ({ id: n.id, x: Math.round(n.position.x), y: Math.round(n.position.y), h: n.size?.h ?? 0 }))
  }, over)
  const off = await layout({ direction: 'TB', includeTitleHeight: false, titleHeight: 0, intraSpacingY: 80 })
  const on = await layout({ direction: 'TB', includeTitleHeight: true, titleHeight: 24, intraSpacingY: 80 })
  truthy('布局后节点仍有位置', on.length > 0)
  // 判定口径：同一节点在两个开关下的 y 差。比「两行之间的空隙」稳 ——
  // 画布上节点常落在同一 rank（空隙 0，比不出差别），而标题占位只会把后面的节点往下推。
  const moved = on.filter((n) => {
    const before = off.find((o) => o.id === n.id)
    return before && n.y !== before.y
  })
  truthy('打开标题占位后节点整体重新计算（y 有变化）', moved.length > 0,
    '变化节点 ' + moved.length + ' / ' + on.length)
  await t.shot('auto-layout')
})

// 4. Ctrl+方向键紧凑排列：间距与标题占位
suite('align-arrange', true, async (t) => {
  const s = await t.snapshot()
  if (!check('有至少两个节点', s.nodes.length >= 2)) return
  await t.select(s.nodes.slice(0, 2).map((n) => n.id))
  /**
   * align-arrange 不是自带件（安装清单里的可装卸件），没装时**跳过**而不是失败。
   * 判据用命令是否存在 —— 比查设置键稳（设置键是内核平面命名，可能被别的插件先占）。
   */
  const installed = s.plugins.includes('align-arrange')
  if (!installed) {
    check('align-arrange 未安装，跳过（装好后重跑本 suite）', true)
    return
  }
  await t.setting('alignArrangeGapY', 40)
  await t.setting('alignArrangeTitleHeight', 24)
  const before = await t.snapshot()
  await t.runCommand('align-arrange:compact-arrowdown')
  await t.page.waitForTimeout(800)
  const after = await t.snapshot()
  const moved = before.nodes.some((n, i) => n.position.y !== after.nodes[i]?.position.y)
  truthy('Ctrl+↓ 紧凑排列真的移动了节点', moved)
  await t.shot('align-arrange')
})

// 5. Agent 分页：结构可读、页码形如 n / m
suite('agent pager', true, async (t) => {
  const has = await t.page.evaluate(() => !!document.querySelector('button[aria-label="Agent 对话"]'))
  if (!check('有 Agent 对话按钮', has)) return
  await t.page.locator('button[aria-label="Agent 对话"]').first().click()
  await t.page.waitForTimeout(1800)
  const pager = await t.page.evaluate(() => {
    const nav = document.querySelector('.ac-branch-nav')
    return nav ? { text: (nav.textContent || '').trim() } : { none: true }
  })
  if (pager.text) truthy('页码形如 n / m', /\d+\s*\/\s*\d+/.test(pager.text), pager.text)
  else check('没有分叉时不画分页器', true)
  await t.shot('agent-pager')
})

// --------------------------- 主流程 ---------------------------
async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const picked = suites.filter((s) => !opts.filters.length || opts.filters.some((f) => s.name.includes(f)))
  if (!picked.length) {
    console.error('没有匹配的 suite。可用：' + suites.map((s) => s.name).join(', '))
    process.exit(2)
  }

  const browser = await chromium.launch({ channel: 'chrome', headless: opts.headless })
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
  const issues = []
  page.on('pageerror', (e) => issues.push('PAGEERROR: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) issues.push('CONSOLE: ' + m.text()) })

  const t = makeTools(page, opts)
  const ready = await t.open(opts.canvas || undefined)
  if (!ready) {
    console.error('页面没有就绪：PlumeUI 未挂载（服务没起？地址不对？）')
    await browser.close()
    process.exit(2)
  }

  for (const s of picked) {
    currentSuite = s.name
    try {
      await s.run(t)
    } catch (err) {
      check('suite 未抛异常', false, err instanceof Error ? err.message : String(err))
    }
  }

  check('全程无页面报错', issues.length === 0, issues.slice(0, 5).join(' | '))
  await browser.close()

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} 通过` + (failed.length ? `，${failed.length} 失败` : ''))
  if (failed.length) {
    console.log('失败项：')
    for (const f of failed) console.log(`  - [${f.suite}] ${f.name}${f.detail ? '  -- ' + f.detail : ''}`)
  }
  process.exit(failed.length ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(2)
})
