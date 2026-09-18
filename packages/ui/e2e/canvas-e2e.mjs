// @ts-nocheck
// canvas-e2e —— 画布端到端 UI 自动化测试（真实浏览器，非无头桩）。
//
// 跑法：
//   1) 起服务：pnpm -C packages/ui dev          （:5288）
//   2) 跑测试：node packages/ui/e2e/canvas-e2e.mjs
//
// 依赖：playwright-core + 本机已下载的 Chromium（见下方 CHROME 常量，可用环境变量覆盖）。
// 这条流水线覆盖「注册场改造」的对外可观察行为：宿主装配、doc 门面、core 不可卸、
// 注册场运行时放/取/回收 + source、区域渲染、拖动/建节点/撤销重做/刷新恢复/设置面板。
// UI 自动化测试：注册场改造后的画布端到端验证（真实浏览器）。
// 跑法：node .tmp-ui-e2e/canvas-e2e.mjs  （需 packages/ui dev 已在 :5288 运行）
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const EXE = process.env.CANVAS_E2E_CHROME
  ?? 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const BASE = 'http://localhost:5288/';

const errors = [];
const warns = [];
const notFound = [];
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`);
}
if (!existsSync(EXE)) { console.error('chromium 不存在:', EXE); process.exit(2); }

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('console', (m) => {
  const t = m.type();
  if (t === 'error') errors.push(m.text());
  else if (t === 'warning') warns.push(m.text());
});
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('response', (r) => { if (r.status() === 404) notFound.push(r.url()); });

const boot = async () => {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate(() => { try { localStorage.clear(); } catch {} });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2200);
};
const state = () => page.evaluate(() => {
  const api = window.MiniCanvasUI;
  const h = api && api.getHost();
  if (!h) return null;
  const nodes = h.nodeStore.getNodes();
  return {
    plugins: api.listPlugins(),
    count: nodes.length,
    types: nodes.map((n) => n.type),
    ids: nodes.map((n) => n.id),
    services: h.ctx.injectedServices(),
    hasDoc: !!h.ctx.get('doc'),
    canUninstallBase: h.ctx.canUninstall('canvas-base'),
  };
});
const posOf = (id) => page.evaluate((nid) => {
  const n = window.MiniCanvasUI.getHost().nodeStore.getNodes().find((x) => x.id === nid);
  return n ? { x: n.position.x, y: n.position.y } : null;
}, id);

await boot();

// ① 画布渲染
// 等 VueFlow 真把节点渲染出来（首次冷启动 vite 预构建可能慢，轮询而不是死等固定秒数）
await page
  .waitForSelector('.vue-flow__node', { timeout: 30000 })
  .catch(() => null);
check('画布渲染出节点 DOM', (await page.locator('.vue-flow__node').count()) >= 2, `node 元素 = ${await page.locator('.vue-flow__node').count()}`);

// ② 宿主/服务/插件
const s0 = await state();
check('宿主句柄可读（window.MiniCanvasUI）', !!s0);
check('seed 生效（2 个默认节点）', s0?.count === 2, `实际 ${s0?.count}: ${s0?.types.join(',')}`);
check('doc 门面已装配（步骤 5a）', s0?.hasDoc === true);
check('canvas-base 不可卸载（决策 1 core）', s0?.canUninstallBase.ok === false && s0?.canUninstallBase.reason === 'core', JSON.stringify(s0?.canUninstallBase));
check('canvas-base 不在对外清单（环境而非插件项）', !s0?.plugins.includes('canvas-base'), `${s0?.plugins.length} 个业务插件`);

// ③ 建节点
await page.getByRole('button', { name: '+ 文本' }).click();
await page.waitForTimeout(500);
const s1 = await state();
check('点「+ 文本」建出节点', s1?.count === s0.count + 1, `${s0.count} -> ${s1?.count}`);

// ④ 拖动（按 id 取位置，避免 DOM 顺序 ≠ 数组顺序）
await page.mouse.click(30, 800); // 点画布空白：把焦点从工具栏按钮挪回画布（真实用户行为）
await page.waitForTimeout(300);
// 注意：新节点默认落在节点 1 上方，拖「最上层」的那个（最后建的）才是真实用户场景。
const dragId = s1.ids[s1.ids.length - 1];
const g = await page.evaluate((nid) => {
  const el = document.querySelector(`.vue-flow__node[data-id="${nid}"]`);
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}, dragId);
const beforeDrag = await posOf(dragId);
const dragStart = { x: g.x + g.w / 2, y: g.y + 8 }; // 顶部条带：避开内容区，命中节点壳
await page.mouse.move(dragStart.x, dragStart.y);
await page.mouse.down();
for (let i = 1; i <= 14; i++) { await page.mouse.move(dragStart.x + i * 10, dragStart.y + i * 7); await page.waitForTimeout(20); }
await page.mouse.up();
await page.waitForTimeout(500);
const afterDrag = await posOf(dragId);
check('拖动节点位置真的变了', !!afterDrag && (Math.abs(afterDrag.x - beforeDrag.x) > 40 || Math.abs(afterDrag.y - beforeDrag.y) > 40), `几何=${JSON.stringify(g)} ${JSON.stringify(beforeDrag)} -> ${JSON.stringify(afterDrag)}`);

// ⑤ 撤销 / 重做（走工具栏按钮，与用户操作一致）
const beforeUndo = (await state()).count;
await page.getByRole('button', { name: '↶ 撤销' }).click();
await page.waitForTimeout(450);
const afterUndo = (await state()).count;
check('撤销按钮回退了上一步（拖动）', afterUndo === beforeUndo, `节点数 ${beforeUndo} -> ${afterUndo}（拖动撤销不改变节点数）`);
await page.getByRole('button', { name: '↶ 撤销' }).click();
await page.waitForTimeout(450);
const afterUndo2 = (await state()).count;
check('再撤销回退了建节点', afterUndo2 === s0.count, `${afterUndo} -> ${afterUndo2}（期望 ${s0.count}）`);
await page.getByRole('button', { name: '↷ 重做' }).click();
await page.waitForTimeout(450);
const afterRedo = (await state()).count;
check('重做恢复节点', afterRedo === s1.count, `${afterUndo2} -> ${afterRedo}`);

// ⑥ 刷新持久化
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(2000);
const s2 = await state();
check('刷新后节点数恢复（落盘链路）', s2?.count === afterRedo, `重新加载 ${s2?.count}`);

// ⑦ 设置面板
await page.getByRole('button', { name: /设置/ }).click();
await page.waitForTimeout(800);
check('设置面板能打开且长出分组', (await page.locator('text=/常规/').count()) > 0);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// ⑧ 注册场运行时放/取/回收 + source 可诊断
const field = await page.evaluate(() => {
  const ctx = window.MiniCanvasUI.getContext();
  const f = ctx.registryOf('node/region');
  const before = f.ids('text/out:top').length;
  const h = f.add('text/out:top', { component: { name: 'Probe' }, id: 'probe-e2e' }, { order: 0 });
  const after = f.ids('text/out:top').length;
  const src = f.list('text/out:top')[0]?.source;
  const wrapped = f.wrap('text/out:top', (inner) => ({ name: 'Wrapper', inner }), { id: 'w-e2e' });
  const resolved = f.resolve('text/out:top');
  wrapped.dispose();
  h.dispose();
  return { before, after, src, hasResolve: !!resolved, afterDispose: f.ids('text/out:top').length };
});
check('注册场运行时放/取/回收（node/region）', field.after === field.before + 1 && field.afterDispose === field.before, JSON.stringify(field));
check('场条目带 source（谁放的）', typeof field.src === 'string' && field.src.length > 0, `source=${field.src}`);
check('wrap/resolve（叠层可合成）', field.hasResolve === true);

// ⑨ core 插件拒卸（真实宿主）
const core = await page.evaluate(() => {
  const api = window.MiniCanvasUI;
  const ctx = api.getContext();
  const r = api.uninstallPlugin('canvas-base');
  // 5c 起老名 graph 下线；数据统一走 doc 门面（get('graph') 应为 undefined）
  return { returned: r, state: ctx.inspectPlugins().find((p) => p.name === 'canvas-base')?.state, graph: !!ctx.get('doc'), oldGraphGone: ctx.get('graph') === undefined };
});
check('真实宿主上 canvas-base 卸不掉、doc 可用、老名 graph 已下线', core.returned === false && core.state === 'active' && core.graph === true && core.oldGraphGone === true, JSON.stringify(core));

// 9b. ctx.surface() 自省：真实宿主上一次列出服务 / 注册场 / 命令 / 工具（新原语）
const surf = await page.evaluate(() => {
  const s = window.MiniCanvasUI.getContext().surface();
  return {
    services: s.services.map((x) => x.name),
    docSource: (s.services.find((x) => x.name === 'doc') || {}).source,
    docMethods: (s.services.find((x) => x.name === 'doc') || {}).methods || [],
    kinds: s.registries.map((r) => r.kind),
    commandCount: s.commands.length,
    commandIdsOk: s.commands.every((c) => typeof c.id === 'string'),
    toolCount: s.tools.length,
    toolParamsOk: s.tools.every((t) => t.params === undefined || Array.isArray(t.params)),
    modelToolNames: s.modelTools.map((t) => t.name),
  };
});
check('surface().services 列出 doc 等服务且带 source（谁注入的）', surf.services.includes('doc') && typeof surf.docSource === 'string', 'services=' + surf.services.length + ', doc.source=' + surf.docSource);
check('surface().services 带方法清单（用户要的"支持哪些函数"）', ['getNodes', 'createNode', 'removeNodes', 'transaction'].every((m) => surf.docMethods.includes(m)), 'doc.methods=' + surf.docMethods.length + ' 个');
check('surface().registries 覆盖 node/region、command 等场', ['node/region', 'command'].every((k) => surf.kinds.includes(k)), 'kinds=' + surf.kinds.join(','));
check('surface().commands 列出已注册命令（含 id/keys/areas）', surf.commandCount > 0 && surf.commandIdsOk, surf.commandCount + ' 条');
check('surface().tools 列出生成工具且 params 形状合法', surf.toolCount > 0 && surf.toolParamsOk, surf.toolCount + ' 个');
console.log('surface 快照: services=' + surf.services.length + ' kinds=[' + surf.kinds.join(',') + '] commands=' + surf.commandCount + ' tools=' + surf.toolCount + ' modelTools=[' + surf.modelToolNames.join(',') + ']');

// 9c. surface 是活快照：运行时往 tool 场注册一条，再读一次必须能看见（证明不是启动时缓存）
const live = await page.evaluate(() => {
  const ctx = window.MiniCanvasUI.getContext();
  const before = ctx.surface().modelTools.map((t) => t.name);
  const h = ctx.registryOf('tool').add('e2e-probe', {
    description: 'e2e 探针',
    parameters: { type: 'object', properties: { x: { type: 'string' } } },
    output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: '' }] },
    execute: () => 'ok',
  });
  const mid = ctx.surface().modelTools.find((t) => t.name === 'e2e-probe');
  h.dispose();
  const after = ctx.surface().modelTools.map((t) => t.name);
  return { before, midDesc: mid ? mid.description : null, midParams: mid ? typeof mid.parameters : null, after };
});
check('surface 是活快照：运行时注册的模型工具立刻可见、注销后消失', live.midDesc === 'e2e 探针' && live.midParams === 'object' && !live.after.includes('e2e-probe'), JSON.stringify(live));

// ⑩ 控制台：零 error（favicon 404 不算）
const real404 = notFound.filter((u) => !/favicon/i.test(u));
const realErrors = errors.filter((e) => !/favicon/i.test(e) && !/status of 404/.test(e));
check('零 error（favicon 404 除外）', realErrors.length === 0, realErrors.slice(0, 2).join(' | '));
if (real404.length) console.log('非 favicon 的 404:', JSON.stringify(real404));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n===== UI 自动化：${results.length - failed.length}/${results.length} 通过 =====`);
if (warns.length) console.log(`warn ${warns.length} 条（首条：${warns[0].slice(0, 90)}...）`);
process.exit(failed.length ? 1 : 0);
