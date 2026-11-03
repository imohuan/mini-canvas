import { computed } from 'vue'
import type { UiState } from './createUiState'
import type { UiHostScope } from './useUiHost'

export type ViewportLike = {
  getViewport(): { zoom: number }
  zoomIn(): void
  zoomOut(): void
  zoomTo(level: number): void
  fitView(padding?: number): void
}

/**
 * 缩放：左下角菜单动作 + 状态栏读数镜像。
 *
 * 唯一事实来源 = view（getViewport().zoom）。rAF 常驻循环与重复 onReady 撤旧循环的行为不改。
 */
export function createViewportScope(state: UiState, host: UiHostScope) {
  const { hostCtx, readSetting } = host

  // ===== 缩放（左下角「缩放选项」）=====
  //
  // 唯一事实来源 = 真实画布视口（view 服务的 getViewport().zoom）。状态栏那个百分比只是**镜像值**：
  // 由宿主就绪时同步一次 + 每次视口移动/缩放结束（RenderEvents.MoveEnd）再同步，显示永远与画布一致。
  // 菜单动作一律调 view 服务去改真实画布，不再只改一个数字（原先 s.zoom 是纯 UI 数字，
  // 从没接到 viewport 上 —— 表现为"点缩放至 100% 画布纹丝不动"）。
  /** view 服务的最小用面（契约见 canvas-data renderServiceContracts，宿主恒在注入） */
  type ViewportLike = {
    getViewport(): { zoom: number }
    zoomIn(): void
    zoomOut(): void
    zoomTo(level: number): void
    fitView(padding?: number): void
  }
  function viewportSvc(): ViewportLike | undefined {
    return hostCtx()?.get<ViewportLike>('view')
  }
  /** 把真实视口缩放同步到状态栏镜像值（未就绪 → 不动，保留上一次显示） */
  function syncZoomDisplay(): void {
    const zoom = viewportSvc()?.getViewport?.().zoom
    if (typeof zoom === 'number' && Number.isFinite(zoom)) state.zoom = Math.round(zoom * 100)
  }
  /** 放大（钳到 800%，与状态栏读数的上限一致） */
  function zoomInStep(): void {
    const svc = viewportSvc()
    if (!svc) return
    const current = Math.round((svc.getViewport?.().zoom ?? 1) * 100)
    svc.zoomTo(Math.min(800, current + 10) / 100)
  }
  /** 缩小（钳到 10%） */
  function zoomOutStep(): void {
    const svc = viewportSvc()
    if (!svc) return
    const current = Math.round((svc.getViewport?.().zoom ?? 1) * 100)
    svc.zoomTo(Math.max(10, current - 10) / 100)
  }
  /** 缩放到某个倍率（缩放菜单里的「缩放至 X%」） */
  function zoomToPercent(percent: number): void {
    viewportSvc()?.zoomTo(percent / 100)
  }
  /**
   * 缩放到最大（缩放菜单里的「缩放到最大」）。
   *
   * "最大"取自宿主级设置 `maxZoom`（分组「常规/画布」，默认 2 = 200%，设置面板可调 1–8），
   * 而不是写死一个 800% —— 那样在默认上限 200% 下点了也到不了，文案与实际不符。
   * 设置键缺席（旧宿主）时按同一默认 2 兜底。
   */
  function zoomToMax(): void {
    const svc = viewportSvc()
    if (!svc) return
    const max = readSetting<number>('maxZoom')
    svc.zoomTo(typeof max === 'number' && Number.isFinite(max) ? max : 2)
  }
  /** 适合屏幕（把整张图收进视口；替代原先那个只改文字的假按钮） */
  function zoomFit(): void {
    viewportSvc()?.fitView()
  }
  /**
   * 让状态栏读数始终跟着真实视口走。
   *
   * 为什么用常驻 rAF 而不是订阅视口事件：**程序化缩放不发 VueFlow 的 move 事件**（实测 zoomTo /
   * fitView / 小地图拖拽 / 首屏 fitView 全部不发 moveEnd），只靠 `RenderEvents.MoveEnd` 订阅会让读数
   * 停在旧值（表现为"点了缩放至 100%，画布动了、数字没动"）。逐帧比对一次真实 zoom、变了才写
   * （同一个整数不触发响应式），任何来源的缩放都跟得上；成本是一次 getViewport + 整数比较，可忽略。
   * 与 App.vue 里给小地图逐帧定位的 rAF 同款做法。重复 onReady 先撤旧循环。
   */
  let disposeZoomBind: (() => void) | undefined
  function bindZoomSync(): void {
    disposeZoomBind?.()
    disposeZoomBind = undefined
    const ctx = hostCtx()
    if (!ctx) return
    syncZoomDisplay()
    // node/SSR 环境没有 rAF：只做一次同步即可（那些环境也没有真实视口可跟）
    if (typeof requestAnimationFrame !== 'function') return
    let raf = requestAnimationFrame(function tick(): void {
      syncZoomDisplay()
      raf = requestAnimationFrame(tick)
    })
    disposeZoomBind = () => { cancelAnimationFrame(raf) }
  }
  /** 撤掉视口订阅（宿主销毁时调用，与 unbindSettingsClose / unbindCanvasToggles 同处） */
  function unbindZoomSync(): void {
    disposeZoomBind?.()
    disposeZoomBind = undefined
  }
  return {
    viewportSvc, syncZoomDisplay, zoomInStep, zoomOutStep, zoomToPercent, zoomToMax, zoomFit,
    bindZoomSync, unbindZoomSync,
  }
}

export type ViewportScope = ReturnType<typeof createViewportScope>

