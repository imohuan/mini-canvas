import type { InjectionKey, Ref } from 'vue'
import type { CanvasHost } from '../src/demo/host'
import type { NodeRegistry } from '../src/core/registry/nodeRegistry'

/**
 * HOST_KEY —— demo 内容组件经 provide/inject 拿到宿主句柄的令牌。
 *
 * 因内核异步 boot，provide 的是"宿主引用"（开始时为空、boot 完成后填充），
 * 内容组件在交互时（此时 boot 必已结束）读取 `.value`。
 */
export const HOST_KEY: InjectionKey<Ref<CanvasHost | undefined>> = Symbol('canvas-v2-demo-host')

/**
 * NODE_REGISTRY_KEY —— NodeRenderer/BaseNode 拿"type → 段组件"注册表的令牌。
 * 由 CanvasDemo(宿主)在 setup 同步 seed + provide，BaseNode 经 inject 取来解析 content。
 */
export const NODE_REGISTRY_KEY: InjectionKey<NodeRegistry> = Symbol('canvas-v2-node-registry')
