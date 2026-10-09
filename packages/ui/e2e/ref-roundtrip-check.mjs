// @ts-nocheck
// 引用标记（XML）回填端到端检查。
// 跑法：node packages/ui/e2e/ref-roundtrip-check.mjs （需 cloud-server :8865）
import { chromium } from "playwright-core"
import { existsSync } from "node:fs"

const EXE = "C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe"
const BASE = "http://127.0.0.1:8865"
const CANVAS_ID = "430c8f1f00bd4aba"
if (!existsSync(EXE)) { console.error("chromium 不在:", EXE); process.exit(2) }

const browser = await chromium.launch({ executablePath: EXE, headless: true })
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })

await page.goto(BASE + "/#/canvas/" + CANVAS_ID, { waitUntil: "load" })
await page.waitForTimeout(3500)
await page.getByRole("button", { name: "Agent 对话" }).first().click()
await page.waitForTimeout(2000)

const XML = "\u003cref type=\"asset\" name=\"\u6d4b\u8bd5\u56fe.png\" path=\"D:/tmp/a.png\" /\u003e  \u4ecb\u7ecd\u4e00\u4e0b"

// 通过 Vue 组件实例调用 setText（等价「编辑回填」塞进去的数据）
const called = await page.evaluate((xml) => {
  const ed = [...document.querySelectorAll("[contenteditable]")].pop()
  if (!ed) return false
  let node = ed
  while (node && !node.__vueParentComponent) node = node.parentElement
  let inst = node && node.__vueParentComponent
  while (inst) {
    const ex = inst.exposed
    if (ex && typeof ex.setText === "function") { ex.setText(xml); return true }
    const ss = inst.setupState
    if (ss && ss.editorRef && ss.editorRef.value && typeof ss.editorRef.value.setText === "function") {
      ss.editorRef.value.setText(xml); return true
    }
    inst = inst.parent
  }
  return false
}, XML)
await page.waitForTimeout(1200)

const chip = await page.locator(".ac-tag").count()
const pmText = await page.evaluate(() => { const ed = [...document.querySelectorAll("[contenteditable]")].pop(); return ed ? (ed.querySelector(".ProseMirror") || ed).innerText : "" })
const ok = called && chip > 0 && !pmText.includes("<ref")
console.log((ok ? "PASS" : "FAIL") + "  XML 回填解析成 chip 标签（不是文字）")
console.log("   setText 被调用: " + called + " / chip 数: " + chip)
console.log("   输入框文本: " + JSON.stringify(pmText.slice(0, 80)))

await browser.close()
process.exit(ok ? 0 : 1)
