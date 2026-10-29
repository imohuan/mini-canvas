import { shallowReactive } from 'vue'
import type { MessageItem, MessageOptions } from './types'

let seq = 0
export const messageList = shallowReactive<MessageItem[]>([])

export function message(options: MessageOptions | string): string {
  const opts: MessageOptions = typeof options === 'string' ? { text: options } : options
  const id = 'message-' + (++seq)
  messageList.push({ id, text: opts.text, tone: opts.tone ?? 'neutral' })
  window.setTimeout(() => removeMessage(id), opts.duration ?? 2400)
  return id
}

export function removeMessage(id: string): void {
  const index = messageList.findIndex((x) => x.id === id)
  if (index >= 0) messageList.splice(index, 1)
}

export function clearMessages(): void { messageList.splice(0, messageList.length) }
