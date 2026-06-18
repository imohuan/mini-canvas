export type CanvasMenuItem = {
  id: string
  label: string
  description?: string
  badge?: string
  disabled?: boolean
  icon?: 'text' | 'image' | 'video' | 'layers' | 'link' | 'delete' | 'duplicate'
}

export type CanvasMenuState = {
  visible: boolean
  title: string
  mode: 'pane' | 'node' | 'connection'
  position: { x: number; y: number }
  items: CanvasMenuItem[]
}