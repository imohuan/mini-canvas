// @ts-nocheck
// canvas-chip-menu-check —— 画布下拉的行尾菜单（勾 ⇄ 三个点 + 四项操作）真机验证。
//
// 跑法：
//   1) 起后台：pnpm -C packages/cloud-server serve   （:8865，页面由它托管）
//   2) 跑本脚本：node packages/ui/e2e/canvas-chip-menu-check.mjs
//
// 验的是用户口径（2026-10-09，附效果图）这条链：
//   ① 当前画布那一行显示勾；② hover 到该行 → 勾换成三个点；
//   ③ 点三个点 → 弹出该画布的操作菜单，四项都在；
//   ④ 四个动作都是真实现：复制会多出一张、重命名会改名、删除会少一张、新窗口会开新标签页。
import { chromium } from 'playwright-core'
import { existsSync } from 'node:fs'

const EXE = process.env.CANVAS_E2E_CHROME
  ?? 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = process.env.CANVAS_BASE ?? 'http://127.0.0.1:8865'
if (!existsSync(EXE)) { console.error('chromium 不存在:', EXE); process.exit(2) }

const results = []
const check = (n, ok, d = '') => { results.push({ n, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -- ' + d : ''}`) }
const api = async (p, init) => (await fetch(BASE + p, init)).json()

const browser = await chromium.launch({ executablePath: EXE, headless: true })
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } })
const page = await ctx.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 200)))
const warnings = []
page.on('console', (m) => { if (m.type() !== 'log') warnings.push(m.type() + ': ' + m.text().slice(0, 160)) })
const deletes = []
page.on('response', (r) => { if (r.request().method() === 'DELETE') deletes.push(r.url() + ' -> ' + r.status()) })

/** 直接用接口造一张干净的实验画布，并切到它（不动别的画布） */
const projects = await api('/api/projects')
const pid = projects.projects[0].id
const made = await api(`/api/projects/${pid}/canvases`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '芯片菜单验证' }),
})
const CID = made.canvas.id

await page.goto(`${BASE}/#/canvas/${CID}`, { waitUntil: 'load' })
await page.waitForTimeout(2500)

// 节点用**页面自己**建（不能用接口预置：画布一挂载就会把它那份空状态推回服务器，预置的被抹掉）。
// 建两个文本节点，顺便等落盘（复制要拷的就是这份真数据）。
for (let i = 0; i < 2; i++) {
  await page.getByRole('button', { name: '添加节点' }).first().click()
  await page.getByRole('menuitem', { name: '文本', exact: true }).first().click()
  await page.waitForTimeout(700)
}
await page.waitForTimeout(1500)
const seeded = await api(`/api/canvases/${CID}`)
// 新画布首帧会带一份种子节点（见 assembly.seedDefaultCanvas），所以这里只断「有节点且都落盘了」
check('准备：画布里有节点并已落盘', seeded.nodes.length >= 2, `节点数=${seeded.nodes.length}`)

const chip = page.getByLabel('当前画布')
check('画布 chip 在页面上（左上角块 A）', (await chip.count()) >= 1)

// 列表 = 带画布行的那个**浮层**（操作菜单里没有 .canvas-row）。
// 用 .dd-menu 而不是 [role=menu]：每个浮层里外两层都带 role=menu（面板 + AxMenu），按 role 数会翻倍。
const list = page.locator('.dd-menu').filter({ has: page.locator('.canvas-row') })
const rows = list.locator('.canvas-row')
const activeRow = list.locator('.canvas-row.is-active')

/** 打开画布列表（已经开着就什么都不做 —— 它现在会一直留着，再点触发器反而会关掉） */
const openList = async () => {
  if ((await list.count()) === 0) {
    await chip.first().click()
    await page.waitForTimeout(600)
  }
}
/** 点当前画布那一行的「⋯」，弹出它的操作菜单 */
const openActionsForCurrent = async () => {
  await openList()
  await list.locator('.canvas-row.is-active .canvas-row-more').click()
  await page.waitForTimeout(700)
}
await openList()
check('下拉列出画布，且当前那张被标成选中行', (await rows.count()) >= 1 && (await activeRow.count()) === 1,
  `行数=${await rows.count()} 选中行=${await activeRow.count()}`)

