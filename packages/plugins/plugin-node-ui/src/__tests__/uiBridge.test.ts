/**
 * 往外输出的两条通道（2026-10-13 与用户确认的设计）。
 *
 * 要点：
 *   · 状态 → 可撤销（撤销退一笔，不是退一张图）；
 *   · 产物 → 不进历史 + 覆盖槽位（画一百笔只占一份文件）。
 * 这两条是「撤销不违和」「磁盘不爆炸」的唯一保证，所以拿测试钉住。
 */
import { describe, it, expect } from 'vitest'
import { buildUiBridge, BRIDGE_GLOBAL, UI_GLOBAL } from '../uiData'

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

  it('saveOutput 走**槽位**上传（slot=节点id）—— 这是「一个节点一份文件」的落点', () => {
    expect(js).toContain('/resources?slot=')
    expect(js).toContain('encodeURIComponent(U.nodeId)')
  })

  it('saveOutput 成功后把地址报给宿主（宿主才知道往节点里写什么）', () => {
    expect(js).toContain('type: ' + "'" + 'output' + "'")
    expect(js).toContain('url: j.url')
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
    expect(js).toContain('window[' + JSON.stringify(UI_GLOBAL) + ']')
    expect(js).toContain('U.baseUrl')
    expect(js).toContain('U.canvasId')
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

  it('★ 叫后台干活包成 task()：canvasId/nodeId 自动带上（漏了就 403）', () => {
    expect(js).toContain('task: function(name, methods, args, opts)')
    expect(js).toContain('canvasId: U.canvasId, nodeId: U.nodeId')
  })

  it('★ task 能自己订阅长任务（日志/进度回调 + 终局），并支持取消', () => {
    expect(js).toContain('function watchRun(runId, opts)')
    expect(js).toContain('/api/task/events?runId=')
    expect(js).toContain('opts.onLog')
    expect(js).toContain('opts.onProgress')
    expect(js).toContain('cancel: function(runId)')
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
   * 超采样：`zoom` 和 `body 尺寸` **必须成对出现**。
   *
   * 2026-10-17 的三次真实事故都是「只改一半」造成的：
   *   ① 只改 body 宽高 100/Z% → 内容只占节点左上角一小块；
   *   ② 只设 documentElement.zoom → 排版宽度被放大了 Z 倍，内容看起来缩小、露出大片空白；
   *   ③ 两者都不设 → 撑大 iframe 后页面按 Z 倍宽重排，布局整个变样。
   *
   * 两者配对后：排版宽度 = (原宽 × Z) ÷ Z = 原宽，布局逐像素不变，只是按 Z 倍像素重画。
   * 这条测试锁的是「配对」，不是「禁止」—— 少一个就回退到上面三种错误之一。
   */
  it('★ 超采样必须成对：zoom=Z 与 body 100/Z% 同时存在', () => {
    expect(js).toContain('function applyRasterScale(sc)')
    expect(js).toContain('de.style.zoom = String(z)')
    expect(js).toContain("document.body.style.width = (100 / z)")
    expect(js).toContain("document.body.style.height = (100 / z)")
    // 恢复 1 倍时两者都要清掉，否则留下半套状态
    expect(js).toContain("de.style.zoom = ''")
  })
})

