import type { Ref } from 'vue'

export interface HostCtx {
  get<T>(key: string): T
  tryGet?<T>(key: string): T | undefined
  on(evt: string, cb: () => void): { dispose(): void }
  /** 运行时是完整内核 Context：树外读 ui 目录用（类型窄声明即可） */
  registryOf?<T>(name: string): {
    top(key: string): { value: T } | undefined
    subscribe(fn: () => void): { dispose(): void }
  }
}

export interface HostApi {
  ctx?: HostCtx
  command?: { execute(id: string, payload?: unknown): void }
  nodeStore?: { getNodes(): unknown[] }
}

/** CanvasHost 暴露的完整宿主（与 window.MiniCanvasUI.getHost() 同源） */
export type FullHost = HostApi & {
  command: { execute(id: string, payload?: unknown): void }
  nodeStore: { getNodes(): unknown[] }
}

export interface ManagerApi {
  install(opts: { url: string }, cfg?: { config?: unknown }): Promise<void>
}

export interface HostLike {
  host?: HostApi
  manager?: ManagerApi
}

export interface TreeNode {
  id: string
  name: string
  meta: string
  icon: 'group' | 'image' | 'video' | 'audio' | 'text'
  children?: TreeNode[]
  /** 画布坐标（点击节点居中显示用；由 canvasTree.buildCanvasTree 从节点 position 带来） */
  x?: number
  y?: number
  /** 缩略图地址（图片/视频节点；由 canvasTree 从 data 里取，抽屉里直接当 <img> 用） */
  thumb?: string
  /** 视频节点的播放地址（缩略图用 <video> 显示首帧；由 canvasTree.nodeVideoUrl 带来）。
   *  与 thumb 分开：thumb 只认图（mp4 塞 <img> 必裂），视频没有海报时靠这个字段出首帧。 */
  video?: string
}

export type HostRef = Ref<HostApi | undefined>

