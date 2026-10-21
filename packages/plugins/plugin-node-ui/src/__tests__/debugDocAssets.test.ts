/**
 * 独立调试页的 sdk.js 契约（审查 S5）。
 *
 * 这条链上有两个容易写错的地方，都会"测试全绿、真机全坏"：
 *   1. 上传产物带的是哪个令牌 —— 调试页在**另一个源**，绝不能碰管理令牌；
 *   2. 数据怎么拉 —— 跨源 fetch 会被 CORS 挡，只能靠 <script> 重载。
 */
import { describe, it, expect } from 'vitest'
import { renderSdkJs, SDK_JS_TEMPLATE } from '../debugDocAssets'

const js = renderSdkJs('http://127.0.0.1:9001/c1/context-7.js')

describe('调试页 sdk：上传只带节点令牌', () => {
  it('★ 带 x-task-token，且不碰 x-admin-token', () => {
    expect(js).toContain('x-task-token')
    expect(js).toContain('U.debugToken')
    expect(js).not.toContain('x-admin-token')
  })

  it('没有令牌时给出人话错误（不是静默 403）', () => {
    expect(js).toContain('没有写入令牌')
  })

  it('上传地址仍是本节点的资源槽位', () => {
    expect(js).toContain("\"/api/canvases/\"")
    expect(js).toContain('"/resources?slot="')
  })

  it('HTTP 非 2xx 会抛带状态码的错误（不再把 403 当成功）', () => {
    expect(js).toContain('HTTP ')
    expect(js).toContain('if (!r.ok) {')
  })

  it('★ 403 时通知画布重签令牌（页面开久了令牌会过期）', () => {
    expect(js).toContain('r.status === 403')
    expect(js).toContain('token-stale')
  })
})

describe('调试页 sdk：数据靠 <script> 重载（跨源不能 fetch）', () => {
  it('★ 不再 fetch context.js', () => {
    expect(js).not.toContain('fetch(CONTEXT_URL')
    expect(js).not.toContain('new Function')
  })

  it('★ 用动态 script 标签加载 context，并加时间戳破缓存', () => {
    expect(js).toContain('createElement("script")')
    expect(js).toContain('s.src = CONTEXT_URL')
    expect(js).toContain('Date.now()')
    expect(js).toContain('s.onload')
  })

  it('加载成功后触发 onChange；失败只 warn，不打断界面', () => {
    expect(js).toContain('fireChange()')
    expect(js).toContain('console.warn')
  })

  it('★ 数据没变就不触发 onChange（否则每 5 秒白重绘一次）', () => {
    expect(js).toContain('JSON.stringify(collect()) !== before')
  })

  it('5 秒轮询还在（这是"改完内容自动刷新"的唯一来源）', () => {
    expect(js).toContain('setInterval(reloadContext, 5000)')
  })

  it('占位符被替换成真实地址，模板里不残留 __CONTEXT_URL__', () => {
    expect(js).toContain('http://127.0.0.1:9001/c1/context-7.js')
    expect(SDK_JS_TEMPLATE).toContain('__CONTEXT_URL__')
    expect(js).not.toContain('__CONTEXT_URL__')
  })

  it('★ 生成的 sdk 是合法 JS（拼字符串最容易写出语法错）', () => {
    expect(() => new Function(js)).not.toThrow()
  })
})

/**
 * 审查 N3：调试页的 CanvasUI 少了 api / task / cancel。
 *
 * 这个页面的意义就是「同一份节点代码、可断点」；少这三个方法，很多节点
 * 拷过来第一行就是 `TypeError: CanvasUI.task is not a function`。
 * 它们都走宿主代发（与画布里的沙箱页共用同一套权限表），这里只验形状。
 */
describe('调试页 sdk：与画布里同一套方法', () => {
  it('★ 有 api / task / cancel，且都走宿主（不自己打后台）', () => {
    expect(js).toContain('api: function(path, init)')
    expect(js).toContain('task: function(name, methods, args, opts)')
    expect(js).toContain('cancel: function(runId)')
    expect(js).toContain('hostCall("api"')
    expect(js).toContain('hostCall("task"')
    expect(js).toContain('hostCall("task-cancel"')
    // 关键：不自己拼后台地址（那会绕过来源边界与令牌）
    expect(js).not.toContain('/api/task/call')
    // api / task 的请求体只可能是消息，不该出现 fetch 的 init 形状
    expect(js).not.toContain('method: "POST", headers: { "content-type": "application/json" }')
  })

  it('★ api 的回包形状接近 fetch（ok / status / headers.get / text / json / arrayBuffer）', () => {
    for (const k of ['ok:', 'status:', 'headers:', 'text:', 'json:', 'arrayBuffer:']) {
      expect(js).toContain(k)
    }
    expect(js).toContain('headers: { get: function(k)')
  })

  it('★ task 的日志/进度走 onEvent（与画布里那份同名）', () => {
    expect(js).toContain('opts.onLog')
    expect(js).toContain('opts.onProgress')
    expect(js).toContain('task-event')
  })

  /**
   * 宿主不回包（画布页崩了 / 没人在听）时，api / cancel 不能永远挂着。
   * task 的超时要长得多（15 分钟）：脚本本来就可能跑十分钟，但不能永远挂着 ——
   * 宿主整页崩掉时（画布关掉 / 崩了）没有任何人会回包。
   */
  it('★ api / cancel 30 秒、task 15 分钟（都不会永远挂着）', () => {
    expect(js).toContain('timeoutMs: 30000')
    expect(js).toContain('15 * 60 * 1000')
    const taskCall = js.slice(js.indexOf('hostCall("task"'), js.indexOf('hostCall("task"') + 600)
    expect(taskCall).toContain('timeoutMs')
  })
})
