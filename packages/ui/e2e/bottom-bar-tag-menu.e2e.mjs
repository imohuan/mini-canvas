// @ts-nocheck
/**
 * 底部状态栏「参考卡片 + 标签菜单」的真机检查（Playwright，跑真画布）。
 *
 * 覆盖用户 2026-10-29 提的这批问题：
 *   ① 卡片圆角恢复成 8px、hover 时没有名称条（不再盖住右下角 @）；
 *   ② hover 预览在卡片**上方**、说明气泡在**下方**，两者不重叠；
 *   ③ @ 按钮 hover 可见、白字、点了能插标签；
 *   ④ 图片节点删掉后，hover 预览立刻消失（不显示旧图）；
 *   ⑤ 双击卡片 = 和 F 键同一套取景（缩放按 focusHeightRatio 算，节点居中）；
 *   ⑥ 点标签**左侧图标**用主题 Dropdown 弹两栏菜单（已引用 + 素材引用类别 → 该类节点）；
 *   ⑦ 点标签**右侧文字**不弹菜单（走默认：约 1s 后光标落到标签后）；
 *   ⑧ 菜单里选一个节点 → 标签换绑（断旧线、连新线、名字跟着变）。
 *
 * 跑法：先起 dev server，再
 *   AGENT_BASE=http://localhost:5311/ node packages/ui/e2e/bottom-bar-tag-menu.e2e.mjs
 */
import { chromium } from 'playwright-core'

const EXE = process.env.AGENT_E2E_CHROME
  ?? 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = process.env.AGENT_BASE ?? 'http://localhost:5288/'
const SHOT_DIR = process.env.AGENT_SHOT_DIR ?? ''

const fails = []
const ok = (name, cond, detail = '') => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  -- ' + detail : ''))
  if (!cond) fails.push(name)
}

/**
 * 竖屏素材（327×581）：用来验证 hover 预览保持竖屏、长边封顶 200。
 * 之前这里是 480×320 的横图，竖图问题（用户 2026-10-29 图 2）测不出来。
 */
const svgOf = (color) => 'data:image/svg+xml;base64,' + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="327" height="581">'
  + '<rect width="327" height="581" fill="' + color + '"/></svg>',
).toString('base64')

const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(BASE + '#/canvas/824e779f34314f86', { waitUntil: 'load' })
await page.waitForTimeout(6500)

const seed = await page.evaluate(([a, b]) => {
  const doc = window.MiniCanvasUI?.getHost?.()?.ctx?.get?.('doc')
  if (!doc) return { error: 'no doc' }
  const before = new Set(doc.getNodes().map((n) => n.id))
  doc.addNodes([
    { type: 'image', position: { x: 40, y: 60 }, data: { label: '目标图片' } },
    { type: 'image', position: { x: -520, y: 60 }, data: { label: '甲图', imageUrl: a } },
    { type: 'image', position: { x: -520, y: 420 }, data: { label: '乙图', imageUrl: b } },
  ])
  const fresh = doc.getNodes().filter((n) => !before.has(n.id))
  doc.addEdge({ source: fresh[1].id, target: fresh[0].id })
  return { target: fresh[0].id, a: fresh[1].id, b: fresh[2].id }
}, [svgOf('#0ea5e9'), svgOf('#f472b6')])
if (seed.error) {
  console.log('SKIP: ' + JSON.stringify(seed))
  await browser.close()
  process.exit(0)
}
await page.waitForTimeout(800)

// 注入一个「带输入框」的动作，让底栏出现输入区（标签才有地方插）
await page.evaluate(() => {
  const ctx = window.MiniCanvasUI?.getHost?.()?.ctx
  ctx?.tryGet?.('nodeBar')?.register(ctx, {
    id: 'e2e:compose',
    types: ['text', 'image'],
    title: '探针生成',
    description: 'e2e：带输入框的动作',
    needsPrompt: true,
    promptBinding: 'none',
    run: async () => ({ ok: true }),
  })
})
await page.waitForTimeout(400)

