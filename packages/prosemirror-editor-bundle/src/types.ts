import type { VNode } from 'vue'

export interface ResourceItem {
  id: string
  name: string
  category: string
  icon?: string
  /**
   * 引用标记信息（技能 / MCP / 节点）。
   *
   * 给了它，标签在正文里就序列化成 `@[kind:name](value)`（见 referenceMarkup.ts），
   * 而不是退化成 `@名字` —— 发消息时后端据此认出「引用了哪一种、引用了谁」。
   * 不给则维持旧的 `@名字`（图片 / 视频素材这类只作展示的标签）。
   */
  ref?: { kind: string; name: string; value?: string }
  renderItem?: (item: ResourceItem) => VNode   // MentionMenu 下拉菜单渲染
  renderEditor?: (item: ResourceItem) => [string, Record<string, any>, ...any[]] | HTMLElement  // 输入框内 DOM 渲染；数组=DOMOutputSpec（ProseMirror 创建），HTMLElement=直接返回
  // 编辑器内交互事件（不传 → 无默认行为）
  onClick?: (item: ResourceItem) => void       // 点击资源节点
  onMouseEnter?: (item: ResourceItem) => void  // 鼠标进入资源节点（默认：悬停预览）
  onMouseLeave?: (item: ResourceItem) => void  // 鼠标离开资源节点
  url?: string
  thumbnail_url?: string
  mediaType?: 'image' | 'video' | 'audio'
  value?: string
}

export interface MenuPosition {
  left: string;
  top: string;
  origin?: string; // 动画原点，如 "top left", "bottom right"
  side?: 'top' | 'bottom'; // 菜单显示在触发点的上方还是下方
  /**
   * 触发点（光标）的视口坐标。给了它，菜单就能用**自己真实测量的尺寸**决定上下翻转，
   * 而不是拿写死的高度估算 —— 估大了会把明明放得下的菜单顶到屏幕上方（实测 bug）。
   * 自定义 mention-menu 插槽可以忽略这两个字段。
   */
  anchorTop?: number;
  anchorBottom?: number;
}

export interface PreviewPosition {
  left: string;
  top: string;
  transform?: string;
}
