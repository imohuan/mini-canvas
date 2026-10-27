/**
 * canvasHostCore —— 渲染宿主组件(CanvasHost.vue)的纯逻辑部分，可脱离 DOM / Vue 单测。
 *
 * 职责：把 CanvasDemo.vue 里"store→flow 映射、主题装配、默认外观参数"这几段无副作用逻辑收拢在此，
 * CanvasHost.vue 只做接线(建 host/provide/订阅/事件)。这样核心映射逻辑有单测保护，宿主组件保持薄。
 *
 * 边界：不 import @vue-flow/core，不 import Vue 运行时；类型用最小结构接口避免拉运行时。
 */

import { isTransient, isNodeRunning, type NodeStoreService, type CanvasNode } from '@mini-canvas/canvas-data'
import type { ThemeRegistry } from '@mini-canvas/canvas-data'
import type { EdgeVisual } from '../contracts/edgeContext'
import type { CanvasParams } from '../contracts/canvasParamKey'
import type { CanvasDebug } from '../contracts/debugContext'
import type { NodeWritePatch } from '../contracts/nodeRegistryKey'
import { LAYERS } from '../contracts/layers'

// ============================================================================
// 节点写回 patch 拆分
// ============================================================================

/** 节点写回 patch 的归一结果：data 部分 + 可选正式尺寸 */
export interface NodeWriteSplit {
  /** 写进 node.data 的字段（标题/文本内容/cardWidth…） */
  data: Record<string, unknown>
  /** 保留 key `size` → node.size 正式尺寸字段；patch 未带该 key 时为 undefined */
  size?: { w: number; h: number }
}

/**
 * 把 BaseNode 经 nodeWrite 回传的 patch 拆成 { data, size } 两路。
 *
 * 保留 key `size`：卡片 resize 要把尺寸写进内核的**正式尺寸字段** node.size，而不是塞进 data。
 * 拆出来交给同一次 graph.updateNode 提交，保证「data.cardWidth 与 node.size 同帧、同一条历史」——
 * 否则一次 resize 会记两条撤销记录，且两份尺寸可能不一致。
 *
 * patch 未带 size（如标题就地重命名）→ size 为 undefined，调用方只写 data。
 */
export function splitNodeWritePatch(patch: NodeWritePatch): NodeWriteSplit {
  const { size, ...data } = patch
  return size !== undefined ? { data, size: { w: size.w, h: size.h } } : { data }
}

// ============================================================================
// store → VueFlow 渲染态
// ============================================================================

/** VueFlow 消费的节点最小形状（宿主由此驱动渲染；与 nodeStore 节点同构 + 浅拷贝 data） */
export interface FlowNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
  /** 选中态（来自内核 selection；VueFlow 据此高亮节点） */
  selected?: boolean
  /**
   * 节点可见状态（2026-10-26，docs/plan/2026-10-26-node-visibility-states.md）。
   * 通过 data._cullState 下发（'visible' | 'culled' | 'culled-linked'；transient 不下发），
   * 壳按状态自选绘制深度。hidden 只用于压缩档的纯 culled 节点（见 compactShells 参数注释）。
   */
  /** 兼容保留：hidden 路线已退役，恒 false（显式写以清除 VueFlow 合并语义的旧残留） */
  hidden?: boolean
  /** 父节点 id（内核 CanvasNode.parentId 投影；VueFlow 父子嵌套字段名是 parentNode，
   *  子 position 视为相对父的局部坐标，渲染层级自动排在父之上） */
  parentNode?: string
  /** 渲染层级（容器型 transparent 类型投影为 -1，垫到边层之下） */
  zIndex?: number
  /** 声明尺寸 → 像素 style（内核 CanvasNode.size 投影） */
  style?: { width: string; height: string }
  /** 临时脚手架节点（拖线落空白的菜单节点）：在 VueFlow 维度关闭交互 */
  draggable?: boolean
  selectable?: boolean
  deletable?: boolean
  focusable?: boolean
}

