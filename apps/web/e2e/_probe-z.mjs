// 层级调查：全量层级清单 + 置顶连线 vs 控制栏 重叠实测（真实浏览器）
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const EXE = process.env.CANVAS_E2E_CHROME
  ?? 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const BASE = process.env.BASE ?? 'http://localhost:5291/';
const OUT = '.scratch/shots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR ' + e.message));
await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => { try { localStorage.clear(); } catch {} });
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.vue-flow__node', { timeout: 30000 });
await page.waitForTimeout(1200);

await page.evaluate(() => {
  const h = window.MiniCanvasUI.getHost();
  const g = h.graph;
  const st = h.ctx.get('settings');
  st.set('edgeType', 'straight');
  const ids = g.getNodes().map((n) => n.id);
  const textId = ids.find((id) => g.getNode(id).type === 'text');
  const imgId = ids.find((id) => g.getNode(id).type === 'image');
  g.updateNode(imgId, { position: { x: 620, y: 260 } });
  h.viewport.setViewport({ x: 0, y: 0, zoom: 1 });
  h.selection.set([imgId]);
  window.__ids = { textId, imgId };
});
await page.waitForTimeout(900);

await page.evaluate(() => {
  const h = window.MiniCanvasUI.getHost();
  const g = h.graph;
  const { textId, imgId } = window.__ids;
  const nodeEl = document.querySelector('.vue-flow__node[data-id="' + imgId + '"]');
  const bar = nodeEl.querySelector('.v2-slot--bottom');
  const b = bar.getBoundingClientRect();
  const flow = h.viewport.screenToFlow(b.x + b.width / 2, b.y + b.height / 2);
  g.updateNode(textId, { position: { x: flow.x - 1000, y: flow.y - 90 } });
  const rightId = g.createNode('text', { x: flow.x + 320, y: flow.y - 90 });
  g.removeEdges(g.getEdges().map((e) => e.id));
  const r1 = g.connectEdge({ source: textId, target: rightId });
  window.__probe = { barRect: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }, flowY: Math.round(flow.y), r1 };
});
await page.waitForTimeout(900);

const overlap = async (label) => {
  const data = await page.evaluate(() => {
    const h = window.MiniCanvasUI.getHost();
    const st = h.ctx.get('settings');
    const { imgId } = window.__ids;
    const nodeEl = document.querySelector('.vue-flow__node[data-id="' + imgId + '"]');
    const bars = ['.v2-slot--top', '.v2-slot--bottom'].map((sel) => {
      const el = nodeEl.querySelector(sel);
      if (!el) return { sel, missing: true };
      const b = el.getBoundingClientRect();
      let edgeHits = 0, total = 0;
      const first = { x: -1, y: -1, who: '' };
      for (let y = b.y + 2; y < b.y + b.height - 2; y += 6) {
        for (let x = b.x + 2; x < b.x + b.width - 2; x += 6) {
          if (x < 0 || y < 0 || x >= 1400 || y >= 900) continue;
          total++;
          const t = document.elementFromPoint(x, y);
          if (t && t.closest('svg.vue-flow__edges')) { edgeHits++; if (first.x < 0) { first.x = Math.round(x); first.y = Math.round(y); first.who = 'EDGE'; } }
        }
      }
      return { sel, rect: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }, total, edgeHits, sampleEdgePoint: first };
    });
    return {
      edgeOnTop: st.get('edgeOnTop'),
      edgeSvgZ: [...document.querySelectorAll('svg.vue-flow__edges')].map((s) => s.style.zIndex || getComputedStyle(s).zIndex),
      nodeZ: getComputedStyle(nodeEl).zIndex,
      edges: h.graph.getEdges().map((e) => e.id),
      bars,
    };
  });
  console.log('=== ' + label + ' ===');
  console.log(JSON.stringify(data, null, 1));
  await page.screenshot({ path: OUT + '/' + label + '.png' });
};

await overlap('10-default-edges-below');
await page.evaluate(() => { window.MiniCanvasUI.getHost().ctx.get('settings').set('edgeOnTop', true); });
await page.waitForTimeout(900);
await overlap('11-edges-on-top');

await browser.close();
