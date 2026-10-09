import { chromium } from 'playwright-core'
const EXE = process.env.CHROME_EXE ?? 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
// 一张纯白图 + 一张白图（两图测 +N）
const WHITE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='
await page.goto('http://127.0.0.1:8865/#/canvas/430c8f1f00bd4aba', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)
await page.locator('button[aria-label="Agent 对话"]').first().click().catch(()=>{})
await page.waitForTimeout(2500)
const sid = await page.evaluate(async (WHITE) => {
  const canvas='430c8f1f00bd4aba'
  const c = await fetch('/api/agent/canvases/'+canvas+'/sessions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({provider:'test',modelId:'test模型',title:'目标迷你图验证'})}).then(r=>r.json())
  const S='/api/agent/canvases/'+canvas+'/sessions/'+c.id
  // 目标带两张图（验证 +N）
  await fetch(S+'/messages',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:'带图目标',provider:'test',modelId:'test模型',images:[WHITE,WHITE],goal:{objective:'带图目标',budget:100000}})}).catch(()=>{})
  // 队列一条带两图
  await fetch(S+'/queue',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({op:'pause'})}).catch(()=>{})
  await fetch(S+'/queue',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({op:'add',text:'带两图的排队消息',images:[WHITE,WHITE]})}).catch(()=>{})
  return c.id
}, WHITE)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)
await page.locator('button[aria-label="Agent 对话"]').first().click().catch(()=>{})
await page.waitForTimeout(3000)
const st = await page.evaluate(() => ({
  goalThumb: !!document.querySelector('.ac-goal-row .ac-queue-thumb'),
  goalThumbBorder: (()=>{const t=document.querySelector('.ac-goal-row .ac-queue-thumb'); return t?getComputedStyle(t).borderTopWidth+' '+getComputedStyle(t).borderTopColor:null})(),
  goalPlusN: document.querySelector('.ac-goal-row .ac-queue-thumb-more')?.textContent ?? null,
  queueThumb: !!document.querySelector('.ac-queue-row .ac-queue-thumb'),
  queuePlusN: document.querySelector('.ac-queue-row .ac-queue-thumb-more')?.textContent ?? null,
}))
console.log('ST=', JSON.stringify(st))
const clip = await page.evaluate(() => { const c=document.querySelector('.ac-composer'); const r=c.getBoundingClientRect(); return {x:Math.max(0,r.x-16),y:Math.max(0,r.y-70),width:r.width+32,height:r.height+90} })
await page.screenshot({ path: 'packages/ui/e2e/_shots/goal-thumbs.png', clip: clip || undefined })
await browser.close()
