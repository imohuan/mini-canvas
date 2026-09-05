/**
 * vueFlowBridge —— 内核精选的 VueFlow 能力出口（插件侧统一从内核 import，不再各自依赖 @vue-flow/core）。
 *
 * 动机：渲染类插件（主题：节点壳 / 连线 / 背景）需要碰 VueFlow 的少数原语（端口 Handle、方向常量、
 * 路径工具、实例组合式 + 类型）。与其让每个插件各自 import '@vue-flow/core'（多一层依赖、还容易搞出
 * "多份 @vue-flow 实例"这类双实例 Bug），不如内核把这些成员精选导出一处，插件只需 import 内核。
 *
 * 边界：
 * - 只精选插件真正会用到的成员（见下方），不 `export *` 整库——避免把第三方库变成内核的"泄漏门面"。
 * - @vue-flow/core 是内核依赖；这里 re-export 不产生新副本，仍指向同一模块实例。
 * - 需要完整 VueFlow 的场景（宿主 demo 预览页自 mount <VueFlow>）仍直接 import @vue-flow/core，不走这里。
 */
// 运行时原语：端口组件 / 方向常量 / 贝塞尔路径 / 实例组合式（拿 store：读选中、缩放、删边、订阅事件）
export { Handle, Position, getBezierPath, useVueFlow } from '@vue-flow/core'
// 类型：自定义节点壳 / 自定义边 收到的引擎 props（起点终点坐标、选中、动画等都在其中）
export type { EdgeProps, NodeProps } from '@vue-flow/core'
