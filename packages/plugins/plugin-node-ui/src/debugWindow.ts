/**
 * 「调试」按钮的打开流程（从 UiContent.vue 里抽出来，纯粹为了能测）。
 *
 * ## 为什么要抽
 *
 * 这段逻辑有三条分支，而三条都只会在真机上出问题：
 *   1. 弹窗被拦 → 必须给人话提示（不是静默什么都不发生）；
 *   2. 后台没生成出页面（调试源没起来 / 令牌不对）→ 关掉那个空窗口、把原因说出来；
 *   3. 成功 → 把窗口导航到调试源地址。
 *
 * 在组件里它没法直接测（`window.open` 在 headless 里拿不到用户激活，点了也被拦），
 * 而这三条恰恰是「用户点了没反应」这类问题的高发区。所以把决策抽成纯函数、
 * 把副作用（开窗 / alert）由调用方注入。
 *
 * ## 时序（不能改）
 *
 * **先同步开窗口，再异步要地址。** 反过来的话，浏览器会认为那是脚本自己弹窗（没有用户激活），
 * 直接拦掉 —— 用户看到的就是「点了调试没反应」。
 */

/** 本文件需要的窗口形状（只声明真用到的那几个方法） */
export interface DebugWindowLike {
  closed: boolean
  location: { href: string }
  close(): void
  addEventListener?(type: string, fn: () => void): void
}

export type OpenDebugResult =
  /** 窗口被浏览器拦了（用户得允许弹窗） */
  | { ok: false; reason: 'blocked'; message: string }
  /** 后台没生成出调试页 */
  | { ok: false; reason: 'docs-failed'; message: string }
  /** 窗口开了但导航失败（窗口已经被关掉等） */
  | { ok: false; reason: 'navigate-failed'; message: string }
  | { ok: true; win: DebugWindowLike; url: string }

export interface OpenDebugDeps {
  /** 同步开一个空窗口；被拦返回 null */
  openWindow(): DebugWindowLike | null
  /** 向后台要调试页地址；失败返回 error 文案 */
  fetchDocUrl(): Promise<{ ok: true; url: string } | { ok: false; error: string }>
  /** 给用户看的提示（组件里是 window.alert） */
  alert(message: string): void
}

export const DEBUG_BLOCKED_MESSAGE =
  '调试窗口被浏览器拦住了。请允许这个站点弹窗，然后再点一次「调试」。'

export async function openDebugWindow(deps: OpenDebugDeps): Promise<OpenDebugResult> {
  // ① 先开窗：必须在这一拍同步完成，否则拿不到用户激活
  const win = deps.openWindow()
  if (!win) {
    deps.alert(DEBUG_BLOCKED_MESSAGE)
    return { ok: false, reason: 'blocked', message: DEBUG_BLOCKED_MESSAGE }
  }

  // ② 再要地址（这一步是异步的：写文件 + 签短令牌）
  const made = await deps.fetchDocUrl()
  if (!made.ok) {
    // 那个空窗口不能留着：用户会以为「调试页就是这个空白」
    try {
      win.close()
    } catch {
      /* 已经关了 */
    }
    deps.alert(made.error)
    return { ok: false, reason: 'docs-failed', message: made.error }
  }

  // ③ 导航过去
  try {
    win.location.href = made.url
  } catch {
    const message = '调试页打不开（窗口可能被关掉了）。再点一次「调试」试试。'
    deps.alert(message)
    return { ok: false, reason: 'navigate-failed', message }
  }
  return { ok: true, win, url: made.url }
}
