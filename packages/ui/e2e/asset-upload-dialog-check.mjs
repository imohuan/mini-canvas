// @ts-nocheck
// asset-upload-dialog-check —— 资产面板/上传弹窗的 UI 自动化测试（真实 Chromium，打 cloud-server :8865）。
// 覆盖：① 「+」触发文件选择器；② 下拉+箭头左对齐；③ 移动到（当前位置打勾 + 真挪）；
//       ④ 添加到画布自动聚焦（等价按 F）。
// 跑法：node packages/ui/e2e/asset-upload-dialog-check.mjs
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const EXE = process.env.CANVAS_E2E_CHROME
  ?? 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const BASE = process.env.ASSET_BASE ?? 'http://127.0.0.1:8865';
const CANVAS_ID = process.env.CANVAS_ID ?? '430c8f1f00bd4aba';
if (!existsSync(EXE)) { console.error('chromium 不存在:', EXE); process.exit(2); }

const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -- ' + d : ''}`); };
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));

const sleep = (ms) => page.waitForTimeout(ms);
const openDrawerAssets = async () => {
  // 抽屉可能关着、可能开着但停在别的 tab：统一走「确保打开 + 切到资产」
  if (await page.locator('.left-drawer').count() === 0) {
    await page.getByRole('button', { name: '资产管理' }).first().click();
    await page.waitForTimeout(900);
  }
  const tab = page.locator('.left-drawer [role=tab]', { hasText: '资产' });
  if (await tab.count()) {
    await tab.first().click({ force: true });
    await page.waitForTimeout(1500);
  }
};
// 清理遗留的测试文件夹（上次跑失败可能留下垃圾）
const cleanup = () => page.evaluate(async () => {
  const fs = await fetch('/api/asset-folders').then(r => r.json()).then(d => d.folders);
  for (const f of fs.filter(x => /^(自动化|回归)-/.test(x.name))) await fetch('/api/asset-folders/' + f.id, { method: 'DELETE' });
});

await page.goto(`${BASE}/#/canvas/${CANVAS_ID}`, { waitUntil: 'load' });
await page.waitForTimeout(3500);
await cleanup();

