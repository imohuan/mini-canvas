/**
 * renderContext —— 渲染宿主统一上下文（Vue provide/inject 单令牌收口）。
 *
 * 目标：把 CanvasHost 之前逐个 provide 的 6 个独立令牌(NODE_REGISTRY/NODE_WRITE/CANVAS_PARAMS/
 * HOST/EDGE_VISUAL/EDGE_SELECTION)收拢成**一个上下文对象** + 一个消费函数 `useCanvasRender()`，
 * 消费方(插件壳/边/content 组件)不必逐个 `inject(某 KEY)!` 再自己处理缺省/报错。
 *
 * 用法：
 *   CanvasHost 内（root provider）：provide(RENDER_CONTEXT_KEY, { registry, nodeWrite, host,
 *     handleParams, edgeVisual, edgeSelection })
 *   任意子组件：const { registry, handleParams, edgeVisual } = useCanvasRender()
 *
 * 说明：
 * - 字段里凡"宿主注入的响应式对象/ref"(edgeVisual/handleParams/edgeSelection/host) 保持**原引用**，
 *   不包 reactive——消费方 computed 照常追踪，属性改即实时生效。
 * - 旧 6 个 *_KEY 常量仍保留导出(CanvasHost 仍逐个 provide 同引用)以兼容未迁移的外部消费方；
 *   新代码一律走 useCanvasRender()。
 */
import { inject, type InjectionKey, type Ref } from 'vue'
import type { NodeRegistry } from '@mini-canvas/canvas-core-v2'
import type { CanvasHostHandle } from '../host/createMiniCanvasHost'
import type { NodeWrite } from './nodeRegistryKey'
import type { CanvasParams } from './canvasParamKey'
import type { EdgeVisual, EdgeSelection } from './edgeContext'

/** 渲染宿主提供给其子树(VueFlow 内插件组件)的整包上下文 */
export interface CanvasRenderContext {
  /** 宿主句柄的响应式引用（boot 完成前为空；content 组件交互时读 .value.ctx 调服务） */
  host: Ref<CanvasHostHandle | undefined>
  /** 节点展示注册表（content/toolbar 段组件） */
  registry: NodeRegistry
  /** 标题就地重命名写回；宿主总给，消费方按需用（缺省判断保留以兼容无宿主环境） */
  nodeWrite: NodeWrite
  /** 浮动端口外观（响应式对象，属性改实时生效） */
  handleParams: CanvasParams
  /** 边外观（响应式对象） */
  edgeVisual: Partial<EdgeVisual>
  /** 选中集合（含 ref，供"相连被选即高亮"） */
  edgeSelection: EdgeSelection
}

/** 单令牌：CanvasHost provide、消费方经 useCanvasRender() 取 */
export const RENDER_CONTEXT_KEY: InjectionKey<CanvasRenderContext> = Symbol('canvas-v2-render-context')

/**
 * 取渲染宿主上下文。必须在 <CanvasHost> 内(其 provide 作用域下)调用；
 * 不在宿主内会抛清晰错误（这些渲染组件本就依赖宿主能力）。
 */
export function useCanvasRender(): CanvasRenderContext {
  const ctx = inject(RENDER_CONTEXT_KEY, null)
  if (!ctx) {
    throw new Error('[useCanvasRender] 缺少渲染上下文：请确保该组件渲染在 <CanvasHost> 之内（宿主未 provide RENDER_CONTEXT_KEY）')
  }
  return ctx
}
