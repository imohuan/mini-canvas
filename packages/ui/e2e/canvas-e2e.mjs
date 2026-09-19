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