// ① 选中行显示勾（opacity=1）、三个点不显（opacity=0）
const readOpacity = (sel) => activeRow.locator(sel).first().evaluate((el) => getComputedStyle(el).opacity)
const checkBefore = await readOpacity('.canvas-row-check')
const dotsBefore = await readOpacity('.canvas-row-dots')
check('① 选中行常显勾（三个点不显）', checkBefore === '1' && dotsBefore === '0',
  `勾=${checkBefore} 点=${dotsBefore}`)

// ② hover 到该行 → 勾让位、三个点显形
await activeRow.hover()
await page.waitForTimeout(400)
const checkAfter = await readOpacity('.canvas-row-check')
const dotsAfter = await readOpacity('.canvas-row-dots')
check('② hover 到该行 → 勾换成三个点', checkAfter === '0' && dotsAfter === '1',
  `勾=${checkAfter} 点=${dotsAfter}`)

// ③ 点三个点 → 弹出操作菜单（四项）
await openActionsForCurrent()
const actionMenu = page.locator('.dd-menu').last()
const items = (await actionMenu.locator('.ax-menu-item').allInnerTexts()).map((t) => t.trim())
check('③ 点三个点弹出操作菜单，四项都在',
  ['在新窗口打开', '重命名画布', '复制画布', '删除画布'].every((x) => items.includes(x)),
  JSON.stringify(items))
// ③-b 两个菜单**并存**：画布列表不能被顶掉（用户口径 2026-10-09）
const listRowsNow = await list.locator('.canvas-row').count()
check('③-b 画布列表没消失，两个菜单并排',
  (await list.count()) === 1 && listRowsNow >= 1 && (await page.locator('.dd-menu').count()) === 2,
  `列表${await list.count()}个（${listRowsNow}行）、浮层${await page.locator('.dd-menu').count()}个`)
// ③-b2 连着点**另一行**的「⋯」：同一份菜单要跟着挪到那一行旁边（不留在原处）
const otherRow = list.locator('.canvas-row').nth(1)
const otherBox = await otherRow.locator('.canvas-row-more').boundingBox()
await otherRow.locator('.canvas-row-more').click()
await page.waitForTimeout(800)
const actBox = await page.locator('.dd-menu').last().boundingBox()
check('③-b2 点另一行的「⋯」→ 菜单跟着挪到那一行旁边',
  !!actBox && !!otherBox && Math.abs(actBox.y - otherBox.y) < 60 && actBox.x > otherBox.x,
  `按钮=${JSON.stringify(otherBox && { x: Math.round(otherBox.x), y: Math.round(otherBox.y) })} 菜单=${JSON.stringify(actBox && { x: Math.round(actBox.x), y: Math.round(actBox.y) })}`)
// ③-c 点**父面板里不是按钮的那块**（列表标题「画布」）→ 只关操作菜单、列表留着。
// 这条正是「点父面板只关子菜单」那条分支：它依赖子菜单的点外判定只认自己的 id。
const menusBefore = await page.locator('.dd-menu').count()
await list.locator('.canvas-menu-head').click({ force: true })
await page.waitForTimeout(700)
const menusAfter = await page.locator('.dd-menu').count()
const survivors = await page.locator('.dd-menu').allInnerTexts()
check('③-c 点父面板只关操作菜单、列表仍在',
  menusAfter === menusBefore - 1 && menusAfter >= 1 && (await list.count()) === 1,
  `浮层 ${menusBefore} -> ${menusAfter}；活下来的是=${JSON.stringify(survivors.map((s) => s.slice(0, 24)))}`)
// 重新点开操作菜单（上面收掉了），继续验四个动作
await openActionsForCurrent()

// ④-1 复制画布：清单 +1、副本名字带「副本」、节点数一致且视口不带走
const before = (await api(`/api/projects/${pid}/canvases`)).canvases.length
await actionMenu.locator('.ax-menu-item', { hasText: '复制画布' }).first().click()
await page.waitForTimeout(1800)
const afterList = (await api(`/api/projects/${pid}/canvases`)).canvases
const copy = afterList.find((c) => c.name.includes('副本'))
check('④-1 复制画布真的多出一张（名字带「副本」）', afterList.length === before + 1 && !!copy,
  `${before} -> ${afterList.length}，副本=${copy?.name}`)
