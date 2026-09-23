import { chromium } from 'playwright-core'
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 812 } })
await page.goto('http://localhost:5288/', { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForTimeout(3500)
const isOpen = () => page.evaluate(() => !!document.querySelector('.app-settings'))
const open = async () => { await page.click('[aria-label="设置"]'); await page.waitForTimeout(1100) }
const r = {}
await open(); r.a1 = await isOpen()
await page.keyboard.press('Escape'); await page.waitForTimeout(900)
r.afterEsc = await isOpen()
// 遮罩：点面板外远处（左上角画布区）
await open(); r.a2 = await isOpen()
const box = await page.evaluate(() => { const el = document.querySelector('.app-settings'); const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom } })
r.panelBox = box
await page.mouse.click(box.l - 60, Math.round((box.t + box.b) / 2))
await page.waitForTimeout(900)
r.afterMask = await isOpen()
console.log(JSON.stringify(r, null, 1))
await browser.close()
process.exit(0)
