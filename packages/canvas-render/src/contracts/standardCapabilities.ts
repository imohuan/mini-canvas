/**
 * standardCapabilities —— 宿主提供的**标准能力包**（设计文档 §4.5「capability」/ 案例 5 / 决策 9）。
 *
 * 为什么要有标准四件：作者抱怨的"组件里得重复实现一堆通用 hooks"——读节点、改节点、
 * 看缩放、看选中、调工具，这四件事每个节点插件都在各写一份。宿主把它们注册进
 * registryOf('capability')，插件只需在 attach 里写 needs: ['node','zoom']。
 *
 * 与决策 9 的关系：
 * - ① 谁有权注册：不设限 —— 任何插件都能注册同名能力（order 小者赢，主题插件因此能整套换掉）。
 *   本模块只是**宿主那一份**的默认实现，不是唯一入口。
 * - ② 实例作用域：工厂每节点调一次（由消费方组件回收，见 createCapabilityCache）。
 * - ③ 缺项行为：本模块不参与 —— 由 createCapabilityCache 按 ctx.isDev 裁决。
 */
import type { Ref } from 'vue'
import type { CapabilityFactory } from './capabilities'
import type { Context } from '@mini-canvas/canvas-data'

/** node 能力：本节点的身份 / 数据 / 写回 */
export interface NodeCapability {
  readonly id: string
  readonly type: string
  /** 节点数据（活引用：外部改 data 这里立刻看得到） */
  readonly data: Readonly<Ref<Record<string, unknown>>>
  /** 当前标题（data.label；没设过 = undefined，调用方自行回落 type） */
  label(): string | undefined
  /** 就地改名（写回走唯一图写入口，自动进历史 + 落盘） */
  setLabel(label: string | undefined): void
  /** 写回任意 data 字段（同一个 patch = 一条历史） */
  update(patch: Record<string, unknown>): void
}

/** zoom 能力：读当前缩放 + 控制视口 */
export interface ZoomCapability {
  /** 当前缩放（活引用；已防零） */
  readonly zoom: Readonly<Ref<number>>
  /** 当前视口（x/y/zoom 快照） */
  viewport(): { x: number; y: number; zoom: number }
  zoomIn(): void
  zoomOut(): void
  zoomTo(level: number): void
  fitView(): void
  /** 把视图中心挪到某画布坐标（保留当前缩放） */
  centerOn(x: number, y: number): void
}

/** selected 能力：本节点的选中态 */
export interface SelectedCapability {
  /** 是否在选中集里（活引用） */
  readonly selected: Readonly<Ref<boolean>>
  /** 是否被**单独**选中（恰好一个且就是我；操作栏显隐的既有语义，活引用） */
  readonly solo: Readonly<Ref<boolean>>
}

/** tools 能力：调 ctx.tools 里的生成工具（文生图/图生文…），插件零 import */
export interface ToolsCapability {
  list(): Array<{ name: string; title?: string; description?: string; group?: string; produces?: string }>
  invoke(name: string, input: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>
}

/**
 * selection 能力：当前"选中的是哪一批"（多选框上的按钮用 —— 它不是某一个节点，是一批）。
 *
 * 与 SelectedCapability（"我（某个节点）是否被选中"）的区别：这个是**读者视角看整个选择集**，
 * 给多选框区域栏用。两者名字相邻但语义不同：selected 回答"我在不在里面"，selection 回答"里面有谁"。
 *
 * 为什么是方法（ids()/nodes()）而不是只读 Ref：选择集是多选框区域的**跨条目共享**输入，
 * 每帧都可能变；方法式快照让调用方在它真正需要的那一刻取值，避免把一份会变的值烘进注册时。
 */
export interface SelectionCapability {
  /** 当前选中的节点 id 列表（快照） */
  ids(): string[]
  /** 当前选中的节点对象列表（按 id 从 doc 取；快照） */
  nodes(): Array<{ id: string; type: string }>
}

/**
 * 造宿主的标准四件（在 createMiniCanvasHost 里注册进 registryOf('capability')）。
 *
 * 只依赖 ctx（与传入的节点上下文），不 import 任何节点插件 —— 保持"渲染层不认识业务节点"的边界。
 */
export function createStandardCapabilities(ctx: Context): Record<string, CapabilityFactory> {
  const viewportOf = () =>
    ctx.get<
      | {
          getViewport(): { x: number; y: number; zoom: number }
          zoomIn(): void
          zoomOut(): void
          zoomTo(level: number): void
          fitView(padding?: number): void
          setCenter(x: number, y: number, zoom?: number): void
        }
      | undefined
    >('viewport')
  const toolsOf = () =>
    ctx.get<
      | {
          list(): Array<{ name: string; title?: string; description?: string; group?: string; produces?: string }>
          invoke(name: string, input: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>
        }
      | undefined
    >('tools')

  return {
    // 本节点：身份 / 数据 / 写回
    node: (n): NodeCapability => ({
      id: n.id,
      type: n.type,
      data: n.data,
      label: () => {
        const v = n.data.value?.label
        return typeof v === 'string' && v.length > 0 ? v : undefined
      },
      setLabel: (label) => n.update({ label }),
      update: (patch) => n.update(patch),
    }),

    // 缩放 / 视口控制
    zoom: (n): ZoomCapability => ({
      zoom: n.zoom,
      viewport: () => viewportOf()?.getViewport() ?? { x: 0, y: 0, zoom: n.zoom.value },
      zoomIn: () => viewportOf()?.zoomIn(),
      zoomOut: () => viewportOf()?.zoomOut(),
      zoomTo: (level) => viewportOf()?.zoomTo(level),
      fitView: () => viewportOf()?.fitView(),
      centerOn: (x, y) => viewportOf()?.setCenter(x, y, n.zoom.value),
    }),

    // 选中态（读者视角：只看自己，不改选中集 —— 改选中集属 selection 服务的事）
    selected: (n): SelectedCapability => ({ selected: n.selected, solo: n.solo }),

    // 选择集（读者视角：看"选中的是哪一批"；多选框区域栏的按钮用）。
    // 与上面 selected 的区别：那个回答"我在不在里面"，这个回答"里面有谁"。
    selection: (): SelectionCapability => {
      const idsOf = (): string[] => {
        const s = ctx.get<{ ids: ReadonlySet<string> } | undefined>('selection')
        return s ? [...s.ids] : []
      }
      return {
        ids: idsOf,
        nodes: () => {
          const ids = new Set(idsOf())
          if (ids.size === 0) return []
          const doc = ctx.get<{ getNodes(): Array<{ id: string; type: string }> } | undefined>('doc')
          return (doc?.getNodes() ?? [])
            .filter((n) => ids.has(n.id))
            .map((n) => ({ id: n.id, type: n.type }))
        },
      }
    },

    // 生成工具：转发 ctx.tools（缺失时给空表 + 明确错误，不静默假装成功）
    tools: (): ToolsCapability => ({
      list: () => (toolsOf()?.list() ?? []).map((t) => ({
        name: t.name,
        title: t.title,
        description: t.description,
        group: t.group,
        produces: t.produces,
      })),
      invoke: (name, input, options) => {
        const tools = toolsOf()
        if (!tools) {
          return Promise.reject(
            new Error('[capability] tools 能力不可用：本宿主没装 ctx.tools（生成工具注册表）'),
          )
        }
        return tools.invoke(name, input, options)
      },
    }),
  }
}
