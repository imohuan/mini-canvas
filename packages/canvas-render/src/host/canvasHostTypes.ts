/**
 * CanvasHost / CanvasProvider 的公共类型。
 *
 * 分成两半是有意的：
 * - BootProps 只在 CanvasProvider 里用（插件、存储、种子、window 暴露）；
 * - RenderProps 只在 CanvasHost 里用（外观、写回、视口持久化）。
 *
 * 不再保留“旧 CanvasHost 自己启动”的合并类型：那会让调用方继续把启动参数传给
 * 一个不负责启动的组件，错误只能在运行时才暴露。
 */
import type { CanvasNode, StorageAdapter } from '@mini-canvas/canvas-data'
import type { PluginClassLike, PluginModule } from '@mini-canvas/kernel'
import type { CanvasHostHandle } from './createMiniCanvasHost'
import type { PluginManifest } from './pluginManager'
import type { NodeWrite } from '../contracts/nodeRegistryKey'
import type { EdgeVisual } from '../contracts/edgeContext'
import type { CanvasParams } from '../contracts/canvasParamKey'
import type { CanvasDebug } from '../contracts/debugContext'
import type { SnapZoneConfig } from '../connection/geometry'

/** CanvasProvider 的启动参数：建内核、装插件、恢复存储、暴露 window API。 */
export interface CanvasHostBootProps {
  /** 冷启动插件（顺序即装载序）。 */
  plugins?: (PluginModule | PluginClassLike)[]
  /** 装配清单（给则优先于 plugins，见 createMiniCanvasHost）。 */
  manifest?: PluginManifest
  /** 存储后端；缺省内存 adapter。 */
  adapter?: StorageAdapter
  /** 首次（存储为空）生成默认画布。 */
  seed?: () => CanvasNode[]
  /** 开发态开关，落到 ctx.isDev。 */
  dev?: boolean
  /** 挂到 window 的调试 key；传空则不挂。 */
  windowKey?: string
}

/** CanvasHost 的渲染参数：只影响“怎么画”，不参与启动。 */
export interface CanvasHostRenderProps {
  /** 覆盖默认的标题/尺寸写回实现。 */
  nodeWrite?: NodeWrite
  /** 边外观覆盖（响应式对象，属性改实时生效）。 */
  edgeVisual?: Partial<EdgeVisual>
  /** 浮动端口尺寸覆盖（需要完整字段，见 CanvasHost 注释）。 */
  handleVisual?: CanvasParams
  /** 调试可视化开关覆盖。 */
  debugVisual?: CanvasDebug
  /** 吸附带配置覆盖。 */
  snapZoneVisual?: SnapZoneConfig
  /** 是否持久化画布视口；缺省 true。 */
  persistViewport?: boolean
}

/** 右键菜单请求 payload（CanvasHost → 父级）。 */
export interface CanvasContextMenuPayload {
  kind: 'node' | 'pane' | 'edge'
  clientX: number
  clientY: number
  nodeId?: string
  edgeId?: string
}

/** CanvasHost 的事件：没有 boot-error，启动失败由 Provider 报。 */
export interface CanvasHostEmits {
  /** 画布渲染子树已挂载、订阅已接好。 */
  ready: [host: CanvasHostHandle]
  /** 右键菜单请求（内部已 preventDefault）。 */
  'context-menu': [payload: CanvasContextMenuPayload]
  /** 运行期某插件装载失败（ctx:lifecycle-change 的 error 转发）。 */
  'plugin-issue': [payload: { name: string; lifecycle: string }]
}

/** CanvasProvider 的事件：内核启动成功/失败。 */
export interface CanvasProviderEmits {
  /** 内核已启动、ctx 可用；此时才渲染默认插槽。 */
  ready: [host: CanvasHostHandle]
  /** 内核启动失败；默认插槽不会渲染。 */
  'boot-error': [error: Error]
}
