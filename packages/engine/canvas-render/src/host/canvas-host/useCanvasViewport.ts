import { shallowRef, watch, type Ref } from 'vue'
import { GRAPH_VIEWPORT_KEY } from '@plume-canvas/canvas-data'
import { FIRST_RUN_FIT_RETRY_DELAYS } from '../canvasHostCore'
import type { CanvasHostHandle } from '../createPlumeHost'
import type { ViewportState } from '../../viewport/viewportService'
import type { CanvasSurfaceHandle } from './types'

/** 取景 / 恢复视野之后，盯着视口被重置的最长时间（VueFlow 挂载收尾可能再写一次默认视口） */
export const VIEWPORT_GUARD_MS = 2000

/**
 * 画布视野：**启动只取景一次，之后只恢复**（用户口径 2026-11-16）。
 *
 * 三件事，按发生顺序：
 * 1. 启动取景：等就绪闸门（插件的异步初始化）放行 → 按全部节点算一次构图（view.focusAll）。
 * 2. 守护：VueFlow 挂载收尾 / 整树重挂会用自己的默认视口（{0,0,1}）覆盖我们的结果，
 *    所以在短时间内盯着，「被改回去就写回来」。用户一动视口立刻停手。
 * 3. 之后的重挂：只把上次视野还回去（restoreViewport），不重新取景 —— 不会出现第二次聚焦。
 *
 * 为什么不能靠「重挂后再取景一次」来兜：那会让同一次打开出现两次构图变化（画面跳），
 * 而且插件装卸越多、跳的次数越多。
 */
