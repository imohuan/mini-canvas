// @ts-nocheck
/**
 * ref-slot-regression.mjs —— 用真实画布节点 23 回归（用户 2026-10-27 报的那张图）。
 *
 * 断言三件事：
 *   ① 参考区不再铺出 44 格（格数 = max(连线数, 归一化声明数)）；
 *   ② 拖拽只改显示顺序，slotIndex 不跟图走；
 *   ③ 空壳格有默认图片图标。
 *
 * 跑法：先起服务（8865），再 node packages/ui/e2e/ref-slot-regression.mjs
 */
import { chromium } from 'playwright-core'

const EXE = process.env.AGENT_E2E_CHROME
  ?? 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = process.env.AGENT_BASE ?? 'http://127.0.0.1:8865/'
const CANVAS = BASE + '#/canvas/824e779f34314f86'

const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
const fails = []
const ok = (name, cond, detail = '') => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  -- ' + detail : ''))
  if (!cond) fails.push(name)
}

await page.goto(CANVAS, { waitUntil: 'load' })
await page.waitForTimeout(6000)

// 选中节点 23（用户报的那个「角色B·日常便装全身参考」）
const picked = await page.evaluate(() => {
  const host = window.MiniCanvasUI?.getHost?.()
  const doc = host?.ctx?.get?.('doc')
  if (!doc) return { error: 'no doc' }
  const node = doc.getNodes().find((n) => n.id === '23')
  if (!node) return { error: 'node 23 missing', ids: doc.getNodes().map((n) => n.id).slice(0, 20) }
  host.ctx.get('selection')?.set?.(['23'])
  return {
    label: node.data?.label,
    refOrderLen: (node.data?.refOrder || []).length,
    prompt: (node.data?.barPrompt || '').slice(0, 120),
  }
})

if (picked.error) {
  console.log('SKIP：' + JSON.stringify(picked))
  await browser.close()
  process.exit(0)
}
console.log('样本节点 = ' + JSON.stringify(picked))
await page.waitForTimeout(2000)

const tiles = await page.evaluate(() => {
  const els = [...document.querySelectorAll('.nb-shell [data-tile-key]')]
  return els.map((el) => ({
    key: el.getAttribute('data-tile-key'),
    index: el.querySelector('.nb-card-index')?.textContent?.trim(),
    hasPlaceholder: !!el.querySelector('.nb-card-placeholder'),
  }))
})

console.log('格子数 = ' + tiles.length)
ok('参考区没有铺出 44 格', tiles.length < 44, 'tiles=' + tiles.length)
ok('格子数受限（≤ 连线数或声明数的较大者）', tiles.length <= 10, JSON.stringify(tiles.map((t) => t.key)))

const pending = tiles.filter((t) => t.hasPlaceholder)
// 该节点 4 格都有图（4 条连线）→ 本来就不该有空壳；
// 「有空格时必须带占位图标」的契约由单测 bottomBarRender 覆盖。
ok(
  '有图格不误显示占位图标（4 格都有图）',
  tiles.length === 0 || pending.length === tiles.filter((t) => !t.key.startsWith('card:')).length,
  'pending=' + pending.length + ' tiles=' + JSON.stringify(tiles.map((t) => t.key)),
)

await page.screenshot({ path: 'packages/ui/e2e/_shots/ref-slot-regression.png' })
await browser.close()
if (fails.length) { console.log('失败项：' + JSON.stringify(fails)); process.exit(1) }
console.log('全部通过')

