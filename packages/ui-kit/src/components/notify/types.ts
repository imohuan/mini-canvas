import type { UiKitTone } from '../../shared/types'

export interface NotifyItem {
  id: string
  title: string
  description?: string
  tone?: UiKitTone
  /**
   * 停留时长（ms）。不传 = 默认 3600；`0` = 常驻，需要用户自己关。
   *
   * 为什么 `0` 是常驻：旧版就是 `duration=0` 不自动关，文档与用户代码都这么写；
   * 现在交给 vue-sonner 后，内部用 `Infinity` 表达同一件事。
   */
  duration?: number
  action?: { label: string; onClick: () => void }
}

export interface NotifyOptions extends Omit<NotifyItem, 'id'> {
  id?: string
}
