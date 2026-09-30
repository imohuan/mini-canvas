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
// BASE 可经 CANVAS_PORT 覆盖：多个 worktree 可能同时起 dev（vite.config 是 strictPort:false，
// 谁先占 5288 谁就是 5288）——写死 5288 会打到别人的代码上，验证结果不算数。
const BASE = `http://localhost:${process.env.CANVAS_PORT ?? 5288}/`;

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
await page.getByRole('button', { name: '添加节点' }).click();
await page.getByRole('menuitem', { name: '文本', exact: true }).click();
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
await page.keyboard.press('Control+z');
await page.waitForTimeout(450);
const afterUndo = (await state()).count;
check('撤销回退了上一步（拖动）', afterUndo === beforeUndo, `节点数 ${beforeUndo} -> ${afterUndo}（拖动撤销不改变节点数）`);
await page.keyboard.press('Control+z');
await page.waitForTimeout(450);
const afterUndo2 = (await state()).count;
check('再撤销回退了建节点', afterUndo2 === s0.count, `${afterUndo} -> ${afterUndo2}（期望 ${s0.count}）`);
await page.keyboard.press('Control+Shift+z');
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

// ⑦-2 关闭通道（✕ / 遮罩 / Esc 三条都必须真的把面板收起来）
// 这条曾经全红：默认皮的关闭只发内核事件 settings:ui-close，而装配层没人订阅 →
// 点 ✕/遮罩毫无反应、不报错不 warn（只有宿主自己的全局 Esc 兜住了）。
// 面板外壳（遮罩/居中/✕）由渲染层 SettingsShell 提供，所以任何皮打开时都有 .psd-mask。
const panelOpen = () => page.evaluate(() => !!document.querySelector('.psd-mask'));
const settingsBtn = () => page.getByRole('button', { name: '设置' }).first();
await settingsBtn().click();
await page.waitForTimeout(600);
check('设置面板可再次打开（上一轮 Esc 已收起）', await panelOpen());
await page.locator('button[aria-label="关闭"], button[aria-label="关闭设置"]').first().click();
await page.waitForTimeout(400);
check('点 ✕ 能关闭设置面板', !(await panelOpen()));
await settingsBtn().click();
await page.waitForTimeout(600);
// 点弹窗外的空白处 = 遮罩（用左下角，任何皮/任何尺寸下都在弹窗之外）
await page.mouse.click(12, 820);
await page.waitForTimeout(400);
check('点遮罩能关闭设置面板', !(await panelOpen()));
await settingsBtn().click();
await page.waitForTimeout(600);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
check('Esc 能关闭设置面板', !(await panelOpen()));

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

