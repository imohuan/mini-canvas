// @ts-nocheck
// 控制栏统一样式探针：普通节点 / 图片节点 / 分组节点 / 多选，逐个选中后
// 核对 (a) 容器都挂 .ntp-root 且计算样式一致，(b) 按钮默认透明、hover 才上色。
// 跑法：node packages/ui/e2e/_probe-toolbar-unify.mjs
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const EXE = process.env.CANVAS_E2E_CHROME
  ?? 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const BASE = process.env.PROBE_BASE ?? 'http://localhost:5312/';
if (!existsSync(EXE)) { console.error('chromium 不存在:', EXE); process.exit(2); }

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`);
}

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// 建一个图片节点（这样能同时覆盖 普通文本节点 / 图片节点 / 分组 / 多选）
try {
  await page.getByRole('button', { name: '添加节点' }).click({ timeout: 4000 });
  await page.getByRole('menuitem', { name: '图片', exact: true }).click({ timeout: 4000 });
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: '添加节点' }).click({ timeout: 4000 });
  await page.getByRole('menuitem', { name: '文本', exact: true }).click({ timeout: 4000 });
  await page.waitForTimeout(800);
  console.log('已建出图片 + 文本节点');
} catch (e) {
  console.log('建节点跳过：', e.message.split('\n')[0]);
}

/** 点第 idx 个节点的顶部条带选中它 */
const selectNode = async (idx) => {
  const box = await page.evaluate((i) => {
    const nodes = [...document.querySelectorAll('.vue-flow__node')];
    const el = nodes[i < 0 ? nodes.length + i : i];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + 8, w: r.width };
  }, idx);
  if (!box) return null;
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(600);
  return box;
};

/** 量当前页面上所有 .ntp-root 容器的关键计算样式 + 里面按钮的默认底色 */
const measure = () => page.evaluate(() => {
  const roots = [...document.querySelectorAll('.ntp-root')];
  const out = roots.map((el) => {
    const cs = getComputedStyle(el);
    const btns = [...el.querySelectorAll('button')];
    return {
      cls: el.className,
      display: cs.display,
      gap: cs.gap,
      padding: cs.padding,
      radius: cs.borderRadius,
      bg: cs.backgroundColor,
      border: cs.borderTopWidth + ' ' + cs.borderTopColor,
      whiteSpace: cs.whiteSpace,
      btnCount: btns.length,
      btnBgs: btns.slice(0, 4).map((b) => getComputedStyle(b).backgroundColor),
    };
  });
  return out;
});

const shots = new URL('./_shots/', import.meta.url).pathname.replace(/^\//, '');

/** 找当前页面上带 out:top 控制栏的节点索引（图片/视频才有，文本节点没注册 out:top） */
const findToolbarNodes = () => page.evaluate(() => {
  const nodes = [...document.querySelectorAll('.vue-flow__node')];
  return nodes.map((n, i) => ({ i, type: (n.className.match(/vue-flow__node-(\w+)/) ?? [])[1] ?? '?' }));
});

const types = await findToolbarNodes();
console.log('页面节点:', JSON.stringify(types));

// —— 逐个节点类型选中（只选注册了 out:top 的：image/video）——
const seen = [];
for (const t of types) {
  if (!/image|video/.test(t.type)) continue;
  const box = await selectNode(t.i);
  if (!box) continue;
  const m = await measure();
  console.log(`${t.type} 节点控制栏:`, JSON.stringify(m, null, 1));
  if (m.length) seen.push({ label: t.type, m });
  await page.screenshot({ path: `${shots}toolbar-${t.type}.png` }).catch(() => {});
  // 取消选中，避免干扰下一个
  await page.mouse.click(30, 860);
  await page.waitForTimeout(300);
}

check('至少捕获到一种节点控制栏', seen.length > 0, `捕获 ${seen.length} 种`);

// 所有捕获到的容器，计算样式必须完全一致（"一套规则"）
if (seen.length) {
  const sig = (r) => [r.display, r.gap, r.padding, r.radius, r.bg, r.border, r.whiteSpace].join('|');
  const all = seen.flatMap((s) => s.m.map(sig));
  const uniq = [...new Set(all)];
  check('所有控制栏容器计算样式一致（同一套规则）', uniq.length === 1, `${all.length} 个容器 / ${uniq.length} 种样式\n` + uniq.join('\n'));
  check('容器都挂了 .ntp-root', seen.every((s) => s.m.every((r) => r.cls.includes('ntp-root'))));

  // 按钮默认必须透明
  const btnBgs = seen.flatMap((s) => s.m.flatMap((r) => r.btnBgs));
  const nonTransparent = btnBgs.filter((b) => b !== 'rgba(0, 0, 0, 0)');
  console.log('按钮默认底色样本:', JSON.stringify(btnBgs.slice(0, 6)));
  check('控制栏按钮默认无背景（全透明）', nonTransparent.length === 0,
    nonTransparent.length ? `非透明: ${nonTransparent.join(', ')}` : `${btnBgs.length} 个按钮全透明`);
}

check('页面无 console 报错', errors.length === 0, errors.slice(0, 3).join(' | '));

const failed = results.filter((r) => !r.ok);
console.log(`\n==== ${results.length - failed.length}/${results.length} 通过 ====`);
await browser.close();
process.exit(failed.length ? 1 : 0);
