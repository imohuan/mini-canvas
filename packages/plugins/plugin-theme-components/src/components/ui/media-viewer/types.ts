/** 一个待预览的媒体（与底栏 mediaPreview.ts 的 PreviewItem 同构；这里是通用形状） */
export interface MediaViewerItem {
  /** 标题（左上角悬浮显示；空则不显示） */
  name?: string
  /** 媒体种类（决定内置预览用 img / video / audio / 纯文本） */
  kind: "image" | "video" | "audio" | "text" | string
  /** 图片/视频/音频地址 */
  url?: string
  /** 文本内容（kind="text" 用） */
  text?: string
  /**
   * 一段自包含 HTML（kind="ui" 用）—— 可视化节点的界面代码。
   *
   * 为什么不能像别的类型那样给 url：可视化节点的内容不是"可加载的媒体"，
   * 而是一段 HTML（它没有独立的可访问地址）。用户口径 2026-10-14：
   * 「可以在预览中添加一个 iframe 预览框」—— 这个字段就是给那个 iframe 的 srcdoc。
   */
  html?: string
  /** 宿主自带的同组媒体（给了就出 上一张/下一张 与页码；图片变换工具随当前张走） */
  list?: string[]
  /** 当前张在 list 里的下标（配合 list 用；默认 0） */
  index?: number
}

export interface MediaViewerProps {
  /** 当前预览的媒体；null/undefined = 不渲染 */
  item?: MediaViewerItem | null
  /** 删除处理（给了才会出现右上角的删除按钮） */
  onDelete?: (item: MediaViewerItem) => void
  /**
   * 宿主自备的预览注册件（画布树外渲染时 ui 目录取不到，宿主从自己的
   * 宿主 ctx 里读出来传入；键：audioPreview / videoPreview / textPreview）。
   * 给了就优先用，没给走 useUiComponent（树内）或原生标签兜底（树外）。
   */
  previewComponents?: Record<string, unknown> | null
}

export interface MediaViewerEmits {
  (e: "close"): void
  (e: "remove", item: MediaViewerItem): void
  /** 当前看的是 list 里的第几张（宿主传了 list 时才有意义；删除要按它算） */
  (e: "index", index: number): void
}

