import { chromium } from 'playwright-core'
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 812 } })
await page.goto('http://localhost:5288/', { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForTimeout(3500)
await page.click('[aria-label="设置"]')
await page.waitForTimeout(1200)
const box = await page.evaluate(() => { const b = document.querySelector('.app-settings').getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom } })
// 点面板左侧 40px 处（遮罩上）
await page.mouse.click(box.l - 40, Math.round((box.t + box.b) / 2))
await page.waitForTimeout(900)
const closed = await page.evaluate(() => !document.querySelector('.app-settings'))
// 面板 rect 确认点击点确实在面板外
console.log('R ' + JSON.stringify({ box, clickX: box.l - 40, closed }))
await browser.close()
process.exit(0)
