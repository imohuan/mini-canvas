// 复现：拖动节点时滚轮缩小，可见集合变化两次，观察节点是否被 store 旧位置拉回。
import { chromium } from '../node_modules/.pnpm/playwright-core@1.63.0/node_modules/playwright-core/index.mjs';

const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const BASE = 'http://localhost:5288/#/canvas/repro-cull2-check';
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => { if (!/resolveAgentBaseUrl/.test(e.message)) errors.push('PAGEERROR ' + e.message); });
page.on('console', (m) => { if (m.type() === 'error' && !/resolveAgentBaseUrl|status of 403/.test(m.text())) errors.push('CONSOLE ' + m.text()); });

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(2500);
await page.waitForSelector('.vue-flow__node', { timeout: 30000 });

await page.evaluate(() => {
  const h = window.MiniCanvasUI.getHost();
  const doc = h.ctx.get('doc');
  const old = doc.getNodes();
  if (old.length) doc.removeNodes(old.map((n) => n.id));
  const nodes = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      nodes.push({
        id: `n${row}_${col}`,
        type: 'text',
        position: { x: col * 420, y: row * 300 },
        size: { w: 180, h: 110 },
        data: { label: `N${row}-${col}`, text: `N${row}-${col}` },
      });
    }
  }
  doc.addNodes(nodes);
  h.viewport.setViewport({ x: 40, y: 40, zoom: 0.6 });
});
await page.waitForTimeout(1200);

const snap = (tag) => page.evaluate((t) => {
  const h = window.MiniCanvasUI.getHost();
  const n = h.ctx.get('doc').getNode('n0_0');
  const el = document.querySelector('.vue-flow__node[data-id="n0_0"]');
  const r = el?.getBoundingClientRect();
  return {
    tag: t,
    doc: { ...n.position },
    transform: el?.style.transform ?? null,
    dom: r ? { x: +r.x.toFixed(1), y: +r.y.toFixed(1) } : null,
    vp: h.viewport.getViewport(),
    nodeEls: document.querySelectorAll('.vue-flow__node').length,
    sel: [...h.selection.ids],
  };
}, tag);

const rows = [await snap('start')];
const box = await page.locator('.vue-flow__node[data-id="n0_0"]').boundingBox();
const sx = box.x + box.width / 2;
const sy = box.y + 8;
await page.mouse.move(sx, sy);
await page.mouse.down();
await page.mouse.move(sx + 220, sy + 120, { steps: 12 });
await page.waitForTimeout(200);
rows.push(await snap('drag-visual'));
await page.mouse.wheel(0, 160);
await page.waitForTimeout(400);
rows.push(await snap('wheel-out-1'));
await page.mouse.wheel(0, 160);
await page.waitForTimeout(400);
rows.push(await snap('wheel-out-2'));
await page.mouse.move(sx + 260, sy + 150, { steps: 6 });
await page.waitForTimeout(160);
rows.push(await snap('move-after-wheel'));
await page.mouse.up();
await page.waitForTimeout(700);
rows.push(await snap('after-release'));

// rows[1] 是起手前，rows[2..4] 是拖动中；滚轮期间的画面位置应保持拖动后的值。
const failed = rows.slice(2, 4).some((r) => r.transform !== rows[2].transform);
const grown = rows[2].nodeEls > rows[0].nodeEls || rows[3].nodeEls > rows[0].nodeEls;
const persisted = Math.abs(rows[5].doc.x - rows[0].doc.x) > 100;
console.log(JSON.stringify({ pass: !failed && grown && persisted, failed, grown, persisted, rows, errors }, null, 2));
await browser.close();
process.exit(!failed && grown && persisted && errors.length === 0 ? 0 : 1);