if (copy) {
  const src = await api(`/api/canvases/${CID}`)
  const dst = await api(`/api/canvases/${copy.id}`)
  check('④-1b 副本带上了全部节点、视口没被带走',
    dst.nodes.length === src.nodes.length && src.nodes.length >= 2 && dst.view === null,
    `节点 ${src.nodes.length} -> ${dst.nodes.length}，view=${JSON.stringify(dst.view)}`)
}

// ④-2 重命名：先把 window.prompt 换成固定答案，再走菜单（原生弹框在无头里没法交互）
await page.evaluate(() => { window.prompt = () => '芯片改名验证' })
await openActionsForCurrent()
await page.locator('.dd-menu').last().locator('.ax-menu-item', { hasText: '重命名画布' }).first().click()
await page.waitForTimeout(1500)
const renamed = (await api(`/api/projects/${pid}/canvases`)).canvases.find((c) => c.id === CID)
check('④-2 重命名画布真的改了名（写回后端）', renamed?.name === '芯片改名验证', `名字=${renamed?.name}`)

// ④-3 在新窗口打开：应开出一个新标签页，地址带该画布 id
const tabsBefore = ctx.pages().length
await openActionsForCurrent()
const [newTab] = await Promise.all([
  ctx.waitForEvent('page', { timeout: 5000 }).catch(() => null),
  page.locator('.dd-menu').last().locator('.ax-menu-item', { hasText: '在新窗口打开' }).first().click(),
])
await page.waitForTimeout(1200)
check('④-3 「在新窗口打开」真开了新标签页（地址就是这张画布）',
  !!newTab && newTab.url().includes('#/canvas/' + CID) && ctx.pages().length === tabsBefore + 1,
  `标签 ${tabsBefore} -> ${ctx.pages().length}，url=${newTab?.url()}`)
// 关掉新标签：它还挂着画布应用，会在下一次保存里**把已删的画布文件夹写回来**
// （真机实测：于是目录里多出一个没索引的孤儿，列表又把它当成一张画布列出来）。
if (newTab) await newTab.close()
await page.bringToFront()
await page.waitForTimeout(300)

// ④-4 删除画布：清单 -1；删的正是当前这张时页面要跳到剩下那张（不停在已不存在的 hash 上）
const beforeDel = (await api(`/api/projects/${pid}/canvases`)).canvases.length
await page.evaluate(() => { window.confirm = () => true })
await openActionsForCurrent()
const delItem = page.locator('.dd-menu').last().locator('.ax-menu-item', { hasText: '删除画布' })
check('④-4a 删除项在菜单里（当前画布可删）', (await delItem.count()) === 1, `找到 ${await delItem.count()} 个删除项`)
await delItem.first().click()
await page.waitForTimeout(2000)
const afterDel = (await api(`/api/projects/${pid}/canvases`)).canvases
check('④-4 删除画布真的少了一张', afterDel.length === beforeDel - 1,
  `${beforeDel} -> ${afterDel.length}；DELETE 请求=${JSON.stringify(deletes)}；控制台=${JSON.stringify(warnings.slice(-3))}`)
check('④-4b 删掉当前画布后自动跳到剩下那张（hash 不再是已删的）',
  !page.url().includes(CID) && page.url().includes('#/canvas/'), `url=${page.url()}`)

// 收尾：清掉这次验证造出来的画布（不留垃圾数据）
const leftovers = (await api(`/api/projects/${pid}/canvases`)).canvases.filter((c) => c.name.includes('副本'))
for (const c of leftovers) await fetch(BASE + '/api/canvases/' + c.id, { method: 'DELETE' })
const stillThere = (await api(`/api/projects/${pid}/canvases`)).canvases.filter((c) => c.name.includes('芯片'))
for (const c of stillThere) await fetch(BASE + '/api/canvases/' + c.id, { method: 'DELETE' })

await browser.close()
const failed = results.filter((r) => !r.ok)
if (pageErrors.length) console.log('页面错误:', pageErrors.slice(0, 2).join(' | '))
console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`)
process.exit(failed.length ? 1 : 0)
