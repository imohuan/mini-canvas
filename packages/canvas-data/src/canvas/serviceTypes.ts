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
import type { SaveServiceImpl } from '../storage/SaveService'
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
    save: SaveServiceImpl
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
