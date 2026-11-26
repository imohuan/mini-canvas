/**
 * 界面规范检查：把「必须做到的事」钉成代码，而不是靠 AI 记。
 *
 * 用户口径（2026-11-26）：「这个逻辑，这部分需要使用代码进行检查，不能靠 ai」。
 * 起因是画布上真出现过：连线删了还显示「上游 图片 1」、参数监听了却不读上游。
 */
import { describe, it, expect } from 'vitest'
import { lintUiHtml, formatLint } from '../task/uiLint'

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

  it('★ onChange 不读上游 = 警告（删了连线界面不会变）', () => {
    const html = '<div>x</div><script>CanvasUI.onChange(function(d){ console.log(d.inputs) });</script>'
    const r = lintUiHtml(html)
    expect(r.warnings.map((w) => w.rule)).toContain('onchange-ignores-upstream')
  })

  it('外链 = 错误（沙箱连不上）', () => {
    for (const bad of [
      '<link href="https://cdn.x/a.css" rel="stylesheet">',
      '<script src="https://cdn.x/vue.js"></script>',
      '<img src="http://x/a.png">',
      '<style>.a{background:url(https://x/a.png)}</style>',
    ]) {
      const r = lintUiHtml('<div>x</div><script>CanvasUI.onChange(function(d){ d.upstream });</script>' + bad)
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
      '<div>x</div><script>var UI = window.__CANVAS_UI__; CanvasUI.onChange(function(d){ d.upstream });</script>'
    const rules = lintUiHtml(html).warnings.map((w) => w.rule)
    expect(rules).toContain('no-persist')
    expect(rules).not.toContain('no-ui-context')
  })

  it('空界面 = 错误（不算通过）', () => {
    expect(lintUiHtml('   ').ok).toBe(false)
  })
})
