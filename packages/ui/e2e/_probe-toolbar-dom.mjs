// @ts-nocheck
import { chromium } from 'playwright-core';
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const BASE = 'http://localhost:5312/';
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const dump = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('.vue-flow__node')];
  return {
    nodeCount: nodes.length,
    roots: document.querySelectorAll('.ntp-root').length,
    nodeInfo: nodes.map((n, i) => {
      const r = n.getBoundingClientRect();
      return {
        i, id: n.getAttribute('data-id'), cls: n.className.slice(0, 120),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        selected: n.classList.contains('selected'),
        hasToolbar: !!n.querySelector('.ntp-root'),
      };
    }),
    allToolbarLike: [...document.querySelectorAll('[class*="toolbar"], [class*="it-root"], [class*="vt-root"]')]
      .slice(0, 10).map((e) => e.className.slice(0, 100)),
  };
});
console.log(JSON.stringify(dump, null, 1));

// 试着点第一个节点
const box = await page.evaluate(() => {
  const n = document.querySelector('.vue-flow__node');
  if (!n) return null;
  const r = n.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + 8 };
});
console.log('click at', box);
if (box) {
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => ({
    selected: [...document.querySelectorAll('.vue-flow__node.selected')].map((n) => n.getAttribute('data-id')),
    roots: document.querySelectorAll('.ntp-root').length,
    rootCls: [...document.querySelectorAll('.ntp-root')].map((e) => e.className),
    anyToolbar: document.querySelectorAll('[class*="toolbar"]').length,
  }));
  console.log('after click:', JSON.stringify(after, null, 1));
}
await browser.close();
