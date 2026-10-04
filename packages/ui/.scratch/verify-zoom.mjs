import { chromium } from 'playwright-core'
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = `http://localhost:${process.env.CANVAS_PORT ?? 5289}/`
const results = []
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -- ' + d : ''}`) }

const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(BASE, { waitUntil: 'load' })
await page.evaluate(() => { try { localStorage.clear() } catch {} })
await page.reload({ waitUntil: 'load' })
await page.waitForTimeout(2800)

const realZoom = () => page.evaluate(() => window.MiniCanvasUI.getHost().viewport.getViewport().zoom)
const label = () => page.evaluate(() => (document.querySelector('button[aria-label="缩放选项"]') || {}).textContent.trim())

// 1) 读数 = 真实视口（不是写死的 39）
const z0 = await realZoom()
const l0 = await label()
check('状态栏读数 = 真实视口缩放', l0 === Math.round(z0 * 100) + '%', `读数=${l0} 真实=${(z0 * 100).toFixed(0)}%`)

// 2) 「缩放至 100%」真的缩放画布
await page.click('button[aria-label="缩放选项"]')
await page.waitForTimeout(250)
await page.click('button[role="menuitem"]:has-text("缩放至100%"), button[role="menuitem"]:has-text("缩放至 100%")')
await page.waitForTimeout(600)
const z100 = await realZoom()
check('「缩放至 100%」真的把画布缩放到 1.0', Math.abs(z100 - 1) < 0.02, 'real zoom=' + z100.toFixed(3))
await page.waitForTimeout(300)
check('读数跟着变成 100%', (await label()) === '100%', 'label=' + (await label()))

// 3) 「缩放至 50%」
await page.click('button[aria-label="缩放选项"]')
await page.waitForTimeout(250)
await page.click('button[role="menuitem"]:has-text("缩放至50%"), button[role="menuitem"]:has-text("缩放至 50%")')
await page.waitForTimeout(600)
const z50 = await realZoom()
check('「缩放至 50%」真的缩放到 0.5', Math.abs(z50 - 0.5) < 0.02, 'real zoom=' + z50.toFixed(3))
check('读数跟着变成 50%', (await label()) === '50%', 'label=' + (await label()))

// 4) 放大 / 缩小
await page.click('button[aria-label="缩放选项"]')
await page.waitForTimeout(250)
await page.click('button[role="menuitem"]:has-text("放大")')
await page.waitForTimeout(600)
const zUp = await realZoom()
check('「放大」使真实缩放变大（0.5 → ~0.6）', zUp > z50 && Math.abs(zUp - 0.6) < 0.03, 'real zoom=' + zUp.toFixed(3))
await page.click('button[aria-label="缩放选项"]')
await page.waitForTimeout(250)
await page.click('button[role="menuitem"]:has-text("缩小")')
await page.waitForTimeout(600)
const zDown = await realZoom()
check('「缩小」使真实缩放变小（~0.6 → 0.5）', zDown < zUp && Math.abs(zDown - 0.5) < 0.03, 'real zoom=' + zDown.toFixed(3))

// 5) 适合屏幕
await page.click('button[aria-label="缩放选项"]')
await page.waitForTimeout(250)
await page.click('button[role="menuitem"]:has-text("适合屏幕")')
await page.waitForTimeout(800)
const zFit = await realZoom()
check('「适合屏幕」执行了 fitView（缩放随之改变、读数跟上）', Math.abs(zFit - 0.5) > 0.02, 'real zoom=' + zFit.toFixed(3))
check('读数与真实缩放仍一致', (await label()) === Math.round(zFit * 100) + '%', `读数=${await label()} 真实=${Math.round(zFit * 100)}%`)

// 5b) 「缩放到最大」文案与真实上限
await page.click('button[aria-label="缩放选项"]')
await page.waitForTimeout(300)
const items = await page.evaluate(() => [...document.querySelectorAll('button[role="menuitem"]')].map((b) => b.textContent.trim()))
check('下拉里是「缩放到最大」，不再有 800% 文案', items.includes('缩放到最大') && !items.some((t) => t.includes('800')), JSON.stringify(items))
await page.click('button[role="menuitem"]:has-text("缩放到最大")')
await page.waitForTimeout(700)
const maxSetting = await page.evaluate(() => window.MiniCanvasUI.getHost().ctx.get('settings').get('maxZoom'))
const zMax = await realZoom()
check('「缩放到最大」按设置 maxZoom 走（默认 2 = 200%）', Math.abs(zMax - maxSetting) < 0.02, `real=${zMax.toFixed(3)} maxZoom设置=${maxSetting}`)
check('读数跟上最大缩放', (await label()) === Math.round(zMax * 100) + '%', 'label=' + (await label()))

// 6) 滚轮缩放后读数也跟上
await page.mouse.move(700, 450)
await page.mouse.wheel(0, -300)
await page.waitForTimeout(800)
const zWheel = await realZoom()
check('滚轮缩放后读数跟随真实视口', (await label()) === Math.round(zWheel * 100) + '%', `读数=${await label()} 真实=${Math.round(zWheel * 100)}%`)

check('无页面异常', errors.length === 0, errors.slice(0, 2).join(' | '))
console.log(`\n${results.filter(Boolean).length}/${results.length} 通过`)
await browser.close()
process.exit(results.every(Boolean) ? 0 : 1)