/**
 * 把内核 nodeStore 当前节点灌成 VueFlow 节点数组（data 浅拷贝，避免共享引用被 Vue 改写污染内核）。
 * @param selectedIds 内核选中的节点 id 集（可选）：传入则给匹配节点打 selected=true，驱动 VueFlow 高亮；
 *   不传则不带 selected 字段（向后兼容）。
 */
/**
 * cullIds —— 可见剔除集合（2026-10-15 性能优化，docs/plan/2026-10-15-canvas-perf-diagnosis.md §九）。
 * 语义（2026-10-26 更新）：集合 = 视口(+缓冲带)内节点。**hidden 路线已退役** ——
 * VueFlow EdgeWrapper 对 hidden 端点的边整体不画（连线随节点消失，用户实测断线）。
 * 现在集合只用于派生 data._cullState（visible / culled / culled-linked），
 * 节点一律常驻渲染，绘制深度由壳（BaseNode 等按状态自选）决定 —— 性能回收在壳层不挂内容。
 * null / undefined = 不剔除（全量渲染，未挂载/禁用时的安全兜底）。
 * 零例外规则：选中/拖拽中/分组父节点一律走同一相交判定，不做特判（选中是数据态不依赖 DOM）。
 */
export function nodesFromStore(
  store: NodeStoreService,
  selectedIds?: ReadonlySet<string>,
  cullIds?: ReadonlySet<string> | null,
  /** 与被剔除节点相连的节点 id 集（任一端被剔除的边，其两端都算 linked） */
  linkedIds?: ReadonlySet<string>,
  /**
   * 屏外壳压缩（canvasInteractionSettings.cullCompactShells）：true 时纯 culled 节点
   * （视口外且不在 linkedIds）hidden=true —— VueFlow 不产出任何 DOM（壳数量压到
   * 可视 + 跨线节点数）。**绝不允许 hidden 落在 linkedIds 里的节点**：VueFlow 对
   * hidden 端点的边整体不画（2026-10-26 断线教训）。false = 壳全挂（缺省兜底）。
   */
  compactShells?: boolean,
): FlowNode[] {
  return store.getNodes().map((n: CanvasNode) => {
    const selected = selectedIds ? selectedIds.has(n.id) : false
    const out: Record<string, unknown> = {
      id: n.id,
      type: n.type,
      position: { x: n.position.x, y: n.position.y },
      data: { ...(n.data as Record<string, unknown>) },
      // 显式分层（不再依赖 DOM 顺序）：普通节点同层，选中节点抬一档。
      // 选中抬层**只在置顶连线之下**（用户口述的层级语义）——见 contracts/layers 的带序。
      zIndex: selected ? LAYERS.nodeSelected : LAYERS.node,
    }
    if (selectedIds) out.selected = selected
    // hidden 只允许出现在压缩档的**纯 culled**节点上（不在 linkedIds —— 与任何跨内外连线无关，
    // 连线不会被连坐）。visible / culled-linked / transient 一律 false 且**显式写**：
    // VueFlow 内部 store 对节点更新是合并语义，旧残留的 true 必须显式清除。
    const culled = Boolean(cullIds) && !cullIds!.has(n.id)
    const compactHidden = compactShells === true && culled && !linkedIds?.has(n.id)
    out.hidden = compactHidden
    // 可见状态注入 data（壳消费；VueFlow 不认识该字段，零副作用）。
    // transient 不参与剔除（2026-10-16 拖线弹菜单失效的根因），恒 visible。
    if (!isTransient(n)) {
      const data = out.data as Record<string, unknown>
      // 压缩档的纯 culled 节点没有壳，状态无消费方 —— 不注入，保持 data 干净。
      if (!compactHidden) {
        data._cullState = !culled ? 'visible' : (linkedIds?.has(n.id) ? 'culled-linked' : 'culled')
      }
    }
    // —— v2 渲染投影：CanvasNode.parentId/size → VueFlow 父子/尺寸（group 插件依赖）——
    // parentNode：VueFlow(1.48) 的父子字段。挂上后子节点 position 按相对父解析，
    // 且 z = 父 z + 1（getXYZPos），分组卡片永远垫在子节点下面。
    if (n.parentId) out.parentNode = n.parentId
    // 容器型类型（transparent，如分组）z 按嵌套深度分层：外层组 groupBase、内层组 groupNested。
    // 注意 VueFlow getXYZPos：有父节点的 computed z = max(父z, 自身z) + 1，**逐级累加**。
    //   所以普通子节点的 computed z 恒比父组高 1（父在 groupBase 时 → groupBase+1）；
    //   嵌套子节点的父是内层组（groupNested+1）→ 再 +1，仍远低于 edge，"连线夹在组与子节点之间"不变。
    // 全部数值来自 contracts/layers（唯一事实源），不再写裸数字。
    if (store.types.get(n.type)?.transparent === true) {
      let depth = 0
      let cur = n
      const seen = new Set<string>([n.id])
      while (cur.parentId) {
        if (seen.has(cur.parentId)) break
        seen.add(cur.parentId)
        const p = store.getNode(cur.parentId)
        if (!p || p.type !== 'group') break
        depth += 1
        cur = p
      }
      out.zIndex = depth === 0 ? LAYERS.groupBase : LAYERS.groupNested
    }
    // size → style 像素尺寸：VueFlow 用它布局父容器/边界；无 size 则交由节点壳自撑。
    //
    // 例外：声明 loadingDefaultSize 的类型（图片/视频）在跑任务时投影**类型默认尺寸** ——
    // 包裹尺寸与卡片实测尺寸一起落到用户在设置里配的默认宽高，加载态那张卡就是横屏默认态，
    // 而不是上一次那张图/视频的比例。只影响渲染，不动 node.size：任务结束 runState 一变比例就回来。
    //
    // 为什么投影默认尺寸、而不是干脆不给 style：VueFlow 对节点更新是**合并**语义，
    // 去掉 style 不会把上一次写进 DOM 的 width/height 抹掉（实测：包裹仍停在旧比例）；
    // 显式给一个值才会真正改写。
    const loadingSize = store.types.get(n.type)?.loadingDefaultSize === true && isNodeRunning(n) ? store.types.get(n.type)?.defaultSize : undefined
    const styleSize = loadingSize ?? n.size
    if (styleSize) out.style = { width: styleSize.w + 'px', height: styleSize.h + 'px' }
    // 中间态节点（如拖线落空白时的菜单卡）—— 必须在 VueFlow 维度隔离：
    //   draggable/selectable/deletable 全关 → pane click 的 removeSelectedElements 摸不到它、
    //   不会拖动、不会进 VueFlow 内部选中集。判定读内核通用契约，不认识具体插件。
    if (isTransient(n)) {
      out.draggable = false
      out.selectable = false
      out.deletable = false
      out.focusable = false
      // 临时菜单卡（拖线落空白的选类型卡）恒在最上层：不提升会被普通节点压在下面
      //（用户实测截图：菜单卡被嵌套组内的 image 节点盖住）
      out.zIndex = LAYERS.tempNode
    }
    return out as unknown as FlowNode
  })
}

