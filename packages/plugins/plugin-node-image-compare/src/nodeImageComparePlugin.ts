/**
 * plugin-node-image-compare —— 图片对比节点插件（连两张图，用可拖拽分割线左右对照）。
 *
 * 对照老版 packages/canvas-core/src/nodes/image-compare/ImageCompareNodePlugin.ts：
 * - 类型声明对齐：label「图片对比」、只收图片输入、不产出输出；
 * - 老版靠 `context.on('connect')` + 手删边实现"最多 2 条、超了挤最老"；v2 里内核容量语义是"到顶就拒"，
 *   没有"满了自动挤"（commitEdge 先用内核校验拦一道，满了直接不落边）。
 *   所以本插件把声明容量设成"可见上限 + 1 个缓冲位"（见 imageCompareEngine 文件头），
 *   让第 3 条能落下来，再订阅边集变化用 planOverflowTrim 挤掉最老一条 —— 与老版行为一致但不用手写 connect 监听。
 *
 * UI 与逻辑同包：ImageCompareContent.vue 是 content 组件，二者在 apply(ctx) 里一次注册。
 * 依赖方向：只依赖内核 + 渲染层类型，不反向依赖宿主。
 */
import { Service, type Context, type PluginModule } from '@mini-canvas/canvas-base'
import type { EdgeStoreService, GraphDocumentService } from '@mini-canvas/canvas-data'
import ImageCompareContent from './ImageCompareContent.vue'
import {
  INPUT_CAPACITY,
  DIVIDER_DEFAULT,
  incomingImageEdgeIds,
  planOverflowTrim,
  clampDivider,
} from './imageCompareEngine'
// 初始/兜底高度与比较窗口里"宽度跟随"时用的兜底高度同源：
// 两处各写一个数字，迟早会在"用户还没拖过高度"时对不上（同一份真相只留一处）
import { DEFAULT_COMPARE_HEIGHT } from './compareFit'

/** 本插件注册的节点类型名 */
export const IMAGE_COMPARE_NODE_TYPE = 'image-compare'

/** 图片对比插件暴露给外部的服务形状（content 组件/宿主经 ctx.get('imageCompare') 使用） */
export interface ImageCompareNodeService {
  /** 放一个图片对比节点；返回短 id */
  addCompareNode(position: { x: number; y: number }): string
  /** 设置分割线位置（百分比，自动夹在 0~100） */
  setDividerPosition(id: string, pct: number): void
  /** 某对比节点当前的分割线位置（缺省 50） */
  getDividerPosition(id: string): number
  /** 删除节点（连带清边、可撤销、自动落盘） */
  removeNode(id: string): void
}

/** 类型增强缝：宿主/作者 ctx.imageCompare 直访时类型为本服务 */
declare module '@mini-canvas/canvas-data' {
  interface Context {
    imageCompare: ImageCompareNodeService
  }
}

/** 图片对比服务：构造即上架 'imageCompare'，方法经 this.ctx.get 惰性取现时服务（不缓存） */
export class ImageCompareService extends Service implements ImageCompareNodeService {
  constructor(ctx: Context) {
    super(ctx, 'imageCompare')
  }

  private graph(): GraphDocumentService {
    return this.ctx.get<GraphDocumentService>('graph')
  }

  addCompareNode(position: { x: number; y: number }): string {
    return this.graph().transaction('add-image-compare-node', (tx) =>
      tx.createNode(IMAGE_COMPARE_NODE_TYPE, position, { dividerPosition: DIVIDER_DEFAULT }),
    )
  }

  setDividerPosition(id: string, pct: number): void {
    const node = this.graph().getNode(id)
    if (!node) return
    const next = clampDivider(pct)
    if (node.data.dividerPosition === next) return
    // updateNode 的 data 是浅合并，只给要改的键即可（不会抹掉节点上的其它字段）
    this.graph().updateNode(id, { data: { dividerPosition: next } })
  }

  getDividerPosition(id: string): number {
    return clampDivider(Number(this.graph().getNode(id)?.data.dividerPosition))
  }

  removeNode(id: string): void {
    this.graph().removeNodes([id])
  }

  /**
   * 把某对比节点的输入边收敛到"最新两张"（FIFO）。
   * 只在超限时删边，且删边走 graph.removeEdges（可撤销、触发落盘）。
   */
  trimOverflow(targetId: string): string[] {
    const graph = this.graph()
    const edges = graph.getEdges()
    const getData = (nodeId: string) => graph.getNode(nodeId)?.data
    const incoming = incomingImageEdgeIds(edges, targetId, getData)
    const doomed = planOverflowTrim(incoming)
    if (doomed.length > 0) graph.removeEdges(doomed)
    return doomed
  }
}

export const name = 'image-compare'
export const inject = ['graph', 'edgeStore'] as string[]

/** 节点类型图标（标题左侧与"新建节点"菜单共用） */
const NODE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="18" rx="1"/><rect x="13" y="3" width="8" height="18" rx="1"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/></svg>'

/**
 * 插件主体：上架 'imageCompare' 服务 + 注册 'image-compare' 节点类型 + 订阅边变化做 FIFO 挤出。
 * 连接约束：只收图片（acceptsTypes:['image']）、不产出输出（outputs:[]）、容量 = 可见上限 + 1 缓冲位。
 */
export function apply(ctx: Context) {
  const service = new ImageCompareService(ctx)

  ctx.nodes.register({
    type: IMAGE_COMPARE_NODE_TYPE,
    label: '图片对比',
    icon: NODE_ICON,
    size: { w: 480, h: DEFAULT_COMPARE_HEIGHT },
    inputs: [{ port: 'target', acceptsTypes: ['image'], capacity: INPUT_CAPACITY }],
    outputs: [],
    resizable: true,
    content: ImageCompareContent,
    create(position) {
      return service.addCompareNode(position)
    },
  })

  // 边一有变化就看一眼各对比节点是否超限（新边连入 → 挤掉最老一条）。
  // 放在边集订阅里而不是 connect 回调里：这样"哪条算最老"永远按 edgeStore 的真实顺序判断，
  // 撤销/重做/刷新恢复也能自动收敛，不必依赖某一次事件参数。
  const edgeStore = ctx.get<EdgeStoreService>('edgeStore')
  // 挤边本身会再触发一次边变化（remove 广播）→ 用标志挡住重入，避免无谓的层层套娃；
  // 即便不挡也会自然收敛（第二次进来已不超限），这里只是把行为说得更明确。
  let trimming = false
  const off = edgeStore.subscribe(() => {
    if (trimming) return
    trimming = true
    try {
    const graph = ctx.get<GraphDocumentService>('graph')
    for (const node of graph.getNodes()) {
      if (node.type !== IMAGE_COMPARE_NODE_TYPE) continue
      service.trimOverflow(node.id)
    }
    } finally {
      trimming = false
    }
  })
  ctx.effect(() => () => off())
}

/** 兼容旧装配的 PluginModule 出口（name='image-compare' 供 HMR reload） */
export const nodeImageComparePlugin: PluginModule = { name, inject, apply }
