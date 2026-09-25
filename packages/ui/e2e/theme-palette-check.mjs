// @ts-nocheck
// 主题色板「两格制」浏览器验证 —— 真实 Chromium 跑 :5288。
//
// 为什么必须真浏览器：本特性的全部价值是"亮/暗两套主题各取一个值"，
// 而这依赖 ①内联变量、②<html class="dark">、③ui-theme.css 的 :root/html.dark 分支
// 三者真实协作。Node 单测只能验纯逻辑与变量名，验不到"切主题真的换了颜色"。
//
// 跑法：先 pnpm -C packages/ui dev（:5288），再 node packages/ui/e2e/theme-palette-check.mjs
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const EXE = process.env.CANVAS_E2E_CHROME
  ?? 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const BASE = 'http://localhost:5288/';
if (!existsSync(EXE)) { console.error('chromium 不存在:', EXE); process.exit(2); }

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  -- ' + detail : ''));
}

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));

await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => { try { localStorage.clear(); } catch {} });
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(2200);

const setTheme = (dark) => page.evaluate((d) => {
  document.documentElement.classList.toggle('dark', d);
  document.documentElement.dataset.canvasTheme = d ? 'dark' : 'light';
}, dark);

/** 读某变量在指定主题下解析后的值 */
const resolved = async (varName, dark) => {
  await setTheme(dark);
  return page.evaluate((v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim(), varName);
};

/** 判断解析后的颜色是否等价于给定 hex（浏览器可能回成 rgb(...) 形式） */
const toRgb = (hex) => {
  const h = hex.replace('#', '');
  return 'rgb(' + parseInt(h.slice(0, 2), 16) + ', ' + parseInt(h.slice(2, 4), 16) + ', ' + parseInt(h.slice(4, 6), 16) + ')';
};
const isColor = (actual, hex) => {
  const a = String(actual).toLowerCase().replace(/\s+/g, ' ');
  return a === hex.toLowerCase() || a === toRgb(hex).toLowerCase() || a.indexOf(toRgb(hex).toLowerCase()) >= 0;
};

/** 通过设置服务改一格（等价于用户在设置面板拖取色器） */
const setSetting = (key, value) => page.evaluate((kv) => {
  window.MiniCanvasUI.getHost().ctx.get('settings').set(kv[0], kv[1]);
  return true;
}, [key, value]);

const settingValue = (key) => page.evaluate((k) => {
  const s = window.MiniCanvasUI.getHost().ctx.get('settings');
  return s.has(k) ? String(s.get(k)) : null;
}, key);

// —— 1. 色板字段真的登记进了设置（面板里才看得到） ——
for (const key of ['edgeRailColorLight', 'edgeRailColorDark', 'accentColorLight', 'accentColorDark', 'guideColorLight', 'guideColorDark']) {
  const v = await settingValue(key);
  check('设置里存在 ' + key, v !== null, v === null ? '未登记' : '=' + v);
}

// —— 2. 默认值下，两套主题解析出不同的颜色 ——
const railLight0 = await resolved('--ui-edge-rail', false);
const railDark0 = await resolved('--ui-edge-rail', true);
check('默认：连线色亮/暗不同', railLight0 !== railDark0, 'light=' + railLight0 + ' dark=' + railDark0);

const flowLight0 = await resolved('--ui-edge-flow', false);
const flowDark0 = await resolved('--ui-edge-flow', true);
check('默认：流光色亮/暗不同', flowLight0 !== flowDark0, 'light=' + flowLight0 + ' dark=' + flowDark0);

// —— 3. 只改亮色那格 → 亮色变、暗色不变（两格制核心不变量） ——
await setSetting('edgeRailColorLight', '#ff00aa');
const railLight1 = await resolved('--ui-edge-rail', false);
const railDark1 = await resolved('--ui-edge-rail', true);
check('改亮色格：亮色生效', isColor(railLight1, '#ff00aa'), railLight1);
check('改亮色格：暗色不受影响', railDark1 === railDark0, 'dark=' + railDark1 + ' (期望 ' + railDark0 + ')');

// —— 4. 只改暗色那格 → 暗色变、亮色不动 ——
await setSetting('edgeRailColorDark', '#00ff00');
const railLight2 = await resolved('--ui-edge-rail', false);
const railDark2 = await resolved('--ui-edge-rail', true);
check('改暗色格：暗色生效', isColor(railDark2, '#00ff00'), railDark2);
check('改暗色格：亮色保持不动', railLight2 === railLight1, 'light=' + railLight2);

// —— 5. 改回默认值 → 内联覆盖被清掉 ——
await setSetting('edgeRailColorDark', '#9ca3af');
const inlineDark = await page.evaluate(() => document.documentElement.style.getPropertyValue('--uic-edge-rail-color-dark').trim());
check('改回默认：内联覆盖被清除', inlineDark === '', 'inline="' + inlineDark + '"');

// —— 6. 未改过的格不写内联（否则会压掉主题插件在 CSS 里给的配色） ——
const inlineAccent = await page.evaluate(() => document.documentElement.style.getPropertyValue('--uic-accent-color-light').trim());
check('未改动的格不写内联', inlineAccent === '', 'inline="' + inlineAccent + '"');

// —— 7. 派生档跟着主色现算 ——
const softBefore = await resolved('--ui-accent-soft', false);
await setSetting('accentColorLight', '#7c3aed');
const softAfter = await resolved('--ui-accent-soft', false);
check('强调色派生档跟随现算', softBefore !== softAfter, softBefore + ' -> ' + softAfter);

// —— 8. 真实连线元素吃到了色板色（先建一条真边：首屏样例只有节点、没有连线） ——
await page.evaluate(() => {
  const h = window.MiniCanvasUI.getHost();
  const nodes = h.nodeStore.getNodes();
  const a = nodes.find((n) => n.type === 'text') ?? nodes[0];
  const b = nodes.find((n) => n.type === 'image') ?? nodes[1];
  if (a && b && h.doc.getEdges().length === 0) h.doc.addEdge({ source: a.id, target: b.id });
});
await page.waitForTimeout(600);
const edgeProbe = async (dark, expectedHex) => {
  await setTheme(dark);
  await page.waitForTimeout(250);
  return page.evaluate(() => {
    const p = document.querySelector('.custom-edge .ef-base, .custom-edge .ef-rail') ?? document.querySelector('.custom-edge path');
    if (!p) return null;
    // CustomEdge 把色值内联绑到 SVG 表现属性（var() 在表现属性里不解析），所以读属性即可
    return { attr: p.getAttribute('stroke'), computed: getComputedStyle(p).stroke };
  });
};

const probeDark = await edgeProbe(true, '#9ca3af');
check('连线元素渲染出来了', probeDark !== null, JSON.stringify(probeDark));
if (probeDark) {
  check('暗色下连线取到暗色格的值', isColor(probeDark.attr, '#9ca3af') || isColor(probeDark.computed, '#9ca3af'), JSON.stringify(probeDark));
}

// 改亮色格 → 亮色主题下连线元素跟着变（证明设置真的流到了渲染件，不只是变量变了）
await setSetting('edgeRailColorLight', '#ff00aa');
const probeLight = await edgeProbe(false, '#ff00aa');
if (probeLight) {
  check('亮色下连线取到亮色格的值', isColor(probeLight.attr, '#ff00aa') || isColor(probeLight.computed, '#ff00aa'), JSON.stringify(probeLight));
}

check('无未捕获页面错误', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log('');
console.log('主题色板验证：' + (results.length - failed.length) + '/' + results.length + ' 通过');
process.exit(failed.length === 0 ? 0 : 1);
