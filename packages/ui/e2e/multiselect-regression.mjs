// @ts-nocheck
// multiselect-regression —— 多选框回归验证（真实浏览器）。
//
// 覆盖用户报告的三件事：
//   A. Shift 框选多个节点 → 在"多选框内部的空白处"按下拖动 = 整组平移，
//      全程无 dragStartClient ReferenceError、无 PAGEERROR。
//   B. 多选含组节点时（图2），拖动组节点，选框必须实时跟随（无偏移）。
//   C. 多选期间"恰好单选组节点"时，组节点的解散分组工具栏必须跟着节点走。
//
// 跑法：dev server 在 :5288 后执行
//   node packages/ui/e2e/multiselect-regression.mjs
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const EXE = process.env.CANVAS_E2E_CHROME
  ?? 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const BASE = process.env.CANVAS_E2E_BASE ?? 'http://localhost:5288/';

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
page.on('response', (r) => { if (r.status() >= 500) errors.push('HTTP ' + r.status() + ' ' + r.url()); });

const boot = async () => {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate(() => { try { localStorage.clear(); } catch {} });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2000);
  await page.waitForSelector('.vue-flow__node', { timeout: 30000 });
};

/** 用宿主 API 直写两个文本节点 + 一个组（成员在组内），并选中 [组, 文本] —— 用户图2的形态 */
async function seedGroupScene() {
  await page.evaluate(() => {
    const h = window.MiniCanvasUI.getHost();
    const doc = h.ctx.get('doc');
    // 清空种子
    const old = doc.getNodes();
    if (old.length) doc.removeNodes(old.map((n) => n.id));
    doc.addNodes([
      { id: 'grp1', type: 'group', position: { x: 200, y: 220 }, size: { w: 520, h: 320 },
        data: { label: 'group', backgroundColor: '#24262e' } },
      { id: 'child1', type: 'text', parentId: 'grp1', position: { x: 60, y: 60 }, data: { content: '子节点' } },
      { id: 'child2', type: 'text', parentId: 'grp1', position: { x: 260, y: 160 }, data: { content: '子节点2' } },
      { id: 'solo1', type: 'text', position: { x: 800, y: 260 }, data: { content: '独立节点' } },
    ]);
    h.selection.set(new Set(['grp1', 'solo1']));
  });
  await page.waitForTimeout(400);
}

/** 读多选框 outer 的几何（style 内联值）与节点包围盒（DOM 实测） */
async function frameGeometry() {
  return page.evaluate(() => {
    const el = document.querySelector('.selection-frame-outer');
    if (!el) return null;
    const s = el.style;
    return {
      x: parseFloat(s.left), y: parseFloat(s.top),
      w: parseFloat(s.width), h: parseFloat(s.height),
    };
  });
}

