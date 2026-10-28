// @ts-nocheck
/**
 * 名称化参考标签的真机探针（用户 2026-10-28 定案）。
 *
 * 断言：
 *   ① 卡片显示节点名称（不是「图片1 / 音频1」这种类型+序号）；
 *   ② 老格式 ref-slot:* 标签按失效显示（灰掉），不再按序号猜；
 *   ③ 手打的 @名称 点「标记」后变成待绑定标签 ref-name:*，卡片显示该名称；
 *   ④ 序号角标仍然存在（只做顺序观察）。
 *
 * 跑法：先起 ui dev（:5288），再 node packages/ui/e2e/ref-name-tags-probe.mjs
 */
import { chromium } from 'playwright-core'

const EXE = process.env.AGENT_E2E_CHROME
  ?? 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
// 注意：vite 默认只监听 localhost（IPv6 ::1 优先），写 127.0.0.1 会 ERR_CONNECTION_REFUSED
const BASE = process.env.AGENT_BASE ?? 'http://localhost:5288/'
const CANVAS = BASE + '#/canvas/824e779f34314f86'

const fails = []
const ok = (name, cond, detail = '') => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  -- ' + detail : ''))
  if (!cond) fails.push(name)
}

const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(CANVAS, { waitUntil: 'load' })
await page.waitForTimeout(7000)

/**
 * 现场造一个干净的样本（不依赖某张老画布里恰好有什么）：
 *   目标节点 + 三个上游（图片 / 音频 / 文本），都连进来。
 * 这样断言「卡片名称 = 节点名称」时不会受历史数据里旧标签干扰。
 */
const info = await page.evaluate(() => {
  const host = window.MiniCanvasUI?.getHost?.()
  const doc = host?.ctx?.get?.('doc')
  if (!doc) return { error: 'no doc' }
  const existing = doc.getNodes().map((n) => n.id)
  const before = new Set(existing)
  const added = doc.addNodes([
    // 目标用视频节点：它的 target 口接受 text/audio/image/video（图片节点不收音频）
    { type: 'video', position: { x: 200, y: 200 }, data: { label: '探针-目标' } },
    { type: 'image', position: { x: 0, y: 0 }, data: { label: '场景:天空之城', imageUrl: 'data:image/png;base64,iVBORw0KGgo=' } },
    { type: 'audio', position: { x: 0, y: 200 }, data: { label: '雨声', audioUrl: 'data:audio/mp3;base64,AAAA' } },
    { type: 'text', position: { x: 0, y: 400 }, data: { label: '角色设定', text: '一段设定' } },
  ])
  void added
  const fresh = doc.getNodes().filter((n) => !before.has(n.id))
  const [target, image, audio, text] = fresh
  if (!target || !image || !audio || !text) {
    return { error: 'addNodes failed', fresh: fresh.map((n) => [n.id, n.type, n.data?.label]) }
  }
  for (const up of [image, audio, text]) doc.addEdge({ source: up.id, target: target.id })
  host.ctx.get('selection')?.set?.([target.id])
  return {
    target: target.id,
    label: target.data?.label,
    upstream: [image, audio, text].map((n) => ({ id: n.id, type: n.type, label: n.data?.label })),
    edges: doc.getEdges().filter((e) => e.target === target.id).map((e) => e.source),
  }
})

if (info.error) {
  console.log('SKIP：' + JSON.stringify(info))
  await browser.close()
  process.exit(0)
}
console.log('样本节点 = ' + JSON.stringify(info))
await page.waitForTimeout(2500)

const tiles = await page.evaluate(() =>
  [...document.querySelectorAll('.nb-shell [data-tile-key]')].map((el) => ({
    key: el.getAttribute('data-tile-key'),
    name: el.getAttribute('data-tile-name'),
    index: el.querySelector('.nb-card-index')?.textContent?.trim(),
    namebar: el.querySelector('.nb-card-namebar')?.textContent?.trim(),
    pending: el.classList.contains('is-pending'),
    invalid: el.classList.contains('is-invalid'),
    kind: el.querySelector('.nb-card-fallback')?.getAttribute('data-kind')
      ?? el.querySelector('.nb-card-placeholder')?.getAttribute('data-kind')
      ?? null,
  })),
)
console.log('卡片 = ' + JSON.stringify(tiles, null, 1))

const nameOf = new Map(info.upstream.map((n) => [n.id, n.label]))
const boundTiles = tiles.filter((t) => t.key.startsWith('ref-node:'))
ok('卡片身份是 ref-node:<节点id>（不再按类型+序号）', boundTiles.length > 0, JSON.stringify(tiles.map((t) => t.key)))
ok(
  '卡片名称 = 节点名称',
  boundTiles.every((t) => {
    const id = t.key.slice('ref-node:'.length)
    const want = nameOf.get(id)
    return !want || t.name === want
  }),
  JSON.stringify(boundTiles.map((t) => [t.key, t.name])),
)
ok(
  '不再出现「图片N / 音频N」这种自动名',
  tiles.every((t) => !/^(图片|视频|音频|文本)\s?\d+$/.test(String(t.name ?? ''))),
  JSON.stringify(tiles.map((t) => t.name)),
)
ok('序号角标保留（只做顺序观察）', tiles.every((t) => /^\d+$/.test(String(t.index ?? ''))))

