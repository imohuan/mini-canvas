// @ts-nocheck
import { chromium } from 'playwright-core'
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const b = await chromium.launch({ executablePath: EXE, headless: true })
const p = await b.newPage({ viewport: { width: 1920, height: 911 } })
const errs = []
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message.slice(0,200)))
await p.goto('http://127.0.0.1:8865/', { waitUntil: 'load' })
await p.waitForTimeout(4500)
await p.locator('button[aria-label="Agent 对话"]').first().click()
await p.waitForTimeout(1300)
const out = {}
const shown = () => p.locator('.dd-menu .agent-history').count()
const clickHist = async () => { await p.locator('button[aria-label="历史对话"]').click(); await p.waitForTimeout(600) }
// 1) 打开
await clickHist()
out.opened = await shown()
out.items = await p.locator('.dd-menu .agent-history-item').count()
out.inDdMenu = await p.evaluate(() => !!document.querySelector('.dd-menu .agent-history'))
out.oldFloatingGone = await p.evaluate(() => [...document.querySelectorAll('.agent-history')].every(el => !!el.closest('.dd-menu')))
out.renameDel = await p.evaluate(() => ({ rename: document.querySelectorAll('.dd-menu .agent-history-icon').length, del: document.querySelectorAll('.dd-menu .agent-history-icon.danger').length }))
// 2) 点外部 → 自动收起（核心诉求）
await p.mouse.click(300, 300)
await p.waitForTimeout(500)
out.afterOutside = await shown()
// 3) Esc
await clickHist(); out.reopened = await shown()
await p.keyboard.press('Escape'); await p.waitForTimeout(400)
out.afterEsc = await shown()
// 4) 点某条 → 收起并切过去
await clickHist()
const first = p.locator('.dd-menu .agent-history-item').first()
const title = (await first.innerText()).split('\n')[0].trim()
await first.click()
await p.waitForTimeout(2000)
out.afterPick = await shown()
out.panelTitle = await p.evaluate(() => document.querySelector('.agent-title')?.textContent?.trim())
out.picked = title
await clickHist()
const shell = await p.locator('.agent-shell').boundingBox()
await p.screenshot({ path: 'packages/ui/e2e/_shots/hist-dd.png', clip: { x: shell.x - 20, y: shell.y, width: shell.width + 40, height: Math.min(shell.height, 460) } })
console.log(JSON.stringify({ out, errs }, null, 1))
await b.close()

