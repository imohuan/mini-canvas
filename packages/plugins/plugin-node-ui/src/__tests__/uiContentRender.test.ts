/**
 * UiContent 渲染契约（SSR 拿真 HTML 断言）。
 *
 * 用户实测报的缺陷（原话）：「渲染的是 HTML 代码，把我的节点拖拽功能顶掉了……
 * 应该是需要我双击才能进入编辑的状态」。
 *
 * 根因：iframe 是独立文档，pointerdown / wheel 都不会冒泡给宿主 ——
 * 不盖一层遮罩，节点就拖不动、画布也缩不了（所以这一层是**功能必需**，不是装饰）。
 *
 * 这里锁住两态：
 *   · 有内容时：**默认必须盖着遮罩**（否则拖拽失灵），且 iframe 是沙箱的；
 *   · 没内容时：显示空态、不画 iframe（空 iframe 会变成一个吃事件的透明块）。
 */
import { describe, it, expect } from 'vitest'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import UiContent from '../UiContent.vue'

/** 最小渲染上下文：UiContent 要用 ctx.tryGet('doc'/'settings'/'selection') */
function renderCtx(doc?: Record<string, unknown>): CanvasRenderContext {
  return {
    ctx: {
      tryGet: (name: string) =>
        name === 'doc'
          ? { getNode: () => undefined, getEdges: () => [], ...(doc ?? {}) }
          : name === 'settings'
            ? { get: () => undefined }
            : undefined,
    },
    viewport: { value: { zoom: 1 } },
  } as unknown as CanvasRenderContext
}

function render(data: Record<string, unknown>, doc?: Record<string, unknown>): Promise<string> {
  const app = createSSRApp({
    render: () =>
      h(UiContent as Component, { id: '7', data }),
  })
  app.provide(RENDER_CONTEXT_KEY, renderCtx(doc))
  return renderToString(app)
}

