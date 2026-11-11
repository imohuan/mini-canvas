import { reactive } from 'vue'
import { DEFAULT_EDGE_VISUAL, DEFAULT_HANDLE_VISUAL, DEFAULT_DEBUG_VISUAL, splitNodeWritePatch } from '../canvasHostCore'
import { DEFAULT_SNAP_ZONE_CONFIG } from '../../connection/geometry'
import type { CanvasHostHandle } from '../createPlumeHost'
import type { CanvasHostRenderProps } from '../canvasHostTypes'
import type { NodeWrite, NodeWritePatch } from '../../contracts/nodeRegistryKey'

export function useCanvasLayer(opts: {
  hostRef: { value: CanvasHostHandle | undefined }
  props: CanvasHostRenderProps
}) {
  const { hostRef } = opts

  // 节点写回（标题就地重命名 / 卡片 resize 尺寸）：缺省 = 改内核 nodeStore 并落盘。
  // nodeStore.subscribe 会自动刷新渲染态，无需像旧 demo 那样手动 map 改 nodes 数组。
  //
  // 保留 key `size`：写进正式尺寸字段 node.size（而非 data），与 data.cardWidth/cardHeight 同一个 patch
  // 原子提交 —— 这样 resize 一次只产生一条撤销记录，且 node.size 不再恒空（布局回退链可与数据字段一致）。
  function defaultWrite(id: string, patch: NodeWritePatch): void {
    const h = hostRef.value
    if (!h) return
    const node = h.nodeStore.getNode(id)
    if (!node) return
    const { data, size } = splitNodeWritePatch(patch)
    // 统一走 graph：历史 + 提交落盘由唯一写入口负责，避免与其它写路径漂移。
    h.graph.updateNode(id, size !== undefined ? { data, size } : { data })
  }
  const nodeWrite: NodeWrite = opts.props.nodeWrite ?? defaultWrite

  // 外观参数注入：EDGE_VISUAL(边) / CANVAS_PARAMS(浮动端口)。
  // 父级若传 props.edgeVisual / props.handleVisual（应为响应式对象，改属性实时生效），
  // 我们直接传那个引用；未传则用内部 DEFAULT reactive 回落。
  // 注意：BaseNode 读 handle 字段不做默认回落，故 handleVisual 需含全部 5 个字段（通常传一个全字段 reactive）。
  const edgeDefaultR = reactive({ ...DEFAULT_EDGE_VISUAL })
  const handleDefaultR = reactive({ ...DEFAULT_HANDLE_VISUAL })
  const debugDefaultR = reactive({ ...DEFAULT_DEBUG_VISUAL })
  const snapZoneDefaultR = reactive({ ...DEFAULT_SNAP_ZONE_CONFIG })

  const edgeVisualToProvide = opts.props.edgeVisual ?? edgeDefaultR
  const handleToProvide = opts.props.handleVisual ?? handleDefaultR
  const debugToProvide = opts.props.debugVisual ?? debugDefaultR
  const snapZoneToProvide = opts.props.snapZoneVisual ?? snapZoneDefaultR

  return {
    nodeWrite,
    edgeVisualToProvide,
    handleToProvide,
    debugToProvide,
    snapZoneToProvide,
  }
}
