import { watch, type Ref } from 'vue'
import { GRAPH_VIEWPORT_KEY } from '@plume-canvas/canvas-data'
import { FIRST_RUN_FIT_RETRY_DELAYS } from '../canvasHostCore'
import type { CanvasHostHandle } from '../createPlumeHost'
import type { ViewportState } from '../../viewport/viewportService'
import type { CanvasSurfaceHandle } from './types'

/** 重挂后恢复视野的最长重试时间（覆盖 VueFlow Pane 挂载时的那次默认视口强写） */
export const RESTORE_VIEWPORT_TIMEOUT_MS = 1500

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
  /** 画布就绪闸门：等插件声明的异步初始化落地后再取景（同步插件不受影响） */
  readiness?: { wait(): Promise<void>; close(): void }
}) {
  const { hostRef, surfaceRef } = opts
  let stopViewportWatch: (() => void) | undefined
  let viewportTimers: ReturnType<typeof setTimeout>[] = []
  /**
   * 启动取景是否**已经完成**（用户口径 2026-11-16）。
   *
   * 只取景一次：等就绪闸门（异步插件初始化）落地后按全部节点取景，之后再也不自动动视野。
   * 之后再来的插件（画布已呈现后用户手动装）、重挂、云端合并，都用「记住并恢复」代替重新取景。
   */
  let startupFocusDone = false
  /** 用户是否亲手动过视口：动过就永久不再自动取景 */
  let userMovedViewport = false
  /** 上一次程序设定 / 用户确认的视口：重挂或后续数据变更后原样恢复 */
  let lastViewport: ViewportState | undefined
  /** 取景轮次：每次挂载 / 重挂 +1，旧轮次的重试自动作废（不再互相覆盖） */
  let focusRound = 0

  function clearTimers(): void {
    for (const t of viewportTimers) clearTimeout(t)
    viewportTimers = []
  }

  function startupFocusActive(): boolean {
    return !userMovedViewport && !startupFocusDone
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
        lastViewport = h.view.getViewport()
        startupFocusDone = true
        opts.readiness?.close()
        // 把这次取景落盘：云端那份「上次位置」也跟着对齐，不会停在一个没人看过的旧构图
        h.save.set(GRAPH_VIEWPORT_KEY, lastViewport, 'canvas')
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
    lastViewport = h.view.getViewport()
    h.save.set(GRAPH_VIEWPORT_KEY, lastViewport, 'canvas')
  }

  /**
   * 把上次的视野原样恢复（重挂后 / 启动取景完成后数据又变）。
   *
   * 为什么不重新取景：用户口径 2026-11-16 —— 启动只取景一次。之后再动视野就变成了
   * 「又聚焦一遍」，画面会跳；记录并恢复用户看到的视野才是正确的补充方式。
   *
   * ★ 为什么带重试 + 校验：VueFlow 重挂时，它内部的 Pane 会在**自己的 onMounted** 里
   * 用 defaultViewport 强写一次 {0,0,1}。如果我们在重挂那一刻就写，会被它随后覆盖掉
   * （实测：恢复后 200ms 又回到 100%）。所以一直重试到「写进去的视野确实还在」或超时为止。
   */
  function restoreViewport(): void {
    const target = lastViewport
    if (!target) return
    const deadline = Date.now() + RESTORE_VIEWPORT_TIMEOUT_MS
    const tick = (): void => {
      const h = hostRef.value
      if (!h || userMovedViewport || lastViewport !== target) return
      const cur = h.view.getViewport()
      const same =
        Math.abs(cur.x - target.x) < 0.5 &&
        Math.abs(cur.y - target.y) < 0.5 &&
        Math.abs(cur.zoom - target.zoom) < 1e-4
      if (same) return
      h.view.setViewport(target)
      if (Date.now() >= deadline) return
      viewportTimers.push(setTimeout(tick, 120))
    }
    tick()
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
    // 用户已经接管视野：闸门关掉，之后不再等插件初始化，也不再自动取景
    opts.readiness?.close()
  }

  function bindViewportRestore(): void {
    // immediate：watch 默认**不**跑首次值。本函数在 setup 里调用，而 CanvasSurface 可能已经挂上
    // （重进画布、或者挂载比这一行更快），不立即检查就永远收不到那次变化。
    stopViewportWatch = watch(
      surfaceRef,
      (surface) => {
        if (!surface || !hostRef.value || !opts.persistViewport()) return
        // 启动取景已经做完 / 用户已接管 → 重挂后把上次的视野原样还回去，不再重新取景
        if (!startupFocusActive()) return restoreViewport()
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
     * 启动阶段按当前图取景；启动取景完成之后只**恢复**上次视野，不再重新取景（不产生第二次取景）。
     */
    if (opts.remountSignal) {
      watch(
        opts.remountSignal,
        () => {
          const surface = surfaceRef.value
          if (!surface || !hostRef.value || !opts.persistViewport()) return
          if (!startupFocusActive()) return restoreViewport()
          focusSurface(surface)
        },
        { flush: 'post' },
      )
    }
    // 就绪闸门：等插件声明的异步初始化（联网恢复画布等）落地后再取景 —— 只做这一次
    void (opts.readiness ? opts.readiness.wait() : Promise.resolve()).then(() => {
      const surface = surfaceRef.value
      if (!surface || !hostRef.value || !opts.persistViewport()) return
      if (!startupFocusActive()) return
      focusSurface(surface)
    })
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
