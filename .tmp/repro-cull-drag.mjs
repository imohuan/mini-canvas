// 临时复现：大画布 + 可见剔除变化时，拖动中的节点是否被 store 旧位置拉回。
import { chromium } from '../node_modules/.pnpm/playwright-core@1.63.0/node_modules/playwright-core/index.mjs';

const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const BASE = 'http://localhost:5288/#/canvas/repro-cull-' + Date.now();
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2500);
await page.waitForSelector('.vue-flow__node', { timeout: 30000 });

const seeded = await page.evaluate(() => {
  const h = window.MiniCanvasUI.getHost();
  const doc = h.ctx.get('doc');
  const old = doc.getNodes();
  if (old.length) doc.removeNodes(old.map((n) => n.id));
  const nodes = [];
  for (let row = 0; row < 14; row++) {
    for (let col = 0; col < 14; col++) {
      nodes.push({
        id: `n${row}_${col}`,
        type: 'text',
        position: { x: col * 230, y: row * 170 },
        size: { w: 160, h: 100 },
        data: { label: `N${row}-${col}`, text: `N${row}-${col}` },
      });
    }
  }
  doc.addNodes(nodes);
  h.viewport.setViewport({ x: 60, y: 60, zoom: 0.5 });
  return { count: doc.getNodes().length };
});
await page.waitForTimeout(1200);

const snap = (tag) => page.evaluate((t) => {
  const h = window.MiniCanvasUI.getHost();
  const doc = h.ctx.get('doc').getNode('n0_0');
  const el = document.querySelector('.vue-flow__node[data-id="n0_0"]');
  const r = el?.getBoundingClientRect();
  const all = [...document.querySelectorAll('.vue-flow__node')];
  return {
    tag: t,
    doc: { ...doc.position },
    transform: el?.style.transform ?? null,
    dom: r ? { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) } : null,
    vp: h.viewport.getViewport(),
    nodeEls: all.length,
    cull: el?.querySelector('.v2-card')?.getAttribute('data-cull-state') ?? el?.getAttribute('data-cull-state') ?? null,
    sel: [...h.selection.ids],
  };
}, tag);

const rows = [await snap('start')];
const box = await page.locator('.vue-flow__node[data-id="n0_0"]').boundingBox();
console.log('BOX', box);
const sx = box.x + box.width / 2;
const sy = box.y + 8;
await page.mouse.move(sx, sy);
await page.mouse.down();
await page.mouse.move(sx + 180, sy + 100, { steps: 10 });
await page.waitForTimeout(180);
rows.push(await snap('drag-visual'));
// 按住不放，缩放范围变大 → 可见集合变化 → 宿主重灌；
await page.mouse.wheel(0, 300);
await page.waitForTimeout(500);
rows.push(await snap('wheel-out-while-holding'));
await page.mouse.up();
await page.waitForTimeout(700);
rows.push(await snap('after-release'));

console.log(JSON.stringify({ seeded, rows, errors }, null, 2));
await browser.close();