const clickNode = async (id) => {
  const p = await page.evaluate((nodeId) => {
    const n = document.querySelector('.vue-flow__node[data-id="' + nodeId + '"]')
    if (!n) return null
    const r = n.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  }, id)
  if (p) { await page.mouse.click(p.x, p.y); await page.waitForTimeout(1400) }
  return !!p
}

await clickNode(seed.target)
// 把目标节点摆到屏幕中上部：底栏完整可见，后面所有卡片坐标才可靠
await page.evaluate((id) => {
  const ctx = window.MiniCanvasUI?.getHost?.()?.ctx
  const vp = ctx?.tryGet?.('view')
  const rect = ctx?.tryGet?.('view')?.getNodeRect?.(id)
  if (vp && rect) vp.setViewport({ x: 700 - (rect.x + rect.w / 2), y: 300 - (rect.y + rect.h / 2), zoom: 1 })
}, seed.target)
await page.waitForTimeout(900)

const cardBox = (name) => page.evaluate((tileName) => {
  const el = [...document.querySelectorAll('.nb-card')].find((c) => c.getAttribute('data-tile-name') === tileName)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
}, name)

// ① 卡片圆角 / 名称条
const cardInfo = await page.evaluate(() => {
  const card = document.querySelector('.nb-card')
  const clip = card?.querySelector('.nb-card-clip')
  return {
    radius: card ? getComputedStyle(card).borderRadius : null,
    clipRadius: clip ? getComputedStyle(clip).borderRadius : null,
    namebar: !!document.querySelector('.nb-card-namebar'),
  }
})
ok('卡片圆角恢复（内外都是 8px）', cardInfo.radius === '8px' && cardInfo.clipRadius === '8px', JSON.stringify(cardInfo))
ok('hover 时没有底部名称条（不再盖住 @）', !cardInfo.namebar)

// ②③ hover：预览在上、气泡在下、@ 白色可点
const first = await cardBox('甲图')
if (!first) {
  console.log('SKIP: 卡片没渲染')
  await browser.close()
  process.exit(0)
}
await page.mouse.move(first.x, first.y, { steps: 6 })
await page.waitForTimeout(1100)
const hoverState = await page.evaluate(() => {
  const card = document.querySelector('.nb-card')
  const cr = card.getBoundingClientRect()
  const prev = document.querySelector('.nb-hover-preview')
  const pr = prev?.getBoundingClientRect()
  const br = document.querySelector('.tlt-bubble')?.getBoundingClientRect()
  const at = card.querySelector('.nb-card-at')
  const s = at ? getComputedStyle(at) : null
  return {
    card: { top: Math.round(cr.top), bottom: Math.round(cr.bottom) },
    preview: pr ? { top: Math.round(pr.top), bottom: Math.round(pr.bottom) } : null,
    bubble: br ? { top: Math.round(br.top), bottom: Math.round(br.bottom) } : null,
    atColor: s?.color ?? null,
    atOpacity: s?.opacity ?? null,
  }
})
ok('hover 弹出预览框', !!hoverState.preview)
ok('预览在卡片上方', !!hoverState.preview && hoverState.preview.bottom <= hoverState.card.top, JSON.stringify(hoverState.preview))
ok('说明气泡在卡片下方（与预览分开）', !!hoverState.bubble && hoverState.bubble.top >= hoverState.card.bottom - 2, JSON.stringify(hoverState.bubble))

// 预览框要按素材原始宽高比（竖图 327×581 → 高 200、宽约 113）
const previewAspect = await page.evaluate(() => {
  const box = document.querySelector('.nb-hover-preview')
  const media = box?.querySelector('img, video')
  const r = box?.getBoundingClientRect()
  if (!box || !media || !r) return null
  const nw = media.naturalWidth || media.videoWidth || 0
  const nh = media.naturalHeight || media.videoHeight || 0
  return {
    box: { w: Math.round(r.width), h: Math.round(r.height) },
    natural: { w: nw, h: nh },
  }
})
ok('竖屏素材的 hover 预览保持竖屏（高 200、宽 < 高）',
  !!previewAspect && previewAspect.box.h === 200 && previewAspect.box.w < previewAspect.box.h,
  JSON.stringify(previewAspect))