/**
 * 拖动中的节点位置覆盖层（store → VueFlow 投影用）。
 *
 * 为什么需要它：VueFlow 原生拖拽**只在松手时落盘**，拖动期间 store 仍是起手位置。
 * 而滚轮缩放会改变可见剔除集合，宿主随即用 store 整批重灌渲染态 —— 结果是正在拖的
 * 节点被旧位置拉回（用户实测：拖动后缩放，节点跳回拖拽前的位置）。
 *
 * 投影时把「VueFlow 此刻的真实位置」盖在 store 位置之上，既保留拖动跟手，
 * 又不把这次位移写进数据层（松手仍由宿主 onNodeDragStop 统一落盘）。
 *
 * @param positions 被拖动节点的实时位置（id → flow 坐标）；空表 = 不覆盖
 */
export function overlayDraggingPositions(
  target: FlowNode[],
  positions: ReadonlyMap<string, { x: number; y: number }> | undefined,
): FlowNode[] {
  if (!positions || positions.size === 0) return target
  return target.map((node) => {
    const live = positions.get(node.id)
    return live ? { ...node, position: { x: live.x, y: live.y } } : node
  })
}

/** 现有边保留(宿主内维护)；当节点被删时清掉悬挂边 */
export function pruneDanglingEdges<T extends { source: string; target: string }>(
  edges: T[],
  aliveNodeIds: Set<string>,
): T[] {
  return edges.filter((e) => aliveNodeIds.has(e.source) && aliveNodeIds.has(e.target))
}

/** 命中检测用的节点矩形（flow 绝对坐标；由 nodeLayout 实测尺寸给出） */
export interface NodeRectLike {
  id: string
  x: number
  y: number
  w: number
  h: number
}

/**
 * 松手点是否落在某个节点卡片上（用于区分"落空白"与"落节点上"）。
 *
 * 为什么需要它：拖线松手时"没建成边"有**三种**原因，只有第一种是真空白 ——
 *   ① 落在空白处（真该放临时节点/弹菜单）；
 *   ② 落在节点上但连接不成立（类型不符 / 输入口已满 / 成环 / 重复）；
 *   ③ 落在节点上但方向不符（如从输出口拖到另一个输出口）。
 * 后两种"没建成边"只说明这条连接不合法，落点明明在卡片上，不该冒出"在此处新建节点"的菜单。
 *
 * 为什么用几何命中而不是 elementFromPoint：拖线期间画布挂着 `.connecting` 端口覆盖层，
 * elementFromPoint 命中的是覆盖元素而不是节点卡片（本项目已踩过这个坑）。
 *
 * @param point 松手点（flow 坐标）
 * @param rects 存活节点矩形
 * @returns 命中的节点 id；未命中返回 null（= 真空白）
 */
export function hitNodeIdAt(
  point: { x: number; y: number },
  rects: readonly NodeRectLike[],
): string | null {
  for (const r of rects) {
    if (point.x >= r.x && point.x <= r.x + r.w && point.y >= r.y && point.y <= r.y + r.h) {
      return r.id
    }
  }
  return null
}

// ============================================================================
// themeRegistry 装配
// ============================================================================

/** 主题装配结果：宿主拿去填 VueFlow 的 node-types/edge-types + 背景 + 建边默认 type */
export interface ThemeAssembly {
  /** 节点壳组件（nodeShell 槽位；缺省 undefined = 无壳/裸内容） */
  nodeShell: unknown
  /**
   * 每个业务 type 最终用的节点壳（type → 组件）。
   * 解析顺序：`nodeShell:<type>`（该类型自带外壳）→ `nodeShell`（全局默认壳）。
   * 于是某插件想完全自定义自己节点的外观时，注册 `nodeShell:<type>` 即可，不必让默认壳去认识它。
   */
  nodeShells: Record<string, unknown>
  /** 边渲染组件（edge 槽位，放 edgeTypes.custom） */
  edge: unknown
  /** 画布背景组件（background 槽位；缺省 undefined） */
  background: unknown
  /** 拖线临时连接线组件（connectionLine 槽位；缺省 undefined = 宿主回退默认线） */
  connectionLine: unknown
  /** 所有边默认 type 键（edgeDefaultType 槽位；缺省 'custom'） */
  edgeDefaultType: string
  /** 展示注册表里已注册的业务 type 列表（用于铺 nodeTypes 键） */
  nodeTypes: string[]
}

/**
 * 某业务 type 的"专属节点壳"槽名（插件注册它即接管该 type 的整体外观）。
 *
 * 为什么需要：默认壳（如 theme-default 的 BaseNode）提供的是通用卡片外观；
 * 某些节点类型形态特殊（不是"标题+内容"那种卡片），由它自己决定怎么画最合适。
 * 与其让默认壳去猜/认识每个特殊类型，不如让特殊类型自带外壳 —— 默认壳保持通用、零特判。
 */
