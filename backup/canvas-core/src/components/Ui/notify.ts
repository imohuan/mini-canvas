/**
 * AxNotify —— 基于 vue-sonner 的自定义 toast 控制器。
 *
 * 底层是 vue-sonner 单例，但**不用** vue-sonner 原生 success/error 样式，
 * 而是统一通过 `toast.custom(markRaw(AxToast), ...)` 渲染我们自己的 <AxToast />，
 * 从而让所有通知都保持 AxNotify 的自定义外观（类型图标 + 配色 + 缩略图）。
 *
 * 展示需在应用根挂载一次 <Toaster />（见 Canvas.vue），并一次性引入 'vue-sonner/style.css'。
 * 容器/堆叠/进出场动画/滑动关闭/自动关闭(duration) 交给 vue-sonner；
 * 卡片外观与「消息/说明/缩略图/关闭按钮」由 AxToast 自行渲染（onCloseToast 由 vue-sonner 注入）。
 *
 * 用法（既有调用面保持不变）：
 *   import { notifySuccess, notifyError } from './notify'
 *   notifySuccess('已生成 1 张画面', { images: urls })
 *   notifyError('生成失败')
 *   notifyInfo('正在同步…', { duration: Infinity })
 */
import { markRaw } from 'vue'
import { toast } from 'vue-sonner'
import type { ExternalToast } from 'vue-sonner'
import AxToast from './AxToast.vue'

/** 通知类型：info/success/warning/error（语义等同 AlertType） */
export type AxNotifyType = 'info' | 'success' | 'warning' | 'error'

export interface AxNotifyOptions {
  /** 主文案（必填——由各便捷方法的第一个参数带入） */
  message?: string
  /** 次要说明文字（渲染在 message 下方） */
  description?: string
  /** 可选缩略图列表（如生成结果图），以图片行展示在正文下方 */
  images?: string[]
  /** 停留时长 ms；Infinity = 不自动关闭。缺省用 vue-sonner 默认时长 */
  duration?: number
}

/** 组装 toast.custom 所需的 componentProps（AxToast 的入参） */
function buildComponentProps(
  message: string,
  type: AxNotifyType,
  options?: AxNotifyOptions,
): ExternalToast['componentProps'] & { type: AxNotifyType; message: string } {
  return {
    type,
    message,
    description: options?.description,
    images: options?.images,
  }
}

/** 核心入口：渲染一条自定义 AxToast 通知并返回其 id */
export function notify(message: string, options?: AxNotifyOptions & { type?: AxNotifyType }): string | number {
  const type = (options?.type ?? 'info') as AxNotifyType
  return toast.custom(markRaw(AxToast), {
    componentProps: buildComponentProps(message, type, options),
    duration: options?.duration,
  })
}

/** 便捷别名（第一个参数为主文案；opts 不含 type） */
export function notifySuccess(message: string, opts?: AxNotifyOptions): string | number {
  return notify(message, { ...opts, type: 'success' })
}
export function notifyError(message: string, opts?: AxNotifyOptions): string | number {
  return notify(message, { ...opts, type: 'error' })
}
export function notifyInfo(message: string, opts?: AxNotifyOptions): string | number {
  return notify(message, { ...opts, type: 'info' })
}
export function notifyWarning(message: string, opts?: AxNotifyOptions): string | number {
  return notify(message, { ...opts, type: 'warning' })
}

/** 主动关闭某条 toast（id 来自 notify 系列或 toast 调用的返回值）；不传 id 则关闭全部 */
export function dismissNotify(id?: string | number): void {
  toast.dismiss(id)
}

/** 清空当前所有 toast */
export function clearNotifies(): void {
  toast.dismiss()
}
