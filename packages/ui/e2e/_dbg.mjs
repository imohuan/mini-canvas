import { chromium } from 'playwright-core'
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } })
await page.goto('http://localhost:5288/#/canvas/default', { waitUntil: 'load' })
await page.waitForTimeout(3500)
await page.evaluate(() => { document.documentElement.classList.remove('dark'); document.documentElement.setAttribute('data-canvas-theme','light') })
await page.waitForTimeout(400)
await page.locator('button[aria-label="设置"]').first().click()
await page.waitForTimeout(1200)

const dump = async (tag) => {
  const s = await page.evaluate(() => {
    const nav = document.querySelector('[role="dialog"] aside nav')
    const all = [...nav.querySelectorAll('.asp-row')]
    const cur = all.filter(r => r.classList.contains('is-current'))
    return {
      totalRows: all.length,
      current: cur.map(r => ({ t: r.querySelector('.asp-label').textContent.trim(), bg: getComputedStyle(r).backgroundColor })),
      // is 外观 even in the tree?
      yaoguan: all.filter(r => r.querySelector('.asp-label').textContent.trim() === '外观').length,
    }
  })
  console.log(tag, JSON.stringify(s))
}
await dump('OPEN')

// click 外观 in the left tree
const clicked = await page.evaluate(() => {
  const nav = document.querySelector('[role="dialog"] aside nav')
  const b = [...nav.querySelectorAll('.asp-label')].find(x => x.textContent.trim() === '外观')
  if (!b) return false
  b.click(); return true
})
await page.waitForTimeout(1400)
console.log('clicked 外观:', clicked)
await dump('AFTER_CLICK')
await page.screenshot({ path: '../../.scratch/clickwg.png' })
await browser.close()

