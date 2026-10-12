/**
 * plugin-node-ui —— 「AI 可视化节点」插件。
 *
 * ## 这个节点是什么
 *
 * **一块画布。** 它自己没有界面、没有状态、没有按钮 —— 内容由 **Agent** 写进去
 * （一段 HTML，节点里就地渲染出来）。所以它只做三件事：
 *
 *   1. 注册一种节点类型（一块可以放 HTML 的面板）；
 *   2. 上架一个服务，让 **Agent / MCP** 把生成的 HTML 写进来；
 *   3. 挂一条命令，让外部（Agent、MCP、快捷键）能一次性拿到「该画什么」所需的全部上下文。
 *
 * ## 为什么不做自己的底栏 / 参数面板（2026-10-12 用户口径）
 *
 * 用户原话：「没必要给他画 UI 了……如果要给他画 UI，可以直接交给那个 Agent，那个 AI 做得更完善一些。」
 * 判断是对的：这个节点的内容本来就是「AI 现写的一段界面」，那我们再手写一条底栏、再让用户
 * 手动声明参数，等于把同一件事做两遍，而且做得更差。**让 Agent 全权负责**：
 * 它看得到节点连了什么、后台有哪些接口、画布上还有什么，一次就能写对。
 *
 * 所以这里**没有**底栏动作、**没有**设置面板、**没有**自己的状态提示。空态只说一句话：
 * 让 Agent 帮你画。
 *
 * ## 依赖方向
 *
 * 只依赖内核（canvas-base / canvas-data）+ 渲染层；**不 import 底栏、不 import Agent**。
 * 与 Agent 的协作走「服务 + 命令」这两条公开缝：Agent 调得到我们，我们不需要认识它。
 */
import { Service, type Context, type ConfigSchema, bindTypeDefaultSize, type PluginModule } from '@mini-canvas/canvas-base'
import type { DocService } from '@mini-canvas/canvas-data'
import { extractHtml, normalizeInputs, normalizeUpstream, type UiInputDecl } from './uiData'
import { fetchBackendOrigin } from './uiOrigin'
import { currentCanvasId, readUiConfig, resolveBaseUrl } from './uiConfig'
import UiContent from './UiContent.vue'

/** 本插件注册的节点类型名 */
export const UI_NODE_TYPE = 'ui'

/** 节点 data 里的字段名（写在多处共用；改这里就是改契约） */
export const UI_DATA_KEYS = {
  /** 节点里渲染的 HTML（内容本体，由 Agent 写入） */
  html: 'uiHtml',
  /** 写入时间（展示"什么时候画的"） */
  at: 'uiGeneratedAt',
  /** 是谁写的（'agent' / 'mcp' / 'user'，排查用） */
  by: 'uiBy',
  /** 后台自己的地址（生成的页面直连它；见下方 ensureBackendOrigin） */
  origin: 'uiBackendOrigin',
  /** 输入参数声明（可选：不声明就只给原始数据，AI 自己理解） */
  inputs: 'uiInputs',
  /** 手工填的参数值（可选） */
  values: 'uiValues',
  /** 上一次用到的上游素材（渲染时按它注入数据） */
  upstream: 'uiUpstream',
} as const

/** 本插件暴露给外部的服务形状（Agent / MCP / 别的插件经 ctx.get('uiNode') 使用） */
export interface UiNodeService {
  /** 在画布上放一个可视化节点，返回短 id */
  addNode(position: { x: number; y: number }): string
  /**
   * 写一段 HTML 进节点（**这是 Agent 的主要入口**）。
   * @param source 谁写的（'agent' / 'mcp' / 'user'），只用于排查与展示
   * @returns 是否写入成功（节点不存在 → false）
   */
  setHtml(id: string, html: string, source?: string): boolean
  /** 读某节点当前渲染的 HTML（空串 = 还没画） */
  htmlOf(id: string): string
  /** 读某节点声明的输入参数 */
  inputsOf(id: string): UiInputDecl[]
  /** 清掉内容（回到空态） */
  clear(id: string): boolean
}

/** 类型增强缝（cordis 声明合并）：宿主/作者 ctx.uiNode 直访时类型为本服务 */
declare module '@mini-canvas/canvas-data' {
  interface Context {
    uiNode: UiNodeService
  }
}

/** uiNode 服务：构造即上架，方法经 this.ctx.get 惰性取现时服务（不缓存） */
export class UiNodeService_ extends Service implements UiNodeService {
  constructor(ctx: Context) {
    super(ctx, 'uiNode')
  }

  private doc(): DocService {
    return this.ctx.get('doc')
  }

