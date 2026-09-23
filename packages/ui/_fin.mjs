import { chromium } from 'playwright-core'
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 812 } })
const errs = []
page.on('pageerror', e => errs.push('PAGEERROR ' + e.message.slice(0, 120)))
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 120)) })
await page.goto('http://localhost:5288/', { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForTimeout(3500)
const out = {}
// 打开设置
await page.click('[aria-label="设置"]')
await page.waitForTimeout(1200)
out.opened = await page.evaluate(() => !!document.querySelector('.app-settings'))
// 主题色：导航强调条 / 滑块 / 开关
out.colors = await page.evaluate(() => {
  const root = getComputedStyle(document.documentElement)
  const bar = document.querySelector('.app-settings nav button span.bg-brand')
  const fill = document.querySelector('.app-settings .ps-fill')
  return { brandToken: root.getPropertyValue('--color-brand').trim(), accentVar: root.getPropertyValue('--ui-accent').trim(),
    navBar: bar ? getComputedStyle(bar).backgroundColor : null,
    sliderFill: fill ? getComputedStyle(fill).backgroundImage.slice(0, 90) : null }
})
// 关闭按钮
await page.click('[aria-label="关闭设置"]')
await page.waitForTimeout(900)
out.closedByX = await page.evaluate(() => !document.querySelector('.app-settings'))
// 再开一次，测 Esc + 遮罩
await page.click('[aria-label="设置"]')
await page.waitForTimeout(1000)
await page.keyboard.press('Escape')
await page.waitForTimeout(800)
out.closedByEsc = await page.evaluate(() => !document.querySelector('.app-settings'))
await page.click('[aria-label="设置"]')
await page.waitForTimeout(1000)
await page.mouse.click(40, 400)
await page.waitForTimeout(800)
out.closedByMask = await page.evaluate(() => !document.querySelector('.app-settings'))
// 下拉浮层暗色（设置里找 select 字段）
await page.click('[aria-label="设置"]')
await page.waitForTimeout(1100)
const sel = await page.locator('.app-settings .sel-trigger').first()
if (await sel.count()) {
  await sel.click()
  await page.waitForTimeout(700)
  out.selectMenu = await page.evaluate(() => { const m = document.querySelector('.dd-menu'); if (!m) return null; const c = getComputedStyle(m); return { bg: c.backgroundColor, color: c.color, border: c.borderTopColor } })
  await page.keyboard.press('Escape')
}
await page.screenshot({ path: 'D:/Code/Git/mini-canvas/packages/ui/_fin.png' })
console.log('OUT ' + JSON.stringify(out, null, 1))
console.log('ERRORS ' + JSON.stringify(errs.slice(0, 5)))
await browser.close()
process.exit(0)
