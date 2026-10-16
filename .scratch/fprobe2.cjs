const pw = require('D:/Code/Git/mini-canvas/node_modules/.pnpm/playwright-core@1.63.0/node_modules/playwright-core');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await pw.chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto('http://127.0.0.1:8865/#/canvas/7cc7dc03e3624eb7', { timeout: 20000 });
  await page.waitForTimeout(3500);
  await page.getByRole('button', { name: 'Agent 对话' }).click();
  await page.waitForTimeout(2000);
  await page.locator('[aria-label="Agent 偏好"]').click();
  await page.waitForTimeout(1500);
  const found = await page.evaluate(() => {
    const t = document.body.innerText;
    const i1 = t.indexOf('发送中显示队列');
    const i2 = t.indexOf('后台对话');
    const i3 = t.indexOf('目标设置');
    return { has: i1 >= 0, between: i2 >= 0 && i3 > i2 && i1 > i2 && i1 < i3, order: [i2, i1, i3] };
  });
  console.log('F detail:', JSON.stringify(found));
  const sw = page.locator('[aria-label="发送中显示队列"]');
  const swCount = await sw.count();
  // 点开关验证状态翻转
  const before = await sw.getAttribute('aria-checked');
  await sw.click(); await sleep(800);
  const after = await sw.getAttribute('aria-checked');
  await sw.click(); await sleep(500); // 恢复开启
  const restored = await sw.getAttribute('aria-checked');
  console.log('switch:', swCount, 'before:', before, 'after:', after, 'restored:', restored);
  await page.screenshot({ path: 'D:/Code/Git/mini-canvas/.scratch/f-setting2.png' });
  await browser.close();
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });

