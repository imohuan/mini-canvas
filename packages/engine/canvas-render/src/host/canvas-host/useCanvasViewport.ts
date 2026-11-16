import { watch, type Ref } from 'vue'
import { GRAPH_VIEWPORT_KEY } from '@plume-canvas/canvas-data'
import { FIRST_RUN_FIT_RETRY_DELAYS, STARTUP_FOCUS_WINDOW_MS } from '../canvasHostCore'
import type { CanvasHostHandle } from '../createPlumeHost'
import type { CanvasSurfaceHandle } from './types'

/**
 * 画布视口：**启动只取景，不恢复存档视口**（用户口径 2026-11-16）。
 *
 * 以前这里做的是「恢复上次停的位置」：挂载时读 graph-viewport，有就 setViewport。
 * 它有两个实际问题：
 *   ① 装着云端插件时，cloud-client 恢复完云端画布还会**再写一次**服务器上的视口 ——
 *      同一次启动恢复两次，画面会跳，而且很多次两边都不在好看的构图上；
 *   ② 存档视口是当时那块窗口/抽屉状态下的构图，换屏幕尺寸或换一张画布就框不到内容。
 *
 * 现在：启动统一按**全部节点**取景（view.focusAll，与 F 键同一条算法）。
 * 云端用服务器画布覆盖本地之后，由 cloud-client 显式再取景一次 —— 始终只有一种「聚焦全部」。
 *
 * ★ 为什么取景要跟着 VueFlow 重挂反复补做，而不是「只做一次」：
 *   插件装/卸会 bump nodeEpoch，VueFlow 整棵树销毁重建，新实例的视口回到 {0,0,1}。
 *   冷启动时外部插件是**陆续**装进来的，实测「先取好景 → 再接一个插件重挂 → 画面回到左上角」。
 *   所以在启动窗口期（STARTUP_FOCUS_WINDOW_MS）内，每次画布重新挂上都重新取景一次；
 *   窗口结束或用户自己动了视口，就彻底停手，不再打扰用户。
 *
 * 视口仍然落盘（平移/缩放结束后写 graph-viewport）：云端留一份记录供诊断，
 * 但启动不再读它。
 */
export function useCanvasViewport(opts: {
  hostRef: { value: CanvasHostHandle | undefined }
  surfaceRef: Ref<CanvasSurfaceHandle | undefined>
  persistViewport: () => boolean
  /** VueFlow 整树重挂信号（插件装/卸 bump nodeEpoch）；重挂后视口会被重置 */
  remountSignal?: () => number
}) {
  const { hostRef, surfaceRef } = opts
  let stopViewportWatch: (() => void) | undefined
  let viewportTimers: ReturnType<typeof setTimeout>[] = []
  /** 启动取景窗口的截止时刻（毫秒时间戳）；窗口内允许因重挂补做 */
  let startupWindowUntil = 0
  /** 用户是否在启动窗口期内亲手动过视口：动过就永久不再自动取景 */
  let userMovedViewport = false
  /** 取景轮次：每次挂载 / 重挂 +1，旧轮次的重试自动作废（不再互相覆盖） */
  let focusRound = 0

  function clearTimers(): void {
    for (const t of viewportTimers) clearTimeout(t)
    viewportTimers = []
  }

  function startupFocusActive(): boolean {
    return !userMovedViewport && Date.now() < startupWindowUntil
  }

  /**
   * 对当前挂载的画布取一次景，带重试等几何就绪。
   *
   * 为什么要重试：节点尺寸来自 node.size，但 VueFlow 要先量到容器与节点 DOM 才算得出
   * 真实构图；冷启动第一帧量到 0×0 时算出来的缩放会把内容压扁。
   * 判据用 focusAll 的返回值 —— 它只在「真的移动了视图」时返回 true。
   *
   * ★ 为什么第一轮要等两帧再动手（而不是立刻取景）：
   *   VueFlow 内部的 Pane 组件在**它自己的 onMounted** 里用 defaultViewport 强制
   *   d3Zoom.transform(...) 把视口重置成 {0,0,1}，而子组件的 mounted 晚于父组件。
   *   本函数若在同一 tick 直接取景，就会被那次重置覆盖
   *   （实测：取景算出 zoom 1.55，400ms 后画面回到 100%、贴左上角）。
   *   等两帧（rAF → rAF）确保这棵树全部 mounted 完，再取景才是最终值；
   *   focusAll 在视图未就绪时返回 false，之后会按 retry 节奏继续尝试。
   */
  function focusSurface(surface: CanvasSurfaceHandle, waitFrames = true): void {
    const delays = FIRST_RUN_FIT_RETRY_DELAYS
    let k = 0
    const round = ++focusRound
    clearTimers()
    const attempt = (): void => {
      const h = hostRef.value
      // 期间画布又重挂了 / 用户动手了：本轮作废，交给新的那一轮
      if (!h || round !== focusRound || surfaceRef.value !== surface || !startupFocusActive()) return
      if (h.view.focusAll()) {
        // 把这次取景落盘：云端那份「上次位置」也跟着对齐，不会停在一个没人看过的旧构图
        h.save.set(GRAPH_VIEWPORT_KEY, h.view.getViewport(), 'canvas')
        return
      }
      if (k >= delays.length) return
      viewportTimers.push(setTimeout(attempt, delays[k]))
      k++
    }
    // 两帧后再算：先让当前这棵树挂完；如果 VueFlow 的 Pane 还在挂载（d3Zoom 未就绪），
    // 再等下一次重试 —— focusAll 在未就绪时返回 false，不会把画面写成半成品。
    if (!waitFrames) return attempt()
    requestAnimationFrame(() => requestAnimationFrame(attempt))
  }

  /** 移动/缩放结束：把当前 viewport 落盘(与 graph 同走 save，防抖 flush 统一；读视口统一走 viewport 服务) */
  function persistViewport(): void {
    const h = hostRef.value
    if (!h) return
    h.save.set(GRAPH_VIEWPORT_KEY, h.view.getViewport(), 'canvas')
  }

  /**
   * 用户亲手平移/缩放（onMoveStart）：停止启动阶段的自动取景。
   *
   * 程序自己写视口不会触发 move-start（VueFlow 的 move 事件只在用户手势里发），
   * 所以这条信号就代表「用户开始接管视野」。
   */
  function markUserMoved(): void {
    userMovedViewport = true
    clearTimers()
  }

  function bindViewportRestore(): void {
    startupWindowUntil = Date.now() + STARTUP_FOCUS_WINDOW_MS
    // immediate：watch 默认**不**跑首次值。本函数在 setup 里调用，而 CanvasSurface 可能已经挂上
    // （重进画布、或者挂载比这一行更快），不立即检查就永远收不到那次变化。
    stopViewportWatch = watch(
      surfaceRef,
      (surface) => {
        if (!surface || !hostRef.value || !opts.persistViewport()) return
        // 启动窗口结束 / 用户已接管 → 不再自动取景（之后重挂保持 VueFlow 自己的视口）
        if (!startupFocusActive()) return
        focusSurface(surface)
      },
      { immediate: true },
    )
    /*
     * VueFlow 整树重挂（插件装/卸 → nodeEpoch 变化）后视口回到默认值。
     *
     * 为什么必须单独监听：重挂发生在 CanvasSurface **内部**（VueFlow 带 key），
     * surfaceRef 这个句柄不会变 —— 只监听 surfaceRef 就永远收不到「重挂」这件事，
     * 表现就是取景一次、随后被后续插件装载的重挂抹掉（实测：8 节点取景成功 → 重挂 → 100% 贴左上角）。
     * 每次重挂都按当前图重新取景（轮次号自增，上一轮还没落定的重试自动作废）。
     */
    if (opts.remountSignal) {
      watch(
        opts.remountSignal,
        () => {
          const surface = surfaceRef.value
          if (!surface || !hostRef.value || !opts.persistViewport()) return
          if (!startupFocusActive()) return
          focusSurface(surface)
        },
        { flush: 'post' },
      )
    }
  }

  function dispose(): void {
    stopViewportWatch?.()
    clearTimers()
  }

  return {
    fitViewFirstRun: () => {
      const surface = surfaceRef.value
      if (surface) focusSurface(surface)
    },
    persistViewport,
    bindViewportRestore,
    markUserMoved,
    dispose,
  }
}