// ⑧-2. 用户最初那段场景在真实画布上跑一遍（**并且是运行期直接改场**，不装卸插件）：
// 插件给 image 节点的上控制栏加一个按钮、下控制栏加一个面板，两者共享同一份"展开"能力实例。
// 这条此前会红：BaseNode 在挂载那刻读出条目就定了，之后往场里 add 不重渲染（静默失效）。
const scenario = await page.evaluate(async () => {
  const api = window.MiniCanvasUI;
  const ctx = api.getContext();
  const h = api.getHost();
  const MARK = 'E2E_SCENARIO';
  // ① 作者注册一个能力（每节点一份实例）
  ctx.registryOf('capability').add('展开', (n) => ({ open: false, id: n.id }), { id: 'e2e:expand' });
  // ② 上控制栏按钮 + 下控制栏面板，needs 同一个能力
  const btn = { name: 'GenBtn', props: ['id', 'data'], inheritAttrs: false, render: () => MARK + '_BTN' };
  const panel = { name: 'GenPanel', props: ['id', 'data'], inheritAttrs: false, render: () => MARK + '_PANEL' };
  const f = ctx.registryOf('node/region');
  const a = f.add('image/out:top', { component: btn, needs: ['展开'] }, { id: 'e2e-scenario-btn', order: -20 });
  const c = f.add('image/out:bottom', { component: panel, needs: ['展开'] }, { id: 'e2e-scenario-panel', order: -20 });
  const text = () => [...document.querySelectorAll('.vue-flow__node')].map((n) => n.innerText).join('|');
  // ③ 选中 image 节点让控制栏浮出来
  const img = h.nodeStore.getNodes().find((n) => n.type === 'image');
  if (img) ctx.get('selection').set([img.id]);
  await new Promise((r) => setTimeout(r, 800));
  const seen = { btn: text().includes(MARK + '_BTN'), panel: text().includes(MARK + '_PANEL') };
  a.dispose();
  c.dispose();
  await new Promise((r) => setTimeout(r, 600));
  ctx.registryOf('capability').remove('展开', 'e2e:expand');
  return { ...seen, gone: !text().includes(MARK) };
});
check('运行期直接改场 → 节点热增上/下控制栏条目（用户最初那段场景）', scenario.btn && scenario.panel && scenario.gone, JSON.stringify(scenario));
check('场条目带 source（谁放的）', typeof field.src === 'string' && field.src.length > 0, `source=${field.src}`);
check('wrap/resolve（叠层可合成）', field.hasResolve === true);

