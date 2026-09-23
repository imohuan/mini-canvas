import { chromium } from 'playwright-core'
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 812 } })
const errs = []
page.on('pageerror', e => errs.push(e.message.slice(0, 100)))
await page.goto('http://localhost:5288/', { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForTimeout(3500)
const isOpen = () => page.evaluate(() => !!document.querySelector('.app-settings'))
const r = {}
// ✕
await page.click('[aria-label="设置"]'); await page.waitForTimeout(1100)
await page.click('[aria-label="关闭设置"]'); await page.waitForTimeout(800)
r.byX = !(await isOpen())
// Esc
await page.click('[aria-label="设置"]'); await page.waitForTimeout(1100)
await page.keyboard.press('Escape'); await page.waitForTimeout(800)
r.byEsc = !(await isOpen())
// 遮罩
await page.click('[aria-label="设置"]'); await page.waitForTimeout(1100)
await page.mouse.click(30, 400); await page.waitForTimeout(800)
r.byMask = !(await isOpen())
// 下拉浮层暗色（找 select 字段）
await page.click('[aria-label="设置"]'); await page.waitForTimeout(1100)
const trig = page.locator('.app-settings .sel-trigger').first()
if (await trig.count()) { await trig.click(); await page.waitForTimeout(700);
  r.menu = await page.evaluate(() => { const m = document.querySelector('.dd-menu'); if (!m) return null; const c = getComputedStyle(m); return { bg: c.backgroundColor, ink: c.color } })
  const opt = page.locator('.sel-option.is-active').first()
  if (await opt.count()) r.optionActive = await opt.evaluate(el => getComputedStyle(el).backgroundColor)
}
console.log('R ' + JSON.stringify(r, null, 1))
console.log('ERRS ' + JSON.stringify(errs.slice(0, 4)))
await browser.close()
process.exit(0)
