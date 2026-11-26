/**
 * 界面规范检查：把「必须做到的事」钉成代码，而不是靠 AI 记。
 *
 * 用户口径（2026-11-26）：「这个逻辑，这部分需要使用代码进行检查，不能靠 ai」。
 * 起因是画布上真出现过：连线删了还显示「上游 图片 1」、参数监听了却不读上游。
 */
import { describe, it, expect } from 'vitest'
import { lintUiHtml, formatLint } from '../task/uiLint'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const GOOD = `
<style>html,body{height:100%;margin:0}</style>
<div id="src"></div><button id="go">生成</button><img id="out">
<script>
(function(){
  var UI = window.__CANVAS_UI__ || {};
  function upstream(){ return window.__CANVAS_UPSTREAM__ || []; }
  function draw(){ document.getElementById("src").textContent = upstream().length ? "有素材" : "无上游"; }
  CanvasUI.onChange(function(d){ draw(); if (d && d.inputs) restore(d.inputs); });
  function restore(){}
  draw();
})();
</script>`

describe('lintUiHtml —— 规范检查', () => {
  it('照规范的界面：零错误（onChange 里读上游、读了 __CANVAS_UI__）', () => {
    const r = lintUiHtml(GOOD)
    expect(r.errors).toEqual([])
    expect(r.ok).toBe(true)
  })

  it('★ 没注册 onChange = 错误（用户点名：节点必须实现参数监听）', () => {
    const r = lintUiHtml('<div>x</div><script>var a=1;</script>')
    expect(r.ok).toBe(false)
    expect(r.errors.map((e) => e.rule)).toContain('missing-onchange')
    expect(formatLint(r)).toContain('onChange')
  })

  it('★ 整份界面都不读上游 = 警告（删了连线界面不会变）', () => {
    const html = '<div>x</div><script>CanvasUI.onChange(function(d){ console.log(d.inputs) });</script>'
    const r = lintUiHtml(html)
    expect(r.warnings.map((w) => w.rule)).toContain('onchange-ignores-upstream')
  })

  /**
   * 正确的写法：onChange 里调 draw()，draw() 自己现读上游（手册的示例就是这样）。
   * 这种不能被误判 —— 误报会把好代码「改坏」。
   */
  it('onChange 里调用会读上游的函数 = 不算问题', () => {
    const html = `<div>x</div><script>
      function draw(){ var u = window.__CANVAS_UPSTREAM__ || []; }
      CanvasUI.onChange(function(){ draw(); });
      draw();
    </script>`
    const rules = lintUiHtml(html).warnings.map((w) => w.rule)
    expect(rules).not.toContain('onchange-ignores-upstream')
  })

  /**
   * 2026-11-26 口径变了：允许联网时脚本来源是放开的，引组件库/图表库是**正常写法**，
   * 只提醒「要能打开、离线会失效」；纯展示那一档才拦。
   */
  it('允许联网时引用外部脚本 = 提醒，不是错误（组件库要靠它）', () => {
    const html =
      '<div>x</div><script src="https://cdn.x/kit.js"></script>' +
      '<script>CanvasUI.onChange(function(d){ d.upstream });</script>'
    const r = lintUiHtml(html)
    expect(r.errors).toEqual([])
    expect(r.warnings.map((w) => w.rule)).toContain('external-asset')
  })

  it('纯展示档（不允许联网）引用外部脚本 = 错误（CSP 只认内联）', () => {
    for (const bad of [
      '<link href="https://cdn.x/a.css" rel="stylesheet">',
      '<script src="https://cdn.x/vue.js"></script>',
      '<style>.a{background:url(https://x/a.png)}</style>',
    ]) {
      const r = lintUiHtml('<div>x</div><script>CanvasUI.onChange(function(d){ d.upstream });</script>' + bad, {
        allowNetwork: false,
      })
      expect(r.errors.map((e) => e.rule), bad).toContain('external-link')
    }
  })

  it('直接 fetch = 错误（沙箱是不透明源）', () => {
    const html = '<div>x</div><script>fetch("/api/x");CanvasUI.onChange(function(d){ d.upstream });</script>'
    expect(lintUiHtml(html).errors.map((e) => e.rule)).toContain('direct-fetch')
  })

  it('★ 调了没声明的脚本 = 错误（用户点按钮就 403）', () => {
    const html =
      '<div>x</div><script>CanvasUI.onChange(function(d){ d.upstream });CanvasUI.task("pixelize","hd",[]);</script>'
    const r = lintUiHtml(html, { declaredScripts: ['_pixelize'], knownScripts: ['pixelize', '_pixelize'] })
    const e = r.errors.find((x) => x.rule === 'undeclared-script')
    expect(e).toBeTruthy()
    expect(e!.message).toContain('pixelize')
    expect(e!.message).toContain('_pixelize')
  })

  it('调了根本不存在的脚本 = 错误（拼写错）', () => {
    const html = '<div>x</div><script>CanvasUI.onChange(function(d){ d.upstream });CanvasUI.task("pxlize","hd",[]);</script>'
    const r = lintUiHtml(html, { declaredScripts: [], knownScripts: ['pixelize'] })
    expect(r.errors.map((e) => e.rule)).toContain('unknown-script')
  })

  it('声明齐全时不报脚本错（修完不能把正常路径也拦了）', () => {
    const html =
      '<div>x</div><script>CanvasUI.onChange(function(d){ d.upstream });CanvasUI.task("pixelize","hd",[]);</script>'
    const r = lintUiHtml(html, { declaredScripts: ['pixelize'], knownScripts: ['pixelize'] })
    expect(r.errors).toEqual([])
  })

  it('从不交参数 = 警告；读了 __CANVAS_UI__ 就不再报上下文警告', () => {
    const html =
      '<div><input id="w"></div><script>var UI = window.__CANVAS_UI__;' +
      'CanvasUI.onChange(function(d){ d.upstream });</script>'
    const rules = lintUiHtml(html).warnings.map((w) => w.rule)
    expect(rules).toContain('no-persist')
    expect(rules).not.toContain('no-ui-context')
  })

  it('纯展示界面（没有输入控件）不要求 setInputs —— 不塞无意义的空调用', () => {
    const html = '<div>x</div><script>CanvasUI.onChange(function(d){ d.upstream });</script>'
    expect(lintUiHtml(html).warnings.map((w) => w.rule)).not.toContain('no-persist')
  })

  it('空界面 = 错误（不算通过）', () => {
    expect(lintUiHtml('   ').ok).toBe(false)
  })
})

describe('★ 手册里的示例本身必须合规', () => {
  /**
   * 为什么要这条：手册里那个「最小例子」曾经没有 onChange、还有一处引号写坏 ——
   * AI 照抄就会被自己的规范检查拦下（2026-11-26 核对时发现）。
   * 示例错了比没示例更坏：它会被当成「官方写法」抄进每个节点。
   */
  it('guide.md 的 html 示例能直接通过检查', () => {
    const file = fileURLToPath(new URL('../guide.md', import.meta.url))
    const md = readFileSync(file, 'utf8')
    const blocks = [...md.matchAll(/```html\n([\s\S]*?)```/g)].map((m) => m[1])
    expect(blocks.length).toBeGreaterThan(0) // 至少得有一个可抄的例子
    for (const block of blocks) {
      const r = lintUiHtml(block)
      expect(formatLint(r)).toBe('')
    }
  })
})
