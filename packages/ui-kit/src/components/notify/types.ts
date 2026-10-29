import type { UiKitTone } from '../../shared/types'

export interface NotifyItem {
  id: string
  title: string
  description?: string
  tone?: UiKitTone
  duration?: number
  action?: { label: string; onClick: () => void }
}

export interface NotifyOptions extends Omit<NotifyItem, 'id'> {
  id?: string
}
