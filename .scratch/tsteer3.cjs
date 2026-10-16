const pw = require('D:/Code/Git/mini-canvas/node_modules/.pnpm/playwright-core@1.63.0/node_modules/playwright-core');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
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
  await input.click(); await input.fill('::test 15s:: 引导终验轮');
  await send.click(); await sleep(1200);
  await input.click(); await input.fill('引导终验-M3');
  await send.click(); await sleep(1200);
  await page.locator('.ac-queue-row').first().locator('button[aria-label="引导（插队发送）"]').click();
  await sleep(1500);
  const st1 = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.ac-queue-row')];
    return { rows: rows.map(r => ({ t: (r.querySelector('.ac-queue-text') || {}).textContent, sending: r.classList.contains('is-sending'), flag: (r.querySelector('.ac-queue-flag') || {}).textContent || '' })), bubbles: [...document.querySelectorAll('.ac-user-line')].map(p => p.textContent.trim().slice(0, 40)) };
  });
  console.log('STEP1 (点击引导后):', JSON.stringify(st1));
  // 中途再采样两次确认「发送中」持续可见
  await sleep(5000);
  const st2 = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.ac-queue-row')];
    return { sending: rows.some(r => r.classList.contains('is-sending')), flag: (rows[0]?.querySelector('.ac-queue-flag') || {}).textContent || '', bubbles: [...document.querySelectorAll('.ac-user-line')].map(p => p.textContent.trim().slice(0, 40)) };
  });
  console.log('STEP2 (5秒后仍在发送中):', JSON.stringify(st2));
  // 等第一轮结束、消息进对话
  let final = null;
  for (let i = 0; i < 25; i++) {
    const st = await page.evaluate(() => ({ rows: document.querySelectorAll('.ac-queue-row').length, bubbles: [...document.querySelectorAll('.ac-user-line')].map(p => p.textContent.trim().slice(0, 40)), rawSteer: document.body.innerText.includes('[user_steering]') }));
    if (st.rows === 0 && st.bubbles.some(b => b.includes('引导终验-M3'))) { final = st; break; }
    await sleep(1000);
  }
  console.log('FINAL:', JSON.stringify(final));
  const pass = st1.rows.some(r => r.sending && r.flag === '发送中') && final && final.rows === 0 && final.bubbles.some(b => b.includes('引导终验-M3')) && !final.rawSteer;
  console.log('VERDICT:', pass ? 'PASS' : 'FAIL');
  await page.screenshot({ path: 'D:/Code/Git/mini-canvas/.scratch/steer-final.png' });
  await browser.close();
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });

