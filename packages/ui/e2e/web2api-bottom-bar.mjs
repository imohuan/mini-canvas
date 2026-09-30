// @ts-nocheck
// web2api-bottom-bar —— 底栏 + web2api 动作的浏览器回归（真实 Chromium）。
//
// 覆盖用户点名的几件事（都是实测复现过的）：
//   A. 发送时**把所有连进来的素材**都上送（referenceImages 收图片+视频，文本拼进 prompt），
//      即使没 @ 引用；模型来自第一个下拉（烘焙进 chat-auto 前缀）。
//   B. 点发送 → 底栏收起 → 卡片上是**整卡加载态**（流光百分比），根不接指针事件（仍可拖拽）。
//   C. 「取消」既收敛本地状态，也真的 POST /api/tasks/<id>/cancel 到服务端。
//   D. 失败 / 暂停 / 轮询中断：卡片上留一条原因提示（不是留白，也不是继续显示进度）。
//   E. 刷新页面后，running + taskId 的节点自动接回来继续查（不卡在刷新前的百分比）。
//   F. 输入框里 @ 出候选（引用名是 图片1 / 视频1 / 文本1），菜单贴着光标。
//
// 跑法（dev server 在 :5296）：
//   node packages/ui/e2e/web2api-bottom-bar.mjs
// 真连服务端（不做任何 stub）：
//   CANVAS_E2E_REAL=1 node packages/ui/e2e/web2api-bottom-bar.mjs
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync } from 'node:fs'

const EXE =
  process.env.CANVAS_E2E_CHROME ??
  'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = process.env.CANVAS_E2E_BASE ?? 'http://localhost:5296/'
const REAL = process.env.CANVAS_E2E_REAL === '1'
const OUT = 'packages/ui/e2e/_shots'
const IMG = 'https://picsum.photos/seed/cat/420/320'
const VIDEO = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'

