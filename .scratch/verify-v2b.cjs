const fs = require('fs');
const pw = require('D:/Code/Git/mini-canvas/node_modules/.pnpm/playwright-core@1.63.0/node_modules/playwright-core');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = {};
(async () => {
  const browser = await pw.chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto('http://127.0.0.1:8865/#/canvas/7cc7dc03e3624eb7', { timeout: 20000 });
  await page.waitForTimeout(3500);
  await page.getByRole('button', { name: 'Agent 对话' }).click();
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: '新建对话' }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: '选择模型' }).click();
  await page.waitForTimeout(1000);
  await page.getByText('test模型', { exact: false }).first().click();
  await page.waitForTimeout(800);
  const send = page.locator('.ac-send');
  const input = page.locator('[contenteditable=true]').first();
  const waitIdle = async () => { for (let i = 0; i < 40; i++) { const s = await page.evaluate(() => ({ q: document.querySelectorAll('.ac-queue-row').length, running: !!document.querySelector('.ac-send[aria-label="停止"]') || !!document.querySelector('[class*=send][aria-label="停止"]') })); if (s.q === 0) return true; await sleep(1000); } return false; };

  // ---- A. 气泡折叠 ----
  const LONG = Array.from({length: 40}, (_, i) => '验证行 ' + (i+1) + '：内容足够长用来撑高气泡的文本。').join('\n');
  await input.click(); await input.fill(LONG);
  await send.click(); await sleep(2500);
  const a1 = await page.evaluate(() => {
    const line = document.querySelector('.ac-user-line');
    const t = document.querySelector('.ac-user-toggle');
    return { clamp: getComputedStyle(line).maxHeight === '192px', toggle: t ? t.textContent.trim() : null };
  });
  await page.locator('.ac-user-toggle').click(); await sleep(500);
  const a2 = await page.evaluate(() => document.querySelector('.ac-user-line').classList.contains('is-open'));
  await page.locator('.ac-user-toggle').click(); await sleep(500);
  const a3 = await page.evaluate(() => !document.querySelector('.ac-user-line').classList.contains('is-open'));
  results.A_bubbleClamp = a1.clamp && a1.toggle === '展开' && a2 && a3 ? 'PASS' : 'FAIL';
  await waitIdle();

  // ---- B+C. 入队 3 条 + 拖拽 ----
  await input.click(); await input.fill('::test 8s:: 终验长轮');
  await send.click(); await sleep(1500);
  for (const t of ['终验-1', '终验-2', '终验-3']) { await input.click(); await input.fill(t); await send.click(); await sleep(700); }
  await sleep(1500);
  const b = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.ac-queue-row')];
    return { order: rows.map(r => (r.querySelector('.ac-queue-text') || {}).textContent), handles: rows.filter(r => r.querySelector('.ac-queue-handle')).length, pause: !!document.querySelector('.ac-queue-pause'), cnt: (document.querySelector('.ac-queue-pause-cnt') || {}).textContent };
  });
  results.B_enqueue = b.order.filter(t => t.startsWith('终验-')).length === 3 && b.handles >= 3 && b.pause && b.cnt === '3' ? 'PASS' : 'FAIL:' + JSON.stringify(b);
  // 拖拽：终验-3 → 队首
  const idx3 = b.order.indexOf('终验-3');
  const h = page.locator('.ac-queue-row').nth(idx3).locator('.ac-queue-handle');
  const t0 = page.locator('.ac-queue-row').nth(0).locator('.ac-queue-text');
  const hb = await h.boundingBox(); const tb = await t0.boundingBox();
  await page.mouse.move(hb.x + hb.width/2, hb.y + hb.height/2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width/2, hb.y - 30, { steps: 5 });
  await page.mouse.move(tb.x + tb.width/2, tb.y + tb.height/2, { steps: 12 });
  await sleep(250); await page.mouse.up(); await sleep(1200);
  const c = await page.evaluate(() => [...document.querySelectorAll('.ac-queue-row')].map(r => (r.querySelector('.ac-queue-text') || {}).textContent));
  results.C_dragReorder = c[0] === '终验-3' ? 'PASS' : 'FAIL:' + JSON.stringify(c);
  await page.screenshot({ path: 'D:/Code/Git/mini-canvas/.scratch/verify-C.png' });

  // ---- D. 引导两段式：对终验-3 点引导 ----
  const idx3b = await page.evaluate(() => [...document.querySelectorAll('.ac-queue-row')].findIndex(r => (r.querySelector('.ac-queue-text') || {}).textContent === '终验-3'));
  await page.locator('.ac-queue-row').nth(idx3b).locator('button[aria-label="引导（插队发送）"]').click();
  await sleep(1500);
  const d1 = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.ac-queue-row')];
    const steerRow = rows.find(r => (r.querySelector('.ac-queue-text') || {}).textContent === '终验-3');
    return { exists: !!steerRow, sending: steerRow ? steerRow.classList.contains('is-sending') : false, flag: steerRow ? (steerRow.querySelector('.ac-queue-flag') || {}).textContent : null, bubbleYet: [...document.querySelectorAll('.ac-user-line')].some(p => p.textContent.includes('终验-3')) };
  });
  results.D1_sendingVisible = d1.exists && d1.sending && d1.flag === '发送中' && !d1.bubbleYet ? 'PASS' : 'D1:' + JSON.stringify(d1);
  await page.screenshot({ path: 'D:/Code/Git/mini-canvas/.scratch/verify-D.png' });
  let d2 = null;
  for (let i = 0; i < 40; i++) {
    d2 = await page.evaluate(() => ({ rows: document.querySelectorAll('.ac-queue-row').length, bubble: [...document.querySelectorAll('.ac-user-line')].some(p => p.textContent.includes('终验-3')), rawSteer: document.body.innerText.includes('[user_steering]') }));
    if (d2.bubble && !d2.rawSteer) break;
    await sleep(1000);
  }
  results.D2_bubbleReplace = d2 && d2.bubble && !d2.rawSteer ? 'PASS' : 'FAIL:' + JSON.stringify(d2);
  await page.screenshot({ path: 'D:/Code/Git/mini-canvas/.scratch/verify-D2.png' });

  // ---- E. 队列全清后按钮消失 ----
  await waitIdle();
  await sleep(1000);
  const e = await page.evaluate(() => ({ rows: document.querySelectorAll('.ac-queue-row').length, pause: !!document.querySelector('.ac-queue-pause') }));
  results.E_pauseHiddenWhenEmpty = (e.rows === 0 && !e.pause) ? 'PASS' : 'FAIL:' + JSON.stringify(e);

  // ---- F. 设置开关存在 ----
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.waitForTimeout(1500);
  const f = await page.evaluate(() => document.body.innerText.includes('发送中显示队列'));
  results.F_settingExists = f ? 'PASS' : 'FAIL';
  await page.screenshot({ path: 'D:/Code/Git/mini-canvas/.scratch/verify-F.png' });
  await page.keyboard.press('Escape'); await sleep(500);

  // ---- G. 全程无裸标记 ----
  const g = await page.evaluate(() => document.body.innerText.includes('[user_steering]'));
  results.G_noRawMarker = !g ? 'PASS' : 'FAIL';

  await browser.close();
  fs.writeFileSync('D:/Code/Git/mini-canvas/.scratch/v2b-results.json', JSON.stringify(results, null, 1)); console.log('RESULTS=' + JSON.stringify(results));
})().catch(e => { console.error('FATAL:', e.message); fs.writeFileSync('D:/Code/Git/mini-canvas/.scratch/v2b-results.json', JSON.stringify(results, null, 1)); console.log('RESULTS=' + JSON.stringify(results)); process.exit(1); });

