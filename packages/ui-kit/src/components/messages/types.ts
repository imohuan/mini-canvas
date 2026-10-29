import type { UiKitTone } from '../../shared/types'

export interface MessageItem {
  id: string
  text: string
  tone?: UiKitTone
}

export interface MessageOptions {
  text: string
  tone?: UiKitTone
  duration?: number
}
