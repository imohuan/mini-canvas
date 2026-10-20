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
    expect(js).toContain('if (!r.ok) throw')
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
