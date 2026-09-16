/**
 * plugin-node-3d-preview —— 3D 全景预览节点插件（three.js 球体内壁贴图，可拖拽转向 / 滚轮缩放 / 重置视角）。
 *
 * 对照老版 packages/canvas-core/src/nodes/panorama/PanoramaNodePlugin.ts + PanoramaNode.vue：
 * - 类型声明对齐老版：label「3D 预览」、可接收图片输入、不产出输出、可 resize；
 * - 老版靠 `context.on('connect')` 监听 + 手删 edge 来限制"只接一条输入"；v2 内核已内建声明式容量：
 *   本插件只声明 capacity:1，满额时**内核自动挤掉原先那张图**（缺省 evictOnFull=true）——
 *   即"再连一张 = 换掉当前全景"，与老版手删的行为一致，但不用自己写监听。
 *
 * UI 与逻辑同包：PanoramaContent.vue 是 content 组件，二者在 apply(ctx) 里一次注册（宿主零硬编码）。
 *
 * 依赖方向：只依赖内核(canvas-base/canvas-data) + 渲染层类型(useCanvasRender)，不反向依赖宿主/demo。
 */
import { Service, type Context, type PluginModule } from '@mini-canvas/canvas-base'
import type { GraphDocumentService } from '@mini-canvas/canvas-data'
import PanoramaContent from './PanoramaContent.vue'
import {
  PANORAMA_FULLSCREEN_COMMAND,
  PANORAMA_RESET_COMMAND,
  resolveCommandTarget,
} from './node3dCommands'
import { requestResetView, toggleFullscreen } from './panoramaSession'

/** 本插件注册的节点类型名 */
export const PANORAMA_NODE_TYPE = '3d-preview'

/** 3D 预览插件暴露给外部的服务形状（其它插件/宿主经 ctx.get('panorama3d') 使用） */
export interface Panorama3DNodeService {
  /** 放一个 3D 预览节点；imageUrl 可给初始全景图（URL / dataURL / objectURL），不给则显示占位 */
  addPreviewNode(position: { x: number; y: number }, imageUrl?: string): string
  /** 换掉某节点贴的全景图；空串 = 撤掉贴图回到占位态 */
  setImageUrl(id: string, imageUrl: string): void
  /** 删除节点（走图唯一写入口，连带清边、可撤销、自动落盘） */
  removeNode(id: string): void
}

/** 类型增强缝（cordis 声明合并）：宿主/作者 ctx.panorama3d 直访时类型为本服务 */
declare module '@mini-canvas/canvas-data' {
  interface Context {
    panorama3d: Panorama3DNodeService
  }
}

/** 3D 预览服务：构造即上架 'panorama3d'，方法经 this.ctx.get 惰性取现时服务（不缓存） */
export class Panorama3DService extends Service implements Panorama3DNodeService {
  constructor(ctx: Context) {
    super(ctx, 'panorama3d')
  }

  private graph(): GraphDocumentService {
    return this.ctx.get<GraphDocumentService>('graph')
  }

  addPreviewNode(position: { x: number; y: number }, imageUrl = ''): string {
    return this.graph().transaction('add-3d-preview-node', (tx) =>
      tx.createNode(PANORAMA_NODE_TYPE, position, imageUrl ? { imageUrl } : {}),
    )
  }

  setImageUrl(id: string, imageUrl: string): void {
    this.graph().updateNode(id, { data: { imageUrl } })
  }

  removeNode(id: string): void {
    this.graph().removeNodes([id])
  }
}

export const name = '3d-preview'
export const inject = ['graph'] as string[]

/**
 * 节点快捷键在"同键竞争"里的优先级。
 *
 * 用户要求"选中节点之后支持这些快捷键"，而 f/r 画布上已被自动布局注册（order 20/30）。
 * 取比它们更小的值 = 选中 3D 节点时节点命令赢；没选中时 when 为假、自动让位回画布命令
 * （分发规则见 kernel/src/command.ts 的 findCommandByKeys）。
 */
const NODE_SHORTCUT_ORDER = 5

/**
 * 节点类型图标（标题左侧与右键"新建节点"共用；单一来源 = 本类型注册时声明）。
 * 球形+经纬线，和"360° 全景"的语义对得上。
 */
const NODE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>'

/**
 * 插件主体：上架 'panorama3d' 服务 + 注册 '3d-preview' 节点类型（数据/尺寸/连接约束 + content 组件 + create）。
 * 连接约束：只接一张图（capacity:1），不产出输出（outputs: []）。
 */
export function apply(ctx: Context) {
  const service = new Panorama3DService(ctx)

  ctx.nodes.register({
    type: PANORAMA_NODE_TYPE,
    label: '3D 预览',
    icon: NODE_ICON,
    size: { w: 420, h: 280 },
    inputs: [{ port: 'target', acceptsTypes: ['image'], capacity: 1 }],
    outputs: [],
    // 全景窗口要能拉大拉小；渲染层按容器实测尺寸重建画布（ResizeObserver）
    resizable: true,
    content: PanoramaContent,
    create(position) {
      return service.addPreviewNode(position)
    },
  })

  // —— 节点快捷键（用户要求：r 重置视角、f 全屏切换）——
  // 只在"恰好选中一个 3D 预览节点"时接管这两个键，其余情况让位给画布原有绑定：
  //   f 平时是自动布局的"聚焦选中"，r 平时是"适应视图"。
  // when 读 selection 现算（不缓存）：选中集是随时变的，缓存会判过期。
  const commandTarget = (): string => {
    const selection = ctx.get<{ ids: ReadonlySet<string> }>('selection')
    const nodeStore = ctx.get<{ getNode(id: string): { type: string } | undefined }>('nodeStore')
    return resolveCommandTarget([...(selection?.ids ?? [])], (id) => nodeStore?.getNode(id)?.type)
  }

  ctx.commands.register({
    id: PANORAMA_FULLSCREEN_COMMAND,
    title: '3D 预览：全屏切换',
    keys: ['f'],
    group: 'node-3d-preview',
    order: NODE_SHORTCUT_ORDER,
    // 没选中 3D 节点 → when 为假 → 分发时让位给画布的 f（聚焦选中）
    when: () => commandTarget() !== '',
    run() {
      const id = commandTarget()
      if (!id) return false
      return toggleFullscreen(id)
    },
  })

  ctx.commands.register({
    id: PANORAMA_RESET_COMMAND,
    title: '3D 预览：重置视角',
    keys: ['r'],
    group: 'node-3d-preview',
    order: NODE_SHORTCUT_ORDER,
    when: () => commandTarget() !== '',
    run() {
      const id = commandTarget()
      if (!id) return false
      // 视角状态在组件内部，这里只发信号（token +1），组件 watch 到才去动相机
      requestResetView(id)
      return true
    },
  })
}

/** 兼容旧装配的 PluginModule 出口（name='3d-preview' 供 HMR reload） */
export const node3dPreviewPlugin: PluginModule = { name, inject, apply }