describe('可视化节点内容：默认不让 iframe 吃掉鼠标事件', () => {
  it('有内容时：默认盖着交互遮罩（不盖住的话 iframe 会吃掉鼠标事件）', async () => {
    const html = await render({ uiHtml: '<div>hi</div>' })
    expect(html).toContain('ui-gate')
    expect(html).toContain('双击交互')
  })

  it('遮罩**不能**带 nodrag/nopan —— 那会把整个节点的拖拽禁掉（用户实测的根因）', async () => {
    const html = await render({ uiHtml: '<div>hi</div>' })
    // 取出遮罩那一层的 class 属性
    const m = /class="([^"]*ui-gate[^"]*)"/.exec(html)
    expect(m, '找不到遮罩元素').toBeTruthy()
    const cls = m![1]
    expect(cls, '遮罩带了 nodrag：pointerdown 会被 VueFlow 放行，节点就拖不动了').not.toContain('nodrag')
    expect(cls, '遮罩带了 nopan：连画布平移都会被这一层挡掉').not.toContain('nopan')
  })

  it('有内容时：iframe 是沙箱的，且不给 allow-same-origin（沙箱是唯一的安全边界）', async () => {
    const html = await render({ uiHtml: '<div>hi</div>' })
    expect(html).toContain('<iframe')
    expect(html).toContain('sandbox="allow-scripts"')
    expect(html).not.toContain('allow-same-origin')
  })

  it('数据在 iframe 之前注入：生成物一执行就读得到（不靠握手时序）', async () => {
    const html = await render({ uiHtml: '<div>hi</div>', uiBackendOrigin: 'http://x:8865' })
    // 引导脚本排在 iframe 前面（srcdoc 是它的一部分）
    const bootAt = html.indexOf('__CANVAS_INPUTS__')
    // srcdoc 被转义进了属性里，所以这里只验"注入确实发生了"
    expect(bootAt).toBeGreaterThan(-1)
    expect(html).toContain('http://x:8865')
  })

  it('注入的数据进了 srcdoc（生成物一执行就能读到）', async () => {
    const html = await render({
      uiHtml: '<div>hi</div>',
      uiUpstream: [{ refName: '封面', kind: 'image', url: '/a.png' }],
    })
    expect(html).toContain('__CANVAS_UPSTREAM__')
    expect(html).toContain('__CANVAS_UI__')
  })

  it('上游素材：data 里没有时**从连线现算**（Agent 经 MCP 写入那条路不写 uiUpstream）', async () => {
    const doc = {
      // 真实 doc 里的节点**一定带 id**（现算上游时要靠它标出"这条素材来自哪个节点"）
      getNode: (id: string) =>
        id === 'img1'
          ? { id, type: 'image', data: { label: '封面', imageUrl: '/api/a.png' } }
          : id === 'txt1'
            ? { id, type: 'text', data: { text: '一段说明' } }
            : undefined,
      getEdges: () => [
        { source: 'img1', target: '7' },
        { source: 'txt1', target: '7' },
      ],
    }
    const html = await render({ uiHtml: '<div>x</div>' }, doc)
    // 两条素材都进了 __CANVAS_UPSTREAM__（HTML 属性里被转义，所以按裸片段断言）
    expect(html).toContain('封面')
    expect(html).toContain('/api/a.png')
    expect(html).toContain('一段说明')
    // 且带上了各自节点的 id（要改那条上游时用）
    expect(html).toContain('img1')
  })

  it('上游素材：空的连（例如还没生成的图片节点）不进清单，不塞噪音', async () => {
    const doc = {
      getNode: () => ({ type: 'image', data: {} }),
      getEdges: () => [{ source: 'empty', target: '7' }],
    }
    const html = await render({ uiHtml: '<div>x</div>' }, doc)
    // 空的连不给内容（HTML 属性里引号被转义，按片段断言）
    expect(html).toContain('__CANVAS_UPSTREAM__')
    expect(html).not.toContain('empty')
  })

  it('★ 上游只有 resourceId 时也要进 __CANVAS_UPSTREAM__（带引用而不是当空素材）', async () => {
    const doc = {
      getNode: (id: string) => ({ id, type: 'image', data: { label: '封面', resourceId: 'default/abc.png' } }),
      getEdges: () => [{ source: 'img1', target: '7' }],
    }
    const html = await render({ uiHtml: '<div>x</div>' }, doc)
    expect(html).toContain('default/abc.png')
  })

  it('注入色板：__CANVAS_UI__ 里带上 palette（亮/暗两套，给不给用由生成物决定）', async () => {
    const html = await render({ uiHtml: '<div>x</div>' })
    expect(html).toContain('palette')
    expect(html).toContain('accent')
    // 亮/暗两套都要有
    expect(html).toContain('light')
    expect(html).toContain('dark')
  })

  it('没内容时：显示空态、不画 iframe（空 iframe 是个吃事件的透明块）', async () => {
    const html = await render({})
    expect(html).toContain('ui-empty')
    expect(html).toContain('让 Agent 帮你画')
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('ui-gate-badge')
  })

  /**
   * 调试入口的回归线（2026-10-20 审查 S1b）。
   *
   * 那一版是「开 about:blank + document.write」，副本继承画布页的源，
   * 节点 HTML 里的脚本能读走管理令牌。现在必须是「先问后台要 URL，再导航过去」，
   * 而且组件里不该再出现任何 document.write。
   */
  it('★ 调试入口不再往窗口里写文档（同源副本已换成独立源页面）', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../UiContent.vue', import.meta.url), 'utf8'),
    )
    // 只看代码，不看注释（注释里会解释"为什么不再用 document.write"）
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toContain('document.write')
    expect(code).not.toContain('buildDebugDoc')
    // 走的是后台生成接口，页面地址由后台给
    expect(src).toContain('/debug-docs')
    // 导航那一行现在在 debugWindow.ts（抽出去是为了能单测三条分支）
    expect(src).toContain('openDebugWindow')
    const helper = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../debugWindow.ts', import.meta.url), 'utf8'),
    )
    expect(helper).toContain('win.location.href = made.url')
  })

  /**
   * ★ 组件必须把流程交给 openDebugWindow，而不是自己再写一遍。
   *
   * 这条是为了补上一个假绿：上一版只断言「源码里出现过 openDebugWindow」这个字符串。
   * 把旧的打开流程整段写回组件里，那条断言照样通过 —— 等于没测。
   * 所以这里把 openDebug 的函数体抠出来，逐条看它有没有自己开窗 / 自己导航 / 自己关窗。
   */
  it('★ openDebug 只做注入，不自己开窗/导航/关窗（把流程交给被测函数）', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../UiContent.vue', import.meta.url), 'utf8'),
    )
    // 去掉注释后再抠函数体，避免注释里的解释被当成实现
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const start = code.indexOf('async function openDebug(')
    expect(start, '找不到 openDebug（改名了就要同步改这条测试）').toBeGreaterThan(-1)
    const end = code.indexOf('function clearDebugWindow(')
    expect(end).toBeGreaterThan(start)
    const body = code.slice(start, end)

    // 必须把决策交给那个函数
    expect(body).toContain('await openDebugWindow({')
    // 三条分支的副作用都该由它做，组件里不该再出现
    expect(body).not.toContain('.location.href')
    expect(body).not.toContain('win.close()')
    // 但成功之后那两件「接管窗口」的事必须还在（否则窗口关了不会清引用）
    expect(body).toContain('debugWin.value = win')
    expect(body).toContain("addEventListener('pagehide'")
    expect(body).toContain('clearDebugWindow(win)')
    // 开窗动作只出现在注入进去的回调里（同步执行，不能等 await 之后）
    expect(body).toMatch(/openWindow:\s*\(\)\s*=>/)
    expect(body).toContain('window.open(')
  })

  /**
   * ★ 沙箱 iframe 的消息只认「不透明源」。
   *
   * 只比 `ev.source` 不够：如果那个 iframe 被导航到一个同源页面，`ev.source` 仍然是
   * 同一个 window，页面里的脚本就能冒充沙箱页往节点里写东西。
   */
  it('★ 收沙箱消息时同时校验 origin（同源导航不能冒充沙箱页）', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../UiContent.vue', import.meta.url), 'utf8'),
    )
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(code).toContain("ev.origin !== 'null'")
    expect(code).toContain('window.location.origin')
  })
})