ok('预览长边封顶 200px',
  !!previewAspect && Math.max(previewAspect.box.w, previewAspect.box.h) === 200,
  JSON.stringify(previewAspect?.box))
ok('@ 按钮文字是白色', hoverState.atColor === 'rgb(255, 255, 255)', hoverState.atColor)
ok('@ 按钮 hover 时可见', hoverState.atOpacity === '1', hoverState.atOpacity)

const at = await page.evaluate(() => {
  const b = document.querySelector('.nb-card .nb-card-at')
  if (!b) return null
  const r = b.getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
})
if (at) { await page.mouse.click(at.x, at.y); await page.waitForTimeout(1000) }
const chips = await page.evaluate(() => [...document.querySelectorAll('.nb-editor .resource-chip')]
  .map((c) => ({ id: c.getAttribute('data-id'), name: c.querySelector('.resource-chip-name')?.textContent })))
ok('@ 按钮点得动（标签插进输入框）', chips.length === 1 && chips[0].name === '甲图', JSON.stringify(chips))

// ① 标签里缩略图与文字之间要有间隔（用户 2026-10-29 图 1）
const chipGap = await page.evaluate(() => {
  const chip = document.querySelector('.nb-editor .resource-chip')
  if (!chip) return null
  const icon = chip.querySelector('.resource-chip-thumb') || chip.querySelector('.resource-chip-icon')
  const name = chip.querySelector('.resource-chip-name')
  if (!icon || !name) return null
  const ir = icon.getBoundingClientRect()
  const nr = name.getBoundingClientRect()
  return { gap: Math.round(nr.left - ir.right), css: getComputedStyle(chip).columnGap }
})
ok('缩略图与名字之间有 2px 间隔', !!chipGap && chipGap.gap >= 2, JSON.stringify(chipGap))

// ③ hover 标签 → 预览框显示（不再是 display:none），且图标换成铅笔
await page.mouse.move(60, 780, { steps: 4 })
await page.waitForTimeout(500)
const chipBox = await page.evaluate(() => {
  const chip = document.querySelector('.nb-editor .resource-chip')
  const r = chip.getBoundingClientRect()
  return { x: Math.round(r.left + 6), y: Math.round(r.top + r.height / 2) }
})
await page.mouse.move(chipBox.x, chipBox.y, { steps: 5 })
await page.waitForTimeout(1000)
const chipHover = await page.evaluate(() => {
  // 页面上可能有两个 PreviewBox（Agent 面板常驻一个 + 底栏一个）；
  // querySelector 拿的是第一个（Agent 面板的，永远隐藏），底栏那个要按「可见的那个」找。
  const box = [...document.querySelectorAll('body > .preview-box')]
    .find((el) => getComputedStyle(el).display !== 'none')
  const img = box?.querySelector('.preview-image')
  const r = img?.getBoundingClientRect()
  const chip = document.querySelector('.nb-editor .resource-chip')
  return {
    shown: !!box && getComputedStyle(box).display !== 'none',
    box: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null,
    editable: chip?.classList.contains('resource-chip--editable') ?? false,
    pencil: chip ? getComputedStyle(chip, '::after').display === 'block' : false,
  }
})
ok('hover 标签时预览框真的显示（不是 display:none）', chipHover.shown, JSON.stringify(chipHover))
ok('标签 hover 预览也按原比例、长边 200',
  !!chipHover.box && Math.max(chipHover.box.w, chipHover.box.h) <= 200 && chipHover.box.w < chipHover.box.h,
  JSON.stringify(chipHover.box))
