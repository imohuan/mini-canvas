// @ts-nocheck
// 对分组色板截图（临时诊断脚本，非测试）
import { chromium } from 'playwright-core'
import { existsSync } from 'node:fs'

const EXE = process.env.CANVAS_E2E_CHROME
  ?? 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = process.env.ASSET_BASE ?? 'http://127.0.0.1:5291'
const CANVAS_ID = process.env.CANVAS_ID ?? '430c8f1f00bd4aba'
if (!existsSync(EXE)) { console.error('chromium 不存在:', EXE); process.exit(2) }

// vite dev server 只监听 ::1（IPv6）：127.0.0.1 连不上 → 统一换 localhost（同一台机、同一个服务）。
const origin = (() => {
  try {
    const u = new URL(BASE)
    if (u.hostname === '127.0.0.1') u.hostname = 'localhost'
    return u.origin
  } catch { return BASE.replace(/\/+$/, '') }
})()

// ==================== 后台小工具（Node 侧 fetch：取快照 / 造临时文件夹 / 还原） ====================
const jsonInit = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
async function api(path, init) {
  const res = await fetch(origin + path, init)
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body?.ok === false) throw new Error((init?.method ?? 'GET') + ' ' + path + ' → HTTP ' + res.status + ' ' + (body?.error ?? ''))
  return body
}
const apiFolders = async () => (await api('/api/asset-folders')).folders ?? []
const apiAssets = async () => (await api('/api/assets')).assets ?? []
/** anc 是不是 id 的祖先（严格祖先：沿 parentId 往上找能得到 anc） */
function isAncestor(folders, anc, id) {
  let cur = id
  const seen = new Set()
  while (cur) {
    if (seen.has(cur)) return false
    seen.add(cur)
    const f = folders.find((x) => x.id === cur)
    if (!f) return false
    if ((f.parentId ?? '') === anc) return true
    cur = f.parentId
  }
  return false
}

// ==================== 用例统计 ====================
const results = []
const check = (n, ok, d = '') => { results.push({ n, ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (d ? '  -- ' + d : '')) }
const info = (s) => console.log('[信息] ' + s)

// ==================== 开场数据快照 + 临时文件夹 ====================
let tempFolder = null
let foldersSnap = new Map()
let assetsSnap = new Map()
try {
  for (const f of await apiFolders()) foldersSnap.set(f.id, f.parentId ?? '')
  for (const a of await apiAssets()) assetsSnap.set(a.id, a.folderId ?? '')
  tempFolder = (await api('/api/asset-folders', jsonInit('POST', { name: 'e2e-临时' }))).folder
  info('临时文件夹 e2e-临时 = ' + tempFolder.id + '（拖拽用例的目标；结束时会删掉）')
} catch (err) {
  console.error('打不开后台 ' + origin + ' 或建临时文件夹失败:', String(err.message ?? err))
  process.exit(2)
}

const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 200)))
/** 拖拽是否真的产生了原生 dragstart（headless 下偶发不产生 → 有合成兜底） */
await page.addInitScript(() => { window.__dragStarted = false; document.addEventListener('dragstart', () => { window.__dragStarted = true }, true) })

// 断言「发出了哪个请求」靠这张表
const requests = []
page.on('request', (r) => { requests.push({ method: r.method(), url: r.url(), post: r.postData() ?? '' }) })
const pathOf = (u) => { try { return new URL(u).pathname } catch { return u } }
const reqSince = (re, from) => requests.slice(from).find((r) => re.test(pathOf(r.url))) ?? null
async function waitReqSince(re, from, ms = 5000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const hit = reqSince(re, from)
    if (hit) return hit
    await page.waitForTimeout(100)
  }
  return null
}
const RE_FOLDER_PATCH = /^\/api\/asset-folders\/[^/]+$/
const RE_ASSET_BATCH = /^\/api\/assets\/batch$/

