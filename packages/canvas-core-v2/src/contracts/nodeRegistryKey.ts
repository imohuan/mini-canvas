/**
 * nodeRegistryKey —— 节点注册表 / 节点数据写回 注入令牌（Vue provide/inject 用）。
 *
 * 放在 kernel 的组件层(src/components，非 core)：因为 BaseNode(壳) 与宿主(CanvasDemo)
 * 都要用它来跨层传 NodeRegistry，令牌归壳组件所有、宿主 import 即可，不反向依赖 demo-web。
 * 仅 type 级 import vue，不把 vue 运行时拉进 Node 单测路径。
 */
import type { InjectionKey } from 'vue'
import type { NodeRegistry } from '../core/registry/nodeRegistry'

export const NODE_REGISTRY_KEY: InjectionKey<NodeRegistry> = Symbol('canvas-v2-node-registry')

/**
 * 节点数据写回回调：宿主注入后，BaseNode 内的就地编辑(如标题重命名)才能把改动写回
 * 内核(经宿主桥接 ctx/nodeStore)并落盘。宿主不注入则节点仅展示、不可编辑（安全降级）。
 */
export type NodeWrite = (id: string, patch: Record<string, unknown>) => void

export const NODE_WRITE_KEY: InjectionKey<NodeWrite> = Symbol('canvas-v2-node-write')