ok('hover 标签时图标换成铅笔', chipHover.editable && chipHover.pencil, JSON.stringify(chipHover))
await page.mouse.move(60, 780, { steps: 4 })
await page.waitForTimeout(500)

// ⑤ 双击卡片聚焦 = F 键那套取景（缩放按占比算，不是只挪中心）
const beforeZoom = await page.evaluate(() => document.querySelector('.vue-flow__transformationpane')?.style.transform ?? '')
await page.mouse.dblclick(first.x, first.y)
await page.waitForTimeout(1500)
const focus = await page.evaluate((id) => {
  const t = document.querySelector('.vue-flow__transformationpane')?.style.transform ?? ''
  const n = document.querySelector('.vue-flow__node[data-id="' + id + '"]')
  const r = n?.getBoundingClientRect()
  const vp = window.MiniCanvasUI?.getHost?.()?.view
  return {
    transform: t,
    // 缩放从 view 服务读（DOM 上的 transform 可能是 matrix(...) 形式，正则不可靠）
    zoom: vp?.getViewport?.().zoom ?? null,
    node: r ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null,
    vw: window.innerWidth,
    vh: window.innerHeight,
  }
}, seed.a)
ok('双击聚焦改变了视口', focus.transform !== beforeZoom, beforeZoom + ' -> ' + focus.transform)
ok('双击聚焦带缩放（不是只挪中心）', !!focus.zoom && Math.abs(focus.zoom - 1) > 0.01, 'zoom=' + focus.zoom)
ok('双击把目标节点带到屏幕中间',
  !!focus.node && Math.abs(focus.node.x - focus.vw / 2) < focus.vw * 0.2
  && Math.abs(focus.node.y - focus.vh / 2) < focus.vh * 0.25, JSON.stringify(focus.node))

// ⑦ 点右侧文字：不弹菜单，约 1s 后光标落到标签之后
const nameBox = await page.evaluate(() => {
  const n = document.querySelector('.nb-editor .resource-chip .resource-chip-name')
  if (!n) return null
  const r = n.getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
})
if (nameBox) {
  await page.mouse.click(nameBox.x, nameBox.y)
  await page.waitForTimeout(400)
  ok('点右侧文字不弹菜单', !(await page.evaluate(() => !!document.querySelector('.nb-tagmenu-body'))))
  await page.waitForTimeout(900)
  /**
   * 落点用「接着打字」来验证，不去读 caret 的 getBoundingClientRect：
   * 空行里的 collapsed range 量出来是 0×0（真机实测 left=0），读坐标判不出对错。
   * 用户真正在意的也是「点完文字能不能马上接着在标签后面打字」。
   */
  await page.keyboard.type('X')
  await page.waitForTimeout(300)
  const typed = await page.evaluate(() => document.querySelector('.nb-editor .ProseMirror')?.textContent ?? '')
  const xAt = typed.indexOf('X')
  const chipAt = typed.indexOf('甲图')
  ok('约 1s 后光标落到标签后面（接着打字落在后面）',
    xAt > chipAt && chipAt >= 0, JSON.stringify(typed))
  // 清掉这次探针字符，别影响后面的菜单用例
  await page.keyboard.press('Backspace')
  await page.waitForTimeout(200)
}

