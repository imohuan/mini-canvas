import { shallowReactive } from 'vue'
import type { NotifyItem, NotifyOptions } from './types'

let seq = 0
export const notifyList = shallowReactive<NotifyItem[]>([])

export function notify(options: NotifyOptions | string): string {
  const item: NotifyItem = typeof options === 'string'
    ? { id: 'notify-' + (++seq), title: options, tone: 'primary', duration: 3600 }
    : {
        id: options.id ?? 'notify-' + (++seq),
        title: options.title,
        description: options.description,
        tone: options.tone ?? 'primary',
        duration: options.duration ?? 3600,
        action: options.action,
      }
  notifyList.push(item)
  if (item.duration && item.duration > 0) {
    window.setTimeout(() => dismiss(item.id), item.duration)
  }
  return item.id
}

export function dismiss(id: string): void {
  const index = notifyList.findIndex((x) => x.id === id)
  if (index >= 0) notifyList.splice(index, 1)
}

export function clear(): void { notifyList.splice(0, notifyList.length) }
