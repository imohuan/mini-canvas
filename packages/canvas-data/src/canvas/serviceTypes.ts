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
 * 只登记数据层与画布语义这几个基础服务；渲染层注入的 nodeLayout/viewport 由 canvas-render
 * 自行补充（它才知道那两个类型，canvas-data 不认识渲染）。
 */
import type { CommandService, SettingsStore } from '@mini-canvas/kernel'
import type { DocService } from '../docService'
import type { SelectionService } from '../selection'
import type { ResourceService } from '../resourceService'
import type { SettingsPersistService } from '../settingsPersist'
import type { SaveService } from '../storage/types'
import type { NodeFactoryService } from './nodeFactory'
import type { NodeRegistry } from './registry/nodeRegistry'
import type { ThemeRegistry } from './registry/themeRegistry'

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
    /** 命令注册表 */
    command: CommandService
    /** 节点创建工厂 */
    nodeFactory: NodeFactoryService
    /** 节点展示注册表（type → 区域组件） */
    nodeRegistry: NodeRegistry
    /** 主题 / 外观注册表（slot → 组件） */
    themeRegistry: ThemeRegistry
    /** 分组配置单一数据源 */
    settings: SettingsStore
    /** 配置持久化桥（宿主关掉持久化时缺席，取用侧用 tryGet 或自行判空） */
    settingsPersist: SettingsPersistService
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
 * 渲染层注入的 nodeLayout / viewport 由 canvas-render 自行声明（它才知道那两个类型）。
 * 插件自己提供的服务（text/image/group/clipboard/…）仍由各自 declare，那是它们的私有契约。
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
    /** 命令注册表 */
    command: CommandService
    /** 节点创建工厂 */
    nodeFactory: NodeFactoryService
    /** 节点展示注册表 */
    nodeRegistry: NodeRegistry
    /** 主题 / 外观注册表 */
    themeRegistry: ThemeRegistry
  }
}