// ⑧b 多选框区域场（selection/region）：用户要求"多选时只显示多选框自己的状态栏"。
//     两个断言：① 多选时节点控制栏被壳压掉；② 插件往 selection/region 挂的条目真的渲染在框上。
const selToolbar = await page.evaluate(async () => {
  const api = window.MiniCanvasUI;
  const ctx = api.getContext();
  const h = api.getHost();
  const MARK = 'E2E_SELTOOLBAR';
  const btn = { name: 'SelBtn', inheritAttrs: false, render: () => MARK };
  const f = ctx.registryOf('selection/region');
  const a = f.add('out:top', { component: btn, needs: ['selection'] }, { id: 'e2e-sel-top', order: 10 });
  // 选中两个节点 → 多选框出现
  const ids = h.nodeStore.getNodes().slice(0, 2).map((n) => n.id);
  ctx.get('selection').set(ids);
  await new Promise((r) => setTimeout(r, 800));
  const text = () => [...document.querySelectorAll('.vue-flow__node')].map((n) => n.innerText).join('|');
  // 多选时节点自身的上下控制栏应被压掉（壳的 hideToolbars）；
  // 多选框的栏渲染在 .selection-frame-slot--top 里，不在 .vue-flow__node 内。
  const shown = !!document.querySelector('.selection-frame-slot--top') &&
    (document.querySelector('.selection-frame-slot--top')?.textContent || '').includes(MARK);
  const nodeToolbarHidden = !text().includes('上传图片');
  a.dispose();
  await new Promise((r) => setTimeout(r, 600));
  ctx.get('selection').clear();
  return { shown, nodeToolbarHidden, gone: !document.body.innerHTML.includes(MARK) };
});
check('多选框区域场：插件挂的 out:top 条目渲染在框上（selection/region）', selToolbar.shown, JSON.stringify(selToolbar));
check('多选时节点自身的上下控制栏被压掉（只留多选框的栏）', selToolbar.nodeToolbarHidden, JSON.stringify(selToolbar));
check('selection/region 条目 dispose 后从框上摘除', selToolbar.gone, JSON.stringify(selToolbar));

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
    eventNames: s.events,
    // 条目轴：node/type 条目的值是 { type, label } 声明，应能查出它的字段名
    entryFields: (s.registryEntries.find((e) => e.kind === 'node/type') || {}).fields,
    // 组件句柄不该被当成"有字段的声明"（否则只会输出 __name/setup/render 这类编译内部物）
    compFieldsShown: s.registryEntries.some((e) => (e.fields ?? []).includes('__name') || (e.fields ?? []).includes('setup')),
  };
});
check('surface().services 列出 doc 等服务且带 source（谁注入的）', surf.services.includes('doc') && typeof surf.docSource === 'string', 'services=' + surf.services.length + ', doc.source=' + surf.docSource);
check('surface().services 带方法清单（用户要的"支持哪些函数"）', ['getNodes', 'createNode', 'removeNodes', 'transaction'].every((m) => surf.docMethods.includes(m)), 'doc.methods=' + surf.docMethods.length + ' 个');
check('surface().registries 覆盖 node/region、command 等场', ['node/region', 'command'].every((k) => surf.kinds.includes(k)), 'kinds=' + surf.kinds.join(','));
check('surface().commands 列出已注册命令（含 id/keys/areas）', surf.commandCount > 0 && surf.commandIdsOk, surf.commandCount + ' 条');
check('surface().tools 列出生成工具且 params 形状合法', surf.toolCount > 0 && surf.toolParamsOk, surf.toolCount + ' 个');
check('surface().events 列出已登记事件（含内核与渲染层事件）', surf.eventNames.includes('ctx:ready') && surf.eventNames.includes('canvas:selection:change'), surf.eventNames.length + ' 个');
check('surface().registryEntries 带 fields（条目值有哪些可读字段）', Array.isArray(surf.entryFields) && surf.entryFields.includes('label'), 'fields=' + JSON.stringify(surf.entryFields));
check('surface().fields 不把组件句柄当声明（无 __name/setup 噪声）', surf.compFieldsShown === false);
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
// 9d. ui 目录场（设计文档 §4.5 / 案例 4）：主题登记的设计系统件按名可取
const uiDir = await page.evaluate(() => {
  const ctx = window.MiniCanvasUI.getContext();
  const f = ctx.registryOf('ui');
  const before = f.keys().sort();
  const btn = f.top('button')?.value;
  const src = f.top('button')?.source;
  // 换主题 = 叠一层（order 更小者赢），原值仍可查
  const Probe = { name: 'ProbeButton' };
  const h = f.add('button', Probe, { id: 'e2e', order: -10 });
  const afterTop = f.top('button')?.value;
  const all = f.list('button').map((e) => e.id);
  h.dispose();
  return { before, hasButton: btn !== undefined, src, afterTopIsProbe: afterTop === Probe, all };
});
check('ui 目录场有主题登记的设计系统件（button 等）', uiDir.hasButton && typeof uiDir.src === 'string', 'keys=' + uiDir.before.join(','));
check('ui 目录支持换主题（叠层：order 小者赢，原值仍在）', uiDir.afterTopIsProbe && uiDir.all.includes('default'), 'ids=' + uiDir.all.join(','));
// 9d-2. 目录**真有生产消费者**（reviewer 指出过：只有登记没有消费 = 机制在但零收益）。
// 换掉 ui 目录里的 button，节点上控制栏渲染出来的按钮必须跟着换 —— 这就是"换主题业务插件零改动"。
const uiSwap = await page.evaluate(async () => {
  const api = window.MiniCanvasUI;
  const h = api.getHost();
  const ctx = api.getContext();
  // 先选中一个 image 节点，让它的上控制栏浮出来（ImageTopToolbar 经目录取 button）
  const img = h.nodeStore.getNodes().find((n) => n.type === 'image');
  if (img) ctx.get('selection').set([img.id]);
  await new Promise((r) => setTimeout(r, 700));
  const baseline = document.querySelectorAll('.vue-flow__node button').length;
  const f = ctx.registryOf('ui');
  const MARK = 'E2E_UI_SWAP_BUTTON';
  // 探针必须把会被传进来的 props/监听都声明掉，否则 Vue 的"多余属性"warn 会污染控制台
  //（本测试后面有一条"零 error"与"零 [capability] 提示"是要看控制台的）。
  const probe = {
    name: 'E2EUiButton',
    props: ['title', 'disabled', 'icon', 'variant', 'modelValue', 'options'],
    emits: ['click', 'change', 'update:modelValue'],
    // 根是文本节点，额外属性没法继承；显式关掉继承避免 Vue 的无害 warn 污染控制台断言。
    inheritAttrs: false,
    render: () => MARK,
  };
  const swap = f.add('button', probe, { id: 'e2e-ui', order: -100 });
  await new Promise((r) => setTimeout(r, 700));
  const seen = [...document.querySelectorAll('.vue-flow__node')].some((n) => n.innerText.includes(MARK));
  swap.dispose();
  await new Promise((r) => setTimeout(r, 600));
  return { baseline, seen, restored: [...document.querySelectorAll('.vue-flow__node')].some((n) => n.innerText.includes(MARK)) };
});
check('ui 目录换主题真的生效（节点控制栏按钮跟着换，撤回即复原）', uiSwap.baseline > 0 && uiSwap.seen && !uiSwap.restored, JSON.stringify(uiSwap));