  addNode(position: { x: number; y: number }): string {
    return this.doc().transaction('add-ui-node', (tx) =>
      tx.createNode(UI_NODE_TYPE, position, { [UI_DATA_KEYS.inputs]: [], [UI_DATA_KEYS.values]: {} }),
    )
  }

  setHtml(id: string, html: string, source = 'agent'): boolean {
    const doc = this.doc()
    if (!doc.getNode(id)) return false
    // 走 doc.updateNode：是作品，进历史 + 落盘 + 经 cloud-client 同步。
    // 顺手剥一次代码块 —— Agent 常把 HTML 包在 markdown 里交出来。
    doc.updateNode(id, {
      data: {
        [UI_DATA_KEYS.html]: extractHtml(html),
        [UI_DATA_KEYS.at]: Date.now(),
        [UI_DATA_KEYS.by]: source,
      },
    })
    return true
  }

  htmlOf(id: string): string {
    const v = this.doc().getNode(id)?.data?.[UI_DATA_KEYS.html]
    return typeof v === 'string' ? v : ''
  }

  inputsOf(id: string): UiInputDecl[] {
    return normalizeInputs(this.doc().getNode(id)?.data?.[UI_DATA_KEYS.inputs])
  }

  clear(id: string): boolean {
    const doc = this.doc()
    if (!doc.getNode(id)) return false
    doc.updateNode(id, { data: { [UI_DATA_KEYS.html]: '', [UI_DATA_KEYS.by]: '' } })
    return true
  }
}

export const name = 'node-ui'
/** 硬依赖：节点数据走 doc 门面（宿主恒在）。**不需要**底栏 —— 本插件不参与底栏。 */
export const inject = ['doc'] as string[]

/** 节点类型图标 */
const NODE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>'

/**
 * 本插件可配置项。只剩两条真正读得到的（键名带 uiNode 前缀：settings 是全局同一张表）。
 */
export const Config: ConfigSchema = {
  uiNodeAllowNetwork: {
    type: 'boolean',
    default: true,
    label: '允许界面调用后台',
    group: '常规/可视化节点',
    description:
      '打开后，节点里渲染的界面可以直接调画布接口（改节点、下单生成）—— 也就是能「操作画布」而不只是画给你看。关掉 = 纯展示，界面连不上网络。',
  },
  uiNodeDefaultWidth: {
    type: 'number',
    default: 420,
    min: 120,
    max: 2000,
    step: 10,
    label: '默认宽',
    group: '布局/可视化节点尺寸',
    description: '可视化节点没有自己的尺寸时用的宽度（px）。改完立即生效：没被手动拖过尺寸的节点会立刻跟着变。',
  },
  uiNodeDefaultHeight: {
    type: 'number',
    default: 320,
    min: 100,
    max: 2000,
    step: 10,
    label: '默认高',
    group: '布局/可视化节点尺寸',
    description: '可视化节点没有自己的尺寸时用的高度（px）。改完立即生效（同上）。',
  },
}

export function apply(ctx: Context) {
  // 1. 构造即上架 'uiNode' 服务（Agent / MCP 通过它写内容）
  const uiNode = new UiNodeService_(ctx)

  // 2. 注册节点类型：一块画布（内容组件把 HTML 渲染出来）
  ctx.nodes.register({
    type: UI_NODE_TYPE,
    label: '可视化',
    nameTemplate: '可视化 {{ID}}',
    description: '一块画布：内容由 Agent 生成（HTML 就地渲染）',
    icon: NODE_ICON,
    size: { w: 420, h: 320 },
    // 内容铺满整张卡：外壳那圈边框对它没有分层价值（与图片节点同一个理由）
    frameless: true,
    resizable: true,
    // 输入口收一切素材（文本/图片/视频/音频都能连进来当数据源）。
    // outputs 显式声明为空数组 = 不产出、不往下游传东西 —— 与 3d-preview 的写法一致
    // （那个预览节点也是终端节点，同样写 outputs: []）。
    inputs: [{ port: 'target', acceptsTypes: ['text', 'image', 'video', 'audio'] }],
    outputs: [],
    in: UiContent,
    create(position) {
      return uiNode.addNode(position)
    },
  })

  // 默认尺寸接设置面板：改完实时生效（没 resize 过的节点立刻跟着变）
  bindTypeDefaultSize(ctx, UI_NODE_TYPE, { w: 420, h: 320 }, {
    widthKey: 'uiNodeDefaultWidth',
    heightKey: 'uiNodeDefaultHeight',
  })

  // 3. 给 Agent 的入口（**本插件的核心缝**）
  //
  //    ui.getContext：一次性拿齐「该画什么」所需的全部上下文 —— 节点信息、连进来的素材、
  //      后台地址与接口说明、当前画布。Agent 调它就够动手了，不必自己去翻画布。
  //    ui.setHtml  ：把生成的 HTML 写回来（也可由 Agent 直接调 ctx.get('uiNode').setHtml）。
  ctx.commands.register({
    id: 'ui.getContext',
    title: '读取可视化节点的上下文',
    run: (_c, payload) => {
      const { nodeId } = (payload ?? {}) as { nodeId?: string }
      if (!nodeId) return false
      // 结果经事件回给调用方（命令的返回值只表示"成功/失败"）——
      // 为什么用事件而不是直接返回：命令契约是同步布尔；而 Agent 需要的是**数据**。
      ctx.emit('ui/context', buildNodeContext(ctx, nodeId))
      return true
    },
  })

  ctx.commands.register({
    id: 'ui.setHtml',
    title: '写入可视化 HTML',
    run: (_c, payload) => {
      const { nodeId, html, source } = (payload ?? {}) as { nodeId?: string; html?: string; source?: string }
      if (!nodeId || typeof html !== 'string') return false
      return uiNode.setHtml(nodeId, html, source ?? 'command')
    },
  })

  ctx.commands.register({
    id: 'ui.clear',
    title: '清空可视化节点',
    run: (_c, payload) => {
      const { nodeId } = (payload ?? {}) as { nodeId?: string }
      return nodeId ? uiNode.clear(nodeId) : false
    },
  })

  registerEventName(ctx, 'ui/context')
}

