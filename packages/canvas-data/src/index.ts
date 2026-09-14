/**
 * @mini-canvas/canvas-data —— 画布数据层。
 *
 * 职责：画布数据的**保存 / 读取 / 变更**，以及围绕它们的图模型。
 * - 存储：`SaveService` + 可插拔 `StorageAdapter`（内存 / localStorage / 以后云端）
 * - 图数据：`NodeStore`（节点）、`EdgeStore`（连线）、`Selection`（选中）、`History`（撤销栈）
 * - 图写入口：`GraphDocument`（变更 + 历史 + 选中维护 + 提交落盘，统一收口）
 * - 辅助：`ResourceStore`、`createSettingsPersist`（配置落盘桥）、`isTransient` 与中间态常量
 *
 * 边界：本包只做数据，不认识 Vue、不认识渲染；依赖 @mini-canvas/kernel（用其 Disposable/SettingsStore 等通用设施）。
 *
 * 说明：这里用 `export *` 全量再导出，保证"从本包根导入"与"迁移前从 canvas-data/src/services 各文件导入"
 * 拿到的符号面完全一致（迁移期下游零改动）。
 */

// 画布能力段的类型声明合并（把它加载进来合并才生效）
import './canvas/capabilityTypes'

export * from './transient'
export * from './nodeStore'
export * from './edgeStore'
export * from './selection'
export * from './history'
export * from './graphDocument'
export * from './resourceService'
export * from './settingsPersist'
export * from './storage/types'
export * from './storage/keys'
export * from './storage/memoryAdapter'
export * from './storage/localStorageAdapter'
export * from './storage/SaveService'

// 画布语义层（节点/主题注册表、能力段、连接规则、菜单、建节点）
export * from './canvas'
