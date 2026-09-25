// @ts-nocheck
// 浏览器可视化验证：真实 UI 路径（Ctrl+A 全选 → 抓节点拖 → 拖动中滚轮缩放），
// 逐帧截图 + 几何采样，最后输出截图路径供肉眼复核。
import { chromium } from 'playwright-core';

const EXE = process.env.CANVAS_E2E_CHROME
  ?? 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const BASE = process.env.CANVAS_E2E_BASE ?? 'http://localhost:5288/';
const OUT = 'packages/ui/e2e/_shots';

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE-ERR', m.text().slice(0, 160)); });

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => { try { localStorage.clear(); } catch {} });
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(2200);
await page.waitForSelector('.vue-flow__node', { timeout: 30000 });

await page.evaluate(() => {
  const h = window.MiniCanvasUI.getHost();
  const doc = h.ctx.get('doc');
  const old = doc.getNodes();
  if (old.length) doc.removeNodes(old.map((n) => n.id));
  doc.addNodes([
    { id: 't1', type: 'text', position: { x: 260, y: 280 }, data: { content: '节点 A' } },
    { id: 't2', type: 'text', position: { x: 720, y: 430 }, data: { content: '节点 B' } },
  ]);
  h.viewport.setViewport({ x: 0, y: 0, zoom: 1 });
});
await page.waitForTimeout(800);

/** 采样：选框外框相对"选中节点并集"的四边屏幕偏移 */
const offsets = () =>
  page.evaluate(() => {
    const outer = document.querySelector('.selection-frame-outer');
    const ids = [...window.MiniCanvasUI.getHost().selection.ids];
    const ns = ids.map((id) => document.querySelector('.vue-flow__node[data-id="' + id + '"]')).filter(Boolean);
    if (!outer || !ns.length) return null;
    const o = outer.getBoundingClientRect();
    const rs = ns.map((n) => n.getBoundingClientRect());
    return {
      l: +(Math.min(...rs.map((r) => r.left)) - o.left).toFixed(1),
      t: +(Math.min(...rs.map((r) => r.top)) - o.top).toFixed(1),
      r: +(o.right - Math.max(...rs.map((r) => r.right))).toFixed(1),
      b: +(o.bottom - Math.max(...rs.map((r) => r.bottom))).toFixed(1),
    };
  });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  -- ' + detail : ''));
};

// ===== 步骤 1：真实 UI 全选（Ctrl+A）=====
await page.mouse.click(640, 780);
await page.waitForTimeout(300);
await page.keyboard.press('Control+a');
await page.waitForTimeout(500);
const selCount = await page.evaluate(() => window.MiniCanvasUI.getHost().selection.ids.size);
check('Ctrl+A 全选出 2 个节点', selCount === 2, 'count=' + selCount);
const hasFrame = await page.evaluate(() => !!document.querySelector('.selection-frame-outer'));
check('多选框出现', hasFrame);
await page.screenshot({ path: OUT + '/v1-selected.png' });

// ===== 步骤 2：抓节点标题条拖拽（真实用户手势），拖动中滚轮缩放 =====
const grab = await page.evaluate(() => {
  const r = document.querySelector('.vue-flow__node[data-id="t1"]').getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + 8 };
});
await page.mouse.move(grab.x, grab.y);
await page.mouse.down();
await page.waitForTimeout(60);

// 起步拖 120px（分小步，真实手感）
for (let i = 1; i <= 6; i++) {
  await page.mouse.move(grab.x + i * 20, grab.y + i * 8, { steps: 4 });
  await page.waitForTimeout(24);
}
const base = await offsets();
await page.screenshot({ path: OUT + '/v2-dragging.png' });

// ===== 拖动不放，滚轮缩放；逐帧截 6 张 + 记录偏移 =====
const zoomSamples = [];
for (let i = 0; i < 3; i++) {
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(50);
  const o = await offsets();
  zoomSamples.push(o);
  await page.screenshot({ path: OUT + '/v3-zoom-' + i + '.png' });
}
await page.waitForTimeout(400);
const zoomSettled = await offsets();
await page.screenshot({ path: OUT + '/v4-zoom-settled.png' });

// 闪回判定：基准 16/34/16/16（zoom=1 按下时），缩放后每帧都应贴合（容差 6px）
const badZoom = zoomSamples.filter((o) => o && (Math.abs(o.l - 16) > 6 || Math.abs(o.t - 34) > 6 || Math.abs(o.r - 16) > 6 || Math.abs(o.b - 16) > 6));
check('拖动中缩放：无闪回帧（偏移贴合）', badZoom.length === 0, JSON.stringify(badZoom[0] ?? zoomSettled));

// ===== 继续拖一段，确认跟手恢复/保持 =====
let mx = 120;
const before = await page.evaluate(() => {
  const r = document.querySelector('.vue-flow__node[data-id="t1"]').getBoundingClientRect();
  return r.left;
});
for (let i = 1; i <= 5; i++) {
  await page.mouse.move(grab.x + 120 + i * 20, grab.y + 48 + i * 8, { steps: 4 });
  mx += 20;
  await page.waitForTimeout(24);
}
const afterX = await page.evaluate(() => document.querySelector('.vue-flow__node[data-id="t1"]').getBoundingClientRect().left);
const movedScreen = afterX - before;
// 此时 zoom 已放大（wheel -360 约 → 1.65）：节点 flow 位移 = 100/zoom，
// 节点**屏幕**位移 = flow × zoom = 100 —— 屏幕上节点跟着鼠标 1:1 走（跟手）。
// （修前 ratio=0.605：鼠标走 100px 屏幕上节点只走 60px，脱手。）
const zoomNow = await page.evaluate(() => window.MiniCanvasUI.getHost().viewport.getViewport().zoom);
const ratio = movedScreen / 100;
check('缩放后继续拖跟手（屏幕 ratio≈1：节点跟着鼠标走）', Math.abs(ratio - 1) < 0.15, `ratio=${ratio.toFixed(3)} zoom=${zoomNow.toFixed(3)}`);
const afterOffsets = await offsets();
const stillBad = afterOffsets && (Math.abs(afterOffsets.l - 16) > 6 || Math.abs(afterOffsets.t - 34) > 6);
check('缩放后选框仍贴合（16/34/16/16）', !stillBad, JSON.stringify(afterOffsets));
await page.screenshot({ path: OUT + '/v5-continued.png' });

await page.mouse.up();
await page.waitForTimeout(500);
const selAfter = await page.evaluate(() => window.MiniCanvasUI.getHost().selection.ids.size);
check('松手后选中保留', selAfter === 2, 'count=' + selAfter);
await page.screenshot({ path: OUT + '/v6-dropped.png' });

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' 通过');
console.log('截图目录: ' + OUT + '/');
process.exit(failed.length ? 1 : 0);