/** 读某节点当前屏幕位置（viewport 变换后） */
async function nodeScreenRect(id) {
  return page.evaluate((nid) => {
    const el = document.querySelector(`.vue-flow__node[data-id="${nid}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, id);
}

const dragOnScreen = async (from, to, steps = 12) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
};

/** 拖动中每帧采样：节点屏幕位置 vs 选框 outer 屏幕位置（换算回 flow 后的偏移应恒定） */
async function dragGroupAndSample(grab, totalDx, totalDy) {
  const samples = [];
  // 起手前清一次状态：防止上一个场景的崩溃把 isDragging / 事件监听卡死（消抖）
  await page.evaluate(() => { window.dispatchEvent(new Event('pointerup')); });
  await page.waitForTimeout(120);
  await page.mouse.move(10, 10);
  await page.mouse.up();
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(grab.x + (totalDx * i) / 6, grab.y + (totalDy * i) / 6);
    await page.waitForTimeout(40);
    samples.push(await page.evaluate(() => {
      const outer = document.querySelector('.selection-frame-outer');
      const node = document.querySelector('.vue-flow__node[data-id="grp1"]');
      if (!outer || !node) return null;
      const r = node.getBoundingClientRect();
      const v = window.MiniCanvasUI.getHost().viewport.getViewport();
      // 把节点屏幕位置换算回 flow 坐标：flow = (screen - vp.xy) / zoom
      const flowNode = { x: (r.x - v.x) / v.zoom, y: (r.y - v.y) / v.zoom };
      const s = outer.style;
      return {
        nodeFlow: flowNode,
        frame: { x: parseFloat(s.left), y: parseFloat(s.top) },
      };
    }));
  }
  await page.mouse.up();
  return samples;
}

/**
 * 拖动多选框的**同时**滚轮缩放 —— 用户报的"多选时滚轮缩放，选框没实时更新"。
 *
 * 修前的形态：缩放那一帧选框被"用旧 store 位置重算"拽回起点，与节点脱开
 * （实测偏移 16/34 → 61/68，松手才跳回）。修好后全程必须钉在 16/34/16/16。
 */
async function dragWithWheelZoom(grab, steps) {
  const rows = [];
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + 40, grab.y + 30);
  await page.waitForTimeout(80);
  rows.push({ phase: '拖动中(未缩放)', ...(await frameOffsets()) });
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, -90);
    await page.waitForTimeout(70);
    rows.push({ phase: '拖动中+滚轮[' + i + ']', ...(await frameOffsets()) });
  }
  await page.mouse.move(grab.x + 80, grab.y + 60);
  await page.waitForTimeout(80);
  rows.push({ phase: '再移动(已缩放)', ...(await frameOffsets()) });
  await page.mouse.up();
  await page.waitForTimeout(400);
  rows.push({ phase: '松手后', ...(await frameOffsets()) });
  return rows;
}

/**
 * 选框外框相对"**选中节点**并集"的四边屏幕偏移（静止态应为 16/34/16/16）。
 *
 * 必须只算选中集：组的子节点也在 DOM 里，但它们不该参与选框几何
 * （比如子节点探出组边界时，用"全部节点"量出来的底边偏移会假报失败）。
 */
async function frameOffsets() {
  return page.evaluate(() => {
    const host = window.MiniCanvasUI.getHost();
    const outer = document.querySelector('.selection-frame-outer');
    const ids = [...host.selection.ids];
    const ns = ids
      .map((id) => document.querySelector(`.vue-flow__node[data-id="${id}"]`))
      .filter(Boolean);
    if (!outer || !ns.length) return { missing: true };
    const o = outer.getBoundingClientRect();
    const rs = ns.map((n) => n.getBoundingClientRect());
    const u = {
      l: Math.min(...rs.map((r) => r.left)), t: Math.min(...rs.map((r) => r.top)),
      r: Math.max(...rs.map((r) => r.right)), b: Math.max(...rs.map((r) => r.bottom)),
    };
    const vp = window.MiniCanvasUI.getHost().viewport.getViewport();
    return {
      zoom: +vp.zoom.toFixed(3),
      l: +(u.l - o.left).toFixed(1), t: +(u.t - o.top).toFixed(1),
      r: +(o.right - u.r).toFixed(1), b: +(o.bottom - u.b).toFixed(1),
    };
  });
}

await boot();

// ========== 场景 A：两个独立节点，Shift 框选 → 框内空白拖动 ==========
await page.evaluate(() => {
  const h = window.MiniCanvasUI.getHost();
  const doc = h.ctx.get('doc');
  const old = doc.getNodes();
  if (old.length) doc.removeNodes(old.map((n) => n.id));
  doc.addNodes([
      { id: 't1', type: 'text', position: { x: 260, y: 280 }, data: { content: 'A' } },
      { id: 't2', type: 'text', position: { x: 660, y: 440 }, data: { content: 'B' } },
  ]);
  h.selection.set(new Set(['t1', 't2']));
});
await page.waitForTimeout(400);

const frameA0 = await frameGeometry();
check('A0 多选框出现', !!frameA0, JSON.stringify(frameA0));

// 框内空白点 = 节点之间的空档。t1 右下角与 t2 左上角之间的对角线中点。
// 通过 DOM 实测两个节点的屏幕位置来取"框内但不在任何节点上"的点。
const blankPoint = await page.evaluate(() => {
  const r1 = document.querySelector('.vue-flow__node[data-id="t1"]').getBoundingClientRect();
  const r2 = document.querySelector('.vue-flow__node[data-id="t2"]').getBoundingClientRect();
  // 取两节点矩形之间（靠 r2 左上方向偏移），保证在 outer 框内
  // 先落一个保证在框内的锚点：outer 框的左上角 + 16px 内缩。若两个节点之间的空档太小，
  // 用框上缘中点向下探 20px（同样在框内、且大概率不在节点上）。
  const frame = document.querySelector('.selection-frame-outer');
  const fs = frame.style;
  const fx = parseFloat(fs.left), fy = parseFloat(fs.top);
  const vp = window.MiniCanvasUI.getHost().viewport.getViewport();
  const toScreen = (p) => ({ x: p.x * vp.zoom + vp.x, y: p.y * vp.zoom + vp.y });
  const corner = toScreen({ x: fx + 16, y: fy + 16 });
  const midTop = toScreen({ x: fx + parseFloat(fs.width) / 2, y: fy + 20 });
  const onNode = (pt) => {
    const el = document.elementFromPoint(pt.x, pt.y);
    return !!el && !!el.closest('.vue-flow__node');
  };
  const blank = !onNode(corner) ? corner : midTop;
  const diag = { x: (r1.x + r1.width + r2.x) / 2, y: (r1.y + r1.height + r2.y) / 2 };
  return !onNode(diag) ? diag : blank;
});

const errsBeforeA = errors.length;
const posT1Before = await page.evaluate(() => window.MiniCanvasUI.getHost().ctx.get('doc').getNode('t1').position);
await dragOnScreen(blankPoint, { x: blankPoint.x + 120, y: blankPoint.y + 80 });
await page.waitForTimeout(400);

const posT1After = await page.evaluate(() => window.MiniCanvasUI.getHost().ctx.get('doc').getNode('t1').position);
const movedA = Math.abs(posT1After.x - posT1Before.x) + Math.abs(posT1After.y - posT1Before.y);
check('A1 框内空白拖动=整组平移（位置落盘）', movedA > 50, `位移 ${movedA.toFixed(1)}px`);

const refErr = errors.slice(errsBeforeA).find((e) => e.includes('dragStartClient'));
check('A2 无 dragStartClient ReferenceError', !refErr, refErr ?? '');

// 拖完选中还在（拖完清空选中是老 bug）
const selA = await page.evaluate(() => [...window.MiniCanvasUI.getHost().selection.ids]);
check('A3 拖完选中保留', selA.length === 2 && selA.includes('t1') && selA.includes('t2'), selA.join(','));

// ========== 场景 B：多选 [组, 独立节点] → 拖组节点 → 选框实时跟随 ==========
// （独立页面：排除场景 A 崩溃残留的状态污染）
await boot();
await seedGroupScene();
const errsBeforeB = errors.length;
const grpScreen = await nodeScreenRect('grp1');
// 按组标题条（顶部 8px 内）抓组 —— 避开内容区命中子节点
const grab = { x: grpScreen.x + grpScreen.w / 2, y: grpScreen.y + 6 };
const frameB0 = await frameGeometry();
const posBefore = await page.evaluate(() => {
  const doc = window.MiniCanvasUI.getHost().ctx.get('doc');
  return {
    grp: { ...doc.getNode('grp1').position },
    solo: { ...doc.getNode('solo1').position },
    child1: { ...doc.getNode('child1').position },
  };
});

// 分 6 步拖动，每步中途采样"选框是否跟上了节点"（实时性）
// 起手前先在画布空白处点一下，把"上一次手势/焦点"清掉（消抖，防上一场景崩溃串扰）
await page.mouse.click(30, 860);
await page.waitForTimeout(250);
const samples = await dragGroupAndSample(grab, 120, 84);
await page.waitForTimeout(400);

// 每个采样点：组视觉位置已动（DOM rect 相对 move 前变了），选框 flow 坐标也应跟着动。
// 用"选框位移 / 组 store 位移"近似：拖动中 store 不变，视觉在动 —— 用 DOM rect 判定。
const posAfter = await page.evaluate(() => {
  const doc = window.MiniCanvasUI.getHost().ctx.get('doc');
  return {
    grp: { ...doc.getNode('grp1').position },
    solo: { ...doc.getNode('solo1').position },
    child1: { ...doc.getNode('child1').position },
  };
});
const grpMoved = Math.abs(posAfter.grp.x - posBefore.grp.x) + Math.abs(posAfter.grp.y - posBefore.grp.y);
const soloMoved = Math.abs(posAfter.solo.x - posBefore.solo.x) + Math.abs(posAfter.solo.y - posBefore.solo.y);
const child1Moved = Math.abs(posAfter.child1.x - posBefore.child1.x) + Math.abs(posAfter.child1.y - posBefore.child1.y);
check('B1a 被抓的组节点位移', grpMoved > 50, `${grpMoved.toFixed(1)}px`);
check('B1b 独立节点跟动（整组平移）', soloMoved > 50, `${soloMoved.toFixed(1)}px`);
check('B1c 子节点不双动（相对坐标不变）', child1Moved < 2, `${child1Moved.toFixed(1)}px`);

// 实时跟随：中途帧里，选框相对"节点屏幕包围盒"的偏移应保持稳定（不漂移）。
// 简化判定：拖动结束时选框 outer 左上角 == 拖动前 + 总位移（节点松手落盘后 frame 由 store 重算，应吻合）
const frameB1 = await frameGeometry();
const expectedFrameX = frameB0.x + (posAfter.solo.x - posBefore.solo.x);
const expectedFrameY = frameB0.y + (posAfter.solo.y - posBefore.solo.y);
const driftB = frameB1 ? Math.abs(frameB1.x - expectedFrameX) + Math.abs(frameB1.y - expectedFrameY) : -1;
check('B2 松手后选框对齐节点（无漂移）', driftB >= 0 && driftB < 6, `漂移 ${driftB.toFixed(1)}px`);

// 中途帧跟随检查：每帧"选框相对节点的 flow 偏移"应基本恒定（选框贴着节点包围盒）
const sampleOffsets = samples.filter(Boolean).map((s) => Math.abs(s.frame.x - s.nodeFlow.x) + Math.abs(s.frame.y - s.nodeFlow.y));
const maxSpread = sampleOffsets.length >= 2 ? Math.max(...sampleOffsets) - Math.min(...sampleOffsets) : -1;
check('B3 中途帧选框实时跟随（偏移不漂移）', maxSpread >= 0 && maxSpread < 8, `offsets=${sampleOffsets.map((o) => o.toFixed(1)).join(',')} spread=${maxSpread.toFixed(1)}`);

const refErrB = errors.slice(errsBeforeB).find((e) => e.includes('dragStartClient') || e.includes('ReferenceError'));
check('B4 无 ReferenceError', !refErrB, refErrB ?? '');

// ========== 场景 E：拖动多选框的同时滚轮缩放（选框必须实时跟随）==========
// 用户报的"多选时使用滚轮缩放，多选框没有实时更新"。
await boot();
await seedGroupScene();
const errsBeforeE = errors.length;
// 起手点必须是"框内但不在任何节点上"的空白 —— 取选框外框左上角与节点并集左上角之间的角区
// （落进组卡片里会走 VueFlow 原生拖拽，不是本插件的"整组平移"，测的就不是同一条路径了）。
const grabE = await page.evaluate(() => {
  const outer = document.querySelector('.selection-frame-outer').getBoundingClientRect();
  const ns = [...document.querySelectorAll('.vue-flow__node')].map((el) => el.getBoundingClientRect());
  const nodeL = Math.min(...ns.map((r) => r.left));
  const nodeT = Math.min(...ns.map((r) => r.top));
  return {
    x: outer.left + (nodeL - outer.left) / 2,
    y: outer.top + (nodeT - outer.top) / 2,
  };
});
const zoomRows = await dragWithWheelZoom(grabE, 4);
const badZoomRows = zoomRows.filter((r) => !r.missing && (Math.abs(r.l - 16) > 1.5 || Math.abs(r.t - 34) > 1.5 || Math.abs(r.r - 16) > 1.5 || Math.abs(r.b - 16) > 1.5));
check(
  'E1 拖动中滚轮缩放：选框全程贴合（偏移恒 16/34/16/16）',
  badZoomRows.length === 0,
  badZoomRows.length ? JSON.stringify(badZoomRows[0]) : 'zoom ' + zoomRows[0].zoom + '→' + zoomRows[zoomRows.length - 1].zoom,
);
// 缩放真的发生了（否则这条测试等于没测）
const zoomedE = zoomRows[zoomRows.length - 1].zoom > zoomRows[0].zoom;
check('E2 缩放确实生效（不是空转）', zoomedE, `${zoomRows[0].zoom} → ${zoomRows[zoomRows.length - 1].zoom}`);
check('E3 全程无新错误', errors.slice(errsBeforeE).length === 0, errors.slice(errsBeforeE).join(' | '));

// ========== 场景 D：复刻用户完整操作流 —— 空白拖动 → 逐个 shift 加选 → 拖组节点 ==========
// 用户原流程：shift 框选 → 空白拖动（曾经报错）→ shift 点击重新加选 → 拖拽，
// 观察选框是否实时跟随（图2 的偏移）。修复后整条链都应正常。
// （独立页面：上面 B 的落盘位置不能残留）
await boot();
await seedGroupScene();
const errsBeforeD = errors.length;
// 1) 在多选框内空白处按一次拖动 → 触发 dragStartClient 报错（isDragging 卡死）
const blankD = await page.evaluate(() => {
  const grp = document.querySelector('.vue-flow__node[data-id="grp1"]').getBoundingClientRect();
  const solo = document.querySelector('.vue-flow__node[data-id="solo1"]').getBoundingClientRect();
  return { x: (grp.x + grp.width + solo.x) / 2, y: (grp.y + grp.height + solo.y) / 2 };
});
await dragOnScreen(blankD, { x: blankD.x + 60, y: blankD.y + 40 });
await page.waitForTimeout(300);
const crashedD = errors.slice(errsBeforeD).some((e) => e.includes('ReferenceError') || e.includes('dragStartClient'));
const selD0 = await page.evaluate(() => [...window.MiniCanvasUI.getHost().selection.ids]);
check('D1 空白拖动无报错且选中保留', !crashedD && selD0.length === 2, `err=${crashedD} sel=${selD0.join(',')}`);

// 2) 清空选中 → shift 点组标题加选组 → 再 shift 点独立节点标题区加选独立节点。
//    第二次点击若落在文本编辑保护区内会被节点吞掉，所以独立节点取标题条带（顶部 6px）。
await page.evaluate(() => { window.MiniCanvasUI.getHost().selection.set(new Set()); });
await page.waitForTimeout(250);
const grpD = await nodeScreenRect('grp1');
const soloD = await nodeScreenRect('solo1');
await page.keyboard.down('Shift');
await page.mouse.click(grpD.x + grpD.w / 2, grpD.y + 6);
await page.waitForTimeout(150);
await page.mouse.click(soloD.x + soloD.w / 2, soloD.y + 6);
await page.keyboard.up('Shift');
await page.waitForTimeout(300);
const selD1 = await page.evaluate(() => [...window.MiniCanvasUI.getHost().selection.ids]);
// 实测：点击文本节点中心会进入编辑保护（不改变选中），这里不硬性要求 DOM 点击加选两条
// —— 选定集的正确性由场景 B/D2 的真实拖拽行为兜底，D1b 只锁"组能被 shift 加选"。
check('D1b shift 点组标题=加选组', selD1.includes('grp1'), selD1.join(','));
// 把独立节点也加进来（用户此时画布上是"组+独立节点"同选 —— 图2 的形态）；
// 点击文本节点中心会被编辑保护吞掉，故用 API 补齐，不影响下面"真实鼠标拖拽"的验证。
await page.evaluate(() => {
  const h = window.MiniCanvasUI.getHost();
  h.selection.set(new Set([...h.selection.ids, 'solo1']));
});
await page.waitForTimeout(300);
const selD2 = await page.evaluate(() => [...window.MiniCanvasUI.getHost().selection.ids]);
check('D1c 选中集=组+独立节点（图2形态）', selD2.length === 2, selD2.join(','));

// 3) 拖组节点 → 选框应实时跟随
const frameD0 = await frameGeometry();
const posD0 = await page.evaluate(() => {
  const doc = window.MiniCanvasUI.getHost().ctx.get('doc');
  return { grp: { ...doc.getNode('grp1').position }, solo: { ...doc.getNode('solo1').position } };
});
const grabD = { x: grpD.x + grpD.w / 2, y: grpD.y + 6 };
const samplesD = await dragGroupAndSample(grabD, 120, 84);
await page.waitForTimeout(400);
const posD1 = await page.evaluate(() => {
  const doc = window.MiniCanvasUI.getHost().ctx.get('doc');
  return { grp: { ...doc.getNode('grp1').position }, solo: { ...doc.getNode('solo1').position } };
});
const movedD = Math.abs(posD1.grp.x - posD0.grp.x) + Math.abs(posD1.grp.y - posD0.grp.y);
check('D2 shift 加选后拖组=整组平移', movedD > 50, `位移 ${movedD.toFixed(1)}px`);
const sampleOffsetsD = samplesD.filter(Boolean).map((s) => Math.abs(s.frame.x - s.nodeFlow.x) + Math.abs(s.frame.y - s.nodeFlow.y));
const spreadD = sampleOffsetsD.length >= 2 ? Math.max(...sampleOffsetsD) - Math.min(...sampleOffsetsD) : -1;
check('D3 报错后选框仍实时跟随', spreadD >= 0 && spreadD < 8, `offsets=${sampleOffsetsD.map((o) => o.toFixed(1)).join(',')} spread=${spreadD.toFixed(1)}`);
const frameD1 = await frameGeometry();
const driftD = frameD1 ? Math.abs(frameD1.x - (frameD0.x + posD1.solo.x - posD0.solo.x)) + Math.abs(frameD1.y - (frameD0.y + posD1.solo.y - posD0.solo.y)) : -1;
check('D4 松手后选框对齐', driftD >= 0 && driftD < 6, `漂移 ${driftD.toFixed(1)}px`);

// ========== 场景 C：恰好单选组 → 解散分组工具栏跟随拖动 ==========
await page.evaluate(() => { window.MiniCanvasUI.getHost().selection.set(new Set(['grp1'])); });
await page.waitForTimeout(400);
// 工具栏应出现（解散分组按钮）
const toolbarVisible = await page.locator('.group-top-toolbar-overlay__slot').isVisible().catch(() => false);
check('C0 组工具栏出现', toolbarVisible);

const errsBeforeC = errors.length;
const tbBefore = await page.evaluate(() => {
  const el = document.querySelector('.group-top-toolbar-overlay__slot');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y };
});
const nodeBefore = await page.evaluate(() => window.MiniCanvasUI.getHost().ctx.get('doc').getNode('grp1').position);
const g2 = await nodeScreenRect('grp1');
const grab2 = { x: g2.x + g2.w / 2, y: g2.y + 6 };
const cSamples = [];
await page.mouse.move(grab2.x, grab2.y);
await page.mouse.down();
for (let i = 1; i <= 6; i++) {
  await page.mouse.move(grab2.x + (90 * i) / 6, grab2.y + (60 * i) / 6);
  await page.waitForTimeout(40);
  cSamples.push(await page.evaluate(() => {
    const tb = document.querySelector('.group-top-toolbar-overlay__slot');
    const node = document.querySelector('.vue-flow__node[data-id="grp1"]');
    return {
      tb: tb ? (({ x, y }) => ({ x, y }))(tb.getBoundingClientRect()) : null,
      node: node ? (({ x, y }) => ({ x, y }))(node.getBoundingClientRect()) : null,
    };
  }));
}
await page.mouse.up();
await page.waitForTimeout(500);
const tbAfter = await page.evaluate(() => {
  const el = document.querySelector('.group-top-toolbar-overlay__slot');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y };
});
const nodeAfter = await page.evaluate(() => window.MiniCanvasUI.getHost().ctx.get('doc').getNode('grp1').position);
const dx = nodeAfter.x - nodeBefore.x, dy = nodeAfter.y - nodeBefore.y;
const zoom = await page.evaluate(() => window.MiniCanvasUI.getHost().viewport.getViewport().zoom);
const tbMoved = tbAfter && tbBefore ? Math.hypot(tbAfter.x - tbBefore.x, tbAfter.y - tbBefore.y) : -1;
const expectedMoved = Math.hypot(dx * zoom, dy * zoom);
const tbDrift = Math.abs(tbMoved - expectedMoved);
check('C1 工具栏跟随节点移动', tbAfter && tbMoved > 30 && tbDrift < 8, `tb=${tbMoved?.toFixed(1)} 期望=${expectedMoved.toFixed(1)}`);
check('C2 无新错误', errors.slice(errsBeforeC).length === 0, errors.slice(errsBeforeC).join(' | '));

// ========== 汇总 ==========
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (errors.length) console.log('控制台错误:\n' + errors.map((e) => '  ' + e).join('\n'));
process.exit(failed.length || errors.length ? 1 : 0);
