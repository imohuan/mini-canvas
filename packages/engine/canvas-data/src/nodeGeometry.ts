/**
 * NodeGeometryService —— 节点尺寸与位置的**唯一读写口**。
 *
 * 为什么要有它（用户 2026-11-14 拍板）：
 * 以前同一个宽高同时存在 `node.size` 和 `data.cardWidth/cardHeight` 两份，靠“写入时同步”
 * 维系 —— 漏一条路径就出现“布局算出来的框比卡片小”。现在尺寸只存 `node.size`：
 * - 读：插件一律 `ctx.get('nodeGeometry').get(id)` / `getRect(id)`；
 * - 写：`set(id, w, h)` / `setMany([...])`，走唯一写入口（历史 + 落盘 + 重绘）。
 *
 * 与渲染层的关系：渲染层的 `view.nodeSize()` 也读同一个 `node.size`（实测值只做一致性检查，
 * 不再覆盖）；VueFlow 的外层宽高由宿主从 `node.size` 投影而来。
 *
 * 位置：`getRect()` 返回绝对矩形（沿父链累加），写位置仍走 `doc.moveNode`（同一个写入口）。
 * 不做尺寸合法性以外的业务判断（例如“这个类型能不能 resize”属于类型能力，由 UI 决定）。
 */
import type { DocService } from './docService'
import type { LayoutRect } from './canvas/renderServiceContracts'

/** 节点尺寸（画布坐标，像素） */
export interface NodeSize {
  w: number
  h: number
}

/** 批量写尺寸的一条 */
export interface NodeSizeEntry {
  id: string
  size: NodeSize
}

/**
 * 尺寸变化通知。`reason` 区分“尺寸真的变了”与“节点集合变了”（新增/删除/整体替换）：
 * 订阅方通常只在 `size` 时重算，`ids` 时重读一遍即可。
 */
export interface NodeGeometryChange {
  reason: 'size' | 'ids'
  /** 本次涉及的节点；整体替换时为空数组（调用方按“全部重读”处理） */
  ids: string[]
}

/** 节点几何服务契约（服务名 `nodeGeometry`） */
export interface NodeGeometryService {
  /** 读某节点尺寸；节点不存在或没有尺寸 → `null`（不编造默认值） */
  get(id: string): NodeSize | null
  /**
   * 读某节点的**实际尺寸**：自己有 size 就用，没有就跟类型默认值走。
   *
   * 画宽高 / 算布局一律用这个（用户 2026-11-18）：图片、视频没画面时故意不放 size，
   * 好让设置里的默认宽高实时生效。`get()` 保持“只读显式尺寸”的语义，两者别混用。
   */
  getEffective(id: string): NodeSize | null
  /**
   * 读某节点的**实际尺寸**：自己有 size 就用，没有就跟类型默认值走。
   *
   * 画宽高 / 算布局一律用这个（用户 2026-11-18）：图片、视频没画面时故意不放 size，
   * 好让设置里的默认宽高实时生效。`get()` 保持“只读显式尺寸”的语义，两者别混用。
   */
  getEffective(id: string): NodeSize | null
  /** 读绝对矩形（绝对坐标 + 尺寸）；节点不存在或没有尺寸 → `null` */
  getRect(id: string): LayoutRect | null
  /** 全部节点的绝对矩形（只含有尺寸的节点；顺序同 doc） */
  getAllRects(): LayoutRect[]
  /** 某父节点的直属子节点矩形 */
  childrenOf(parentId: string): LayoutRect[]
  /** 写一个节点的尺寸（同一事务：历史 + 落盘 + 重绘）。非法尺寸返回 false 且不写。 */
  set(id: string, w: number, h: number): boolean
  /** 批量写尺寸（一次历史、一次落盘）。任何一条非法 → 整批不写并返回 false。 */
  setMany(entries: NodeSizeEntry[]): boolean
  /** 订阅尺寸/节点集合变化；返回取消函数 */
  subscribe(listener: (change: NodeGeometryChange) => void): () => void
}

/**
 * 带“生命周期绑定”的变体：宿主用 `createNodeGeometry` 建服务后把 `bind` 登记进插件 scope，
 * 卸载时自动摘掉内部订阅（否则热卸插件后它还活在旧 doc 上）。
 */
export interface BindableNodeGeometryService extends NodeGeometryService {
  /** 把内部对 doc 的订阅交给调用方回收 */
  bind(dispose: (fn: () => void) => void): void
}

