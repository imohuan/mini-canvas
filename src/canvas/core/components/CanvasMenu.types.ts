export type CanvasMenuMode = 'pane' | 'node' | 'connection' | 'edge'

export type CanvasMenuItem = {
  id: string
  label: string
  description?: string
  badge?: string
  disabled?: boolean
  danger?: boolean
  shortcut?: string
  group?: string
  icon?: 'text' | 'image' | 'video' | 'layers' | 'link' | 'delete' | 'duplicate'
}

export type CanvasMenuState = {
  visible: boolean
  title: string
  mode: CanvasMenuMode
  position: { x: number; y: number }
  items: CanvasMenuItem[]
}