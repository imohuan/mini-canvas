import { chromium } from 'playwright-core';
const EXE = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage();
await page.goto('http://localhost:5288/', { waitUntil: 'load' });
await page.waitForTimeout(2500);
const s = await page.evaluate(() => {
  const ctx = window.MiniCanvasUI.getContext();
  const svcs = ctx.injectedServices();
  const pluginSvcs = svcs.filter((n) => !['save','doc','resources','nodeRegistry','themeRegistry','selection','command','nodeFactory','nodeLayout','viewport','settingsPersist'].includes(n));
  return { base: svcs.filter((n) => !['text','image','video','panorama3d','imageCompare','multi-select','group','clipboard','mini-map','shortcut-manager','shortcut-remap','file-drop','cloud-save','auto-save','history-facade','image-meta'].includes(n)), pluginProvided: pluginSvcs, all: svcs };
});
console.log(JSON.stringify(s, null, 1));
await browser.close();
