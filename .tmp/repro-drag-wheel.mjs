// 临时复现：拖动节点过程中滚轮缩放，观察 store / 渲染位置是否被旧数据顶回。
import { chromium } from '../node_modules/.pnpm/playwright-core@1.63.0/node_modules/playwright-core/index.mjs';

const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const BASE = 'http://localhost:5288/#/canvas/repro-drag-wheel-' + Date.now();

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2500);
await page.waitForSelector('.vue-flow__node[data-id="1"]', { timeout: 30000 });

const snap = (tag) => page.evaluate((t) => {
  const h = window.MiniCanvasUI.getHost();
  const el = document.querySelector('.vue-flow__node[data-id="1"]');
  const r = el.getBoundingClientRect();
  const doc = h.ctx.get('doc').getNode('1');
  const transform = el.style.transform;
  return {
    tag: t,
    doc: { x: +doc.position.x.toFixed(2), y: +doc.position.y.toFixed(2) },
    transform,
    dom: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
    vp: h.viewport.getViewport(),
    sel: [...h.selection.ids],
  };
}, tag);

await page.evaluate(() => {
  const h = window.MiniCanvasUI.getHost();
  h.viewport.setViewport({ x: 100, y: 100, zoom: 1 });
});
await page.waitForTimeout(300);

const rows = [];
rows.push(await snap('start'));
const box = await page.locator('.vue-flow__node[data-id="1"]').boundingBox();
const sx = box.x + box.width / 2;
const sy = box.y + 10;
await page.mouse.move(sx, sy);
await page.mouse.down();
await page.mouse.move(sx + 70, sy + 50, { steps: 8 });
await page.waitForTimeout(120);
rows.push(await snap('drag-visual'));
await page.mouse.up();
await page.waitForTimeout(600);
rows.push(await snap('after-release'));
// 用户描述：拖完节点、松手之后再滚轮缩放
await page.mouse.move(sx + 100, sy + 70);
await page.waitForTimeout(100);
await page.mouse.wheel(0, -120);
await page.waitForTimeout(500);
rows.push(await snap('wheel-after-release'));
await page.mouse.wheel(0, -120);
await page.waitForTimeout(500);
rows.push(await snap('wheel-after-release-2'));

console.log(JSON.stringify({ rows, errors }, null, 2));
await browser.close();
