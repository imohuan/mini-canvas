/**
 * notifyContract —— 全局通知服务的纯结构契约（零 Vue / 零具体通知库）。
 *
 * 默认主题用 vue-sonner 实现并通过 `ctx.provide('notify', ...)` 上架；
 * 业务插件只依赖这个类型，不 import `vue-sonner`，也不自己挂 Toaster。
 *
 * **和 canvas.notify 不是同一个东西**：
 * - `ctx.get('notify')`：右下角角标通知（成功 / 失败 / loading），落脚一条就消失；
 * - `ctx.get('canvas').notify()`：跟随鼠标的画布浮字（拖线非法、替换连接提示），
 *   带 source / followPointer / 撤回函数。两者各管各的，不要互相替代。
 */

/** 通知类型：对应 vue-sonner 的语义色与图标。 */
export type NotifyKind = 'info' | 'success' | 'warning' | 'error' | 'loading' | 'message'

/** 单条通知的选项（只露业务需要的部分，避免把底层库整包漏出来）。 */
export interface NotifyOptions {
  /** 通知 id；传同一个 id 可原地更新（适合 loading → success） */
  id?: string | number
  /** 第二行说明 */
  description?: string
  /** 自动关闭毫秒数；Infinity = 不自动关 */
  duration?: number
  /** 可手动关闭 */
  dismissible?: boolean
  /** 单个通知上的 action 按钮 */
  action?: { label: string; onClick: (event: MouseEvent) => void }
  /** 成功/失败的回调 */
  onDismiss?: () => void
  onAutoClose?: () => void
}

/** 全局通知服务。 */
export interface NotifyContract {
  /** 普通通知 */
  (message: string, options?: NotifyOptions): string | number
  info(message: string, options?: NotifyOptions): string | number
  success(message: string, options?: NotifyOptions): string | number
  warning(message: string, options?: NotifyOptions): string | number
  error(message: string, options?: NotifyOptions): string | number
  /** 常驻 loading；拿到 id 后可用 success/error 原地更新 */
  loading(message: string, options?: NotifyOptions): string | number
  message(message: string, options?: NotifyOptions): string | number
  /**
   * 等待 Promise：loading → success/error 自动切换。
   * 返回值带 `unwrap()` 时可直接拿 Promise 的最终结果（与 vue-sonner 一致）。
   */
  promise<T>(
    promise: Promise<T> | (() => Promise<T>),
    options: {
      loading: string
      success: string | ((data: T) => string)
      error: string | ((error: unknown) => string)
      description?: string
    },
  ): unknown
  /** 关掉一条（不传 id = 全部） */
  dismiss(id?: string | number): void
}

/** 通知正文用纯文本（服务契约不把具体的组件类型带进 canvas-data）。 */
export type NotifyMessage = string
