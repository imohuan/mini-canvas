// @ts-nocheck
import { chromium } from '../packages/ui/node_modules/playwright-core/index.mjs'
const browser = await chromium.launch({ executablePath: 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe', headless: true })
const page = await browser.newPage({ viewport: { width: 1024, height: 460 } })
page.on('pageerror', e => console.log('pageerror', e.message))
await page.goto('http://localhost:5288/#/canvas/default', { waitUntil: 'load' })
await page.waitForSelector('.vue-flow', { timeout: 30000 })
await page.waitForTimeout(1500)
const anchor = await page.evaluate(() => {
  for (let y = 390; y > 160; y -= 12) for (let x = 994; x > 400; x -= 12) {
    const el = document.elementFromPoint(x, y)
    if (!el) continue
    if (el.closest('.shell-dock, .shell-status, .shell-topbar')) continue
    if (!el.closest('.vue-flow')) continue
    if (el.closest('.vue-flow__node, .vue-flow__edge')) continue
    return { x, y, cls: el.className?.toString().slice(0, 60) }
  }
  return null
})
console.log('anchor', JSON.stringify(anchor))
console.log('dock', JSON.stringify(await page.locator('.shell-dock').boundingBox().catch(()=>null)))
await page.mouse.click(anchor.x, anchor.y, { button: 'right' })
await page.waitForTimeout(600)
console.log('menus', await page.locator('.ctx-menu').count(), JSON.stringify(await page.locator('.ctx-menu').first().boundingBox().catch(()=>null)))
await page.screenshot({ path: '.tmp/ctx-menu-460.png' })
await browser.close()