export function nodeShellSlot(type: string): string {
  return `nodeShell:${type}`
}

/**
 * 从 themeRegistry 读整幅画布渲染所需的外观装配。
 * 节点 type 键来自 nodeStore 已注册类型(经 store 传入)而非 themeRegistry（节点是业务侧注册的）。
 */
export function assembleTheme(
  theme: ThemeRegistry | undefined,
  storeTypes: Iterable<string>,
  /**
   * `registryOf('node/shell')`（壳组件的场；缺省 = 只读 themeRegistry，行为同旧）。
   *
   * 为什么要有它：设计文档 §4.5 把 `node/shell` 定义为"键=节点 type 或 `*`，值=壳组件"，
   * 案例 3/8 教作者用它 `add`/`wrap` 换壳。若这里不读它，那些写法**不报错也不生效**
   * （作者最怕的静默失效）。解析顺序见下。
   */
  shellField?: {
    has(key: string): boolean
    resolve(key: string, base?: unknown): unknown
  },
): ThemeAssembly {
  const shell = theme?.get('nodeShell')
  const edge = theme?.get('edge')
  const background = theme?.get('background')
  const connectionLine = theme?.get('connectionLine')
  const edgeDefaultType =
    (theme?.get('edgeDefaultType') as string | undefined) ?? 'custom'
  const nodeTypes = [...storeTypes]
  // 每 type 解析外壳，四级优先（自上而下第一个命中的赢）：
  //   ① 场 `node/shell/<type>`（精确；resolve 让 wrap 合成生效 = 设计文档案例 3/8 的写法）
  //   ② 场 `node/shell/*`（通配：一处换掉所有节点的壳）
  //   ③ theme 槽 `nodeShell:<type>`（某类型自带外壳）
  //   ④ theme 槽 `nodeShell`（全局默认壳，即 BaseNode 那层）
  // 场排在前面是因为它**语义更窄、更是显式 opt-in**（主题槽是"默认皮"，场是"我就要这个"）。
  // 这样"特殊形态的节点"由它自己的插件负责长相，默认壳不需要任何针对它的分支。
  const nodeShells: Record<string, unknown> = {}
  for (const t of nodeTypes) {
    const own = theme?.get(nodeShellSlot(t))
    // 场外兜底 = theme 槽给的那份壳（精确槽优先、否则全局默认壳）。
    // 把它当 base 交给场的 resolve，作者 wrap 时 inner 就是"原来那个壳"（案例 3/8 的"原值不丢"）。
    const base = own !== undefined ? own : shell
    // 先精确键、再通配键（用 has 判断"这个键上到底有没有人"——不能靠 resolve 的返回值判，
    // 因为给了 base 之后 resolve 在"键为空"时也返回 base，会把通配忽略掉）。
    const fromField =
      shellField === undefined
        ? undefined
        : shellField.has(t)
          ? shellField.resolve(t, base)
          : shellField.has('*')
            ? shellField.resolve('*', base)
            : undefined
    if (fromField !== undefined) nodeShells[t] = fromField
    else if (base !== undefined) nodeShells[t] = base
  }
  return {
    nodeShell: shell,
    nodeShells,
    edge,
    background,
    connectionLine,
    edgeDefaultType,
    nodeTypes,
  }
}

// ============================================================================
// 默认外观参数（host 未显式传参时的回落；对齐 core-node-contract §0）
// 类型复用 contracts 的 EdgeVisual / CanvasParams（自定义边/端口注入契约），避免重复定义。
// ============================================================================

export const DEFAULT_EDGE_VISUAL: EdgeVisual = {
  edgeType: 'bezier',
  edgeLineWidth: 2,
  edgeColor: '#3b82f6',
  edgeDashed: false,
  edgeMarkerEnd: false,
  edgeMarkerSize: 8,
  edgeVisible: true,
  edgeVisibleOnSelect: false,
  edgeOnTop: false,
  edgeGlowEnabled: true,
  edgeGlowIntensity: 1,
  edgeGlowColor: '#3b82f6',
  // —— 连线新视觉默认（导轨 + 光斑流动；与 plugin-theme-default DEFAULT_THEME_EDGE 对齐）——
  edgeFlowEnabled: true,
  edgeFlowCount: 3,
  edgeFlowRatio: 20,
  edgeFlowSpeed: 1,
  edgeFlowFade: 35,
  edgeFlowIntensity: 0.9,
}