export function useCanvasViewport(opts: {
  hostRef: { value: CanvasHostHandle | undefined }
  surfaceRef: Ref<CanvasSurfaceHandle | undefined>
  persistViewport: () => boolean
  /** VueFlow 整树重挂信号（插件装/卸 bump nodeEpoch）；重挂后视口会被重置 */
  remountSignal?: () => number
  /** 就绪闸门：等插件声明的异步初始化落地再取景（同步插件不受影响） */
  readiness?: { wait(): Promise<void>; close(): void; closed?(): boolean }
}) {
  const { hostRef, surfaceRef } = opts
  let stopViewportWatch: (() => void) | undefined
  let viewportTimers: ReturnType<typeof setTimeout>[] = []
  /** 启动取景是否已经完成（闸门放行 + 成功取景） */
  let startupFocusDone = false
  /** 用户是否亲手动过视口：动过就永久不再自动动视野 */
  let userMovedViewport = false
  /** 要维持的视野（取景结果 / 用户最后停留的位置） */
  let lastViewport: ViewportState | undefined
  /** 取景轮次：新一轮作废旧轮次的重试 */
  let focusRound = 0
  /** 视野守护的截止时间（0 = 没有守护） */
  let guardUntil = 0
  /**
   * 首帧是否已经「构图到位」。
   *
   * 首次进入时我们还不知道目标构图（要等 DOM 量测），VueFlow 会先按 {0,0,1} 画一帧 ——
   * 用户就看到「节点贴在左上角 100%」，随后才跳到正确位置，这就是初始化闪烁。
   * 现在首帧前保持透明，算好构图（或超时兜底）后再显示：用户看到的第一眼就是终态。
   */
  const contentVisible = shallowRef(false)
  /**
   * 供 VueFlow 首帧使用的默认视口（响应式）。
   *
   * 为什么要有它：VueFlow 挂载时会用 defaultViewport 写一次视口。以前我们只能在它写完之后再
   * setViewport 校正 —— 用户会看到「先左上角 100%，再跳到正确位置」。把已知的目标视口直接作为
   * defaultViewport 传给它，第一帧就是终态，没有那次跳动。
   */
  const initialViewport = shallowRef<ViewportState | null>(null)

  function clearTimers(): void {
    for (const t of viewportTimers) clearTimeout(t)
    viewportTimers = []
  }

  function sameViewport(a: ViewportState, b: ViewportState): boolean {
    return (
      Math.abs(a.x - b.x) < 0.5 &&
      Math.abs(a.y - b.y) < 0.5 &&
      Math.abs(a.zoom - b.zoom) < 1e-4
    )
  }

  /** 当前是否还能自动动视野（启动未完成、且用户没接管） */
  function autoViewportAllowed(): boolean {
    return !userMovedViewport && !startupFocusDone
  }

  /**
   * 守护：确保视口停在 target 上，直到 guardUntil 或用户接管。
   *
   * 为什么要守：VueFlow 的 Pane 会在挂载收尾时用 defaultViewport 再写一次 {0,0,1}，
   * 这次写不经过任何重挂信号。只在写入那一刻写一次，会被它随后覆盖
   * （实测：取景算出 1.68，200ms 后回到 1）。
   */
  function guardViewport(target: ViewportState): void {
    guardUntil = Date.now() + VIEWPORT_GUARD_MS
    const tick = (): void => {
      const h = hostRef.value
      if (!h || userMovedViewport || lastViewport !== target) return
      const cur = h.view.getViewport()
      if (!sameViewport(cur, target)) h.view.setViewport(target)
      if (Date.now() >= guardUntil) return
      viewportTimers.push(setTimeout(tick, 100))
    }
    tick()
  }

  /**
   * 启动取景：按全部节点算一次构图并守住。
   *
   * 重试的原因：节点几何要等 DOM 量测；VueFlow 的 d3Zoom 也要等 Pane mounted。
   * focusAll 在未就绪时返回 false —— 用它判断「这次算得出真实构图了吗」。
   */
  /**
   * 等视口稳定后显示画布。
   *
   * 视口刚算好那一刻，VueFlow 可能还没把结果写进 d3Zoom；这段时间画面会短暂回到默认值。
   * 连续两次读到同一个（等于目标）视口才显示，用户就不会看到那一下回跳。
   */
  function revealWhenSettled(target: ViewportState, tries = 0): void {
    const h = hostRef.value
    if (!h || userMovedViewport) {
      contentVisible.value = true
      return
    }
    /*
     * 判据不是「现在就相等」而是「接下来一小段都保持相等」：
     * 视口可能刚写进去又被 VueFlow 的挂载收尾改回去 —— 立刻显示就会露出那一下回跳。
     * 连续 3 次（约 120ms）都等于目标才显示。
     */
    if (sameViewport(h.view.getViewport(), target)) {
      if (tries >= 3) {
        contentVisible.value = true
        return
      }
    } else if (tries >= 12) {
      contentVisible.value = true
      return
    }
    viewportTimers.push(setTimeout(() => revealWhenSettled(target, tries + 1), 40))
  }
  function focusSurface(surface: CanvasSurfaceHandle, waitFrames = true): void {
    const delays = FIRST_RUN_FIT_RETRY_DELAYS
    let k = 0
    const round = ++focusRound
    clearTimers()
    const attempt = (): void => {
      const h = hostRef.value
      if (!h || round !== focusRound || surfaceRef.value !== surface || !autoViewportAllowed()) return
      if (h.view.focusAll()) {
        lastViewport = h.view.getViewport()
        // 下一次重挂（插件装载 / 手动装卸）直接以这个视野起帧，避免第一帧再跳一次
        initialViewport.value = lastViewport
        startupFocusDone = true
        opts.readiness?.close()
        // 取景结果落盘：云端那份「上次位置」跟着对齐，不会停在没人看过的旧构图
        h.save.set(GRAPH_VIEWPORT_KEY, lastViewport, 'canvas')
        guardViewport(lastViewport)
        revealWhenSettled(lastViewport)
        return
      }
      if (k >= delays.length) return
      viewportTimers.push(setTimeout(attempt, delays[k]))
      k++
    }
    if (!waitFrames) return attempt()
    requestAnimationFrame(() => requestAnimationFrame(attempt))
  }

  /** 移动/缩放结束：把当前 viewport 落盘（与 graph 同走 save，读视口统一走 viewport 服务） */
  function persistViewport(): void {
    const h = hostRef.value
    if (!h) return
    lastViewport = h.view.getViewport()
    h.save.set(GRAPH_VIEWPORT_KEY, lastViewport, 'canvas')
  }

  /** 把上次的视野还回去（重挂后 / 启动取景完成后数据又变）：不重新取景 */
  function restoreViewport(): void {
    const target = lastViewport
    if (!target) return
    const h = hostRef.value
    if (!h) return
    if (!sameViewport(h.view.getViewport(), target)) h.view.setViewport(target)
    guardViewport(target)
  }

  /**
   * 用户亲手平移/缩放（onMoveStart）：永久停手。
   *
   * 程序自己写视口不会触发 move-start（VueFlow 的 move 事件只在用户手势里发），
   * 所以这条信号就代表「用户开始接管视野」。
   */
  function markUserMoved(): void {
    userMovedViewport = true
    guardUntil = 0
    clearTimers()
    opts.readiness?.close()
  }

  function bindViewportRestore(): void {
    /*
     * 兜底：算构图可能需要等量测，万一迟迟算不出来，也不能让画布一直是空的。
     * 1.5 秒后无论如何先显示（用户至少能看到内容，之后被守护逻辑校正）。
     */
    viewportTimers.push(
      setTimeout(() => {
        contentVisible.value = true
      }, 800),
    )
    // immediate：watch 默认不跑首次值，而 CanvasSurface 可能已经挂上
    stopViewportWatch = watch(
      surfaceRef,
      (surface) => {
        if (!surface || !hostRef.value || !opts.persistViewport()) return
        /*
         * 启动阶段（闸门未放行）：**先不画、也不算构图**。
         * 此时节点集可能还会被数据源换掉（云端），此刻算出来的构图注定要作废 ——
         * 那正是「先 100% 一下、再跳到正确位置」的来源。等闸门放行后一次算准。
         * 启动取景完成之后：重挂/新挂载只恢复上次视野。
         */
        if (autoViewportAllowed()) return
        restoreViewport()
      },
      { immediate: true },
    )
    /*
     * VueFlow 整树重挂（插件装/卸 → nodeEpoch 变化）后视口回到默认值。
     *
     * 为什么必须单独监听：重挂发生在 CanvasSurface **内部**（VueFlow 带 key），
     * surfaceRef 这个句柄不会变 —— 只监听 surfaceRef 收不到「重挂」这件事。
     * 一律「恢复上次视野」；启动取景只由闸门那次做，所以重挂不会再产生一次取景。
     */
    if (opts.remountSignal) {
      watch(
        opts.remountSignal,
        () => {
          const surface = surfaceRef.value
          if (!surface || !hostRef.value || !opts.persistViewport()) return
          restoreViewport()
        },
        { flush: 'post' },
      )
    }
    /*
     * 就绪闸门：等插件声明的异步初始化（联网恢复画布等）落地后再取景 —— 全流程只此一次。
     */
    void (opts.readiness ? opts.readiness.wait() : Promise.resolve()).then(() => {
      const surface = surfaceRef.value
      if (!surface || !hostRef.value || !opts.persistViewport()) return
      if (!autoViewportAllowed()) return
      /*
       * 等一帧再算：这时 VueFlow 的容器/节点已经量过一遍，focusAll 才能算出真实构图。
       * 之前直接算会拿到 0 尺寸的矩形，算出来的缩放不对（于是要重试、白等）。
       */
      requestAnimationFrame(() => focusSurface(surface, false))
    })
  }

  function dispose(): void {
    stopViewportWatch?.()
    guardUntil = 0
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
    /** 交给 VueFlow 的 defaultViewport：有值就首帧到位 */
    initialViewport,
    /** 首帧是否已构图到位（false 时画布先透明，避免看到错误的初始位置） */
    contentVisible,
    dispose,
  }
}