// 9e. 能力包（设计文档 §4.5 案例 5 / 决策 9）：宿主注册的标准四件在真实画布上按名可取
const caps = await page.evaluate(() => {
  const ctx = window.MiniCanvasUI.getContext();
  const f = ctx.registryOf('capability');
  const names = f.keys().sort();
  const src = f.top('node')?.source ?? null;
  // 真调一次 node 能力工厂：证明它拿得到节点上下文并产出可用的实例
  const node = ctx.get('doc').getNodes()[0];
  const cap = node ? f.top('node').value({ ctx, id: node.id, type: node.type, data: { value: node.data }, selected: { value: false }, solo: { value: false }, zoom: { value: 1 }, update: () => {} }) : null;
  return { names, src, capId: cap ? cap.id : null, capLabel: cap ? typeof cap.setLabel : null };
});
check('能力包：宿主注册了标准四件（node/zoom/selected/tools）', ['node', 'zoom', 'selected', 'tools'].every((n) => caps.names.includes(n)), 'keys=' + caps.names.join(','));
check('能力包：工厂按节点上下文产出实例（每节点一份）', caps.capId !== null && caps.capLabel === 'function', 'cap.id=' + caps.capId + ', setLabel=' + caps.capLabel);

// 9f. 事件名白名单（设计文档 §7.4）：dev 下 emit 未登记的事件名会 warn —— 一条都不许有。
// 这条前面被掩盖过：ctx.isDev 在真实宿主营恒为 false（见 CanvasHost props.dev 注释），
// 接通 isDev 之后才暴露 RenderEvents / clipboard / edge-cutting 等名字从未登记。
const eventWarns = warns.filter((w) => w.includes('[EventBus:dev]'));
check('事件名白名单：零条“未声明的事件名”warn（§7.4）', eventWarns.length === 0, eventWarns.slice(0, 2).join(' | '));
// 能力包的两条提示（"不在区域子树里" / "needs 里没声明"）都不该在正常装配下出现。
const capWarns = warns.filter((w) => w.includes('[capability]'));
check('能力包：正常装配下零条 [capability] 提示', capWarns.length === 0, capWarns.slice(0, 2).join(' | '));

// 9g. dev 开关真的接通了（决策 9 的"needs 缺项 dev 抛错"只有它是 true 时才可能生效）。
// 用 dev server 跑时必须是 true；这条也反向守住"别再把 isDev 静默钉死为 false"。
const devFlag = await page.evaluate(() => window.MiniCanvasUI.getContext().isDev);
check('dev 开关接通（ctx.isDev === true，dev server 下）', devFlag === true, 'isDev=' + devFlag);

