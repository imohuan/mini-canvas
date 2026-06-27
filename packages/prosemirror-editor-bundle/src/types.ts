export interface ResourceItem {
  id: string;
  url: string;
  name: string;
  thumbnail_url?: string;
  type?: 'image' | 'video' | 'audio';
}

export interface VariableItem {
  id: string;
  name: string;
  value: string;
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
