/**
 * useNodeMeasure —— 节点 DOM 尺寸实测注入（3A 完整落地：动态尺寸不入存储，渲染层量测后注入 nodeLayout）。
 *
 * 浏览器端接线：ResizeObserver 观测每个 .vue-flow__node 元素，把内容区实测宽高经
 * host.nodeLayout.setMeasuredSize(id, w, h) 写入内存态服务；节点被移除时 clearMeasuredSize。
 * MutationObserver 监听渲染容器，节点 DOM 增删时动态挂/卸观测，避免陈旧引用。
 *
 * 使用：在 CanvasSurface onMounted 后 start()，onBeforeUnmount stop()。
 *
 * 注意：实测宽高取节点卡片内容尺寸（不含 VueFlow 包裹），VueFlow 的 .vue-flow__node 直接包自定义
 * 节点组件，offsetWidth/offsetHeight 即卡片渲染尺寸。
 */
import type { NodeLayoutService } from '../layout/nodeLayout'

export interface NodeMeasureHandle {
  start(): void
  stop(): void
}

/**
 * 解析「节点 DOM 所在的容器」—— 量测与导出共用的实例级锚点。
 *
 * 历史坑（线上 bug）：原实现写死 `root.querySelector('.vue-flow__renderer')`，但 **Vue Flow 1.48 起
 * DOM 里没有这个类名**（其 dist 只产出 viewport / transformationpane / pane / nodes / edges）。
 * querySelector 恒为 null → 量测容器为空、从不 observe → NodeLayoutService 收不到实测尺寸，
 * nodeSize() 永远回落到 node.size ?? type.defaultSize，表现为「resize 过节点，自动布局仍按默认尺寸算」。
 *
 * 这里按「含 .vue-flow__node 的最内层节点容器」逐级兜底，不绑死某一个类名：
 *   .vue-flow__nodes（节点层）→ .vue-flow__viewport → .vue-flow__pane → 传入的 root 本身。
 * 传 null（未挂载 / SSR）返回 null，调用方按"无容器"安全 no-op。
 */
export function resolveMeasureContainer(root: HTMLElement | null | undefined): HTMLElement | null {
  if (!root) return null
  const candidate = root.querySelector<HTMLElement>('.vue-flow__nodes')
  if (candidate) return candidate
  // 兜底：任一层能查到节点元素即认它（兼容将来 VueFlow 改类名）
  for (const sel of ['.vue-flow__viewport', '.vue-flow__pane']) {
    const el = root.querySelector<HTMLElement>(sel)
    if (el && el.querySelector('.vue-flow__node')) return el
  }
  return root
}

export function useNodeMeasure(opts: {
  nodeLayout: NodeLayoutService
  /** 容器元素（VueFlow renderer 内层；应包含 .vue-flow__node 子元素） */
  container: () => HTMLElement | null
}): NodeMeasureHandle {
  const { nodeLayout, container } = opts
  const observed = new Set<HTMLElement>()
  // P1-13：SSR/headless 无 ResizeObserver/MutationObserver/DOM → no-op 句柄，不抛错。
  // 惰性创建：observer 仅 start()（挂载后、容器就绪）时才 new，避免 setup 期即抛。
  const canObserve =
    typeof ResizeObserver !== 'undefined' &&
    typeof MutationObserver !== 'undefined'
  let ro: ResizeObserver | null = null
  let mo: MutationObserver | null = null

  function ensureObservers(): boolean {
    if (!canObserve) return false
    if (!ro) {
      ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement
          const id = el.dataset?.id
          if (!id) continue
          const w = el.offsetWidth
          const h = el.offsetHeight
          if (w > 0 && h > 0) nodeLayout.setMeasuredSize(id, w, h)
        }
      })
      mo = new MutationObserver(() => {
        sync()
      })
    }
    return true
  }

  function observeNode(el: HTMLElement): void {
    if (observed.has(el)) return
    observed.add(el)
    ro?.observe(el)
    // 首次挂载立即上报一次（避免等首帧 ResizeObserver 回调）
    const id = el.dataset?.id
    if (id) {
      const w = el.offsetWidth
      const h = el.offsetHeight
      if (w > 0 && h > 0) nodeLayout.setMeasuredSize(id, w, h)
    }
  }

  function sync(): void {
    const root = container()
    if (!root) return
    const current = new Set<HTMLElement>()
    for (const el of root.querySelectorAll<HTMLElement>('.vue-flow__node')) {
      current.add(el)
      observeNode(el)
    }
    // 卸载已消失节点：清实测 + 解 observe
    for (const el of observed) {
      if (!current.has(el)) {
        const id = el.dataset?.id
        if (id) nodeLayout.clearMeasuredSize(id)
        ro?.unobserve(el)
        observed.delete(el)
      }
    }
  }

  return {
    start() {
      const root = container()
      if (!ensureObservers() || !root) return
      mo?.observe(root, { childList: true, subtree: true })
      sync()
    },
    stop() {
      mo?.disconnect()
      ro?.disconnect()
      observed.clear()
      nodeLayout.reset()
    },
  }
}