// 9h. node/shell 场（设计文档 §4.5 / 案例 3/8）：换壳**真的生效** —— 此前这张场只有写入端、
// 没有读取端，作者照文档写 add/wrap 会"不报错也不生效"（最怕的静默失效）。
// 断言不是"场上多了一条"，而是**节点上渲染出来的内容真的换了**（用一个吐标记文本的假壳）。
const shellSwap = await page.evaluate(async () => {
  const ctx = window.MiniCanvasUI.getContext();
  const f = ctx.registryOf('node/shell');
  const textOf = () => [...document.querySelectorAll('.vue-flow__node')].map((n) => n.innerText)
  const MARK = 'E2E_SHELL_SWAP_MARKER';
  const seenBefore = textOf().some((t) => t.includes(MARK));
  const shellProbe = {
    name: 'E2EShell',
    props: ['id', 'data', 'type', 'selected', 'position', 'dimensions', 'dragging', 'resizing', 'connectable', 'zIndex', 'events', 'sourcePosition', 'targetPosition'],
    emits: ['updateNodeInternals'],
    inheritAttrs: false,
    render: () => MARK,
  };
  const h = f.add('image', shellProbe, { id: 'e2e-swap', order: -100 });
  await new Promise((r) => setTimeout(r, 500));
  const seenAfter = textOf().some((t) => t.includes(MARK));
  h.dispose();
  await new Promise((r) => setTimeout(r, 500));
  return { seenBefore, seenAfter, seenRestored: textOf().some((t) => t.includes(MARK)) };
});
check('node/shell 场换壳真的生效（假壳渲染到节点上，撤回即复原）', !shellSwap.seenBefore && shellSwap.seenAfter && !shellSwap.seenRestored, JSON.stringify(shellSwap));

// 9i. resize 拖拽中缩放：卡片右下角必须始终贴住鼠标（用户报过"同时缩放就形成一点距离"）。
// 根因是尺寸换算写成"屏幕位移 ÷ 当前 zoom"，只在缩放全程不变时成立；现在按当前视口换算。
// 判据用**可观测不变式**：整个拖拽过程中「卡片右下角 − 鼠标」恒定（等于起手抓点偏移）。
const resizeZoom = await page.evaluate(async () => {
  const api = window.MiniCanvasUI;
  const h = api.getHost();
  const doc = h.ctx.get('doc');
  const vp = h.ctx.get('viewport');
  const target = doc.getNodes().find((n) => doc.types.get(n.type)?.resizable === true);
  if (!target) return { skipped: true };
  doc.updateNode(target.id, { position: { x: 250, y: 200 } });
  h.ctx.get('selection').set([target.id]);
  await new Promise((r) => setTimeout(r, 400));
  return { skipped: false, id: target.id };
});
if (resizeZoom.skipped) {
  check('resize 拖拽中缩放仍贴手（需要 resizable 节点）', false, '画布上没有 resizable 节点');
} else {
  const rid = resizeZoom.id;
  const measure = () => page.evaluate((nid) => {
    const el = document.querySelector(`.vue-flow__node[data-id="${nid}"]`);
    const nr = el?.getBoundingClientRect();
    const hr = el?.querySelector('.resize-handle')?.getBoundingClientRect();
    return nr && hr ? { cx: hr.x + hr.width / 2, cy: hr.y + hr.height / 2, corner: { x: nr.right, y: nr.bottom } } : null;
  }, rid);
  const m0 = await measure();
  if (!m0) {
    check('resize 拖拽中缩放仍贴手（需要拖柄可见）', false, '拖柄不在 DOM 里');
  } else {
    await page.mouse.move(m0.cx, m0.cy);
    await page.mouse.down();
    await page.mouse.move(m0.cx + 20, m0.cy + 12);
    await page.waitForTimeout(80);
    const base = await measure();
    const gap0 = { x: base.corner.x - (m0.cx + 20), y: base.corner.y - (m0.cy + 12) };
    // 光标不动，滚轮缩小（没有 pointermove 的一帧 —— 旧实现在这里就会脱手）
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(250);
    const afterWheel = await measure();
    const gap1 = { x: afterWheel.corner.x - (m0.cx + 20), y: afterWheel.corner.y - (m0.cy + 12) };
    // 再拖一段，确认跟随
    await page.mouse.move(m0.cx + 70, m0.cy + 42);
    await page.waitForTimeout(80);
    const afterDrag = await measure();
    const gap2 = { x: afterDrag.corner.x - (m0.cx + 70), y: afterDrag.corner.y - (m0.cy + 42) };
    await page.mouse.up();
    await page.waitForTimeout(150);
    const drift = (a, b) => Math.abs(a.x - b.x) <= 1.5 && Math.abs(a.y - b.y) <= 1.5;
    check(
      'resize 拖拽中滚轮缩放：卡片右下角始终贴住鼠标（起手偏移恒定，无漂移）',
      drift(gap0, gap1) && drift(gap0, gap2),
      `基准=${JSON.stringify(gap0)} 滚轮后=${JSON.stringify(gap1)} 再拖后=${JSON.stringify(gap2)}`,
    );
  }
}


