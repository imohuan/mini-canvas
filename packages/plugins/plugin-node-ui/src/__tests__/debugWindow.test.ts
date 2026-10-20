/**
 * 「调试」按钮的打开流程（三条分支）。
 *
 * 为什么单测而不是只靠真机：headless 里 `Input.dispatchMouseEvent` 造出来的点击不算
 * 用户激活，`window.open` 一律被拦，没法自动跑通按钮那条路。这三条分支恰恰是
 * 「用户点了没反应」的高发区，所以抽成纯函数直接钉住。
 */
import { describe, expect, it, vi } from 'vitest'
import { DEBUG_BLOCKED_MESSAGE, openDebugWindow, type DebugWindowLike } from '../debugWindow'

function fakeWindow(): DebugWindowLike & { closed: boolean; location: { href: string } } {
  return {
    closed: false,
    location: { href: 'about:blank' },
    close() {
      this.closed = true
    },
  }
}

describe('调试窗口：先开窗，再要地址', () => {
  it('★ 成功：窗口导航到后台给的地址，且**先开窗再取地址**', async () => {
    const win = fakeWindow()
    const order: string[] = []
    const r = await openDebugWindow({
      openWindow: () => {
        order.push('open')
        return win
      },
      fetchDocUrl: async () => {
        order.push('fetch')
        return { ok: true, url: 'http://127.0.0.1:9999/c1/debug-7.html' }
      },
      alert: () => order.push('alert'),
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.url).toContain('debug-7.html')
    expect(win.location.href).toBe('http://127.0.0.1:9999/c1/debug-7.html')
    // 顺序是硬要求：反过来的话，浏览器会认为那是脚本自己弹窗、直接拦掉
    expect(order).toEqual(['open', 'fetch'])
    expect(win.closed).toBe(false)
  })

  it('弹窗被拦：给人话提示，不去请求后台', async () => {
    const fetchDocUrl = vi.fn(async () => ({ ok: true as const, url: 'http://x/y.html' }))
    const alerts: string[] = []
    const r = await openDebugWindow({
      openWindow: () => null,
      fetchDocUrl,
      alert: (m) => alerts.push(m),
    })
    expect(r).toMatchObject({ ok: false, reason: 'blocked' })
    expect(alerts).toEqual([DEBUG_BLOCKED_MESSAGE])
    expect(fetchDocUrl).not.toHaveBeenCalled()
  })

  it('★ 后台没生成出页面：把那个空窗口关掉，并把原因说出来', async () => {
    const win = fakeWindow()
    const alerts: string[] = []
    const r = await openDebugWindow({
      openWindow: () => win,
      fetchDocUrl: async () => ({ ok: false, error: '调试源没起来' }),
      alert: (m) => alerts.push(m),
    })
    expect(r).toMatchObject({ ok: false, reason: 'docs-failed' })
    // 留着一个空白窗口会让用户以为「调试页就是这个空白」
    expect(win.closed).toBe(true)
    expect(alerts).toEqual(['调试源没起来'])
  })

  it('窗口在取地址期间被用户关掉：导航失败也给提示，不抛', async () => {
    const win = fakeWindow()
    let alerts = 0
    const r = await openDebugWindow({
      openWindow: () => ({
        get closed() { return true },
        get location(): { href: string } {
          throw new Error('window is closed')
        },
        close() {},
      }),
      fetchDocUrl: async () => ({ ok: true, url: 'http://x/y.html' }),
      alert: () => { alerts++; win.close() },
    })
    expect(r).toMatchObject({ ok: false, reason: 'navigate-failed' })
    expect(alerts).toBe(1)
  })
})
