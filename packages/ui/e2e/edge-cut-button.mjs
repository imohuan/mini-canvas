// @ts-nocheck
// edge-cut-button —— 连线"双击弹删除钮 → 点钮删线"回归验证（真实浏览器）。
//
// 覆盖用户报告的一件事：双击连线弹出删除按钮，但点它没反应。
//
// 根因（本脚本锁的就是它）：CustomEdge 里删除钮与"加宽透明点击热区"同在一个 <g>。
// SVG 没有 z-index，后画的在上层、命中测试也先给它 —— 而 e1e1e997 把热区挪到了模板末尾
// （顺序变成"按钮在前、热区在后"），于是 12px 宽的透明热区整条盖住 32×32 的圆钮中心：
// 双击能弹按钮，点下去命中的却是热区（热区只负责选中/双击，不删线）→ 看起来"按钮坏了"。
//
// 跑法：dev server 在 :5288 后执行
//   node packages/ui/e2e/edge-cut-button.mjs
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const EXE = process.env.CANVAS_E2E_CHROME
  ?? 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const BASE = process.env.CANVAS_E2E_BASE ?? `http://localhost:${process.env.CANVAS_PORT ?? 5288}/`;

const errors = [];
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`);
}
if (!existsSync(EXE)) { console.error('chromium 不存在:', EXE); process.exit(2); }

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));

/** 起一张只有"两个文本节点 + 一条连线"的干净画布（直写存储，绕开种子数据）。 */
const bootWithEdge = async () => {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate(() => {
    try {
      localStorage.clear();
      localStorage.setItem('canvas:graph', JSON.stringify([
        { id: 'n1', type: 'text', position: { x: 120, y: 240 }, data: { text: 'A' } },
        { id: 'n2', type: 'text', position: { x: 760, y: 240 }, data: { text: 'B' } },
      ]));
      localStorage.setItem('canvas:graph-edges', JSON.stringify([{ id: 'e1', source: 'n1', target: 'n2' }]));
    } catch {}
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.vue-flow__edge .edge-hit-area', { timeout: 30000, state: 'attached' });
  await page.waitForTimeout(1200);
};

const edgeIds = () => page.evaluate(() => window.MiniCanvasUI.getHost().edgeStore.getEdges().map((e) => e.id));

/** 连线中点的屏幕坐标（经 path 的 CTM 换算，视口/缩放都算进去）。 */
const edgeMidScreen = () => page.evaluate(() => {
  const path = document.querySelector('.vue-flow__edge .edge-hit-area');
  const svg = path.ownerSVGElement;
  const p = path.getPointAtLength(path.getTotalLength() / 2);
  const pt = svg.createSVGPoint();
  pt.x = p.x; pt.y = p.y;
  const s = pt.matrixTransform(path.getScreenCTM());
  return { x: s.x, y: s.y };
});

/** 按钮的屏幕矩形 + 圆心处**实际命中**的元素（这条才是本 bug 的判据）。 */
const cutButtonProbe = () => page.evaluate(() => {
  const b = document.querySelector('.cut-btn');
  if (!b) return { found: false };
  const r = b.getBoundingClientRect();
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const hit = document.elementFromPoint(cx, cy);
  return {
    found: true,
    rect: { x: r.x, y: r.y, w: r.width, h: r.height },
    hitIsCutBtn: !!hit && !!hit.closest('.cut-btn'),
    hitTag: hit ? hit.tagName.toLowerCase() : null,
    hitClass: hit ? String(hit.getAttribute('class') ?? '') : '',
  };
});

// ========== ① 双击连线弹出删除钮，且钮在最上层（命中测试归它）==========
await bootWithEdge();
const errsBefore = errors.length;
check('起手：画布上有一条连线', (await edgeIds()).length === 1, JSON.stringify(await edgeIds()));

const mid = await edgeMidScreen();
await page.mouse.dblclick(mid.x, mid.y);
await page.waitForTimeout(400);

const probe = await cutButtonProbe();
check('双击连线弹出删除按钮', probe.found, JSON.stringify(probe.rect ?? null));
// 这条是回归红线：修前命中 el 是 .edge-hit-area（透明热区盖住了按钮）。
check('按钮圆心处命中的是按钮本身（未被透明热区盖住）', probe.hitIsCutBtn, `hit=${probe.hitTag}.${probe.hitClass}`);

// ========== ② 点按钮 → 连线真的被删掉 ==========
if (probe.found) {
  const cx = probe.rect.x + probe.rect.w / 2;
  const cy = probe.rect.y + probe.rect.h / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(600);
}
const afterCut = await edgeIds();
check('点删除按钮：连线被删掉', afterCut.length === 0, JSON.stringify(afterCut));
check('删线后按钮不再残留', !(await cutButtonProbe()).found);

// ========== ③ 删线进撤销栈（回落路径走 doc.removeEdges 的行为契约）==========
await page.keyboard.press('Control+z');
await page.waitForTimeout(600);
check('Ctrl+Z 能把删掉的连线撤销回来', (await edgeIds()).includes('e1'), JSON.stringify(await edgeIds()));

// ========== ④ 双击空白处/其它位置：按钮收起，不误删 ==========
const mid2 = await edgeMidScreen();
await page.mouse.dblclick(mid2.x, mid2.y);
await page.waitForTimeout(300);
check('再次双击连线能再弹出按钮', (await cutButtonProbe()).found);
await page.mouse.click(20, 860); // 点画布空白（document 级 click 关闭按钮）
await page.waitForTimeout(300);
check('点画布空白：按钮收起且连线还在', !(await cutButtonProbe()).found && (await edgeIds()).includes('e1'),
  JSON.stringify(await edgeIds()));

// ========== ⑤ 连线被选中/流光时，按钮同样点得动 ==========
const mid3 = await edgeMidScreen();
await page.mouse.click(mid3.x, mid3.y); // 先单击选中边（触发流光重渲染路径）
await page.waitForTimeout(500);
await page.mouse.dblclick(mid3.x, mid3.y);
await page.waitForTimeout(400);
const probeSel = await cutButtonProbe();
check('连线选中态下按钮仍在最上层', probeSel.found && probeSel.hitIsCutBtn, JSON.stringify(probeSel));
if (probeSel.found) {
  await page.mouse.click(probeSel.rect.x + probeSel.rect.w / 2, probeSel.rect.y + probeSel.rect.h / 2);
  await page.waitForTimeout(600);
}
check('选中态下点按钮同样能删线', (await edgeIds()).length === 0, JSON.stringify(await edgeIds()));

check('全程无控制台错误', errors.slice(errsBefore).length === 0, errors.slice(errsBefore).slice(0, 2).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 1 : 0);