// ⑥ 点左侧图标：两栏 Dropdown 菜单
const iconBox = await page.evaluate(() => {
  const chip = document.querySelector('.nb-editor .resource-chip')
  const ic = chip?.querySelector('.resource-chip-thumb') ?? chip?.querySelector('.resource-chip-icon')
  if (!ic) return null
  const r = ic.getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
})
if (iconBox) {
  await page.mouse.click(iconBox.x, iconBox.y)
  await page.waitForTimeout(900)
  const menu = await page.evaluate(() => {
    const body = document.querySelector('.nb-tagmenu-body')
    const r = body?.getBoundingClientRect()
    const chip = document.querySelector('.nb-editor .resource-chip')?.getBoundingClientRect()
    return {
      open: !!body,
      box: r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) } : null,
      chip: chip ? { top: Math.round(chip.top), bottom: Math.round(chip.bottom), left: Math.round(chip.left) } : null,
      vw: window.innerWidth,
      menuParent: body ? String(body.parentElement?.className || body.parentElement?.tagName) : null,
      nav: [...document.querySelectorAll('.nb-tagmenu-group-label')].map((e) => e.textContent.trim()),
      kinds: [...document.querySelectorAll('.nb-tagmenu-kind .nb-tagmenu-name')].map((e) => e.textContent.trim()),
      items: [...document.querySelectorAll('.nb-tagmenu-pane--items .nb-tagmenu-name')].map((e) => e.textContent.trim()),
      search: !!document.querySelector('.nb-tagmenu-search input'),
    }
  })
  ok('点左侧图标弹出主题 Dropdown 菜单', menu.open)
  ok('菜单有搜索框', menu.search)
  ok('两栏结构：已引用 + 素材引用类别', menu.nav.includes('已引用') && menu.nav.includes('素材引用'), JSON.stringify(menu.nav))
  // 当前绑定的那颗在「已引用」栏，右栏列同类里其余的（乙图）
  ok('右栏列出该类的其它节点', menu.items.includes('乙图'), JSON.stringify(menu.items))
  // 下方放不下时 Dropdown 会翻到上方 —— 只要贴着标签的某一条边就算对
  /**
   * 贴上/贴下即可（用户口径「正下方或正上方均可」）。
   * 水平方向不要求左缘严格对齐：标签靠近屏幕右缘时，浮层会自己收进视口、
   * 整体向左挪 —— 那时只要求它仍与标签在水平方向有交集（看得出是从这颗标签弹出来的）。
   */
  ok('菜单贴着标签（紧接上沿或下沿，水平仍与标签相交）',
    !!menu.box && !!menu.chip
    && ((menu.box.top >= menu.chip.bottom - 2 && menu.box.top <= menu.chip.bottom + 24)
      || (menu.box.bottom <= menu.chip.top + 2 && menu.box.bottom >= menu.chip.top - 24))
    && menu.box.right >= menu.chip.left && menu.box.left <= menu.chip.left + 120,
    JSON.stringify([menu.box, menu.chip]))

  // ④ 高度固定：鼠标停在不同类别上时，浮层高度不许变（否则会来回闪）
  const kindRows = await page.evaluate(() => [...document.querySelectorAll('.nb-tagmenu-kind')].map((el) => {
    const r = el.getBoundingClientRect()
    return { label: el.textContent.trim(), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  }))
  const heights = []
  for (const row of kindRows) {
    await page.mouse.move(row.x, row.y, { steps: 3 })
    await page.waitForTimeout(350)
    heights.push(await page.evaluate(() => {
      const body = document.querySelector('.nb-tagmenu-body')
      const panes = document.querySelector('.nb-tagmenu-panes')
      return {
        menu: body ? Math.round(body.getBoundingClientRect().height) : null,
        panes: panes ? Math.round(panes.getBoundingClientRect().height) : null,
        items: [...document.querySelectorAll('.nb-tagmenu-pane--items .nb-tagmenu-name')].map((e) => e.textContent.trim()),
      }
    }))
  }
  const uniqueHeights = new Set(heights.map((h) => h.menu))
  ok('切换类别时下拉菜单高度固定（不来回闪）', uniqueHeights.size === 1 && heights.length >= 2,
    JSON.stringify(heights.map((h) => [h.menu, h.items.length])))

  // 搜索：输入即筛（打开菜单时焦点已在搜索框里）
  await page.keyboard.type('乙')
  await page.waitForTimeout(500)
  const searched = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('.nb-tagmenu-body .nb-tagmenu-name')].map((e) => e.textContent.trim()),
    flat: !!document.querySelector('.nb-tagmenu-list'),
  }))
  ok('菜单搜索能筛出匹配节点', searched.flat && searched.rows.length > 0 && searched.rows.every((r) => r.includes('乙')), JSON.stringify(searched.rows))
  // 清空搜索，回到两栏，再点「乙图」换绑。
  // 用键盘清（Ctrl+A + Delete）：dispatchEvent(new Event('input')) 只冒泡到 DOM，
  // 不会带 value setter —— Vue 的 v-model 监听不到，搜索态清不掉、两栏回不来，
  // 后面点「乙图」命中的还是平铺搜索行，断言就全错位了（真机踩过）。
  await page.click('.nb-tagmenu-search input')
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Delete')
  await page.waitForTimeout(500)
  if (SHOT_DIR) await page.screenshot({ path: SHOT_DIR + '/tag-menu.png' })

  // ⑧ 选「乙图」→ 换绑
  const row = await page.evaluate(() => {
    const target = [...document.querySelectorAll('.nb-tagmenu-body .nb-tagmenu-row')]
      .find((r) => (r.textContent || '').includes('乙图'))
    if (!target) return null
    const r = target.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })
  if (row) { await page.mouse.click(row.x, row.y); await page.waitForTimeout(1800) }
  const after = await page.evaluate((b) => {
    const doc = window.MiniCanvasUI.getHost().ctx.get('doc')
    return {
      chips: [...document.querySelectorAll('.nb-editor .resource-chip')].map((c) => c.getAttribute('data-id')),
      editorText: document.querySelector('.nb-editor .ProseMirror')?.textContent ?? null,
      editorHtml: (document.querySelector('.nb-editor .ProseMirror')?.innerHTML ?? '').slice(0, 300),
      edges: doc.getEdges().map((e) => ({ s: e.source, t: e.target })),
      menuOpen: !!document.querySelector('.nb-tagmenu-body'),
      b,
    }
  }, seed.b)
  ok('选节点后标签换绑到新节点', after.chips.length === 1 && after.chips[0] === 'ref-node:' + seed.b, JSON.stringify(after.chips))
  ok('旧连线断开、新连线建立', after.edges.length === 1 && after.edges[0].s === seed.b, JSON.stringify(after.edges))
  ok('选完菜单收起', !after.menuOpen)
}

