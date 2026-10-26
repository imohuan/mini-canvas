/**
 * tipService —— 通用鼠标跟随提示的**基础服务**（渲染层提供，服务名 "tip"）。
 *
 * 用户口径：和节点同级的基础设施，任何插件 ctx.get("tip").show(...) 直接调用；
 * 位置统一在鼠标右下角、无间隔（左上角对齐指针）。
 *
 * 为什么在渲染层而不是主题：拖线非法提示（BaseNode/ConnectionLine）属于渲染层的反馈，
 * 主题只是外观提供方；服务放渲染层，换主题也仍然可用。
 *
 * 跨模块实例：状态写 globalThis 并广播事件（热重载 UMD 拷贝 vs bundle 拷贝不共享模块 ref）。
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

/** 提示服务契约 */
export interface TipService {
  /** 显示提示（跟随鼠标；空串 = 隐藏） */
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

/** 服务对象（挂到 ctx 服务表 "tip" 名下） */
export const tipService: TipService = { show, hide }

