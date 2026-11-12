/**
 * notifyService —— 画布级提示的唯一队列（服务名 data 里挂 canvas.notify；渲染层 TipLayer 消费）。
 *
 * 为什么不是 toast：拖线非法提示要**跟着鼠标**、空串即隐藏，而且多个持有者
 * （拖线 / 旋转 / 取消任务…）不能互相把对方的提示盖掉。所以每条提示带 source，
 * 撤回函数只撤自己那条，空串只清自己的 source。
 */
import { shallowReactive } from 'vue'

export interface NotifyOptions {
  /** 谁能撤回自己的提示；缺省 'default' */
  source?: string
  /** 数字小的先渲染 */
  priority?: number
  /** 同 source + 同文案已存在时不再新增 */
  once?: boolean
  /** 0 = 常驻；缺省 2600ms */
  durationMs?: number
  /** 跟随鼠标渲染（tip 语义）；缺省 true */
  followPointer?: boolean
}

export interface NotifyItem {
  id: number
  message: string
  source: string
  priority: number
  durationMs: number
  followPointer: boolean
}

export interface NotifyService {
  notify(message: string, opts?: NotifyOptions): () => void
  hide(source?: string): void
  list(): NotifyItem[]
  clear(): void
}

export function createNotifyService(): NotifyService {
  let seq = 0
  const items = shallowReactive<NotifyItem[]>([])
  const timers = new Map<number, ReturnType<typeof setTimeout>>()

  const remove = (id: number): void => {
    const timer = timers.get(id)
    if (timer) clearTimeout(timer)
    timers.delete(id)
    const i = items.findIndex((x) => x.id === id)
    if (i >= 0) items.splice(i, 1)
  }

  return {
    notify(message, opts = {}) {
      const source = opts.source ?? 'default'
      if (!message) {
        for (const item of items.filter((x) => x.source === source)) remove(item.id)
        return () => undefined
      }
      if (opts.once) {
        const same = items.find((x) => x.source === source && x.message === message)
        if (same) return () => remove(same.id)
      }
      const id = ++seq
      const item: NotifyItem = {
        id,
        message,
        source,
        priority: opts.priority ?? 0,
        durationMs: opts.durationMs ?? 2600,
        followPointer: opts.followPointer ?? true,
      }
      items.push(item)
      if (item.durationMs > 0) {
        timers.set(
          id,
          setTimeout(() => remove(id), item.durationMs),
        )
      }
      return () => remove(id)
    },
    hide(source) {
      for (const item of [...items]) if (!source || item.source === source) remove(item.id)
    },
    list: () => [...items].sort((a, b) => a.priority - b.priority),
    clear() {
      for (const item of [...items]) remove(item.id)
    },
  }
}
