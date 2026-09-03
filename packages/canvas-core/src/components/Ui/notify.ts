/**
 * AxNotify —— 全局通用 notify 控制器（无组件依赖，任意处可直接 import 调用）。
 *
 * 用法：
 *   import { notify, notifySuccess, notifyError, notifyInfo, notifyWarning } from './notify'
 *   notifySuccess('已保存')
 *   notifyError('保存失败：网络异常')
 *   notifyInfo('正在同步…', { duration: 0 })
 *   notifyWarning('磁盘空间不足')
 *   // 或底层：
 *   notify({ type: 'error', title: '生成失败', text: '...', duration: 5000 })
 *
 * 展示由 <AxNotifyHost /> 完成：宿主组件只需在应用根渲染一次，
 * 它会订阅本模块的响应式队列，把每条通知渲染成右上角浮动 toast。
 * notify() 与宿主解耦 —— 即使宿主尚未挂载，消息也会先入队，挂载后统一补显示。
 */
import type { AlertType } from './types'
import { reactive } from 'vue'

export interface AxNotifyItem {
  id: number
  type: Exclude<AlertType, ''> // 'info' | 'success' | 'warning' | 'error'
  /** 标题（如「生成失败」）；缺省时按 type 给默认标题 */
  title?: string
  /** 正文 */
  text: string
  /** 可选缩略图/图片列表（如生成结果图），仅用于展示 */
  images?: string[]
  /** 停留时长 ms；0 = 不自动关闭 */
  duration?: number
}

export interface AxNotifyOptions {
  type?: AxNotifyItem['type']
  title?: string
  text: string
  images?: string[]
  duration?: number
}

const DEFAULT_DURATION = 4000
const DEFAULT_TITLES: Record<AxNotifyItem['type'], string> = {
  info: '提示',
  success: '成功',
  warning: '警告',
  error: '错误',
}

/** 通知队列（响应式，供 AxNotifyHost 渲染）—— 必须是 reactive Map，否则宿主不会感知新增 */
export const notifyQueue: Map<number, AxNotifyItem> = reactive(new Map<number, AxNotifyItem>())
let seq = 0

/** 主动移除一条通知 */
export function dismissNotify(id: number): void {
  notifyQueue.delete(id)
}

/** 清空全部通知 */
export function clearNotifies(): void {
  notifyQueue.clear()
}

/** 核心入口：入队一条通知并返回其 id */
export function notify(options: AxNotifyOptions): number {
  const id = ++seq
  const type = options.type ?? 'info'
  notifyQueue.set(id, {
    id,
    type,
    title: options.title ?? DEFAULT_TITLES[type],
    text: options.text,
    images: options.images,
    duration: options.duration,
  })

  // 自动关闭（duration=0 常驻）
  if (options.duration !== 0) {
    const ms = options.duration ?? DEFAULT_DURATION
    window.setTimeout(() => dismissNotify(id), ms)
  }
  return id
}

/** 便捷别名 */
export function notifySuccess(text: string, opts?: Omit<AxNotifyOptions, 'type' | 'text'>): number {
  return notify({ ...opts, type: 'success', text })
}
export function notifyError(text: string, opts?: Omit<AxNotifyOptions, 'type' | 'text'>): number {
  return notify({ ...opts, type: 'error', text })
}
export function notifyInfo(text: string, opts?: Omit<AxNotifyOptions, 'type' | 'text'>): number {
  return notify({ ...opts, type: 'info', text })
}
export function notifyWarning(text: string, opts?: Omit<AxNotifyOptions, 'type' | 'text'>): number {
  return notify({ ...opts, type: 'warning', text })
}
