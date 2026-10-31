/**
 * notify —— 通知的**控制器**：队列、堆叠、悬停暂停、滑动关闭都交给 vue-sonner。
 *
 * 这里只做三件事：
 *   1. 把调用方的 `NotifyOptions` 翻译成 sonner 的参数；
 *   2. 记住每条 id，供 `dismiss` / `clear` 使用；
 *   3. 在 sonner 把卡片移除后，同步清掉本地的登记。
 *
 * 卡片的**外观**不在这里，见 `NotifyCard.vue`，由本文件交给 sonner 渲染。
 */
import { markRaw, shallowReactive } from 'vue'
import { toast } from 'vue-sonner'
import NotifyCard from './NotifyCard.vue'
import type { NotifyItem, NotifyOptions } from './types'

let seq = 0

/** 每次 notify 都新建一个稳定 id；外部传了 id 就用外部的。 */
export const notifyList = shallowReactive<NotifyItem[]>([])

function toSonnerDuration(duration: number | undefined): number {
  // 旧约定：0 = 常驻；sonner 用 Infinity 表示不自动关。
  if (duration === 0) return Infinity
  return duration ?? 3600
}

/**
 * 弹一条通知。
 *
 * 同 id 再调用 = **更新原卡片**（sonner 的能力），不会再多堆一条。
 * 返回 id，可交给 `dismiss()`。
 */
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

  const index = notifyList.findIndex((x) => x.id === item.id)
  if (index >= 0) notifyList.splice(index, 1, item)
  else notifyList.push(item)

  // markRaw：组件对象不能进响应式系统，否则 sonner 每次更新都会收到
  // 「Component made reactive」警告，还会白白包一层 Proxy。
  toast.custom(markRaw(NotifyCard), {
    id: item.id,
    componentProps: { item },
    duration: toSonnerDuration(item.duration),
    dismissible: true,
    // 关闭 / 自动过期的唯一入口都在 sonner：它移除卡片后回调这里，列表跟着减。
    onDismiss: () => forget(item.id),
    onAutoClose: () => forget(item.id),
  })
  return item.id
}

/** 主动关掉一条。 */
export function dismiss(id: string): void {
  toast.dismiss(id)
  forget(id)
}

/** 关掉全部。 */
export function clear(): void {
  for (const item of notifyList) toast.dismiss(item.id)
  notifyList.splice(0, notifyList.length)
}

function forget(id: string): void {
  const index = notifyList.findIndex((x) => x.id === id)
  if (index >= 0) notifyList.splice(index, 1)
}