// ==================== 页面小工具 ====================
const drawer = page.locator('.left-drawer')
const drawerTree = page.locator('.left-drawer .asset-tree[data-variant="drawer"]')
/** 每个用例前：确保左侧抽屉开着 + 停在「资产」tab */
async function ensureDrawerAssets() {
  if ((await drawer.count()) === 0) {
    await page.getByRole('button', { name: '资产管理' }).first().click() // 底栏按钮（抽屉关着时才在）
    await page.waitForTimeout(700)
  }
  await page.getByRole('tab', { name: '资产' }).click()
  await page.waitForTimeout(1200)
}
const rowLoc = (id) => drawerTree.locator('[data-asset-row][data-row-id="' + id + '"]')
/** 行上的计算样式（悬停视觉断言用；outline 要看「画没画出来」= style 不是 none） */
const rowStyle = (loc) => loc.evaluate((el) => {
  const cs = getComputedStyle(el)
  return {
    outlineWidth: cs.outlineWidth, outlineStyle: cs.outlineStyle,
    shadow: cs.boxShadow, borderWidth: cs.borderTopWidth, bg: cs.backgroundColor,
  }
})
/** 有可见描边吗（outline 画出来 / 边框宽度不为 0）——契约要求「背景 + 阴影，没有边框边框和 ring」 */
const hasPaintedStroke = (s) => (s.outlineStyle !== 'none' && s.outlineWidth !== '0px') || (parseFloat(s.borderWidth) || 0) > 0
async function rowsInfo() {
  return drawerTree.locator('[data-asset-row]').evaluateAll((els) => els.map((e) => ({
    id: e.getAttribute('data-row-id'),
    kind: e.getAttribute('data-row-kind'),
    text: (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
  })))
}

// ==================== 拖拽：三种模式按可用性降级 ====================
//   cdp   = CDP Input.setInterceptDrags + dispatchDragEvent（真正的原生拖拽事件序列，能停在悬停那一刻断言）
//   mouse = 真鼠标按下拖动（原生 dragstart）+ 合成 dragover/drop（用来可控地停在悬停这一刻）
//   synth = 全程合成事件（连 dragstart 都由脚本派发）
let cdp = null
let intercepted = null
try {
  cdp = await page.context().newCDPSession(page)
  cdp.on('Input.dragIntercepted', (e) => { intercepted = e.data })
  await cdp.send('Input.setInterceptDrags', { enabled: true })
} catch { cdp = null }

async function beginDrag(fromLoc, toLoc) {
  const fb = await fromLoc.boundingBox()
  const tb = await toLoc.boundingBox()
  if (!fb || !tb) throw new Error('拖拽源/目标行看不到（boundingBox 为空）')
  const from = { x: fb.x + fb.width * 0.55, y: fb.y + fb.height / 2 } // 行中部（避开左侧勾选框/折叠箭头）
  const to = { x: Math.round(tb.x + tb.width * 0.5), y: Math.round(tb.y + tb.height / 2) }
  const session = { to, mode: 'synth', data: null }
  await page.evaluate(() => { window.__dragStarted = false })
  intercepted = null
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  const dir = to.y >= from.y ? 1 : -1
  for (let i = 1; i <= 3; i++) { await page.mouse.move(from.x + i * 12, from.y + dir * i * 4); await page.waitForTimeout(40) }
  if (cdp) {
    const t0 = Date.now()
    while (!intercepted && Date.now() - t0 < 1500) await page.waitForTimeout(100)
    if (intercepted) {
      session.mode = 'cdp'
      session.data = intercepted
      await cdp.send('Input.dispatchDragEvent', { type: 'dragEnter', x: to.x, y: to.y, data: session.data })
      await cdp.send('Input.dispatchDragEvent', { type: 'dragOver', x: to.x, y: to.y, data: session.data })
      await page.waitForTimeout(200)
      return session
    }
    try { await cdp.send('Input.setInterceptDrags', { enabled: false }) } catch { /* 关掉拦截，退回 mouse 模式 */ }
  }
  session.mode = 'mouse'
  if (!(await page.evaluate(() => window.__dragStarted === true))) {
    session.mode = 'synth'
    await fromLoc.evaluate((el) => { const dt = new DataTransfer(); el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt })) })
  }
  // 悬停到目标行：合成一个同类型的 dragover，用来精确停在这一刻做断言
  await toLoc.evaluate((el) => {
    const r = el.getBoundingClientRect()
    el.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, dataTransfer: new DataTransfer() }))
  })
  await page.waitForTimeout(200)
  return session
}
async function endDrag(session, toLoc) {
  try {
    if (session.mode === 'cdp' && session.data) {
      await cdp.send('Input.dispatchDragEvent', { type: 'drop', x: session.to.x, y: session.to.y, data: session.data })
    } else {
      await toLoc.evaluate((el) => el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() })))
    }
  } catch { /* drop 失败也算：下面照样抬鼠标，保证不卡住后续步骤 */ }
  await page.mouse.up()
  await page.waitForTimeout(700)
}