// ===== 造测试文件夹（「移动到」要有目标可选）=====
const mkResult = await page.evaluate(async () => {
  const mk = (n) => fetch('/api/asset-folders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: n }) }).then(r => r.json());
  const a = await mk('回归-甲');
  const b = await mk('回归-乙');
  const assets = await fetch('/api/assets').then(r => r.json()).then(d => d.assets);
  return { aId: a.folder.id, bId: b.folder.id, assetName: assets[0].name, assetId: assets[0].id };
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(3500);
await openDrawerAssets();

// ===== ① 上传弹窗：「+」触发文件选择器 =====
await page.locator('.left-drawer [aria-label="新建或上传"]').first().click();
await sleep(600);
await page.locator('.ax-menu-item', { hasText: '上传资产' }).first().click();
await sleep(900);
const dlg = page.locator('[role=dialog][aria-label="上传资产"]');
check('上传弹窗打开', (await dlg.count()) > 0);
check('弹窗里有隐藏的 file input', await dlg.locator('input[type=file]').count() > 0);
const chooserPromise = page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null);
await dlg.getByLabel('选择文件').click();
const chooser = await chooserPromise;
check('点「+」触发文件选择器', !!chooser);
if (chooser) await chooser.setFiles([]).catch(() => {});
await sleep(400);

// ===== ② 下拉与箭头左对齐 =====
await dlg.getByLabel('选择标签').click();
await sleep(800);
const align = await page.evaluate(() => {
  const d = document.querySelector('[role=dialog][aria-label="上传资产"]');
  const tr = d.querySelector('[aria-label="选择标签"]').getBoundingClientRect();
  const menus = [...document.querySelectorAll('.dd-menu')];
  const menu = menus[menus.length - 1];
  const arrow = document.querySelector('.axd-arrow');
  if (!menu) return { err: 'no menu' };
  const mr = menu.getBoundingClientRect();
  const ar = arrow && arrow.getBoundingClientRect();
  return {
    panelDelta: Math.round(mr.x - tr.x),
    arrowFromMenuLeft: ar ? Math.round((ar.x + ar.width / 2) - mr.x) : null,
    menuWidth: Math.round(mr.width),
  };
});
check('下拉面板左对齐（不是居中）', Math.abs(align.panelDelta) < 4, JSON.stringify(align));
check('箭头跟着左对齐（贴菜单左缘）', align.arrowFromMenuLeft !== null && align.arrowFromMenuLeft < 24, 'arrowFromMenuLeft=' + align.arrowFromMenuLeft);
await page.keyboard.press('Escape');
await sleep(300);
// 关弹窗：直接点右上角 ×（DOM click，避开遮罩拦截 playwright 的可见性判定）
await page.evaluate(() => {
  const d = document.querySelector('[role=dialog][aria-label="上传资产"]');
  const close = d && d.querySelector('[aria-label="关闭"]');
  if (close) close.click();
});
await sleep(800);
// 兜底：还开着就点遮罩
await page.evaluate(() => {
  const d = document.querySelector('[role=dialog][aria-label="上传资产"]');
  if (!d) return;
  const veil = d.parentElement && d.parentElement.querySelector('.bg-veil');
  if (veil) veil.click();
});
await page.waitForFunction(() => !document.querySelector('[role=dialog][aria-label="上传资产"]'), { timeout: 5000 }).catch(() => {});
await sleep(500);
// 万一还残留（遮罩会挡住后面所有 playwright 点击），强制移除
await page.evaluate(() => {
  document.querySelectorAll('[role=dialog][aria-label="上传资产"]').forEach((d) => {
    const root = d.parentElement;
    if (root && root.querySelector('.bg-veil')) root.remove();
  });
});
await sleep(400);
await openDrawerAssets();

// ===== ③ 移动到：当前位置打勾 + 真挪 =====
const mvOpen = await page.evaluate(async (name) => {
  const s = (ms) => new Promise(r => setTimeout(r, ms));
  const btn = [...document.querySelectorAll('.left-drawer [aria-label^="更多操作"]')]
    .find(b => (b.getAttribute('aria-label') || '').includes(name));
  if (!btn) return { err: 'no row' };
  btn.click();
  await s(800);
  const menus = [...document.querySelectorAll('[role=menu]')];
  const move = [...menus[menus.length - 1].querySelectorAll('.ax-menu-item')].find(i => i.textContent.includes('移动到'));
  if (!move) return { err: 'no move item' };
  move.click();
  await s(800);
  const sub = document.querySelector('.ax-sub-menu');
  return { items: sub ? [...sub.querySelectorAll('.ax-menu-item')].map(el => ({ text: el.textContent.trim(), active: el.classList.contains('is-active') })) : [] };
}, mkResult.assetName);
check('「移动到」列出目标文件夹', (mvOpen.items || []).some(i => i.text === '回归-乙'), JSON.stringify((mvOpen.items || []).map(i => i.text)));
const movedRes = await page.evaluate(async (assetId) => {
  const s = (ms) => new Promise(r => setTimeout(r, ms));
  const sub = document.querySelector('.ax-sub-menu');
  const t = sub ? [...sub.querySelectorAll('.ax-menu-item')].find(i => i.textContent.includes('回归-乙')) : null;
  if (!t) return { err: 'no target' };
  t.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  await s(2000);
  const assets = await fetch('/api/assets').then(r => r.json()).then(d => d.assets);
  // 按 id 取那条资产（列表顺序会变，按下标取会误判）
  const target = assets.find(a => a.id === assetId);
  return { folderId: target && target.folderId, found: !!target };
}, mkResult.assetId);
check('「移动到」真改了归属', movedRes.folderId === mkResult.bId, 'got=' + String(movedRes.folderId).slice(0, 8) + ' want=' + String(mkResult.bId).slice(0, 8));

// 再打开一次，确认当前位置已打勾（此时资产就在「回归-乙」）
const mvAgain = await page.evaluate(async (name) => {
  const s = (ms) => new Promise(r => setTimeout(r, ms));
  await s(500);
  const btn = [...document.querySelectorAll('.left-drawer [aria-label^="更多操作"]')]
    .find(b => (b.getAttribute('aria-label') || '').includes(name));
  if (!btn) return { err: 'no row' };
  btn.click();
  await s(800);
  const menus = [...document.querySelectorAll('[role=menu]')];
  const move = [...menus[menus.length - 1].querySelectorAll('.ax-menu-item')].find(i => i.textContent.includes('移动到'));
  move.click();
  await s(800);
  const sub = document.querySelector('.ax-sub-menu');
  const items = sub ? [...sub.querySelectorAll('.ax-menu-item')].map(el => ({ text: el.textContent.trim(), active: el.classList.contains('is-active') })) : [];
  const yi = items.find(i => i.text === '回归-乙');
  document.body.click();
  return { yiActive: !!yi && yi.active, items };
}, mkResult.assetName);
check('「移动到」标出当前位置（打勾）', mvAgain.yiActive === true, JSON.stringify(mvAgain.items || mvAgain));

// ===== ④ 添加到画布 → 自动聚焦（等价按 F）=====
await page.evaluate(() => document.body.click());
await sleep(600);
const focusRes = await page.evaluate(async (name) => {
  const s = (ms) => new Promise(r => setTimeout(r, ms));
  const h = window.MiniCanvasUI.getHost();
  const vp = () => h.view.getViewport();
  const before = { zoom: vp().zoom, x: Math.round(vp().x), y: Math.round(vp().y), nodes: h.nodeStore.getNodes().length };
  const btn = [...document.querySelectorAll('.left-drawer [aria-label^="更多操作"]')]
    .find(b => (b.getAttribute('aria-label') || '').includes(name));
  if (!btn) return { err: 'no row' };
  btn.click();
  await s(800);
  const menus = [...document.querySelectorAll('[role=menu]')];
  const add = [...menus[menus.length - 1].querySelectorAll('.ax-menu-item')].find(i => i.textContent.includes('添加到画布'));
  if (!add) return { err: 'no add item' };
  add.click();
  await s(1800);
  const after = { zoom: vp().zoom, x: Math.round(vp().x), y: Math.round(vp().y), nodes: h.nodeStore.getNodes().length };
  const sel = [...h.ctx.get('selection').ids];
  if (sel.length) h.ctx.get('doc').transaction('cleanup', (tx) => tx.removeNodes(sel));
  return { before, after, selectedCount: sel.length, viewportMoved: before.x !== after.x || before.y !== after.y || before.zoom !== after.zoom };
}, mkResult.assetName);
check('添加到画布：建出新节点', !!(focusRes.after && focusRes.after.nodes > focusRes.before.nodes), JSON.stringify(focusRes));
check('添加到画布：新节点被选中', focusRes.selectedCount === 1, 'selected=' + focusRes.selectedCount);
check('添加到画布：视口自动聚焦（等价按 F）', focusRes.viewportMoved === true, JSON.stringify(focusRes.after));

// ===== 收尾：清测试数据 =====
await page.evaluate(async () => {
  const assets = await fetch('/api/assets').then(r => r.json()).then(d => d.assets);
  for (const a of assets) if (a.folderId) await fetch('/api/assets/batch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: [a.id], folderId: null }) });
});
await cleanup();

await browser.close();
const failed = results.filter((r) => !r.ok);
if (errors.length) console.log('页面错误:', errors.slice(0, 2).join(' | '));
console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
process.exit(failed.length ? 1 : 0);
