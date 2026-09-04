/**
 * nodeRegistryKey —— 节点注册表注入令牌（Vue provide/inject 用）。
 *
 * 放在 kernel 的组件层(src/components，非 core)：因为 BaseNode(壳) 与宿主(CanvasDemo)
 * 都要用它来跨层传 NodeRegistry，令牌归壳组件所有、宿主 import 即可，不反向依赖 demo-web。
 * 仅 type 级 import vue，不把 vue 运行时拉进 Node 单测路径。
 */
import type { InjectionKey } from 'vue'
import type { NodeRegistry } from '../core/registry/nodeRegistry'

export const NODE_REGISTRY_KEY: InjectionKey<NodeRegistry> = Symbol('canvas-v2-node-registry')
