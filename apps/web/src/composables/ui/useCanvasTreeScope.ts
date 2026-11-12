import { computed, reactive } from 'vue'
import { buildCanvasTree, filterTree, prefetchVideoThumbs } from '../canvasTree'
import type { UiState } from './createUiState'
import type { UiHostScope } from './useUiHost'
import type { TreeNode } from './types'

/**
 * 左侧画布树：doc 订阅 → buildCanvasTree → 抽屉树。
 *
 * 订阅句柄仍是模块内闭包（不换对象），refresh / bind / unbind 的顺序与原实现一致。
 */
export function createCanvasTreeScope(state: UiState, host: UiHostScope) {
  const { hostCtx } = host
  // ===== 左侧树（**真实画布数据**）=====
  // 以前这里是写死的假数组；现在跟着画布实时画（doc.subscribe → buildCanvasTree）。
  // 名字全部来自节点自身（见 canvasTree.ts）；空画布就是空树，不塞假节点。
  const tree = reactive<TreeNode[]>([])
  const collapsed = reactive<Record<string, boolean>>({})
  let disposeTreeBind: (() => void) | undefined

  /** doc 服务的**最小用面**（读节点 + 订阅变化；5c 后 nodeStore 不再是服务名，读走 doc） */
  type DocTreeLike = { getNodes(): unknown[]; subscribe(cb: () => void): () => void }
  const docSvc = (): DocTreeLike | undefined => hostCtx()?.get<DocTreeLike>('doc')

  /** 从画布数据重建抽屉树（原地替换内容，绑定不换对象、不闪） */
  function refreshCanvasTree(): void {
    const nodes = (docSvc()?.getNodes?.() ?? []) as never
    const built = buildCanvasTree(nodes)
    tree.splice(0, tree.length, ...built)
    // 视频缩略图：统一走 video 服务（一个视频一张图，全站复用）。
    // 这里只负责"预热 + 取到后重绘一次"；取不到就保持图标兜底，不阻塞渲染。
    // 服务可能没装（没装 video 插件）→ get 会抛，用 try 兜住，静默保持图标兜底
    let videoSvc: { thumb?(url: string | undefined): Promise<string | null> } | undefined
    try {
      videoSvc = hostCtx()?.get<{ thumb?(url: string | undefined): Promise<string | null> }>('video')
    } catch {
      videoSvc = undefined
    }
    if (videoSvc && typeof videoSvc.thumb === 'function') {
      const thumb = videoSvc.thumb.bind(videoSvc)
      const urls = (nodes as Array<{ type?: string; data?: Record<string, unknown> }>).map((n) => {
        const d = n.data ?? {}
        const v = d.videoUrl
        return typeof v === 'string' && v.trim() ? v : undefined
      })
      void prefetchVideoThumbs(urls, thumb).then((touched) => {
        if (touched) refreshCanvasTree()
      })
    }
  }
  /** 订阅画布变化（增删改节点都自动重画左侧树）；重复 onReady 先撤旧订阅 */
  function bindCanvasTree(): void {
    disposeTreeBind?.()
    disposeTreeBind = undefined
    refreshCanvasTree()
    disposeTreeBind = docSvc()?.subscribe(() => refreshCanvasTree())
  }
  /** 撤掉画布树订阅（宿主销毁时调用） */
  function unbindCanvasTree(): void {
    disposeTreeBind?.()
    disposeTreeBind = undefined
  }
  function nodeCount(nodes: TreeNode[]): number {
    return nodes.reduce((sum, n) => sum + 1 + (n.children ? nodeCount(n.children) : 0), 0)
  }
  const treeTotal = computed(() => nodeCount(tree))
  // 搜索 + 类型过滤视图（纯函数在 canvasTree.filterTree）：关键字匹配名字、类型按 图片/视频/文本/分组
  // 过滤；分组在有子节点留下时保留并展开。这里只负责把结果接上折叠状态。
  const filteredTree = computed<TreeNode[]>(() => {
    const { nodes, expandIds } = filterTree(tree, { query: state.searchQuery, type: state.filterType })
    for (const id of expandIds) collapsed[id] = false
    return nodes
  })

  return { tree, collapsed, treeTotal, filteredTree, refreshCanvasTree, bindCanvasTree, unbindCanvasTree }
}

export type CanvasTreeScope = ReturnType<typeof createCanvasTreeScope>