// ==================== 跑用例 ====================
let restoredFolders = 0
let restoredAssets = 0
try {
  await page.goto(origin + '/#/canvas/' + CANVAS_ID, { waitUntil: 'load' })
  await page.waitForTimeout(3500)

  // ---- 1. 侧边栏资产 tab：共用树（drawer 变体） ----
  await ensureDrawerAssets()
  const treeCount = await drawerTree.count()
  const rowCount = treeCount ? await drawerTree.locator('[data-asset-row]').count() : 0
  check('1. 侧边栏资产 tab 有 .asset-tree[data-variant=drawer] 且含 [data-asset-row]', treeCount > 0 && rowCount > 0, 'tree=' + treeCount + ' rows=' + rowCount)
  const drawerRows = await rowsInfo()
  info('抽屉行：' + JSON.stringify(drawerRows))

  // ---- 2. 资产管理弹窗：共用树（dialog 变体） ----
  await drawer.getByRole('button', { name: '资产管理' }).click()
  await page.waitForTimeout(800)
  const dialog = page.locator('[role=dialog][aria-label="资产管理"]')
  const dialogCount = await dialog.count()
  const dialogTree = dialog.locator('.asset-tree[data-variant="dialog"]')
  const dialogTreeCount = dialogCount ? await dialogTree.count() : 0
  const dialogRows = dialogTreeCount ? await dialogTree.locator('[data-asset-row]').count() : 0
  check('2. 弹窗（role=dialog 资产管理）里有 .asset-tree[data-variant=dialog]', dialogTreeCount > 0 && dialogRows > 0, 'dialog=' + dialogCount + ' tree=' + dialogTreeCount + ' rows=' + dialogRows)
  if (dialogCount) { await dialog.locator('button[aria-label="关闭"]').first().click(); await page.waitForTimeout(600) }

  // ---- 3. 右键文件夹行 → .dd-menu 且菜单里有「移动到」 ----
  await ensureDrawerAssets()
  const rows3 = await rowsInfo()
  const folderRows = rows3.filter((r) => r.kind === 'folder')
  if (folderRows.length < 2) throw new Error('抽屉里可见的文件夹行不足 2 个（右键用例要先有一个文件夹行）：' + JSON.stringify(rows3))
  // 右键第 2 个文件夹行（不是第一个）：它的「移动到」列表里会有别的具体文件夹，下面的点选用例能真的挪一下
  const ctxRow = folderRows[1]
  await rowLoc(ctxRow.id).click({ button: 'right' })
  await page.waitForTimeout(600)
  let menu = page.locator('.dd-menu').last()
  let menuCount = await page.locator('.dd-menu').count()
  let moveSubCount = menuCount ? await menu.locator('.ax-sub-row', { hasText: '移动到' }).count() : 0
  check('3. 右键文件夹行打开 .dd-menu 且菜单含「移动到」', menuCount > 0 && moveSubCount > 0, 'menu=' + menuCount + ' 移动到行=' + moveSubCount + ' 行=' + ctxRow.id)

  // ---- 4. 二级菜单点得动：悬停「移动到」→ 点一个具体文件夹 → 发出 PATCH /api/asset-folders/<id> ----
  const moveRow = menu.locator('.ax-sub-row', { hasText: '移动到' }).first()
  await moveRow.hover()
  await page.waitForTimeout(500)
  const sub = page.locator('.dd-menu.ax-sub-menu').last()
  const subCount = await page.locator('.dd-menu.ax-sub-menu').count()
  const subItems = subCount ? await sub.locator('.ax-menu-item').allInnerTexts() : []
  const concrete = sub.locator('.ax-menu-item').filter({ hasNotText: '根目录' })
  const concreteCount = subCount ? await concrete.count() : 0
  let patchReq = null
  let subGone = null
  if (concreteCount > 0) {
    const from = requests.length
    await concrete.first().click({ timeout: 5000 }).catch(() => {})
    patchReq = await waitReqSince(RE_FOLDER_PATCH, from, 5000)
    await page.waitForTimeout(600)
    subGone = (await page.locator('.dd-menu.ax-sub-menu').count()) === 0
  }
  check('4. 二级菜单能点到（点具体文件夹 → 发出 PATCH /api/asset-folders/<id>）', !!patchReq,
    '二级项=' + JSON.stringify(subItems) + ' 命中=' + (patchReq ? patchReq.method + ' ' + pathOf(patchReq.url) : '无请求') + ' 菜单已关=' + subGone)
  // 关掉可能还开着的菜单（别挡住后面的拖拽）
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)

  // ---- 5. 拖文件夹 → 文件夹：过程中 is-drop-over（背景+阴影，无 outline），松手发出 PATCH /api/asset-folders/ ----
  await ensureDrawerAssets()
  const rows5 = await rowsInfo()
  const folders5 = await apiFolders()
  // 选一对「契约允许高亮」的文件夹行：
  //   - 目标不能是自己
  //   - 目标不能是源「当前的父级」（原地不动，canDropOn 按设计不提示）
  //   - 目标不能是源的子孙（会成环，后台也拒绝；抽屉/弹窗里悬停时就不该高亮）
  // 优先拿自己建的临时文件夹当源（它建在根上，没有子孙，最保险）。
  const dragSources = [
    ...rows5.filter((r) => r.kind === 'folder' && r.id === tempFolder.id),
    ...rows5.filter((r) => r.kind === 'folder' && r.id !== tempFolder.id),
  ]
  const pairs = []
  for (const a of dragSources) {
    for (const b of rows5.filter((r) => r.kind === 'folder')) {
      if (a.id === b.id) continue
      const fa = folders5.find((f) => f.id === a.id)
      if ((fa?.parentId ?? '') === b.id) continue
      if (isAncestor(folders5, a.id, b.id)) continue
      pairs.push([a, b])
    }
  }
  if (!pairs.length) throw new Error('找不到可拖拽的文件夹对（需要至少两个互不为父子/父级的文件夹行）')
  const [src5, dst5] = pairs[0]
  const styleBefore5 = await rowStyle(rowLoc(dst5.id))
  const fromReq5 = requests.length
  const s5 = await beginDrag(rowLoc(src5.id), rowLoc(dst5.id))
  const targetCls = (await rowLoc(dst5.id).getAttribute('class')) ?? ''
  const style5 = await rowStyle(rowLoc(dst5.id))
  check('5a. 拖拽悬停目标行带 class is-drop-over', /\bis-drop-over\b/.test(targetCls), 'mode=' + s5.mode + ' class="' + targetCls.slice(0, 90) + '"')
  // 视觉口径（用户，两版原话）：
  //   第一版「不要边框，只给一个 over 的背景，一个灰色阴影就行」
  //   → 实测后改成「拖拽上去有那种灰色的背景…我感觉你好像设置了什么阴影，把这个阴影给去掉」
  // 定稿 = **只有背景**：有底色、没有阴影、没有 border / ring / outline。
  // 说明：Chromium 里「没有 outline」是 outline-style:none（outline-width 仍报 UA 默认的 3px），
  // 所以断言的是"有没有真的画出来"；阴影必须保持 none（改回阴影就是改口径，得同步改这条）。
  check('5b. 悬停视觉 = 只有背景（无阴影、无 outline、无边框）',
    !hasPaintedStroke(style5) && style5.shadow === 'none' && style5.bg !== 'rgba(0, 0, 0, 0)',
    '悬停前 box-shadow=' + styleBefore5.shadow + ' background=' + styleBefore5.bg + ' | 悬停后 outline=' + style5.outlineWidth + '/' + style5.outlineStyle +
    ' border-top-width=' + style5.borderWidth + ' box-shadow=' + String(style5.shadow).slice(0, 40) + ' background=' + style5.bg)
  await endDrag(s5, rowLoc(dst5.id))
  const req5 = await waitReqSince(RE_FOLDER_PATCH, fromReq5, 5000)
  check('5c. 松手后发出 PATCH /api/asset-folders/<id>', !!req5, req5 ? req5.method + ' ' + pathOf(req5.url) + ' body=' + req5.post : '无请求（mode=' + s5.mode + '）')

  // ---- 6. 拖资产 → 文件夹：发出 /api/assets/batch ----
  await ensureDrawerAssets()
  const rows6 = await rowsInfo()
  const folders6 = await apiFolders()
  const assets6 = await apiAssets()
  const assetRow = rows6.find((r) => r.kind === 'asset')
  if (!assetRow) throw new Error('抽屉里没有可见的资产行（data-row-kind=asset）')
  const assetNow = assets6.find((a) => a.id === assetRow.id)
  const dst6 = rows6.filter((r) => r.kind === 'folder' && r.id !== (assetNow?.folderId ?? '')).find((r) => r.id === tempFolder.id)
    ?? rows6.find((r) => r.kind === 'folder' && r.id !== (assetNow?.folderId ?? ''))
  if (!dst6) throw new Error('找不到可接收资产的文件夹行')
  const fromReq6 = requests.length
  const s6 = await beginDrag(rowLoc(assetRow.id), rowLoc(dst6.id))
  const cls6 = (await rowLoc(dst6.id).getAttribute('class')) ?? ''
  await endDrag(s6, rowLoc(dst6.id))
  const req6 = await waitReqSince(RE_ASSET_BATCH, fromReq6, 5000)
  check('6. 拖资产到文件夹后发出 /api/assets/batch', !!req6,
    (req6 ? req6.method + ' ' + pathOf(req6.url) + ' body=' + req6.post : '无请求') + ' mode=' + s6.mode + ' 目标行悬停高亮=' + /\bis-drop-over\b/.test(cls6) + ' 资产=' + assetRow.id + ' 目标=' + dst6.id)
} catch (err) {
  check('用例执行未中断到结尾', false, String(err?.message ?? err).slice(0, 300))
} finally {
  // ==================== 清理：还原被挪动的条目 + 删掉临时文件夹 ====================
  try {
    for (let pass = 0; pass < 4; pass++) {
      const now = await apiFolders()
      const todo = now.filter((f) => f.id !== tempFolder.id && (foldersSnap.get(f.id) ?? '') !== (f.parentId ?? ''))
      if (!todo.length) break
      for (const f of todo) { await api('/api/asset-folders/' + f.id, jsonInit('PATCH', { parentId: foldersSnap.get(f.id) ?? '' })); restoredFolders++ }
    }
    for (const a of await apiAssets()) {
      if (a.id === undefined) continue
      if ((assetsSnap.get(a.id) ?? '') === (a.folderId ?? '')) continue
      await api('/api/assets/batch', jsonInit('POST', { ids: [a.id], folderId: assetsSnap.get(a.id) || undefined }))
      restoredAssets++
    }
    const left = (await apiFolders()).filter((f) => f.id !== tempFolder.id && (foldersSnap.get(f.id) ?? '') !== (f.parentId ?? ''))
    await api('/api/asset-folders/' + tempFolder.id, { method: 'DELETE' })
    info('清理：已删临时文件夹 e2e-临时（' + tempFolder.id + '）；文件夹还原 ' + restoredFolders + ' 次、资产还原 ' + restoredAssets + ' 次' +
      (left.length ? '；⚠ 仍有未还原：' + JSON.stringify(left) : ''))
  } catch (err) {
    info('⚠ 清理没走完（可能有残留，请手工看一眼）：' + String(err?.message ?? err))
  }
  try { if (cdp) await cdp.send('Input.setInterceptDrags', { enabled: false }) } catch { /* ignore */ }
  await browser.close()
}

if (pageErrors.length) console.log('页面错误:', pageErrors.slice(0, 2).join(' | '))
const failed = results.filter((r) => !r.ok)
console.log('\n合计 ' + results.length + ' 项，通过 ' + (results.length - failed.length) + '，失败 ' + failed.length)
process.exit(failed.length ? 1 : 0)