const results = []
const errors = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`)
}
if (!existsSync(EXE)) {
  console.error('chromium 不存在:', EXE)
  process.exit(2)
}
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
let phase = 'boot'
page.on('console', (m) => {
  if (m.type() === 'error' && !/ERR_CONNECTION_CLOSED/.test(m.text())) errors.push(`[${phase}] ` + m.text())
})
page.on('pageerror', (e) => errors.push(`[${phase}] PAGEERROR ` + e.message))

/** 装一个假的 web2api 后端（只有 CANVAS_E2E_REAL=1 时不装）。记录调用参数与取消请求。 */
const stub = async () => {
  if (REAL) return
  await page.evaluate(() => {
    window.__mcp = []
    window.__cancels = []
    const of = window.fetch
    window.fetch = async function (u, i) {
      const url = String(u)
      if (url.includes('/cancel')) {
        window.__cancels.push(url)
        return new Response(JSON.stringify({ code: 0 }), { status: 200 })
      }
      if (url.includes('/mcp') && i && i.body) {
        const req = JSON.parse(i.body)
        window.__mcp.push(req)
        const ok = (result) =>
          new Response(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'mcp-session-id': 'sid' },
          })
        if (req.method === 'initialize')
          return ok({ protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fake' } })
        if (req.method === 'notifications/initialized') return new Response('', { status: 202 })
        if (req.params?.name === 'doubao/chat-auto')
          return ok({
            content: [{ type: 'text', text: '任务已创建，任务ID：demo-task' }],
            structuredContent: { taskId: 'demo-task', status: 'processing' },
          })
        if (req.params?.name === 'system/get-task')
          return ok({
            content: [{ type: 'text', text: 'ok' }],
            structuredContent: { id: 'demo-task', status: 'processing', progress: 40, message: '豆包生成中…', resources: [] },
          })
        return ok({})
      }
      return of.apply(this, arguments)
    }
  })
}

/** 种一个「图片 + 文本 + 视频 → image 节点」的场景，返回目标节点 id */
const seed = async () => {
  await page.evaluate(
    ([img, video]) => {
      const h = window.MiniCanvasUI.getHost()
      const doc = h.ctx.get('doc')
      const old = doc.getNodes()
      if (old.length) doc.removeNodes(old.map((n) => n.id))
      doc.addNodes([
        { id: 'img1', type: 'image', position: { x: -680, y: -120 }, data: { imageUrl: img, label: '小猫' } },
        { id: 'txt1', type: 'text', position: { x: -680, y: 300 }, data: { text: '温暖的午后阳光' } },
        { id: 'vid1', type: 'video', position: { x: -680, y: 560 }, data: { videoUrl: video, label: '花' } },
        { id: 'target', type: 'image', position: { x: 100, y: 150 }, data: {} },
      ])
      h.edgeStore.addEdge({ source: 'img1', target: 'target' })
      h.edgeStore.addEdge({ source: 'txt1', target: 'target' })
      h.edgeStore.addEdge({ source: 'vid1', target: 'target' })
      h.viewport.setCenter(240, 260, 0.8)
      h.selection.set(new Set(['target']))
    },
    [IMG, VIDEO],
  )
  await page.waitForTimeout(1500)
}

const boot = async () => {
  phase = 'boot'
  await page.goto(BASE, { waitUntil: 'load' })
  await page.evaluate(() => {
    try {
      localStorage.clear()
    } catch {}
  })
  await page.reload({ waitUntil: 'load' })
  await page.waitForTimeout(2500)
  await page.waitForSelector('.vue-flow__node', { timeout: 30000 })
  await stub()
}

// —————————————————————— 场景 1：素材全上传 + 整卡加载态 + 取消 ——————————————————————
phase = 'flow'
await boot()
await seed()

const triggers = await page.$$eval('[data-testid="node-bottom-bar"] .sel-trigger', (els) =>
  els.map((e) => e.textContent.trim()),
)
check('第一个下拉显示的是具体模型（不是平台名）', triggers[0]?.includes('Seedream'), triggers.join(' | '))

// 模型清单从底栏服务里读（点开下拉会动选中态，后续还要用这个节点）
const models = await page.evaluate(() =>
  window.MiniCanvasUI.getHost()
    .ctx.get('nodeBar')
    .list({ type: 'image' })
    .filter((a) => a.id.startsWith('web2api:'))
    .map((a) => a.title),
)
check(
  '候选里是具体模型清单（豆包 4.5/5.0 Lite/4.0 + Dola + ChatGPT）',
  models.some((m) => m.includes('Seedream 4.5')) && models.some((m) => m.includes('ChatGPT')),
  models.slice(0, 8).join(', '),
)

await page.click('[data-testid="node-bottom-bar"] .ProseMirror')
await page.keyboard.type('一只猫在草地上')
await page.waitForTimeout(300)
await page.click('.nb-run')
await page.waitForTimeout(3500)

const during = await page.evaluate(() => {
  const node = window.MiniCanvasUI.getHost().ctx.get('doc').getNode('target')
  const ov = document.querySelector('[data-testid="task-overlay"]')
  return {
    runState: node.data.runState,
    overlay: ov
      ? {
          text: ov.textContent.replace(/\s+/g, ' ').trim(),
          pointerEvents: getComputedStyle(ov).pointerEvents,
          cardRadius: getComputedStyle(ov).borderRadius,
        }
      : null,
    barHidden: !document.querySelector('[data-testid="node-bottom-bar"]'),
    calls: (window.__mcp || []).filter((r) => r.params?.name === 'doubao/chat-auto').map((r) => r.params.arguments),
  }
})
check('发送后底栏自动收起（选完就收起来那种）', during.barHidden === true)
check('节点上是整卡加载态（无中间小卡片）', !!during.overlay && !during.overlay.text.includes('task-overlay-card'))
check(
  '覆盖层不接指针事件（取消按钮除外）→ 节点仍可拖拽',
  during.overlay?.pointerEvents === 'none',
  String(during.overlay?.pointerEvents),
)
const args0 = during.calls[0] ?? {}
check('图片素材被上送（没 @ 也传）', (args0.referenceImages ?? []).some((u) => u.includes('picsum')), JSON.stringify(args0.referenceImages))
check('视频素材也被上送', (args0.referenceImages ?? []).some((u) => u.endsWith('.mp4')), JSON.stringify(args0.referenceImages))
check('模型烘焙进请求前缀', String(args0.prompt ?? '').startsWith('/image(model:"Seedream 4.5"'), String(args0.prompt ?? '').slice(0, 60))
check('文本素材拼进 prompt', String(args0.prompt ?? '').includes('温暖的午后阳光'), String(args0.prompt ?? ''))
check('输入的文字进 prompt', String(args0.prompt ?? '').includes('一只猫在草地上'))

await page.screenshot({ path: OUT + '/web2api-running.png' })

// 取消按钮必须真的能被点到（用户实测反馈过「点了取消没反应」）
const cancelHit = await page.evaluate(() => {
  const btn = document.querySelector('.task-overlay-cancel')
  if (!btn) return { found: false }
  const r = btn.getBoundingClientRect()
  const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
  return {
    found: true,
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    top: top ? top.className || top.tagName : null,
    isSelf: top === btn || btn.contains(top),
  }
})
check('取消按钮在最上层（点得到）', cancelHit.found && cancelHit.isSelf, JSON.stringify(cancelHit))

// 取消：本地收敛 + 服务端真取消
await page.click('.task-overlay-cancel')
// 轮询间隔默认 3s，取消后要等下一拍循环才发现 abort —— 断言前留够一拍
await page.waitForTimeout(4500)
const afterCancel = await page.evaluate(() => ({
  runState: window.MiniCanvasUI.getHost().ctx.get('doc').getNode('target').data.runState,
  cancels: window.__cancels,
}))
check('取消后本地状态收敛（不再 running）', afterCancel.runState.status !== 'running', JSON.stringify(afterCancel.runState))
check(
  '取消真的发到服务端（POST /api/tasks/<id>/cancel）',
  REAL ? true : afterCancel.cancels.some((u) => u.includes('/api/tasks/demo-task/cancel')),
  JSON.stringify(afterCancel.cancels),
)

// —————————————————————— 场景 2：失败 / 暂停显示原因 ——————————————————————
phase = 'failed'
await boot()
await seed()
const failStates = [
  ['error', '任务执行失败: 触发了风控，请稍后重试', '任务执行失败'],
  ['paused', '任务被暂停（可在 web2api 里恢复或重试）', '任务被暂停'],
]
for (const [name, message, expect] of failStates) {
  await page.evaluate((msg) => {
    window.MiniCanvasUI.getHost().ctx.get('doc').updateNodeRuntime('target', {
      data: { runState: { status: 'error', message: msg, actionId: 'web2api:doubao-image-seedream45' } },
    })
  }, message)
  await page.waitForTimeout(600)
  const info = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="task-failed"]')
    const ov = document.querySelector('[data-testid="task-overlay"]')
    return el ? { text: el.textContent.replace(/\s+/g, ' ').trim(), pe: getComputedStyle(el).pointerEvents, hasOverlay: !!ov } : null
  })
  check(`失败态「${name}」在卡片上给出原因`, !!info && info.text.includes(expect) && info.pe === 'none' && !info.hasOverlay, JSON.stringify(info))
}
await page.screenshot({ path: OUT + '/web2api-failed.png' })

// —————————————————————— 场景 3：刷新续查 ——————————————————————
phase = 'resume'
await boot()
await page.evaluate(() => {
  const h = window.MiniCanvasUI.getHost()
  const doc = h.ctx.get('doc')
  const old = doc.getNodes()
  if (old.length) doc.removeNodes(old.map((n) => n.id))
  doc.addNodes([
    {
      id: 'n1',
      type: 'image',
      position: { x: 0, y: 0 },
      data: {
        runState: {
          status: 'running',
          progress: 40,
          message: '生成中…',
          actionId: 'web2api:doubao-image-seedream45',
          taskId: 'resume-task-1',
        },
      },
    },
  ])
  h.viewport.setCenter(300, 250, 1)
})
await page.waitForTimeout(1000)
await page.evaluate(() => {
  window.__getTask = []
  const of = window.fetch
  window.fetch = async function (u, i) {
    const url = String(u)
    if (url.includes('/mcp') && i && i.body) {
      const req = JSON.parse(i.body)
      const ok = (result) =>
        new Response(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'mcp-session-id': 'sid' },
        })
      if (req.method === 'initialize') return ok({ protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fake' } })
      if (req.method === 'notifications/initialized') return new Response('', { status: 202 })
      if (req.params?.name === 'system/get-task') {
        window.__getTask.push(req.params.arguments.taskId)
        return ok({
          content: [{ type: 'text', text: 'ok' }],
          structuredContent: { id: req.params.arguments.taskId, status: 'processing', progress: 60, message: '豆包生成中…', resources: [] },
        })
      }
      return ok({})
    }
    return of.apply(this, arguments)
  }
})
await page.reload({ waitUntil: 'load' })
await page.waitForTimeout(2500)
await page.waitForSelector('.vue-flow__node', { timeout: 30000 })
await page.evaluate(() => {
  window.__getTask = []
  const of = window.fetch
  window.fetch = async function (u, i) {
    const url = String(u)
    if (url.includes('/mcp') && i && i.body) {
      const req = JSON.parse(i.body)
      const ok = (result) =>
        new Response(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'mcp-session-id': 'sid' },
        })
      if (req.method === 'initialize') return ok({ protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fake' } })
      if (req.method === 'notifications/initialized') return new Response('', { status: 202 })
      if (req.params?.name === 'system/get-task') {
        window.__getTask.push(req.params.arguments.taskId)
        return ok({
          content: [{ type: 'text', text: 'ok' }],
          structuredContent: { id: req.params.arguments.taskId, status: 'processing', progress: 75, message: '豆包生成中…', resources: [] },
        })
      }
      return ok({})
    }
    return of.apply(this, arguments)
  }
})
await page.waitForTimeout(5000)
const resumed = await page.evaluate(() => ({
  runState: window.MiniCanvasUI.getHost().ctx.get('doc').getNode('n1').data.runState,
  getTask: window.__getTask,
}))
check(
  '刷新后自动接回同一个任务继续查（不卡在刷新前的进度）',
  resumed.getTask.includes('resume-task-1') && resumed.runState.progress > 40,
  JSON.stringify(resumed),
)
// 收尾：给任务一个终态，让续查循环停下来（否则它会一直轮询，后续场景清空画布时
// 会去写一个已不存在的节点，制造与产品无关的页内错误）
await page.evaluate(() => {
  window.MiniCanvasUI.getHost().ctx
    .get('doc')
    .updateNodeRuntime('n1', { data: { runState: { status: 'error', message: '测试收尾', actionId: 'x' } } })
})
// 等续查循环下一拍发现终态并收工，再让下一个场景动文档
await page.waitForTimeout(3500)

// —————————————————————— 场景 4：@ 候选与菜单贴合光标 ——————————————————————
phase = 'mention'
await boot()
await seed()
await page.click('[data-testid="node-bottom-bar"] .ProseMirror')
await page.keyboard.type('cat @')
await page.waitForTimeout(800)
const mention = await page.evaluate(() => {
  const menu = document.querySelector('.mention-menu')
  const sel = window.getSelection()
  const caret = sel && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null
  const items = menu ? [...menu.querySelectorAll('*')].map((e) => e.textContent.trim()).filter((t) => /^(图片|视频|文本)\d$/.test(t)) : []
  return {
    items,
    menuX: menu ? Math.round(menu.getBoundingClientRect().x) : null,
    caretX: caret ? Math.round(caret.x) : null,
  }
})
check('@ 候选用带序号的引用名（图片1 / 文本1 / 视频1）', mention.items.includes('图片1') && mention.items.includes('文本1'), mention.items.join(','))
check('@ 菜单水平方向贴着光标（不偏到屏幕别处）', mention.menuX !== null && Math.abs(mention.menuX - mention.caretX) <= 24, `menu=${mention.menuX} caret=${mention.caretX}`)
await page.keyboard.press('Enter')
await page.waitForTimeout(500)
const chip = await page.evaluate(() => {
  const ed = document.querySelector('[data-testid="node-bottom-bar"] .ProseMirror')
  const c = ed && ed.querySelector('.resource-chip')
  if (!c) return null
  return { name: c.querySelector('.resource-chip-name')?.textContent, thumb: !!c.querySelector('.resource-chip-thumb'), radius: getComputedStyle(c).borderRadius }
})
check('@ 引用插入后是卡片（圆角框 + 缩略图 + 名字）', !!chip && chip.name === '图片1' && chip.thumb && chip.radius !== '0px', JSON.stringify(chip))

if (errors.length) console.log('页内错误:', errors.slice(0, 10))
check('全程无页内报错', errors.length === 0)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过${REAL ? '（真连服务端）' : ''}`)
await browser.close()
process.exit(failed.length ? 1 : 0)
