/**
 * tipService —— 全局鼠标跟随提示的**基础设施服务**（默认主题提供，服务名 "tip"）。
 *
 * 用户口径：和节点同级的基础能力，其它插件 ctx.get<{show,hide}>("tip") 直接调用；
 * 不自绘气泡。位置统一在鼠标右下角、无间隔。
 *
 * 跨模块实例：状态同时写 globalThis 并广播事件（热重载 UMD 拷贝 vs bundle 拷贝不共享模块 ref）。
 */
import { ref } from "vue"

const text = ref("")
const visible = ref(false)

export const TIP_EVENT = "mini-canvas:tip"

function broadcast(): void {
  ;(globalThis as { __miniCanvasTip?: { text: string; visible: boolean } }).__miniCanvasTip = {
    text: text.value,
    visible: visible.value,
  }
  globalThis.dispatchEvent?.(new CustomEvent(TIP_EVENT))
}

/** 提示服务契约（其它插件消费的接口） */
export interface TipService {
  /** 显示提示（跟随鼠标；传空串 = 隐藏） */
  show(message: string): void
  /** 隐藏提示 */
  hide(): void
}

export function show(message: string): void {
  if (!message) return hide()
  text.value = message
  visible.value = true
  broadcast()
}

export function hide(): void {
  if (!visible.value && !text.value) return
  visible.value = false
  text.value = ""
  broadcast()
}

/** 服务对象（挂到 ctx 服务表"tip"名下） */
export const tipService: TipService = { show, hide }

