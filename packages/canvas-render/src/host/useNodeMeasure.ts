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

export function useNodeMeasure(opts: {
  nodeLayout: NodeLayoutService
  /** 容器元素（VueFlow renderer 内层；应包含 .vue-flow__node 子元素） */
  container: () => HTMLElement | null
}): NodeMeasureHandle {
  const { nodeLayout, container } = opts
  const ro = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const el = entry.target as HTMLElement
      const id = el.dataset?.id
      if (!id) continue
      const w = el.offsetWidth
      const h = el.offsetHeight
      if (w > 0 && h > 0) nodeLayout.setMeasuredSize(id, w, h)
    }
  })
  const mo = new MutationObserver(() => {
    sync()
  })

  const observed = new Set<HTMLElement>()

  function observeNode(el: HTMLElement): void {
    if (observed.has(el)) return
    observed.add(el)
    ro.observe(el)
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
        ro.unobserve(el)
        observed.delete(el)
      }
    }
  }

  return {
    start() {
      const root = container()
      if (root) mo.observe(root, { childList: true, subtree: true })
      sync()
    },
    stop() {
      mo.disconnect()
      ro.disconnect()
      observed.clear()
      nodeLayout.reset()
    },
  }
}

