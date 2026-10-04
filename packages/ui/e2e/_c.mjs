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
await p.waitForTimeout(1400)
await p.locator('button[aria-label="历史对话"]').click()
await p.waitForTimeout(800)
const out = await p.evaluate(() => {
  const m = document.querySelector('.dd-menu')
  const btn = document.querySelector('button[aria-label="历史对话"]')
  if (!m || !btn) return null
  const r = m.getBoundingClientRect(); const br = btn.getBoundingClientRect()
  return {
    menuW: Math.round(r.width),
    menuLeft: Math.round(r.left), menuRight: Math.round(r.right),
    btnCenter: Math.round(br.left + br.width / 2),
    menuCenter: Math.round(r.left + r.width / 2),
    // 居中判定：菜单中轴 vs **触发按钮**中轴
    dxTrigger: Math.round((r.left + r.width / 2) - (br.left + br.width / 2)),
    menuTop: Math.round(r.top), btnBottom: Math.round(br.bottom),
  }
})
console.log(JSON.stringify({ out, errs }, null, 1))
await b.close()

