/**
 * paneSize —— pane 尺寸的持续观测（2026-10-17 修复「响应式布局改了窗口，可视区不跟」）。
 *
 * 旧实现只在 CanvasSurface 挂载时（onMounted）和插件重挂时量一次
 * getBoundingClientRect。窗口被拖动 / 侧栏展开收起 / 布局响应式变化后，pane 已经
 * 变了，但量出来的矩形还是旧的 → 可视区（viewportRectInFlow）按旧宽高算 →
 * 可见剔除把本该显示的节点剔掉（或该剔的还留着）。
 *
 * 本模块只做一件事：盯着 pane 元素，尺寸一变就回调最新矩形。
 * - 优先 ResizeObserver（量的是元素本身，窗口缩放 / 父容器变化都能感知）；
 * - 没有 ResizeObserver（老浏览器 / 测试环境）退回 window resize 监听；
 * - 宽高没变不重复回调（下游 watcher 会重算可视矩形 + 剔除集合，避免无意义刷新）；
 * - observe 换元素时先断开旧元素（插件装/卸会让 VueFlow 整树重挂，pane 是新 DOM）。
 */

export interface PaneSizeObserver {
  /** 开始观测给定 pane（传 null = 停止观测并回调一次 null，让下游走安全兜底） */
  observe(pane: HTMLElement | null): void
  /** 立即重量一次（不影响观测关系；用于兜底场景手动刷新） */
  refresh(): void
  /** 组件卸载：断开 ResizeObserver / 摘 window 监听 */
  stop(): void
}

function measure(pane: HTMLElement | null): DOMRect | null {
  if (!pane || typeof pane.getBoundingClientRect !== 'function') return null
  const r = pane.getBoundingClientRect()
  // 退化尺寸（display:none / 尚未布局）视为不可用：下游按 null 全量渲染更安全
  if (!(r.width > 0) || !(r.height > 0)) return null
  return r
}

export function usePaneSizeObserver(onChange: (rect: DOMRect | null) => void): PaneSizeObserver {
  let pane: HTMLElement | null = null
  let ro: ResizeObserver | null = null
  let listeningWindow = false
  /** 上次上报的宽高，用于去重（矩形位置变化不影响可视区计算，不必触发重算） */
  let lastW = -1
  let lastH = -1
  let stopped = false

  const canObserve = typeof ResizeObserver !== 'undefined'

  function emit(rect: DOMRect | null): void {
    if (stopped) return
    if (!rect) {
      lastW = -1
      lastH = -1
      onChange(null)
      return
    }
    if (rect.width === lastW && rect.height === lastH) return
    lastW = rect.width
    lastH = rect.height
    onChange(rect)
  }

  function refresh(): void {
    emit(measure(pane))
  }

  function onWindowResize(): void {
    refresh()
  }

  function detach(): void {
    if (ro) {
      ro.disconnect()
      ro = null
    }
    if (listeningWindow && typeof window !== 'undefined') {
      window.removeEventListener('resize', onWindowResize)
      listeningWindow = false
    }
    pane = null
  }

  return {
    observe(next) {
      if (stopped) return
      // 同一个元素：只重量一次（例如重挂后又指回同一个 pane）
      if (next && next === pane) {
        refresh()
        return
      }
      detach()
      pane = next
      if (!next) {
        emit(null)
        return
      }
      // 先量一次，保证挂载/换元素当帧就有可用矩形
      refresh()
      if (canObserve) {
        ro = new ResizeObserver(() => refresh())
        ro.observe(next)
      } else if (typeof window !== 'undefined') {
        window.addEventListener('resize', onWindowResize)
        listeningWindow = true
      }
    },
    refresh,
    stop() {
      if (stopped) return
      stopped = true
      detach()
    },
  }
}
