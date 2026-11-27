/**
 * ★ 主题切换只改注入值，**不重建文档**（2026-11-27 用户实测报的 bug）。
 *
 * 用户原话：「切换主题色的时候，你的可视化节点被重构了（内部强制刷新重载了）」。
 *
 * 这条测试把桥接脚本**真的跑一遍**（在一个最小的假 DOM 里），验证它会：
 *   ① 把 __CANVAS_UI__.theme 改成新值（"现读全局变量"的界面跟着变）；
 *   ② 把 <html data-theme> 改成新值（"写 CSS 属性选择器"的界面跟着变）；
 *   ③ 滚动条那两格颜色一起更新；
 *   ④ 交参数时不会把主题区域覆盖掉（合并而不是替换）。
 *
 * 为什么不能只断言"字符串里有这段代码"：那种测试挡不住逻辑写反、变量写错。
 * 这个 bug 的代价是用户正在填的内容全丢，值得跑真脚本。
 */
import { describe, it, expect } from 'vitest'
import { BRIDGE_GLOBAL, buildUiBridge, INPUTS_GLOBAL, UI_GLOBAL, UPSTREAM_GLOBAL } from '../uiData'

/** 从桥接产物里取出脚本正文（外面包着 <script> 标签） */
function bridgeBody(): string {
  const src = buildUiBridge()
  const m = /<script>([\s\S]*)<\/script>/.exec(src)
  if (!m) throw new Error('桥接产物里没有 script 正文')
  return m[1]
}

/**
 * 在一个最小假环境里跑桥接脚本，返回可操作的手柄。
 *
 * 只造脚本真正用到的东西：window 的 message 监听、parent.postMessage、
 * document.documentElement 的 setAttribute / style.setProperty。
 */
function runBridge(): {
  deliver: (data: Record<string, unknown>) => void
  html: { attrs: Record<string, string>; style: Record<string, string> }
  ui: () => Record<string, unknown>
  bridge: () => { onChange(fn: (d: Record<string, unknown>) => void): void }
  posted: Array<Record<string, unknown>>
} {
  const listeners: Array<(e: { source: unknown; data: unknown }) => void> = []
  const posted: Array<Record<string, unknown>> = []
  const attrs: Record<string, string> = { 'data-theme': 'light' }
  const style: Record<string, string> = {}

  const win: Record<string, unknown> = {
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      if (type === 'message') listeners.push(fn as (e: { source: unknown; data: unknown }) => void)
    },
    postMessage: (msg: Record<string, unknown>) => posted.push(msg),
  }
  win[UI_GLOBAL] = { theme: 'light', baseUrl: '', canvasId: 'c1', nodeId: 'n1' }
  win[INPUTS_GLOBAL] = {}
  win[UPSTREAM_GLOBAL] = []

  const doc = {
    readyState: 'complete',
    documentElement: {
      setAttribute: (k: string, v: string) => {
        attrs[k] = v
      },
      style: { setProperty: (k: string, v: string) => (style[k] = v) },
    },
    addEventListener: () => undefined,
  }

  // parent 就是宿主窗口：桥接脚本一跑起来就 post 一条 ready 报到
  const parent = { postMessage: (msg: Record<string, unknown>) => posted.push(msg) }
  const fn = new Function('window', 'document', 'parent', bridgeBody())
  fn(win, doc, parent)

  return {
    deliver: (data) => {
      // e.source 必须是宿主窗口：桥接脚本开头就挡掉了非 parent 的消息
      for (const fn of listeners) fn({ source: parent, data })
    },
    html: { attrs, style },
    ui: () => win[UI_GLOBAL] as Record<string, unknown>,
    bridge: () => win[BRIDGE_GLOBAL] as { onChange(fn: (d: Record<string, unknown>) => void): void },
    posted,
  }
}

describe('★ 切主题不重建文档：桥接脚本实跑', () => {
  it('data 消息里的 ui.theme 会同时改全局与 <html data-theme>', () => {
    const b = runBridge()
    expect(b.ui().theme).toBe('light')
    expect(b.html.attrs['data-theme']).toBe('light')

    b.deliver({
      __canvasUiCmd: 1,
      type: 'data',
      upstream: [],
      inputs: {},
      ui: { theme: 'dark' },
    })

    expect(b.ui().theme).toBe('dark')
    expect(b.html.attrs['data-theme']).toBe('dark')
  })

  it('滚动条那两格颜色跟着消息走（壳的 CSS 用 var() 读它们）', () => {
    const b = runBridge()
    b.deliver({
      __canvasUiCmd: 1,
      type: 'data',
      upstream: [],
      inputs: {},
      ui: { theme: 'dark' },
      scrollThumb: 'rgb(255 255 255 / 0.16)',
      scrollThumbHover: 'rgb(255 255 255 / 0.26)',
    })
    expect(b.html.style['--ui-scroll-thumb']).toBe('rgb(255 255 255 / 0.16)')
    expect(b.html.style['--ui-scroll-thumb-hover']).toBe('rgb(255 255 255 / 0.26)')
  })

  it('★ 只送参数时不碰主题（合并语义：各传各的，互不覆盖）', () => {
    const b = runBridge()
    // 先切到暗色
    b.deliver({ __canvasUiCmd: 1, type: 'data', upstream: [], inputs: {}, ui: { theme: 'dark' } })
    // 再只交参数（界面上一次操作完成时会发生）—— 主题不能被冲回亮色
    b.deliver({ __canvasUiCmd: 1, type: 'data', upstream: [], inputs: { size: 64 } })
    expect(b.ui().theme).toBe('dark')
    expect((b.ui() as Record<string, unknown>).canvasId).toBe('c1')
  })

  /**
   * 主题变化也会走到 onChange（界面习惯在回调里统一重画）。
   * 这条不要求界面"专门为主题写分支"——它只是把新数据照样递过去，
   * 界面现读全局就会拿到新主题。
   */
  it('主题变化照常触发 onChange，回调里读到的全局已是新值', () => {
    const b = runBridge()
    const seen: Array<string> = []
    b.bridge().onChange(() => {
      seen.push(String(b.ui().theme))
    })
    b.deliver({ __canvasUiCmd: 1, type: 'data', upstream: [], inputs: {}, ui: { theme: 'dark' } })
    expect(seen).toEqual(['dark'])
  })
})
