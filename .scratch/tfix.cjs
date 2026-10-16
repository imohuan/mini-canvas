const pw = require('D:/Code/Git/mini-canvas/node_modules/.pnpm/playwright-core@1.63.0/node_modules/playwright-core');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const log = [];
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
  await input.click(); await input.fill('::test 8s:: 修复后观察轮');
  await send.click(); await sleep(1000);
  await input.click(); await input.fill('修复验证-X');
  await send.click(); await sleep(500);
  for (let i = 0; i < 44; i++) {
    const s = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.ac-queue-row')];
      const bubbles = [...document.querySelectorAll('.ac-user-line')].map(p => p.textContent.trim().slice(0, 40));
      return {
        s: Math.round(performance.now() / 1000),
        q: rows.map(r => ({ t: (r.querySelector('.ac-queue-text') || {}).textContent, sending: r.classList.contains('is-sending'), flag: (r.querySelector('.ac-queue-flag') || {}).textContent || '' })),
        pause: !!document.querySelector('.ac-queue-pause'),
        bubbles,
        rawSteer: document.body.innerText.includes('[user_steering]'),
      };
    });
    log.push(JSON.stringify(s));
    await sleep(1000);
  }
  require('fs').writeFileSync('D:/Code/Git/mini-canvas/.scratch/t-fix-samples.json', '[\n' + log.join(',\n') + '\n]');
  console.log('DONE');
  await browser.close();
})().catch(e => { require('fs').writeFileSync('D:/Code/Git/mini-canvas/.scratch/t-fix-err.txt', String(e && e.stack || e)); console.error('FAIL'); process.exit(1); });