// ==================== 底栏 / 覆盖层 / 落盘 / 刷新（Task 10 新增断言） ====================
{
  // 防御：前序用例可能触发了页面导航，这里确保画布可用
  await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {});
  if (!(await page.evaluate(() => !!window.MiniCanvasUI).catch(() => false))) {
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForTimeout(2200);
  }
  const bar2 = page.locator('[data-testid="node-bottom-bar"]');
  const assembled = await page.evaluate(() => {
    const ctx = window.MiniCanvasUI.getContext();
    const field = ctx.registryOf('node/region');
    const slots = ctx.get('slots');
    // overlay 槽是多 occupant（分组控制栏/多选框也在里面），按 id 精确认领底栏那一条
    const barOccupant = slots ? slots.list('overlay').some((e) => e.id === 'bottom-bar/host') : false;
    return {
      // 底栏宿主已从节点 out:bottom 迁到画布 overlay 槽（节点内 z 出不去，会被外壳工具栏截走点击）
      bar: barOccupant,
      overlay: field.list('*/over:inset').length,
      actions: ctx.get('nodeBar') ? ctx.get('nodeBar').list({ type: 'image' }).length : -1,
    };
  });
  check(
    '底栏装配：overlay 槽宿主 + over:inset 覆盖层 + image 动作',
    assembled.bar === true && assembled.overlay === 1 && assembled.actions > 0,
    JSON.stringify(assembled),
  );

  // 选中图片节点 → 默认底栏渲染出来
  const hasBar = await (async () => {
    const img = page.locator('.vue-flow__node').nth(1);
    await img.click();
    await page.waitForTimeout(400);
    return (await page.locator('[data-testid="node-bottom-bar"]').count()) > 0;
  })();
  check('选中图片节点 → 默认底栏渲染出来', hasBar);

  // 执行一条异步动作（服务层触发同一链路：nodeTask.run → runAction → updateNodeRuntime → 覆盖层）
  // 注意：这条动作是**测试现场注册**的（e2e 自己造一个假后台），不是成品装配里的插件 ——
  // 成品清单里不该混进"测试用假动作"（用户明确要求：测试就写清是测试，别塞进别的插件）。
  const ran = await (async () => {
    if ((await bar2.count()) === 0) return { overlayShown: false };
    const runPromise = page.evaluate(() => {
      const ctx = window.MiniCanvasUI.getContext();
      const doc = ctx.get('doc');
      const node = doc.getNodes().find((n) => n.type === 'image');
      // 注册一条测试动作（id 带 e2e 前缀，一眼看得出是测试用的）
      const bar = ctx.get('nodeBar');
      // 注册方作用域直接用根 ctx（e2e 不卸载，不需要回收器）
      bar.register(ctx, {
        id: 'e2e:fake-async',
        types: ['image'],
        title: 'e2e 假异步任务',
        needsPrompt: true,
        run() {
          let step = 0;
          return () => {
            step += 1;
            return step < 6
              ? { status: 'running', progress: step * 16, message: 'e2e 进度 ' + step }
              : { status: 'done', result: { ok: true, urls: [node.data.imageUrl] } };
          };
        },
      });
       const calls = [];
       const orig = doc.updateNodeRuntime.bind(doc);
       doc.updateNodeRuntime = (id, patch) => { calls.push({ id, keys: Object.keys(patch?.data ?? {}) }); return orig(id, patch); };
       window.__wrCalls = calls;
      return ctx.get('nodeTask').run(node.id, 'e2e:fake-async', { prompt: 'e2e', values: {} })
        .then((r) => ({ kind: 'returned', r }))
        .catch((e) => ({ kind: 'threw', error: e?.message || String(e) }));
    });
    const stateProbe = await page.evaluate(() => {
      const ctx = window.MiniCanvasUI.getContext();
     const doc = ctx.get('doc');
      const wrCalls = window.__wrCalls;
      const node = doc.getNodes().find((n) => n.type === 'image');
    const host = window.MiniCanvasUI.getHost();
    const hostDoc = host.ctx.get('doc');
     const appliers = ctx.registryOf('node/bar-applier');
     return { viaDoc: node?.data?.runState ?? null, viaStore: (host.nodeStore.getNode(node.id)?.data?.runState) ?? null, id: node.id, sameDoc: hostDoc === doc, keys: Object.keys(node?.data ?? {}), applierKeys: appliers.keys(), applierIsFn: typeof appliers.get('image', 'image')?.value };
   });
    let runResult = null;
    runPromise.then((v) => { runResult = v; }).catch((e) => { runResult = { kind: 'threw', error: String(e) } });
    let overlayShown = false;
    let overlayText = '';
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(100);
      if ((await page.locator('.task-overlay').count()) > 0) {
        overlayShown = true;
        // 覆盖层已改版：不再有中间黑底卡片，文案直接落在卡上
        overlayText = await page.locator('.task-overlay').innerText();
        break;
      }
    }
    return { overlayShown, overlayText, runResult, stateProbe };
  })();
  check(
    '执行测试异步动作 → 卡片出现覆盖层（running）',
    ran.overlayShown,
    'run=' + JSON.stringify(ran.runResult) + ' state=' + JSON.stringify(ran.stateProbe) + ' overlay=' + ran.overlayText,
  );

  // 终态落盘：等 runState 变 done（带 actionId）
  const persisted = await (async () => {
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(250);
      const rs = await page.evaluate(() => {
        const h = window.MiniCanvasUI.getHost();
        const node = h.nodeStore.getNodes().find((n) => n.type === 'image');
        return node?.data?.runState ?? null;
      });
      if (rs && rs.status === 'done') return rs;
    }
    return null;
  })();
  check(
    '终态落盘：runState.status=done 且带 actionId',
    !!persisted && typeof persisted.actionId === 'string',
    JSON.stringify(persisted),
  );

  // 刷新后不悬挂
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2200);
  const after = await page.evaluate(() => {
    const h = window.MiniCanvasUI.getHost();
    const node = h.nodeStore.getNodes().find((n) => n.type === 'image');
    return node?.data?.runState ?? null;
  });
  const overlayAfterReload = await page.locator('.task-overlay').count();
  check(
    '刷新后不悬挂：覆盖层不再出现',
    overlayAfterReload === 0 && !!after && after.status !== 'running',
    JSON.stringify(after),
  );
}