/** 浮动端口外观默认值（对齐 BaseNode DEFAULT_HANDLE / contract §0） */
/**
 * T10 决策（2026-09-27）：portZone 三项对齐 theme-default 的 DEFAULT_THEME_HANDLE（10/0.55/0.8），
 * 消除"宿主回落 86/0.8/1 vs 主题 10/0.55/0.8"的双源漂移（核心节点契约 §9-1）。
 * 依据：成品应用一直走主题值（App.vue 传 :handle-visual=ui.cfg.handle），86 只在
 * 未装主题插件的自建宿主生效 —— 对齐后自建宿主与成品观感一致。决策理由详见
 * docs/plans/2026-09-27-port-zone-default-decision-brief.md。
 */
export const DEFAULT_HANDLE_VISUAL: CanvasParams = {
  handleRestOffset: 36,
  handleCursorGap: 24,
  handleButtonSize: 32,
  portZoneWidth: 10,
  portZoneHeightRatio: 0.55,
  portZoneOffset: 0,
  portZoneShape: 'arc',
  portZoneArcRatio: 0.8,
}

/** 调试可视化开关默认值（**默认开**：端口调试 + 吸附调试都开，方便设计/排错直观看到端口几何 + 吸附范围） */
export const DEFAULT_DEBUG_VISUAL: CanvasDebug = {
  handleDebug: true,
  connectionSnapDebugVisible: true,
}

/** VueFlow 消费的边最小形状（含端口句柄，B 项：多端口边按 handle 匹配端点） */
export interface FlowEdge {
  id: string
  type: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  /** 附加数据（透传给边组件；中间态标记见内核 services/transient.ts） */
  data?: Record<string, unknown>
  /** 中间态边：不可选中/不可删除（VueFlow 侧隔离） */
  selectable?: boolean
  focusable?: boolean
  deletable?: boolean
  zIndex?: number
}

/**
 * 把内核 edgeStore 当前边灌成 VueFlow 边数组，并过滤掉 source/target 已不在存活节点集的悬挂边。
 * B 项：DTO 保留 sourceHandle/targetHandle —— 渲染层能按端口匹配端点，不再丢弃（单端口节点无影响）。
 */
export function edgesFromStore(
  edges: Array<{ id: string; type?: string; source: string; target: string; sourceHandle?: string; targetHandle?: string; data?: Record<string, unknown> }>,
  aliveNodeIds: ReadonlySet<string>,
  /** 选中节点 id 集：任一端选中的普通边抬到 LAYERS.edgeSelected（选中节点 > 其连线 > 其余）。
   *  不传 = 全部普通边不带 zIndex（向后兼容；置顶开关路径也不传，见 CanvasHost.syncFromStore）。 */
  selectedNodeIds?: ReadonlySet<string>,
): FlowEdge[] {
  return edges
    .filter((e) => aliveNodeIds.has(e.source) && aliveNodeIds.has(e.target))
    .map((e) => ({
      id: e.id,
      type: e.type ?? 'custom',
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      ...(e.data ? { data: e.data } : {}),
      // 中间态边（拖线占位）—— 同样在 VueFlow 维度隔离：不可选中/不可键盘删除，与正式边视觉共存但语义隔离。
      // 判定读内核通用契约，不认识具体插件。
      ...(isTransient(e)
        ? { selectable: false, focusable: false, deletable: false, zIndex: LAYERS.tempEdge }
        : selectedNodeIds && (selectedNodeIds.has(e.source) || selectedNodeIds.has(e.target))
          ? { zIndex: LAYERS.edgeSelected }
          : {}),
    }))
}
