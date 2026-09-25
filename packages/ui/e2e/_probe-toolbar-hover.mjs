// @ts-nocheck
// 核对 hover 态：按钮默认透明，鼠标移上去必须出底色（这是用户要求的"只有 hover 才有背景"）。
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
await page.mouse.click(box.x, box.y);
await page.waitForTimeout(800);

const btns = await page.evaluate(() => {
  const root = document.querySelector('.ntp-root');
  return [...root.querySelectorAll('button')].map((b) => {
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, bg: getComputedStyle(b).backgroundColor };
  });
});
console.log('按钮默认底色:', JSON.stringify(btns.map((b) => b.bg)));

let i = 0;
for (const b of btns) {
  await page.mouse.move(b.x, b.y);
  await page.waitForTimeout(400);
  const hovered = await page.evaluate((idx) => {
    const root = document.querySelector('.ntp-root');
    const el = root.querySelectorAll('button')[idx];
    return getComputedStyle(el).backgroundColor;
  }, i);
  const ok = hovered !== 'rgba(0, 0, 0, 0)';
  console.log(`${ok ? 'PASS' : 'FAIL'}  第 ${i + 1} 个按钮 hover 底色 = ${hovered}（默认 ${b.bg}）`);
  i++;
}

// hover 局部放大图
const rootRect = await page.evaluate(() => {
  const r = document.querySelector('.ntp-root').getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
await page.screenshot({
  path: new URL('./_shots/toolbar-hover.png', import.meta.url).pathname.replace(/^\//, ''),
  clip: { x: Math.round(rootRect.x - 20), y: Math.round(rootRect.y - 20), width: Math.round(rootRect.width + 40), height: Math.round(rootRect.height + 40) },
});
await browser.close();