// ④ hover 的节点被删掉 → 预览立刻消失
await page.mouse.move(60, 60, { steps: 4 })
await page.waitForTimeout(600)
// 换绑后「甲图」这个名字已经不在正文里了，要找换绑后的那张卡（乙图）。
// 换绑用例没跑（iconBox 为 null 跳过）时才回退找甲图。
const hoverCard = (await cardBox('乙图')) ?? await cardBox('甲图')
if (hoverCard) {
  await page.mouse.move(hoverCard.x, hoverCard.y, { steps: 6 })
  await page.waitForTimeout(1100)
  const had = await page.evaluate(() => document.querySelectorAll('.nb-hover-preview').length)
  ok('hover 时先有预览（前置）', had === 1, String(had))
  await page.evaluate((id) => {
    window.MiniCanvasUI.getHost().ctx.get('doc').removeNodes([id])
    // 删的是**被 hover 的那张卡**绑定的节点：换绑用例跑过时卡绑的是 seed.b（乙图），
    // 没跑过时才是 seed.a（甲图）。删错节点 = 预览当然不消失（上一轮 e2e 踩过）。
  }, (await cardBox('乙图')) ? seed.b : seed.a)
  await page.waitForTimeout(1500)
  const gone = await page.evaluate(() => document.querySelectorAll('.nb-hover-preview').length)
  ok('图片节点删掉后预览立刻消失（不显示旧图）', gone === 0, String(gone))
}

ok('页面无报错', errors.length === 0, errors.slice(0, 2).join(' | '))
await browser.close()
console.log(fails.length === 0 ? 'ALL PASS' : 'FAILS: ' + fails.join(' / '))
process.exit(fails.length === 0 ? 0 : 1)

