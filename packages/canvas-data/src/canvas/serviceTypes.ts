/**
 * serviceTypes —— 把画布基础服务登记进内核的 Services 映射（执行计划 T03）。
 *
 * 内核已有 interface Services（可由插件 declare module 扩展）与按名推导的 get/tryGet 重载。
 * 此前画布没有在那里登记，于是插件只能自己写 ctx.get<DocService>('doc')：类型对错全靠人抄，
 * 服务改名改方法编译期发现不了。
 *
 * 这里只做**一处**集中声明：服务名 → 类型。运行时一行不改（服务名与实例照旧由宿主注入）；
 * 扩展服务仍可各自 declare module 补充。
 *
 * 登记 7 个基础服务（tools 由内核内置，其余六个在这里）+ 渲染层辅助服务 nodeToolbar。
 * 渲染层契约是**纯结构**（renderServiceContracts.ts，零 Vue / 零 VueFlow / 零实现细节）。
 *
 * 为什么渲染服务的类型也在这里登记：服务名 → 类型必须能被任何只依赖 canvas-base 的逻辑插件
 * 看到。canvas-render 是 canvas-data 的下游，把类型留在那边，纯逻辑插件就得为了服务名
 * import 整个渲染包（或手写窄端口，类型对错全靠人抄）。契约是结构类型，故放上游不引入反向依赖。
 */
import type { SettingsStore } from '@mini-canvas/kernel'
import type { DocService } from '../docService'
import type { SelectionService } from '../selection'
import type { ResourceService } from '../resourceService'
import type { SaveService } from '../storage/types'
import type {
  CanvasActions,
  FocusTarget,
  FitToOptions,
  ViewContract,
} from './renderServiceContracts'

/** 节点上下状态栏服务（渲染层辅助服务；Spec D4 保留，不算基础 7 个）。 */
export interface NodeToolbarContract {
  registerMode(mode: unknown): void
  unregisterMode(id: string): void
  enter(nodeId: string, modeId: string): void
  exit(nodeId?: string): void
  activeModeId(nodeId: string): string
}

declare module '@mini-canvas/kernel' {
  interface Services {
    /** 文档门面：节点 + 边 + 事务 + 撤销 + 快照 + 订阅（5c 起四个老名合并成这一个） */
    doc: DocService
    /** 选中态 */
    selection: SelectionService
    /** 资源生命周期（Blob / objectURL） */
    resources: ResourceService
    /** 存储适配器（本地 / 云端可插拔） */
    save: SaveService
    /** 分组配置单一数据源 */
    settings: SettingsStore
    /** 几何 + 视口合并服务（渲染层注入）；Spec 3.1 的唯一取景服务 */
    view: ViewContract
    /** 画布动作门面（建/选/聚焦/进模式/打组/提示/跑底栏动作）；不存数据 */
    canvas: CanvasActions
    /** 节点上下状态栏的会话与模式注册（渲染层辅助服务，Spec D4） */
    nodeToolbar: NodeToolbarContract
  }
}

/**
 * 同一批基础服务也挂到 Context 上（直访形式）。
 *
 * 注意 settings **不在此列**：ctx.settings 是能力段的声明糖（define/set/get/onChange/groups），
 * 与 ctx.get('settings') 拿到的原始 SettingsStore 不是同一个形状。属性直访命中能力段，
 * 故这里不能重复声明它（会造成接口冲突）。取原始 store 请用 ctx.get('settings')。
 *
 * 为什么两处都要：ctx.get('doc') 与 ctx.doc 是同一批服务的两种写法（插件 ctx 有服务解析
 * Proxy，ctx.doc 运行时等价于 ctx.get('doc')）。此前只登记了 Services，于是 6 个插件各自
 * declare module ... interface Context { doc: DocService } 把同一件事抄了一遍（T03 要消除的重复）。
 *
 * 渲染层注入的 view / nodeToolbar 也在本文件登记；插件自己提供的服务（text/image/group/
 * clipboard/…）仍由各自 declare，那是它们的私有契约。
 */
declare module '@mini-canvas/canvas-data' {
  interface Context {
    /** 文档门面（节点 + 边 + 事务 + 撤销 + 快照） */
    doc: DocService
    /** 选中态 */
    selection: SelectionService
    /** 资源生命周期 */
    resources: ResourceService
    /** 存储适配器 */
    save: SaveService
    /** 几何 + 视口合并服务（渲染层注入） */
    view: ViewContract
    /** 画布动作门面（建/选/聚焦/进模式/打组/提示/跑底栏动作）；不存数据 */
    canvas: CanvasActions
    /** 节点上下状态栏服务（渲染层辅助服务，Spec D4） */
    nodeToolbar: NodeToolbarContract
  }
}

export type { CanvasActions, FocusTarget, FitToOptions, ViewContract }
