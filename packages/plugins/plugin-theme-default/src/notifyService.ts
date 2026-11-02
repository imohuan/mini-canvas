/**
 * notifyService —— 默认主题提供的全局通知服务（底层 vue-sonner）。
 *
 * 为什么放在主题插件：通知是"外观件"，换一套主题时应该能整体换掉。
 * 业务插件只 `ctx.tryGet('notify')`，不直接依赖具体通知库。
 *
 * Toaster 由宿主从 ui 目录取 `Toaster` 挂一次；这里只负责把调用转给 vue-sonner。
 */
import { toast, type ExternalToast } from 'vue-sonner'
import type { NotifyContract, NotifyOptions } from '@mini-canvas/canvas-data'

/** 把项目选项转成 vue-sonner 的选项；undefined 保持 undefined，免得覆盖底层默认。 */
function toSonnerOptions(options?: NotifyOptions): ExternalToast | undefined {
  if (!options) return undefined
  const { id, description, duration, dismissible, action, onDismiss, onAutoClose } = options
  return {
    ...(id !== undefined ? { id } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(duration !== undefined ? { duration } : {}),
    ...(dismissible !== undefined ? { dismissible } : {}),
    ...(action !== undefined ? { action } : {}),
    ...(onDismiss !== undefined ? { onDismiss: () => onDismiss() } : {}),
    ...(onAutoClose !== undefined ? { onAutoClose: () => onAutoClose() } : {}),
  }
}

/** 创建通知服务。不挂 DOM，只转调；Toaster 由宿主挂载。 */
export function createNotifyService(): NotifyContract {
  const notify = ((message: string, options?: NotifyOptions) => toast(message, toSonnerOptions(options))) as NotifyContract
  notify.info = (message, options) => toast.info(message, toSonnerOptions(options))
  notify.success = (message, options) => toast.success(message, toSonnerOptions(options))
  notify.warning = (message, options) => toast.warning(message, toSonnerOptions(options))
  notify.error = (message, options) => toast.error(message, toSonnerOptions(options))
  notify.loading = (message, options) => toast.loading(message, toSonnerOptions(options))
  notify.message = (message, options) => toast.message(message, toSonnerOptions(options))
  // vue-sonner 的 promise() 返回带 unwrap 的对象（旧契约只声明了 id）；
  // 契约层给 unknown，由调用方按需取（不在这里虚构一个 string/number）。
  notify.promise = (promise, options) => toast.promise(promise, options)
  notify.dismiss = (id) => void toast.dismiss(id)
  return notify
}
