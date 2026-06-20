export type CanvasNodeKind = 'text' | 'image' | 'video' | 'stage' | (string & {})

export interface BaseCanvasNodeData {
  nodeType: CanvasNodeKind
  label?: string
  cardWidth?: number
  cardHeight?: number
  resizable?: boolean
}

export interface ImageNodeData extends BaseCanvasNodeData {
  nodeType: 'image'
  assetId?: string
  imageName?: string
  imageType?: string
  imageWidth?: number
  imageHeight?: number
  imageUrl?: string // runtime only, 保存前删除
  _cropMode?: boolean // runtime only
  _cropRect?: unknown // runtime only
}

export interface VideoNodeData extends BaseCanvasNodeData {
  nodeType: 'video'
  assetId?: string
  videoName?: string
  videoType?: string
  videoWidth?: number
  videoHeight?: number
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

export type CanvasNodeData = TextNodeData | ImageNodeData | VideoNodeData | StageNodeData | BaseCanvasNodeData