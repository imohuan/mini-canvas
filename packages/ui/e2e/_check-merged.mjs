import { chromium } from 'playwright-core'
const EXE = process.env.CHROME_EXE ?? 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto('http://127.0.0.1:8865/#/canvas/430c8f1f00bd4aba', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)
await page.locator('button[aria-label="Agent 对话"]').first().click().catch(()=>{})
await page.waitForTimeout(3000)
// 进入目标编辑（找一个未结束的目标）
const info = await page.evaluate(async () => {
  const canvas='430c8f1f00bd4aba'
  const list = await fetch('/api/agent/canvases/'+canvas+'/sessions').then(r=>r.json())
  for (const s of list.sessions) { const d = await fetch('/api/agent/canvases/'+canvas+'/sessions/'+s.id).then(r=>r.json()); if (d.goal && !d.goal.ended) return { sid:s.id, title:s.title } }
  return null
})
if (!info) { console.log('NO LIVE GOAL'); await browser.close(); process.exit(0) }
await page.locator('button[aria-label="历史对话"]').first().click()
await page.waitForTimeout(1200)
const items = page.locator('.agent-history-item'); const n = await items.count()
for (let i=0;i<n;i++){ const t = await items.nth(i).innerText(); if (t.includes(info.title)) { await items.nth(i).click(); break } }
await page.waitForTimeout(3000)
await page.locator('.ac-goal-lead').first().click()
await page.waitForTimeout(900)
const st = await page.evaluate(() => ({
  goalCards: document.querySelectorAll('.ac-goal-mark').length,   // 应为 0（不再重复）
  hasGoalRow: !!document.querySelector('.ac-goal-row.is-editing'),
  badge: document.querySelector('.ac-goal-row .ac-editing-badge')?.textContent?.trim() ?? null,
  editorText: (document.querySelector('.ac-editor')?.textContent||'').slice(0,30),
}))
console.log('STATE=', JSON.stringify(st))
const clip = await page.evaluate(() => { const c=document.querySelector('.ac-composer'); const r=c.getBoundingClientRect(); return {x:Math.max(0,r.x-16),y:Math.max(0,r.y-70),width:r.width+32,height:r.height+90} })
await page.screenshot({ path: 'packages/ui/e2e/_shots/goal-merged.png', clip: clip || undefined })
await browser.close()
