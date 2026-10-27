// @ts-nocheck
import { chromium } from '../packages/ui/node_modules/playwright-core/index.mjs'
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } })
await page.goto('http://localhost:5288/#/canvas/default', { waitUntil: 'load' })
await page.waitForSelector('.vue-flow', { timeout: 30000 })
await page.waitForTimeout(1200)
console.log('title', await page.title())
console.log('flow', JSON.stringify(await page.locator('.vue-flow').first().boundingBox().catch(() => null)))
console.log('body classes', await page.evaluate(() => document.body.className))
console.log('html class', await page.evaluate(() => document.documentElement.className))
console.log('bottom-ish', await page.evaluate(() => {
  const els = [...document.querySelectorAll('body *')]
  const hit = els.filter(el => {
    const r = el.getBoundingClientRect()
    return r.width > 300 && r.height > 30 && r.top > innerHeight - 100
  }).slice(0, 8).map(el => ({ cls: el.className?.toString().slice(0, 80), tag: el.tagName, box: el.getBoundingClientRect().toJSON() }))
  return hit
}))
await page.mouse.click(1024 - 60, 640 - 80, { button: 'right' })
await page.waitForTimeout(600)
console.log('menu box', JSON.stringify(await page.locator('.ctx-menu').first().boundingBox()))
console.log('dock box', JSON.stringify(await page.locator('.shell-dock').first().boundingBox().catch(() => null)))
console.log('status box', JSON.stringify(await page.locator('.shell-status').first().boundingBox().catch(() => null)))
await page.screenshot({ path: '.tmp/ctx-menu-after.png' })
await browser.close()
