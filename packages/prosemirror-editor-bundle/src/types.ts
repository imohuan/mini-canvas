import type { VNode } from 'vue'

export interface ResourceItem {
  id: string
  name: string
  category: string
  icon?: string
  renderItem?: (item: ResourceItem) => VNode   // MentionMenu 下拉菜单渲染
  renderEditor?: (item: ResourceItem) => HTMLElement  // 输入框内 DOM 渲染（替代 toDOM）
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
}

export interface PreviewPosition {
  left: string;
  top: string;
  transform?: string;
}