const legacy = tiles.filter((t) => t.key.startsWith('ref-slot:'))
if (legacy.length > 0) {
  ok('老格式 ref-slot:* → 失效样式', legacy.every((t) => t.invalid), JSON.stringify(legacy))
}

const typed = await page.evaluate(() => {
  const host = window.MiniCanvasUI?.getHost?.()
  const doc = host?.ctx?.get?.('doc')
  if (!doc) return { error: 'no doc' }
  /**
   * 用画布里**已有的图片节点**当「标记」样本（视频节点默认动作是「剪辑」，没有输入框）。
   * 优先挑有 barPromptDoc 的老节点，保证它确实带生成动作。
   */
  /**
   * 现造一个**带生成动作**的图片节点（画布里老节点的动作可能是「旋转」这类即时动作，
   * 没有输入框 → 「标记」按钮不可用）。
   */
  const before = new Set(doc.getNodes().map((n) => n.id))
  doc.addNodes([{
    type: 'image',
    position: { x: 1200, y: 1200 },
    data: { label: '探针-标记样本' },
  }])
  const imageNode = doc.getNodes().find((n) => !before.has(n.id))
  if (!imageNode) return { error: 'no image node' }
  // 先选中（底栏挂载后才有动作清单），再让底栏选到「带输入框」的生成动作
  host.ctx.get('selection')?.set?.([imageNode.id])
  const actions = host.ctx.get('nodeBar')?.list?.({ type: 'image' }) ?? []
  const gen = actions.find((a) => a.needsPrompt)?.id ?? ''
  if (gen) doc.updateNode(imageNode.id, { data: { barValues: { actionId: gen } } })
  return { ok: true, target: imageNode.id, actionCount: actions.length, gen }
})
await page.waitForTimeout(2000)
const typed2 = typed.error ? typed : await page.evaluate(() => {
  const shell = document.querySelector('.nb-shell')
  const editor = document.querySelector('.nb-shell .ProseMirror')
  if (!editor) {
    return {
      error: 'no editor',
      shell: !!shell,
      hasEditorBox: !!document.querySelector('.nb-editor'),
      actions: [...document.querySelectorAll('.nb-shell .nb-field--action')].map((el) => el.textContent?.trim()),
    }
  }
  editor.focus()
  document.execCommand('insertText', false, '测试 @不存在的素材名 ')
  return { ok: true }
})
if (!typed2.error) {
  await page.waitForTimeout(400)
  const markBtn = page.locator('.nb-shell [data-testid="bar-mark"]')
  if (await markBtn.count()) {
    await markBtn.first().click()
    await page.waitForTimeout(1200)
  }
  const after = await page.evaluate(() => ({
    chips: [...document.querySelectorAll('.nb-shell .resource-chip')].map((el) => ({
      id: el.getAttribute('data-id'),
      name: el.getAttribute('data-name'),
      kind: el.getAttribute('data-kind'),
      invalid: el.getAttribute('data-invalid'),
    })),
    tiles: [...document.querySelectorAll('.nb-shell [data-tile-key]')].map((el) => ({
      key: el.getAttribute('data-tile-key'),
      name: el.getAttribute('data-tile-name'),
      pending: el.classList.contains('is-pending'),
    })),
  }))
  console.log('标记后 = ' + JSON.stringify(after, null, 1))
  const pendingChip = after.chips.find((c) => c.id === 'ref-name:不存在的素材名')
  ok('手打 @名称 → 待绑定标签 ref-name:<名>', !!pendingChip, JSON.stringify(after.chips.map((c) => c.id)))
  ok('待绑定标签没有类型（统一资源图标）', !pendingChip?.kind, String(pendingChip?.kind))
  const pendingTile = after.tiles.find((t) => t.key === 'ref-name:不存在的素材名')
  ok('待绑定标签 → 空壳卡（可拖入）', !!pendingTile?.pending, JSON.stringify(pendingTile))
} else {
  console.log('标记步骤跳过：' + JSON.stringify(typed2))
}

// 行高：两行 chip 不能重叠（用户 2026-10-29 报第二行压住第一行底部）
const lineGap = await page.evaluate(() => {
  const chips = [...document.querySelectorAll('.nb-shell .ProseMirror .resource-chip')]
  if (chips.length < 2) return { error: 'need 2 chips', count: chips.length }
  const rects = chips.map((c) => c.getBoundingClientRect())
  let minGap = Infinity
  for (let i = 1; i < rects.length; i++) {
    const dy = rects[i].top - rects[i - 1].bottom
    if (Math.abs(rects[i].top - rects[i - 1].top) > 4) minGap = Math.min(minGap, dy)
  }
  return { count: chips.length, minGap }
})
if (!lineGap.error) {
  ok('相邻两行标签不重叠（行间距 ≥ 0）', lineGap.minGap >= 0, JSON.stringify(lineGap))
} else {
  console.log('行高检查跳过：' + JSON.stringify(lineGap))
}

if (errors.length) console.log('页面错误：' + errors.slice(0, 5).join(' | '))
await browser.close()
console.log(fails.length === 0 ? '\n全部通过' : '\n失败：' + fails.join(' / '))
process.exit(fails.length === 0 ? 0 : 1)
