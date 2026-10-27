// @ts-nocheck
/**
 * chip-caret-probe —— 验「点标签后光标只跳一次」。
 *
 * 用户口径（2026-10-27）：点输入框里的资源标签 → 先整颗选中 → 0.5s 后光标落到标签**之后**。
 * 曾经的毛病：选中后浏览器先把原生光标放到标签**前**，ProseMirror 读到后派发一条
 * 文本光标事务，于是用户看到「先跳到前、再跳到后」两次。
 *
 * 跑法：先起服务（8865），再 `node packages/ui/e2e/chip-caret-probe.mjs`。
 */
import { chromium } from 'playwright-core'

const EXE = process.env.AGENT_E2E_CHROME
  ?? 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
// 直接进画布路由：首页还要先点「新建画布」才有节点
const BASE = process.env.AGENT_BASE ?? 'http://127.0.0.1:8865/'
const CANVAS_URL = BASE + '#/canvas/default'

const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
const fails = []
const ok = (name, cond, detail = '') => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  -- ' + detail : ''))
  if (!cond) fails.push(name)
}

await page.goto(CANVAS_URL, { waitUntil: 'load' })
await page.waitForTimeout(5000)

// 空白新画布没有节点：自己造一个图片节点（与 canvas-e2e 同款 API）
await page.evaluate(() => {
  const doc = window.MiniCanvasUI?.getHost?.()?.ctx?.get?.('doc')
  if (!doc) return
  if (doc.getNodes().some((n) => n.type === 'image')) return
  doc.addNodes([{ id: 'probe-image-1', type: 'image', position: { x: 120, y: 140 }, data: {} }])
})
await page.waitForTimeout(1200)

// 1) 选一个图片节点，等底栏出现
const node = page.locator('.vue-flow__node-image').first()
if ((await node.count()) === 0) {
  console.log('SKIP：画布上没有图片节点')
  await browser.close()
  process.exit(0)
}
const box = await node.boundingBox()
await page.mouse.click(box.x + box.width / 2, box.y + 24)
await page.waitForTimeout(1200)

const editor = page.locator('.nb-shell .ProseMirror').first()
ok('底栏输入框出现', (await editor.count()) > 0)
if ((await editor.count()) === 0) {
  await page.screenshot({ path: 'packages/ui/e2e/_shots/chip-caret-0.png' })
  await browser.close()
  process.exit(1)
}

// 2) 输入两个标签
await editor.click()
// 清空上次残留（探针可反复跑）
await page.keyboard.press('Control+a')
await page.keyboard.press('Backspace')
await page.waitForTimeout(300)
await page.keyboard.type('@图片1 甲 @图片2 乙')
await page.waitForTimeout(1200)
const chips = page.locator('.nb-shell .resource-chip')
ok('输入框里出现了资源标签', (await chips.count()) >= 2, 'count=' + (await chips.count()))
if ((await chips.count()) < 2) {
  await page.screenshot({ path: 'packages/ui/e2e/_shots/chip-caret-1.png' })
  await browser.close()
  process.exit(1)
}

/**
 * 4) 真实鼠标点标签，随后立刻打字 —— 打字落在哪，就是"用户看到的光标在哪"。
 *    这比量折叠光标矩形可靠（PM 的 NodeSelection 期间 DOM 光标是浏览器就近给的）。
 */
/**
 * 同时校验「选中不能中途丢」：点下后 0~500ms 内必须一直是整颗选中。
 * 之前的 bug：底栏 watcher 每次点标签都重写整个节点（内容没变），
 * 选中被销毁、光标先弹到标签前面。现在源头不再产生事务，选中应保持到落光标。
 */
const readState = () => page.evaluate(() => {
  const ed = document.querySelector('.nb-shell .ProseMirror')
  const chips = [...ed.querySelectorAll('.resource-chip')].map((c) => c.getAttribute('data-name'))
  const blocks = [...ed.children].map((p) => p.textContent.replace(/\u200B/g, ''))
  return {
    selected: !!ed.querySelector('.ProseMirror-selectednode'),
    chips,
    blocks,
  }
})

const target = chips.nth(0)
const tb = await target.boundingBox()
// 点击前装一个采样器：记录选中状态在整段时间里有没有被中途清掉
await page.evaluate(() => {
  window.__selFrames = []
  window.__selTimer = setInterval(() => {
    const ed = document.querySelector('.nb-shell .ProseMirror')
    if (!ed) return
    window.__selFrames.push({
      t: Math.round(performance.now()),
      selected: !!ed.querySelector('.ProseMirror-selectednode'),
    })
  }, 20)
})
await page.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2)

// 点击后 200ms 采样一次：这一刻应当是「整颗选中」，还没落光标
await page.waitForTimeout(200)
const early = await readState()
ok('点击后先出现「标签整颗选中」', early.selected === true, JSON.stringify(early))

// 选中态必须一直保持到落光标（中途被清掉 = 又回到"光标先跳到前面"的老毛病）
const frames = await page.evaluate(() => window.__selFrames)
const firstSelected = frames.findIndex((f) => f.selected)
const droppedEarly = firstSelected >= 0 && frames.slice(firstSelected).some((f) => !f.selected && f.t - frames[firstSelected].t < 400)
ok('选中态中途没有被清掉', firstSelected >= 0 && !droppedEarly,
  '选中帧=' + frames.filter((f) => f.selected).length + '/' + frames.length)

// 等 0.5s 计时器走完，再打字：字必须落在标签**之后**
await page.waitForTimeout(900)
await page.evaluate(() => clearInterval(window.__selTimer))
await page.keyboard.type('ZZ')
await page.waitForTimeout(400)
const after = await readState()
console.log('  打完字 = ' + JSON.stringify(after))

const firstBlock = after.blocks[0] ?? ''
ok('0.5s 后打字落在标签之后', !firstBlock.startsWith('ZZ'), '段落=' + JSON.stringify(firstBlock))
ok('标签没被文字挤到后面', after.chips[0] === early.chips[0], 'chips=' + JSON.stringify(after.chips))

// 再整体打字两次，确认没有"先跳到前面"的中间态：字始终跟在标签后
await page.keyboard.type('YY')
await page.waitForTimeout(400)
const after2 = await readState()
const b2 = after2.blocks[0] ?? ''
ok('继续打字仍紧跟标签之后（无前置跳转）', b2.includes('ZZYY') || b2.includes('ZZ') && b2.indexOf('ZZ') < b2.indexOf('YY'),
  '段落=' + JSON.stringify(b2))

await page.screenshot({ path: 'packages/ui/e2e/_shots/chip-caret-2.png' })
await browser.close()
if (fails.length) {
  console.log('\n失败项：' + JSON.stringify(fails))
  process.exit(1)
}
console.log('\n全部通过')
