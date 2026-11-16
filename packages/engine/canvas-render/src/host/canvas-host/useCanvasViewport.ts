import { shallowRef, watch, type Ref } from 'vue'
import { GRAPH_VIEWPORT_KEY } from '@plume-canvas/canvas-data'
import { FIRST_RUN_FIT_RETRY_DELAYS } from '../canvasHostCore'
import type { CanvasHostHandle } from '../createPlumeHost'
import type { ViewportState } from '../../viewport/viewportService'
import type { CanvasSurfaceHandle } from './types'

/** 取景 / 恢复视野之后，盯着视口被重置的最长时间（VueFlow 挂载收尾可能再写一次默认视口） */
export const VIEWPORT_GUARD_MS = 2000
/** 首帧最多隐藏多久（算不出构图也要显示，不能一直空着） */
export const REVEAL_FALLBACK_MS = 800

/**
 * 画布视野：**启动只取景一次，之后只恢复**（用户口径 2026-11-16）。
 *
 * 四个要点：
 * 1. **不提前取景**：启动阶段数据源可能还会换（云端），此刻算出来的构图注定作废。
 * 2. **只取一次**：等就绪闸门放行后按全部节点算一次（view.focusAll）。
 * 3. **首帧不露错位**：VueFlow 会先按 {0,0,1} 渲染一帧（节点贴左上角 100%）。
 *    已知构图就作为 defaultViewport 传给它（首帧即终态）；未知时先隐藏内容，算准再显示。
 * 4. **重挂只恢复**：插件装/卸会让 VueFlow 整树重挂、视口回到默认值，
 *    这时把上次视野还回去，绝不重新取景（否则同一次打开会跳两次）。
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
  /**
   * 定时器分桶：
   * - fitTimers     取景重试（新的一轮开始时清掉旧的）
   * - guardTimers   视野守护（取景/恢复后持续盯着）
   * - revealTimer   首帧兜底显示（**绝不能**被取景重试清掉，否则画布可能一直隐藏）
   */
  const fitTimers = new Set<ReturnType<typeof setTimeout>>()
  const guardTimers = new Set<ReturnType<typeof setTimeout>>()
  let revealTimer: ReturnType<typeof setTimeout> | undefined
  /** 启动取景是否已经完成 */
  let startupFocusDone = false
  /** 用户是否亲手动过视口：动过就永久不再自动动视野 */
  let userMovedViewport = false
  /** 要维持的视野（取景结果 / 用户最后停留的位置） */
  let lastViewport: ViewportState | undefined
  /** 取景轮次：新一轮作废旧轮次的重试 */
  let focusRound = 0
  /** 视野守护截止时间（0 = 无守护） */
  let guardUntil = 0
  /** 首帧是否已构图到位（false 时画布内容先不显示） */
  const contentVisible = shallowRef(false)
  /** 供 VueFlow 首帧使用的默认视口：有值就首帧到位，不会先跳一次 */
  const initialViewport = shallowRef<ViewportState | null>(null)

  function clearSet(set: Set<ReturnType<typeof setTimeout>>): void {
    for (const t of set) clearTimeout(t)
    set.clear()
  }

  function sameViewport(a: ViewportState, b: ViewportState): boolean {
    return (
      Math.abs(a.x - b.x) < 0.5 &&
      Math.abs(a.y - b.y) < 0.5 &&
      Math.abs(a.zoom - b.zoom) < 1e-4
    )
  }

  function autoViewportAllowed(): boolean {
    return !userMovedViewport && !startupFocusDone
  }

  /** 显示画布内容（幂等，且会撤掉兜底定时器） */
  function reveal(): void {
    if (revealTimer !== undefined) {
      clearTimeout(revealTimer)
      revealTimer = undefined
    }
    contentVisible.value = true
  }

  /**
   * 守护：确保视口停在 target 上，直到 guardUntil 或用户接管。
   *
   * 为什么需要：VueFlow 的 Pane 在挂载收尾时会用 defaultViewport 再写一次 {0,0,1}，
   * 这次写不经过任何「重挂」信号 —— 不盯着就会被悄悄改回去（实测：1.55 → 200ms 后回到 1）。
   */
  function guardViewport(target: ViewportState): void {
    clearSet(guardTimers)
    guardUntil = Date.now() + VIEWPORT_GUARD_MS
    const tick = (): void => {
      const h = hostRef.value
      if (!h || userMovedViewport || lastViewport !== target) return
      if (!sameViewport(h.view.getViewport(), target)) h.view.setViewport(target)
      if (Date.now() >= guardUntil) return
      const t = setTimeout(() => {
        guardTimers.delete(t)
        tick()
      }, 100)
      guardTimers.add(t)
    }
    tick()
  }

  /**
   * 启动取景：按全部节点算一次构图，算出来就守住并显示。
   *
   * 重试的原因：节点几何要等 DOM 量测、d3Zoom 要等 Pane mounted；focusAll 未就绪返回 false。
   */
  function focusSurface(surface: CanvasSurfaceHandle, waitFrames = true): void {
    const delays = FIRST_RUN_FIT_RETRY_DELAYS
    let k = 0
    /** 上一轮算出来的结果：用来判断「这次结果和上次一样」= 已经稳定（VueFlow 不再改它） */
    let lastResult: ViewportState | undefined
    const round = ++focusRound
    clearSet(fitTimers)
    const attempt = (): void => {
      const h = hostRef.value
      if (!h || round !== focusRound || surfaceRef.value !== surface || !autoViewportAllowed()) return
      /*
       * 等 VueFlow 把它的默认视口写完再做：它初次挂载时会在 Pane 的 mounted 里写一次；
       * 我们在它之前写，会被它覆盖（实测：1.55 → 120ms 后回到 1）。
       * view.focusAll 自己在未就绪时返回 false，这里再要求连续两轮「读到的视口没被改」，
       * 才认为确实写稳了。
       */
      if (h.view.focusAll()) {
        const result = h.view.getViewport()
        /*
         * 必须连续两次算出一模一样的构图才收工：
         * VueFlow 初次挂载会在 Pane mounted 里写一次默认视口，我们若刚好写在它之前，
         * 结果会被它覆盖（实测 1.55 → 120ms 后回到 1）。第二次重试算出来仍然相同，
         * 说明那次默认写入已经过去，此刻的构图才是最终值。
         */
        if (!lastResult || !sameViewport(lastResult, result)) {
          lastResult = result
          if (k >= delays.length) return
          const t = setTimeout(() => {
            fitTimers.delete(t)
            attempt()
          }, delays[k])
          fitTimers.add(t)
          k++
          return
        }
        lastViewport = result
        // 下一次重挂直接以这个视野起帧（VueFlow defaultViewport），避免第一帧再跳一次
        initialViewport.value = lastViewport
        startupFocusDone = true
        opts.readiness?.close()
        h.save.set(GRAPH_VIEWPORT_KEY, lastViewport, 'canvas')
        guardViewport(lastViewport)
        reveal()
        return
      }
      if (k >= delays.length) {
        // 算不出构图也不能一直隐藏：交给兜底定时器显示
        return
      }
      const t = setTimeout(() => {
        fitTimers.delete(t)
        attempt()
      }, delays[k])
      fitTimers.add(t)
      k++
    }
    if (!waitFrames) return attempt()
    requestAnimationFrame(() => requestAnimationFrame(attempt))
  }

  /** 移动/缩放结束：把当前 viewport 落盘 */
  function persistViewport(): void {
    const h = hostRef.value
    if (!h) return
    lastViewport = h.view.getViewport()
    initialViewport.value = lastViewport
    h.save.set(GRAPH_VIEWPORT_KEY, lastViewport, 'canvas')
  }

  /** 把上次的视野还回去（重挂后）：不重新取景 */
  function restoreViewport(): void {
    const target = lastViewport
    if (!target) return
    const h = hostRef.value
    if (!h) return
    if (!sameViewport(h.view.getViewport(), target)) h.view.setViewport(target)
    guardViewport(target)
  }

  /** 用户亲手平移/缩放：永久停手，并撤掉所有自动定时器 */
  function markUserMoved(): void {
    userMovedViewport = true
    guardUntil = 0
    clearSet(fitTimers)
    clearSet(guardTimers)
    opts.readiness?.close()
  }

  function bindViewportRestore(): void {
    /*
     * 兜底：构图实在算不出来时也要让内容出现（不能永远空白）。
     * 但**只有在没有取景成功**的情况下才直接用「当前」视野显示 ——
     * 否则会在校正之前先露出一次未校正画面（实测：显示时 1、下一帧才变 1.55）。
     */
    revealTimer = setTimeout(() => {
      revealTimer = undefined
      const h = hostRef.value
      if (!h) {
        contentVisible.value = true
        return
      }
      /*
       * 兜底也要**先取一次景**再显示：直接显示当前视口的话，用户看到的是 VueFlow
       * 的默认位置（左上角 100%），随后才被校正 —— 那就是「极快的一下闪烁」。
       * 这里失败也无所谓，下面照样显示，只是可能不够理想。
       */
      if (autoViewportAllowed()) h.view.focusAll()
      const target = h.view.getViewport()
      lastViewport = target
      initialViewport.value = target
      if (!sameViewport(h.view.getViewport(), target)) h.view.setViewport(target)
      guardViewport(target)
      requestAnimationFrame(() => {
        if (lastViewport) restoreViewport()
        contentVisible.value = true
      })
    }, REVEAL_FALLBACK_MS)

    // immediate：CanvasSurface 可能已经挂上，watch 默认不跑首次值
    stopViewportWatch = watch(
      surfaceRef,
      (surface) => {
        if (!surface || !hostRef.value || !opts.persistViewport()) return
        // 启动阶段：数据源可能还会换，此刻**既不取景也不恢复**
        if (autoViewportAllowed()) return
        restoreViewport()
      },
      { immediate: true },
    )

    /*
     * VueFlow 整树重挂：视口回到默认值。这里只恢复上次视野 —— 启动取景只由闸门那次做，
     * 所以重挂不会再产生一次取景（这是「打开时跳两次」的根因）。
     */
    if (opts.remountSignal) {
      watch(
        opts.remountSignal,
        () => {
          if (!surfaceRef.value || !hostRef.value || !opts.persistViewport()) return
          /*
           * 重挂期间先藏起来：新的 VueFlow 树会先按默认视口画一帧（左上角 100%），
           * 恢复视野又要等它挂完 —— 这两帧都会被用户看见，表现为「居中→左上角→居中」。
           * 藏到恢复生效再显示，用户只会看到一次正确画面。
           */
          contentVisible.value = false
          requestAnimationFrame(() => requestAnimationFrame(() => {
            restoreViewport()
            reveal()
          }))
        },
        { flush: 'post' },
      )
    }

    // 就绪闸门：等插件异步初始化落地后取景 —— 全流程只此一次
    void (opts.readiness ? opts.readiness.wait() : Promise.resolve()).then(() => {
      const surface = surfaceRef.value
      if (!surface || !hostRef.value || !opts.persistViewport()) return
      if (!autoViewportAllowed()) return
      requestAnimationFrame(() => focusSurface(surface, false))
    })
  }

  function dispose(): void {
    stopViewportWatch?.()
    guardUntil = 0
    clearSet(fitTimers)
    clearSet(guardTimers)
    if (revealTimer !== undefined) {
      clearTimeout(revealTimer)
      revealTimer = undefined
    }
  }

  return {
    fitViewFirstRun: () => {
      const surface = surfaceRef.value
      if (surface) focusSurface(surface)
    },
    persistViewport,
    bindViewportRestore,
    markUserMoved,
    initialViewport,
    contentVisible,
    dispose,
  }
}
