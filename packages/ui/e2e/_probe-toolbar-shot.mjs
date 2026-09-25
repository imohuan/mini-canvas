// @ts-nocheck
// 只截"选中节点 + 控制栏"的局部图，方便肉眼核对统一后的观感。
import { chromium } from 'playwright-core';
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const BASE = 'http://localhost:5312/';
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const box = await page.evaluate(() => {
  const n = [...document.querySelectorAll('.vue-flow__node')].find((e) => e.className.includes('node-image'));
  if (!n) return null;
  const r = n.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + 8 };
});
if (box) { await page.mouse.click(box.x, box.y); await page.waitForTimeout(800); }

const tb = await page.evaluate(() => {
  const el = document.querySelector('.ntp-root');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
console.log('toolbar rect:', JSON.stringify(tb));
if (tb) {
  const clip = {
    x: Math.max(0, Math.round(tb.x - 24)),
    y: Math.max(0, Math.round(tb.y - 24)),
    width: Math.round(tb.width + 48),
    height: Math.round(tb.height + 48),
  };
  console.log('clip:', JSON.stringify(clip));
  await page.screenshot({
    path: new URL('./_shots/toolbar-closeup.png', import.meta.url).pathname.replace(/^\//, ''),
    clip,
  });
}
await browser.close();
