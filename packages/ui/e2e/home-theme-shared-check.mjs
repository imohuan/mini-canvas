// @ts-nocheck
/**
 * 首页主题与画布页共用一份配置 —— 真浏览器验证（跑**构建产物**，不是源码）。
 *
 * 为什么值得单开一条真机脚本：Node 单测只能验"函数读哪个键、写哪个键"，
 * 而用户报的现象是"首页看起来跟画布页不一样"——那是**真实 DOM 上的结果**
 * （html.dark 有没有、--ui-accent 解析成什么、内联变量写没写）。
 * 这里用一个内存假后台喂数据（不碰真服务里的设置），把真产物跑起来量这几样。
 *
 * 跑法：node packages/ui/e2e/home-theme-shared-check.mjs（会自动起个静态服务器 + 无头 Chromium）
 */
import { chromium } from 'playwright-core'
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG = fileURLToPath(new URL('..', import.meta.url))
const DIST = join(PKG, 'dist')
const EXE =
  process.env.CANVAS_E2E_CHROME ??
  'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist 不存在，先 pnpm -C packages/ui build')
  process.exit(2)
}
if (!existsSync(EXE)) {
  console.error('chromium 不存在:', EXE)
  process.exit(2)
}

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok })
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  -- ' + detail : ''))
}

// ===== 1. 起静态服务器，按 dist 服务（SPA 回落 index.html）=====
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' }
const server = createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0]
  const file = join(DIST, url === '/' ? 'index.html' : url)
  const target = existsSync(file) && !url.endsWith('/') ? file : join(DIST, 'index.html')
  try {
    const body = readFileSync(target)
    res.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const PORT = server.address().port
const BASE = 'http://127.0.0.1:' + PORT + '/'

// ===== 2. 假后台：一份设置 + 项目清单，所有写入都记下来 =====
/** 用户"在画布页配过"的一份设置：暗色 + 一个能一眼认出来的强调色 */
let settings = { themeMode: 'dark', accentColorDark: '#7c3aed', accentColorLight: '#0891b2', snapToGrid: false }
const puts = []
const deletes = []

const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))

await page.route('**/api/**', async (route) => {
  const req = route.request()
  const url = new URL(req.url())
  const json = (obj, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) })
  if (url.pathname === '/api/kv/config/settings') {
    if (req.method() === 'PUT') {
      const body = JSON.parse(req.postData() ?? '{}')
      puts.push(body.value)
      settings = body.value
      return json({ ok: true })
    }
    return json({ value: settings })
  }
  if (url.pathname === '/api/kv/config/themeMode') {
    if (req.method() === 'DELETE') deletes.push(url.pathname)
    return json({ ok: true })
  }
  if (url.pathname === '/api/projects') {
    return json({ projects: [{ id: 'p1', name: '测试项目', createdAt: 0, canvasCount: 0 }] })
  }
  if (url.pathname === '/plugin-manifest.json') return json({ plugins: [] })
  return json({ ok: true })
})

// ===== 3. 打开首页 =====
await page.goto(BASE + '#/', { waitUntil: 'load' })
await page.waitForTimeout(1200)

const readTheme = () =>
  page.evaluate(() => {
    const el = document.documentElement
    const cs = getComputedStyle(el)
    return {
      dark: el.classList.contains('dark'),
      accent: cs.getPropertyValue('--ui-accent').trim(),
      inlineAccentDark: el.style.getPropertyValue('--uic-accent-color-dark').trim(),
      legacyAttr: el.getAttribute('data-canvas-theme'),
    }
  })

const home = await readTheme()
check('首页读到了画布页那份设置（暗色）', home.dark === true, JSON.stringify(home))
check('首页套上了用户在画布页改的强调色（内联变量=#7c3aed）', home.inlineAccentDark === '#7c3aed', JSON.stringify(home))

// --ui-accent 在暗色下应解析成用户那格的值。自定义属性的计算值原样回 hex（浏览器不归一成 rgb），
// 两种写法都认（与 theme-palette-check 的 isColor 同口径）。
const asRgb = (hex) => {
  const h = hex.replace('#', '')
  return 'rgb(' + parseInt(h.slice(0, 2), 16) + ', ' + parseInt(h.slice(2, 4), 16) + ', ' + parseInt(h.slice(4, 6), 16) + ')'
}
const isAccent = home.accent.toLowerCase() === '#7c3aed' || home.accent.toLowerCase() === asRgb('#7c3aed')
check('首页 --ui-accent 解析为用户配色', isAccent, home.accent + ' 期望 #7c3aed')

// ===== 4. 在首页切主题 → 写回同一份 config/settings（且不冲掉别的键）=====
await page.locator('button[aria-label="主题切换"]').first().click()
await page.waitForTimeout(800)

check('切换写到了 config/settings（不是另一个 themeMode 键）', puts.length === 1, JSON.stringify(puts))
if (puts.length) {
  check('写回的 themeMode 已翻转', puts[0].themeMode === 'light', JSON.stringify(puts[0]))
  check('画布页的配色没被冲掉', puts[0].accentColorDark === '#7c3aed', JSON.stringify(puts[0]))
  check('别的设置也原样保留', puts[0].snapToGrid === false, JSON.stringify(puts[0]))
}

const afterToggle = await readTheme()
check('首页切到亮色后 dark class 摘掉了', afterToggle.dark === false, JSON.stringify(afterToggle))

// 旧的独立配置键被清掉（两套配置的残骸），而且没顺手删掉共用的 settings
check('清掉了旧的 config/themeMode 键', deletes.includes('/api/kv/config/themeMode'), JSON.stringify(deletes))
check('没有误删共用的 config/settings', !deletes.includes('/api/kv/config/settings'), JSON.stringify(deletes))

check('无未捕获页面错误', errors.length === 0, errors.slice(0, 2).join(' | '))

await browser.close()
server.close()

const failed = results.filter((r) => !r.ok)
console.log('')
console.log('首页主题共用验证：' + (results.length - failed.length) + '/' + results.length + ' 通过')
process.exit(failed.length === 0 ? 0 : 1)