/** 只认正的有限数：0 / 负数 / NaN / Infinity 都不算“合法尺寸” */
function isPositiveFinite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
}

/**
 * 建几何服务。只依赖 doc（数据门面），不碰 Vue / DOM / 渲染层。
 *
 * 绝对坐标在这里自己沿父链累加（与渲染层 `absolutePosition` 同语义），
 * 于是纯逻辑插件（布局、对齐、导出）不需要渲染宿主就能算矩形。
 */
export function createNodeGeometry(doc: DocService): BindableNodeGeometryService {
  const listeners = new Set<(change: NodeGeometryChange) => void>()

  const emit = (change: NodeGeometryChange): void => {
    for (const fn of [...listeners]) {
      try {
        fn(change)
      } catch {
        /* 单个订阅者异常不阻断其它订阅者/写操作 */
      }
    }
  }

  /** 绝对坐标：沿父链累加（环保护，避免脏数据死循环） */
  function absolutePosition(id: string): { x: number; y: number } {
    let node = doc.getNode(id)
    if (!node) return { x: 0, y: 0 }
    let x = node.position.x
    let y = node.position.y
    const seen = new Set<string>([id])
    while (node?.parentId) {
      if (seen.has(node.parentId)) break
      seen.add(node.parentId)
      const parent = doc.getNode(node.parentId)
      if (!parent) break
      x += parent.position.x
      y += parent.position.y
      node = parent
    }
    return { x, y }
  }

  function getRect(id: string): LayoutRect | null {
    const node = doc.getNode(id)
    if (!node?.size) return null
    const { x, y } = absolutePosition(id)
    return { id, x, y, w: node.size.w, h: node.size.h }
  }

  /**
   * 实际尺寸：自己有 size 就用，没有跟类型默认值走。
   * 画宽高 / 算布局一律用这个；`get()` 保持“只读显式尺寸”的语义（用户 2026-11-18）。
   */
  function getEffective(id: string): NodeSize | null {
    const node = doc.getNode(id)
    if (!node) return null
    if (node.size && node.size.w > 0 && node.size.h > 0) return { w: node.size.w, h: node.size.h }
    const def = doc.types.get(node.type)?.defaultSize
    return def ? { w: def.w, h: def.h } : null
  }

  // 节点集合变化（新增/删除/替换/位置/其它 data）也要通知 —— 订阅方据此重算矩形。
  // 尺寸写入会同时在 doc 里广播一次 update，所以这里统一告诉订阅方“这个节点变了”，
  // 由订阅方重读（比在这里比对前后值更省事，也避免漏掉父子关系变化）。
  const subscriptions: Array<() => void> = []
  subscriptions.push(
    doc.subscribe((change) => {
      if (change.kind !== 'node') return
      const ids = change.id ? [change.id] : []
      if (change.reason === 'add' || change.reason === 'remove' || change.reason === 'replace') {
        emit({ reason: 'ids', ids })
        return
      }
      emit({ reason: 'size', ids })
    }),
  )

  return {
    get(id) {
      const size = doc.getNode(id)?.size
      return size ? { w: size.w, h: size.h } : null
    },
    getEffective,
    getRect,
    getAllRects() {
      const out: LayoutRect[] = []
      for (const n of doc.getNodes()) {
        if (!n.size) continue
        const rect = getRect(n.id)
        if (rect) out.push(rect)
      }
      return out
    },
    childrenOf(parentId) {
      return doc
        .childNodesOf(parentId)
        .map((n) => getRect(n.id))
        .filter((r): r is LayoutRect => r !== null)
    },
    set(id, w, h) {
      if (!isPositiveFinite(w) || !isPositiveFinite(h)) return false
      if (!doc.getNode(id)) return false
      doc.setNodeSize(id, w, h)
      return true
    },
    setMany(entries) {
      if (entries.length === 0) return true
      for (const e of entries) {
        if (!isPositiveFinite(e.size.w) || !isPositiveFinite(e.size.h)) return false
        if (!doc.getNode(e.id)) return false
      }
      doc.updateNodes(entries.map((e) => ({ id: e.id, patch: { size: { w: e.size.w, h: e.size.h } } })))
      return true
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    bind(dispose) {
      dispose(() => {
        for (const off of subscriptions.splice(0)) off()
        listeners.clear()
      })
    },
  }
}
