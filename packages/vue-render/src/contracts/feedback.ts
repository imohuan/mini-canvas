import { reactive } from 'vue'

/**
 * feedback —— 应用级「确认 / 输入 / 告知」服务（禁止各页面自己调 window.confirm / prompt / alert）。
 *
 * 为什么要单独成一层：这些动作在项目页、画布、设置里都要用，而画布与设置分别活在
 * 不同的 Context / Provider 下。统一走一条服务，才不会出现「首页用原生确认框、画布用自制弹窗」
 * 的两套观感，也不会把业务逻辑绑死在某个组件上。
 *
 * 本文件只放**数据与 Promise 排队**，不放 Vue 组件：面板由默认主题登记（见
 * plugin-theme-components 的 FeedbackHost），这样组件库仍是唯一 import shadcn 的地方。
 */

/** 确认框 / 输入框的按钮语气：destructive 用于删除类操作 */
export type FeedbackTone = 'default' | 'destructive'

export interface ConfirmRequest {
  kind: 'confirm'
  title: string
  /** 正文；可多段，用 \n 分段 */
  description?: string
  confirmText: string
  cancelText: string
  tone: FeedbackTone
  resolve: (ok: boolean) => void
}

export interface PromptRequest {
  kind: 'prompt'
  title: string
  description?: string
  label?: string
  defaultValue: string
  placeholder?: string
  confirmText: string
  cancelText: string
  /** 校验失败时返回错误文案；返回空串表示通过。校验在服务侧统一执行，面板只负责显示。 */
  validate?: (value: string) => string
  resolve: (value: string | null) => void
}

export interface AlertRequest {
  kind: 'alert'
  title: string
  description?: string
  confirmText: string
  tone: FeedbackTone
  resolve: () => void
}

export type FeedbackRequest = ConfirmRequest | PromptRequest | AlertRequest

export interface ConfirmOptions {
  title: string
  description?: string
  confirmText?: string
  cancelText?: string
  tone?: FeedbackTone
}

export interface PromptOptions {
  title: string
  description?: string
  label?: string
  defaultValue?: string
  placeholder?: string
  confirmText?: string
  cancelText?: string
  validate?: (value: string) => string
}

export interface AlertOptions {
  title: string
  description?: string
  confirmText?: string
  tone?: FeedbackTone
}

export interface FeedbackService {
  /** 当前等待处理的请求（面板据此渲染；同一时刻只显示一条） */
  readonly current: FeedbackRequest | null
  /** 排队等待的条数（诊断 / 测试用） */
  readonly pending: number
  confirm(opts: ConfirmOptions): Promise<boolean>
  prompt(opts: PromptOptions): Promise<string | null>
  alert(opts: AlertOptions): Promise<void>
  /** 面板点「确认」/「确定」后调用 */
  accept(value?: string): void
  /** 面板点「取消」/关闭后调用 */
  cancel(): void
}

/**
 * 运行期登记「当前应用用的是哪一份反馈服务」。
 *
 * 为什么不能只靠 ctx.get('feedback')：项目页在根 Provider 下能取到；画布会话里
 * 有些调用点（插件内部纯逻辑、模块级单例）拿不到同一个 ctx，却仍需要同一个确认框。
 * 这里保存**当前服务**，面板由谁渲染不影响调用方；服务本身仍由插件生命周期持有。
 */
let activeFeedback: FeedbackService | undefined

export function setFeedbackService(service: FeedbackService | undefined): void {
  activeFeedback = service
}

export function feedbackService(): FeedbackService | undefined {
  return activeFeedback
}

/** 调试 / 集成测试用：读出当前反馈服务有没有在等回答（不暴露内部队列） */
export function feedbackDebugSnapshot(): { kind: string | null; pending: number } | null {
  if (!activeFeedback) return null
  return { kind: activeFeedback.current?.kind ?? null, pending: activeFeedback.pending }
}

/** 把正文里的 \n\n 变成段落：两段以上用换行分隔，供面板按段落渲染 */
export function splitDescription(text: string | undefined): string[] {
  if (!text) return []
  return text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
}

/**
 * 建一份反馈服务。
 *
 * 队列语义：同一时刻只显示第一条；上一条结束（确认 / 取消）后自动弹出下一条。
 * 为什么要排队而不是覆盖：删除确认往往是用户连点两下、或多个卸载动作同时触发；
 * 覆盖会让前一个 Promise 永远悬空，调用方以为「用户没回答」。
 */
export function createFeedbackService(): FeedbackService {
  /**
   * 当前请求必须是**响应式**的：面板是按 `service.current` 渲染的。
   * 早期写成普通 let，调用方确实进了服务，但 Vue 收不到变化，弹窗永远不出现
   * （2026-11-06 真机实测：点「新建项目」毫无反应）。用 reactive 包一层，
   * 面板的 computed 才能追踪到它；不能用 ref，调用方还要 `.value`，接口会变形。
   */
  const box = reactive<{ current: FeedbackRequest | null }>({ current: null })
  const queue: FeedbackRequest[] = []

  function showNext(): void {
    box.current = queue.shift() ?? null
  }

  function enqueue<T>(make: (resolve: (value: T) => void) => FeedbackRequest): Promise<T> {
    return new Promise<T>((resolve) => {
      // 用一次性包装把类型收窄到具体请求；面板只认 current.kind
      const request = make(resolve as never)
      if (box.current) queue.push(request)
      else box.current = request
    })
  }

  function settle(): void {
    box.current = null
    showNext()
  }

  return {
    get current() {
      return box.current
    },
    get pending() {
      return queue.length
    },
    confirm(opts) {
      return enqueue<boolean>((resolve) => ({
        kind: 'confirm',
        title: opts.title,
        description: opts.description,
        confirmText: opts.confirmText ?? '确定',
        cancelText: opts.cancelText ?? '取消',
        tone: opts.tone ?? 'default',
        resolve,
      }))
    },
    prompt(opts) {
      return enqueue<string | null>((resolve) => ({
        kind: 'prompt',
        title: opts.title,
        description: opts.description,
        label: opts.label,
        defaultValue: opts.defaultValue ?? '',
        placeholder: opts.placeholder,
        confirmText: opts.confirmText ?? '确定',
        cancelText: opts.cancelText ?? '取消',
        validate: opts.validate,
        resolve,
      }))
    },
    async alert(opts) {
      await enqueue<void>((resolve) => ({
        kind: 'alert',
        title: opts.title,
        description: opts.description,
        confirmText: opts.confirmText ?? '知道了',
        tone: opts.tone ?? 'default',
        resolve,
      }))
    },
    accept(value) {
      const req = box.current
      if (!req) return
      if (req.kind === 'prompt') {
        const text = value ?? ''
        req.resolve(text)
      } else if (req.kind === 'confirm') {
        req.resolve(true)
      } else {
        req.resolve()
      }
      settle()
    },
    cancel() {
      const req = box.current
      if (!req) return
      if (req.kind === 'prompt') req.resolve(null)
      else if (req.kind === 'confirm') req.resolve(false)
      else req.resolve()
      settle()
    },
  }
}

/** 服务在 Context 上的名字（唯一真源；宿主 / 插件都从这里取） */
export const FEEDBACK_SERVICE = 'feedback'
