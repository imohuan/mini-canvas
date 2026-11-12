// @ts-nocheck
// asset-panel-check —— 资产面板 UI 自动化测试（真实 Chromium，打 cloud-server 8865 成品页）。
// 覆盖本轮全部修复：缩略图/预览/内联重命名/二级箭头/菜单无图标/批量条标签自动关闭/添加到 Agent。
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
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 200)));
const drawer = page.locator('.left-drawer');
// 资产行的「更多操作」按钮（按扩展名区分，避开文件夹行）
const assetMore = drawer.getByLabel(/^更多操作 .+\.(jpeg|jpg|png|ogg|mp4|webp)$/);
const openDrawerAssets = async () => {
  await page.getByRole('button', { name: '资产管理' }).first().click();
  await page.waitForTimeout(600);
  await page.getByRole('tab', { name: '资产' }).click();
  await page.waitForTimeout(1500);
};

// ===== 第一段：缩略图 / 菜单 / 二级箭头 / 预览 / 重命名 =====
await page.goto(`${BASE}/#/canvas/${CANVAS_ID}`, { waitUntil: 'load' });
await page.waitForTimeout(3500);
await openDrawerAssets();

const imgStats = await drawer.locator('.group\\/row img').evaluateAll((els) =>
  els.map((e) => ({ src: e.getAttribute('src'), w: e.naturalWidth })).filter((x) => x.src && x.src.includes('/api/assets/files/')));
check('同源资产缩略图加载成功（naturalWidth>0）', imgStats.length > 0 && imgStats.every((x) => x.w > 0), JSON.stringify(imgStats.slice(0, 1)));

await assetMore.first().click();
await page.waitForTimeout(700);
const menu = page.locator('[role=menu]').last();
check('二级菜单行有箭头提示（›）', (await menu.locator('.ax-sub-row .ax-menu-hint').count()) >= 1);
const contentIcons = await menu.locator(':scope > .ax-menu-item > svg:not(.ax-menu-hint), :scope > .ax-sub-row > .ax-menu-item > svg:not(.ax-menu-hint)').count();
check('一级菜单项不带内容图标', contentIcons === 0, 'svg=' + contentIcons);
await page.mouse.click(1200, 800);
await page.waitForTimeout(400);

await drawer.getByLabel(/^预览 /).first().click();
await page.waitForTimeout(900);
check('点资产能打开预览', (await page.locator('[data-testid=media-preview-overlay], [role=dialog]').count()) > 0);
// 关预览：Esc 最稳（点空白可能被浮层自身拦下）
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
if (await page.locator('[data-testid=media-viewer]').count()) {
  // 兜底：点浮层里的关闭按钮（MediaViewer 右上角）
  await page.locator('[data-testid=media-viewer] button[aria-label="关闭"], [data-testid=media-viewer] [aria-label="关闭"]').first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(600);
}

await assetMore.first().click();
await page.waitForTimeout(700);
await page.locator('[role=menu]').last().locator('.ax-menu-item', { hasText: '重命名' }).first().click();
await page.waitForTimeout(700);
check('重命名 = 内联输入框', (await drawer.locator('input[data-row-rename]').count()) > 0);

// ===== 第二段：重载后测批量条 + 添加到 Agent =====
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(3500);
await page.keyboard.press('Control+j');
await page.waitForTimeout(1500);
await openDrawerAssets();

// 添加到 Agent（资产行）
const tagsBefore = await page.locator('.ac-tag').count();
await assetMore.first().click();
await page.waitForTimeout(700);
await page.locator('[role=menu]').last().locator('.ax-menu-item', { hasText: '添加到Agent' }).first().click();
await page.waitForTimeout(1600);
const tagsAfter = await page.locator('.ac-tag').count();
check('「添加到 Agent」把资产引用进输入框', tagsAfter > tagsBefore, `before=${tagsBefore} after=${tagsAfter}`);
if (tagsAfter > 0) {
  const t = (await page.locator('.ac-tag').first().innerText()).trim();
  check('引用标签带资产名', t.length > 0, JSON.stringify(t));
}

// 批量条「修改标签」点选后自动关闭
await page.locator('.left-drawer [aria-label="批量操作"]').first().click({ force: true });
await page.waitForTimeout(600);
check('批量条出现', (await page.locator('.left-drawer [role=toolbar]').count()) > 0);
await drawer.locator('[role=checkbox]').first().click({ force: true });
await page.waitForTimeout(400);
await page.locator('.left-drawer [role=toolbar] [aria-label="修改标签"]').first().click({ force: true });
await page.waitForTimeout(600);
const before = await page.locator('.dd-menu').count();
await page.locator('.dd-menu .ax-menu-item').first().click({ force: true });
await page.waitForTimeout(700);
const after = await page.locator('.dd-menu').count();
check('点标签后下拉自动关闭', after < before, `before=${before} after=${after}`);

await browser.close();
const failed = results.filter((r) => !r.ok);
if (pageErrors.length) console.log('页面错误:', pageErrors.slice(0, 2).join(' | '));
console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
process.exit(failed.length ? 1 : 0);
