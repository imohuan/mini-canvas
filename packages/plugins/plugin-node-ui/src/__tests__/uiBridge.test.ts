/**
 * 往外输出的两条通道（2026-10-13 与用户确认的设计）。
 *
 * 要点：
 *   · 状态 → 可撤销（撤销退一笔，不是退一张图）；
 *   · 产物 → 不进历史 + 覆盖槽位（画一百笔只占一份文件）。
 * 这两条是「撤销不违和」「磁盘不爆炸」的唯一保证，所以拿测试钉住。
 */
import { describe, it, expect } from 'vitest'
import { buildUiBridge, BRIDGE_GLOBAL } from '../uiData'

describe('注入给页面的助手（window.CanvasUI）', () => {
  const js = buildUiBridge()

  it('注入了这个全局对象', () => {
    expect(BRIDGE_GLOBAL).toBe('CanvasUI')
    expect(js).toContain('window[' + JSON.stringify(BRIDGE_GLOBAL) + ']')
  })

  it('五个方法都在（交参数 / 收变化 / 交产物 / 叫后台 / 取消）', () => {
    expect(js).toContain('setInputs:')
    expect(js).toContain('onChange:')
    expect(js).toContain('save:')
    expect(js).toContain('task:')
    expect(js).toContain('cancel:')
  })

  it('commit 发的消息带 __canvasUi 标记与 state（宿主靠它区分自家消息）', () => {
    expect(js).toContain('__canvasUi: 1')
    expect(js).toContain('type: ' + "'" + 'state' + "'")
  })

  /**
   * ★ 沙箱 iframe 不再自己请求后台（2026-10-20 commit 1）。
   *
   * 不透明源的请求全是 `Origin: null`，后台的请求边界没法把它和恶意网页区分开；
   * 管理令牌也不能交给生成物。所以 save 只把字节交给宿主，由宿主带令牌上传。
   */
  it('★ save 不再自己上传：没有 /api/canvases/、没有 fetch，只发 save 请求', () => {
    expect(js).not.toContain('/api/canvases/')
    expect(js).not.toContain('/resources?slot=')
    expect(js).not.toContain('fetch(')
    expect(js).toContain("call('save'")
    expect(js).toContain('payload: bytes')
    expect(js).toContain('reqId')
  })

  it('save 成功后把地址报给宿主（宿主才知道往节点里写什么）', () => {
    expect(js).toContain('type: ' + "'" + 'output' + "'")
    expect(js).toContain('url: j.url')
    // 回包按 reqId 结算：宿主回 save-result / task-result 都走同一个 settle
    expect(js).toContain('function settle(m)')
    expect(js).toContain('pending[m.reqId]')
  })

  /**
   * 文本要连**正文**一起报上去。
   *
   * 下游（底栏素材区 / 文本节点）读的 `data.text` 是**内容**，不是地址 ——
   * 只报 url 的话，宿主只能把地址放进 data.text（下游把地址当正文）或按扩展名
   * 塞进 imageUrl（那是纯错）。脚本侧 ctx.save 已经是「text 写正文」，两边必须一致。
   */
  it('★ save 把字符串正文一起报给宿主（text 字段要的是内容）', () => {
    expect(js).toContain('text: (typeof data === ')
  })

  it('onCommand 只认来自 parent 的指令（不认别人的消息）', () => {
    expect(js).toContain('e.source !== parent')
    expect(js).toContain('__canvasUiCmd')
  })

  it('读的是同一份注入数据（baseUrl / canvasId / nodeId 都从 __CANVAS_UI__ 取）', () => {
    // 页面侧不再需要 baseUrl / canvasId / nodeId —— 宿主代发时自己带。
    // UI_GLOBAL 仍由 bootstrap 注入，页面数据照旧从它读。
    expect(js).not.toContain('U.baseUrl')
    expect(js).not.toContain('U.canvasId')
    expect(js).not.toContain('U.nodeId')
  })

  it('页面一跑起来就主动报到（type:ready）—— 宿主靠它决定什么时候送状态', () => {
    // 没有报到，宿主只能靠 iframe 的 load 猜时机：消息早于页面建好监听发出去就是白发，
    // 表现为「刷新后数据在、笔迹回不来」。报到由页面在同步脚本里发出，必然已能收消息。
    expect(js).toContain("type: 'ready'")
    expect(js).toContain('ready();')
    expect(js).toContain('DOMContentLoaded')
  })

  /**
   * 前端与后台是同一个能力的两半。**命名必须一样**：
   * 脚本侧叫 ctx.save，前端却叫 saveOutput 的话，手册要解释两遍、AI 也容易记混。
   */
  it('★ 交产物就叫 save（与脚本侧 ctx.save 同名）；**不留旧名字**', () => {
    expect(js).toContain('save: function(data, name)')
    // 用户要求：不留任何兼容手段
    expect(js).not.toContain('saveOutput')
    expect(js).not.toContain('commit:')
    expect(js).not.toContain('onCommand')
  })

  it('★ save 收字符串（文本不用自己 new Blob）', () => {
    expect(js).toContain("typeof data === 'string'")
    expect(js).toContain('new Blob([data]')
  })

  it('★ 叫后台干活包成 task()：canvasId/nodeId 由宿主带上（漏了就 403）', () => {
    expect(js).toContain('task: function(name, methods, args, opts)')
    expect(js).toContain("call('task'")
    expect(js).not.toContain('/api/task/call')
  })

  it('★ task 的日志/进度由宿主订阅 SSE 转回（页面不收 EventSource）', () => {
    expect(js).not.toContain('new EventSource')
    expect(js).not.toContain('/api/task/events')
    expect(js).toContain("d.type === 'task-event'")
    expect(js).toContain('onTaskEvent')
    expect(js).toContain('opts.onLog')
    expect(js).toContain('opts.onProgress')
  })

  it('★ cancel 也走宿主（task-cancel），不再自己 POST', () => {
    expect(js).toContain('cancel: function(runId)')
    expect(js).toContain("call('task-cancel'")
    expect(js).not.toContain('/api/task/cancel')
  })

  /**
   * 旧版 task 的 opts.signal 只有一个语义：**不再等这次调用**（resolve 成 cancelled），
   * 不替调用方去杀后台进程（真要杀得自己调 cancel）。改了实现也要保住这条。
   */
  it('★ opts.signal 中止仍然 resolve 成 cancelled（不 reject、不假装成功）', () => {
    expect(js).toContain("hooks.signal.addEventListener('abort'")
    expect(js).toContain("state: 'cancelled'")
  })

  /**
   * 外面给界面的数据变了（上游素材 / 输入参数）—— **不再重挂 iframe**。
   *
   * 用户口径（2026-10-13）：这跟"状态被退回"对界面来说是同一件事（有数据变了 → 重画），
   * 所以接口就一个 onChange，不拆两个。
   */
  it('★ onChange：上游 / 参数变了走消息（不再重开页面，用户输入不丢）', () => {
    expect(js).toContain('onChange: function(fn)')
    expect(js).toContain("d.type === 'data'")
    // 只有两样：上游 + 参数（"状态"就是参数的一种，用户 2026-10-13 的口径）
    expect(js).toContain('upstream: d.upstream, inputs: d.inputs')
  })

  it('生成的桥代码是**合法 JS**（拼字符串最容易写出语法错，且真机上只会白屏）', () => {
    // 去掉 <script> 外壳，把里面的代码交给 Function 构造——语法错会在这里抛
    const body = js.replace(/^<script>\n?/, '').replace(/<\/script>$/, '')
    expect(() => new Function(body)).not.toThrow()
  })

  it('指令分发先判 e.source===parent（只有宿主能下发）', () => {
    expect(js).toContain('e.source !== parent')
    expect(js).toContain('cmdHandlers.push(function(d)')
  })

  /**
   * 页面里**一律不许碰文档级缩放**（zoom / body 尺寸）。
   *
   * 2026-10-17 两次真实事故，都是往这里加代码造成的：
   *   ① 把 body 写成 100/Z% → 内容只占节点左上角一小块；
   *   ② 把 documentElement.zoom 设成 Z → 字号被放大两次，比不处理还糊。
   * 现在的做法只在宿主侧改 iframe **元素**的宽高与 transform（撑大再缩回），
   * 文档内部保持默认，于是内容按真实屏幕尺寸排版、栅格 1:1（与 Slidev PR #2728 同一判据）。
   */
  it('★ 桥代码不许碰文档级缩放（zoom / body 尺寸）', () => {
    expect(js).not.toContain('documentElement.style.zoom')
    expect(js).not.toContain('body.style.width')
    expect(js).not.toContain('body.style.height')
  })
})

