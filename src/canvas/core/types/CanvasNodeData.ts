export type CanvasNodeKind = 'text' | 'image' | 'video' | 'stage' | 'panorama' | (string & {})

/** 裁剪/扩展矩形 */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** @deprecated 使用 Rect */
export type CropRect = Rect

/** 蒙版绘制配置 */
export interface MaskConfig {
  brushSize: number
  brushColor: string
  brushOpacity: number
  isErasing: boolean
}

/** 临时覆写状态对象。进入特殊模式时设此对象，退出时 delete 一步恢复。
 *  刷新页面后 storage 加载时必须 strip _overlay。 */
export interface CanvasNodeOverlay {
  _cropMode?: boolean
  _expandMode?: boolean
  _maskMode?: boolean
  _toolbarGroup?: string
  _cropRect?: Rect
  _expandRect?: Rect
  _maskConfig?: MaskConfig
}

export interface BaseCanvasNodeData {
  nodeType: CanvasNodeKind
  label?: string
  cardWidth?: number
  cardHeight?: number
  resizable?: boolean
  /** 临时覆写状态，退出时 delete 一步恢复。storage 加载时强制清除。 */
  _overlay?: CanvasNodeOverlay
}

export interface ImageNodeData extends BaseCanvasNodeData {
  nodeType: 'image'
  assetId?: string
  imageName?: string
  imageType?: string
  imageSize?: number   // 文件大小（bytes）
  imageWidth?: number
  imageHeight?: number
  imageUrl?: string // runtime only, 保存前删除
}

export interface VideoNodeData extends BaseCanvasNodeData {
  nodeType: 'video'
  assetId?: string
  videoName?: string
  videoType?: string
  videoSize?: number     // 文件大小（bytes）
  videoWidth?: number
  videoHeight?: number
  videoDuration?: number // 时长（秒）
  videoUrl?: string // runtime only, 保存前删除
  thumbUrl?: string // runtime only, 保存前删除
}

export interface TextNodeData extends BaseCanvasNodeData {
  nodeType: 'text'
  text?: string
}

export interface StageNodeData extends BaseCanvasNodeData {
  nodeType: 'stage'
  values?: Record<string, unknown>
}

export interface PanoramaNodeData extends BaseCanvasNodeData {
  nodeType: 'panorama'
  assetId?: string
  imageName?: string
  imageType?: string
  imageUrl?: string // runtime only, 保存前删除
  panoUrl?: string  // 备用的全景图URL
}

export interface ImageCompareNodeData extends BaseCanvasNodeData {
  nodeType: 'image-compare'
  leftImageUrl?: string  // 左侧图片 URL（runtime only）
  rightImageUrl?: string // 右侧图片 URL（runtime only）
  dividerPosition?: number // 分割线位置百分比 0-100
  compareMode?: 'slider' | 'side-by-side' | 'overlay' // 对比模式
}

export type CanvasNodeData = TextNodeData | ImageNodeData | VideoNodeData | StageNodeData | PanoramaNodeData | ImageCompareNodeData | BaseCanvasNodeData
