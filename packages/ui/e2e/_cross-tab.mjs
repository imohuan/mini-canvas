// @ts-nocheck
// 决定性验证：标签 A 开首页（不刷新），标签 B 在画布页改强调色 → A 要立刻变（SSE 同步）
import { chromium } from 'playwright-core'
import { readFileSync } from 'node:fs'
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const BASE = 'http://127.0.0.1:8865/'
const FILE = 'D:/Code/Git/mini-canvas/packages/cloud-server/.mini-canvas/settings.json'
const cloud = () => { const s = JSON.parse(readFileSync(FILE, 'utf8'))?.config?.settings ?? {}; return { light: s.accentColorLight, dark: s.accentColorDark, mode: s.themeMode } }

const B = await chromium.launch({ executablePath: EXE, headless: true })
const ctx = await B.newContext()
const home = await ctx.newPage()
await home.goto(BASE + '#/', { waitUntil: 'load' }); await home.waitForTimeout(2600)
const readHome = () => home.evaluate(() => ({
  accent: getComputedStyle(document.documentElement).getPropertyValue('--ui-accent').trim(),
  btn: (() => { const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').includes('新建项目')); return b ? getComputedStyle(b).backgroundColor : '-' })(),
}))
const before = cloud()
console.log('CLOUD ' + JSON.stringify(before))
console.log('HOME-initial ' + JSON.stringify(await readHome()))

// 标签 B：画布页改亮色强调色为粉红（用户口径的紫色系之外的、肉眼可辨的颜色）
const canvas = await ctx.newPage()
await canvas.goto(BASE + '#/canvas/default', { waitUntil: 'load' }); await canvas.waitForTimeout(4200)
await canvas.evaluate(() => window.MiniCanvasUI.getHost().ctx.get('settings').set('accentColorLight', '#ff2fd0'))
await canvas.waitForTimeout(2000)
console.log('CLOUD-after-set ' + JSON.stringify(cloud()))

// 标签 A（首页，全程没刷新）应该已经变了
await home.waitForTimeout(1800)
console.log('HOME-no-reload ' + JSON.stringify(await readHome()))
await home.screenshot({ path: 'D:/Code/Git/mini-canvas/.scratch/home-sync.png' })

// 还原用户设置
await canvas.evaluate((v) => { const s = window.MiniCanvasUI.getHost().ctx.get('settings'); if (v.light) s.set('accentColorLight', v.light); if (v.dark) s.set('accentColorDark', v.dark); if (v.mode) s.set('themeMode', v.mode) }, before)
await canvas.waitForTimeout(1800)
await home.waitForTimeout(1200)
console.log('CLOUD-restored ' + JSON.stringify(cloud()))
console.log('HOME-restored ' + JSON.stringify(await readHome()))
await B.close()