/** 声明一个事件名（内核要求"发之前先登记"，否则会 warn；见 design 文档 §7.4） */
function registerEventName(ctx: Context, eventName: string): void {
  const anyCtx = ctx as unknown as { registerEventName?: (n: string) => void }
  anyCtx.registerEventName?.(eventName)
}

/**
 * 组装「该画什么」的全部上下文。
 *
 * 为什么后端算而不是让 Agent 自己拼：素材在边里、接口地址在配置里、画布 id 在 URL 里 ——
 * 这三样分散在三处，Agent 每次自己找容易漏（漏一处的表现是"生成的界面连不上后台"，
 * 而它看起来只是空白，很难查）。收在这里算一次，Agent 拿到的就是完整的一份。
 */
export function buildNodeContext(ctx: Context, nodeId: string): {
  nodeId: string
  canvasId: string
  baseUrl: string
  /** 连进本节点的素材（Agent 据此知道有哪些数据可画） */
  upstream: Array<{ refName: string; kind: string; url?: string; value?: string; nodeId?: string }>
  /** 声明的输入参数（可选；没声明就是空数组，不影响） */
  inputs: UiInputDecl[]
  /** 后台接口速查（写进提示词用；空 baseUrl 时为空串） */
  apiHint: string
} {
  const doc = ctx.get<DocService>('doc')
  const data = (doc.getNode(nodeId)?.data ?? {}) as Record<string, unknown>
  const cfg = readUiConfig(ctx.tryGet<{ get(key: string): unknown }>('settings'))
  const href = typeof location !== 'undefined' ? location.href : undefined
  const baseUrl = resolveBaseUrl(cfg, href)

  // 上游素材：从边里现算（本插件不认识"边"的语义，只按 target===本节点 收集）
  const nodes = doc.getNodes()
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const raw: Array<Record<string, unknown>> = []
  // 同一个上游节点可能有多条边连过来（重复连），只算一次 ——
  // 与底栏 collectUpstreamMaterials 的既有语义一致。
  const seen = new Set<string>()
  for (const e of doc.getEdges()) {
    if (e.target !== nodeId) continue
    if (seen.has(e.source)) continue
    const src = byId.get(e.source)
    if (!src) continue
    seen.add(e.source)
    const d = (src.data ?? {}) as Record<string, unknown>
    const url = [d.imageUrl, d.videoUrl, d.audioUrl, d.panoUrl].find((u): u is string => typeof u === 'string' && !!u)
    const text = typeof d.text === 'string' ? d.text : undefined
    raw.push({
      id: src.id,
      kind: src.type,
      ...(typeof d.label === 'string' ? { name: d.label } : {}),
      ...(url ? { url } : {}),
      ...(text ? { value: text } : {}),
    })
  }

  return {
    nodeId,
    canvasId: currentCanvasId(href),
    baseUrl,
    upstream: normalizeUpstream(raw),
    inputs: normalizeInputs(data[UI_DATA_KEYS.inputs]),
    apiHint: baseUrl
      ? 'base = ' + baseUrl + '；画布读写 /api/canvases/<canvasId>（GET 取全量、PUT 整体写回）；下单 POST /api/jobs'
      : '',
  }
}

/** 兼容旧装配的 PluginModule 出口（name='node-ui' 供 HMR reload） */
export const nodeUiPlugin: PluginModule = { name, inject, Config, apply }