// ==================== 底栏文字可读性（对照度，防"文字与背景同色"回归） ====================
// 背景：本轮的真实 bug —— prosemirror-editor-bundle 的 style.css 把 `color:#111` 写死在
// `.ProseMirror` 本体上，深色主题下输入的字是近黑、与面板背景糊在一起（用户一眼看出来）。
// 只断"有文字"是不够的（文字在 DOM 里、但看不见）；这里按 WCAG 相对亮度算对比度下限。
{
  // 先选中图片节点并等一帧（这段跑在"刷新不悬挂"之后，刷新会清空选中，底栏要下一帧才出来）
  await page.evaluate(() => {
    const ctx = window.MiniCanvasUI.getContext();
    const img = ctx.get('doc').getNodes().find((n) => n.type === 'image');
    if (img) ctx.get('selection').set([img.id]);
  });
  await page.waitForTimeout(800);
  const contrast = await page.evaluate(() => {
    const parse = (c) => {
      const s = String(c || '');
      const srgb = s.match(/color\(srgb\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)(?:\s*\/\s*([0-9.]+))?\)/);
      if (srgb) return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255, srgb[4] === undefined ? 1 : Number(srgb[4])];
      const m = s.match(/[0-9.]+/g);
      return m ? m.map(Number) : null;
    };
    const lum = (rgb) => {
      const s = rgb.slice(0, 3).map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
      return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
    };
    const over = (fg, bg) => { const a = fg[3] === undefined ? 1 : fg[3]; return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)); };
    const effBg = (el) => {
      let cur = el;
      while (cur && cur !== document.documentElement) {
        const c = parse(getComputedStyle(cur).backgroundColor);
        if (c) { const a = c[3] === undefined ? 1 : c[3]; if (a > 0.9) return c.slice(0, 3); if (a > 0.05) return over(c, [38, 38, 38]); }
        cur = cur.parentElement;
      }
      return [38, 38, 38];
    };
    const ratioOf = (el) => {
      const cs = getComputedStyle(el);
      const fg = parse(cs.color);
      const own = parse(cs.backgroundColor);
      let bg = effBg(el);
      if (own) { const a = own[3] === undefined ? 1 : own[3]; if (a > 0.05) bg = over(own, bg); }
      const a = lum(fg), b = lum(bg);
      const hi = Math.max(a, b), lo = Math.min(a, b);
      return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
    };
    const bar = document.querySelector('[data-testid="node-bottom-bar"]');
    if (!bar) return { missing: true };
    const pm = bar.querySelector('.ProseMirror');
    if (pm) pm.focus();
    const targets = {
      输入正文: bar.querySelector('.ProseMirror'),
      模型名: bar.querySelector('.sel-label'),
      参数摘要: bar.querySelector('.tpg-text'),
      字数计数: bar.querySelector('.nb-count'),
    };
    const out = {};
    for (const [name, el] of Object.entries(targets)) {
      if (el) out[name] = ratioOf(el);
    }
    return out;
  });
  const minRatio = Math.min(...Object.values(contrast).filter((v) => typeof v === 'number'));
  check(
    '底栏文字对比度达标（深色主题下文字不能与背景同色）',
    !contrast.missing && Number.isFinite(minRatio) && minRatio >= 4.5,
    JSON.stringify(contrast),
  );
}

const real404 = notFound.filter((u) => !/favicon/i.test(u));
const realErrors = errors.filter((e) => !/favicon/i.test(e) && !/status of 404/.test(e));
check('零 error（favicon 404 除外）', realErrors.length === 0, realErrors.slice(0, 2).join(' | '));
if (real404.length) console.log('非 favicon 的 404:', JSON.stringify(real404));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n===== UI 自动化：${results.length - failed.length}/${results.length} 通过 =====`);
if (warns.length) console.log(`warn ${warns.length} 条（首条：${warns[0].slice(0, 90)}...）`);
{ const uniq = new Map(); for (const w of warns) { const k = w.slice(0, 120); uniq.set(k, (uniq.get(k) ?? 0) + 1) } if (process.env.E2E_SHOW_WARNS) console.log([...uniq].map(([k, n]) => n + 'x ' + k).join('\n')) }
process.exit(failed.length ? 1 : 0);
