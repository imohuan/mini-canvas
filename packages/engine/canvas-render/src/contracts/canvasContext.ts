/**
 * CanvasContext —— 转发件。
 *
 * 实现只有一份，住在 `@plume-canvas/vue-render/context`（通用渲染底座）。这里保留旧路径，
 * 现有 import 不用改；新代码直接从 vue-render 取。
 *
 * 为什么必须删掉本地那份实现：以前这里自己写了一个 `useCanvasContextOrRender`，
 * 从渲染上下文回退时会造出 `api/manager = undefined` 的假上下文；两份实现并存时，
 * 从哪个路径 import 决定拿到真的还是假的，很难查。
 */
import type { InjectionKey } from 'vue'
import type { Context } from '@plume-canvas/canvas-data'
import type { CanvasHostHandle, PlumeApi } from '../host/createPlumeHost'
import type { PluginManager } from '../host/pluginManager'
import {
  CANVAS_CONTEXT_KEY as BASE_KEY,
  useCanvasContext as useBaseContext,
  useCanvasContextOrRender as useBaseContextOrRender,
} from '@plume-canvas/vue-render/context'

/** 外壳与画布共用的一份基础上下文（不含 VueFlow 专属的 flow / 渲染快照）。 */
export interface CanvasContext {
  /** 内核上下文：服务、命令、配置、插槽都从它取。 */
  ctx: Context
  /** 宿主句柄（ctx 的超集：数据服务 + 落盘/停止语义）。 */
  host: CanvasHostHandle
  /** 宿主统一门面：安装/卸载插件、读写节点等。 */
  api: PlumeApi
  /** 宿主统一安装句柄（热装/热卸/清单）。 */
  manager: PluginManager
}

/**
 * 同一个注入键（Symbol.for，跨包一致），这里按画布类型重新标注。
 *
 * 为什么需要重标：vue-render 的 `CanvasContext` 故意把 host/api/manager 声明成可选 + unknown
 * （它不认识画布）；画布层的调用方需要具体类型，否则 `host.save` / `api.installPlugin` 全是 unknown。
 * 实现与运行时对象都只有一份，这里只是类型收窄。
 */
export const CANVAS_CONTEXT_KEY = BASE_KEY as unknown as InjectionKey<CanvasContext>

/** 取基础上下文；Provider 外抛清晰错误（实现见 vue-render/context）。 */
export const useCanvasContext = useBaseContext as unknown as () => CanvasContext

/** 宽松取 ctx：先外壳上下文，再回退渲染上下文；host/api/manager 有就一并透传。 */
export const useCanvasContextOrRender = useBaseContextOrRender as unknown as () => CanvasContext


