/**
 * panoramaMode —— 3D 预览节点的「两种模式」判定（纯函数，零 three / 零 Vue / 零 DOM，Node 可单测）。
 *
 * 用户要求（原话）："3D 预览节点这个地方也有 2 种模式的，也是双击进入，进入之后可以转动视角，
 * 默认模式下是用来拖拽节点的"。
 *
 * 翻成两条硬性规则，也就是本模块存在的全部理由：
 * 1. **默认（预览）模式：画面不吃指针事件** —— 按住画面拖动 = 拖动节点本身（v1 是反过来的：
 *    必须先双击进入 _editing 才能转，否则转不动；v2 把"拖节点"设为默认，符合直觉）；
 * 2. **交互模式（双击进入）：画面接管指针与滚轮** —— 拖拽转视角、滚轮改视野角，
 *    并且把滚轮拦下来（不去缩放画布），否则转视角时画布会跟着一起缩。
 *
 * 抽成纯函数而不是写在 .vue 的 computed 里：这样"哪种模式吃事件/拦滚轮"能在 Node 里直接断言，
 * 不必起 WebGL；模板只负责把结论接到 class / style / 事件上。
 */

/** 模式名：预览 / 交互（双击进入）/ 全屏（f 进入）/ 渲染失败降级 */
export type PanoramaMode = 'preview' | 'interactive' | 'fullscreen' | 'error'

/** 当前模式下的行为结论（模板照它渲染，不再自己判条件） */
export interface PanoramaSpec {
  mode: PanoramaMode
  /** 是否处在"转视角"的交互模式 */
  interactive: boolean
  /** 是否处在全屏查看（f 切换） */
  fullscreen: boolean
  /** 3D 画面是否接管指针事件（false = 事件穿透下去，按住就能拖节点） */
  capturePointer: boolean
  /** 是否把滚轮从画布手里抢过来（不然转视角时画布会跟着缩放） */
  captureWheel: boolean
}

/** 判定输入 */
export interface PanoramaModeInput {
  /** 是否处于交互模式（双击进入） */
  interactive: boolean
  /** 是否处于全屏（f 切换） */
  fullscreen: boolean
  /** 渲染是否失败（浏览器不支持 WebGL 等）：失败就降级成纯文字说明，什么都不接管 */
  hasError: boolean
}

/**
 * 算出当前该用哪种模式 + 相关行为。
 *
 * 优先级：渲染失败 > 全屏 > 交互模式 > 预览模式。两条要点：
 * - 渲染失败时一律不接管事件 —— 画面已经不可用，再抢事件只会让节点变成拖不动的死块；
 * - 全屏等同"更强的交互"：用户按 f 就是专门来看图的，进去就该能转能缩。
 *
 * 注意这里**不再有**任何"操作提示文案"和"重置按钮"：用户明确要求删掉
 * （"这个提醒可以删除，这样会遮挡视线"、"删除你的右上角的 重置按钮"），
 * 操作改走快捷键（f 全屏 / r 重置视角），提示不再常驻画面。
 */
export function resolvePanoramaSpec(input: PanoramaModeInput): PanoramaSpec {
  if (input.hasError) {
    return { mode: 'error', interactive: false, fullscreen: false, capturePointer: false, captureWheel: false }
  }
  if (input.fullscreen) {
    return { mode: 'fullscreen', interactive: true, fullscreen: true, capturePointer: true, captureWheel: true }
  }
  if (input.interactive) {
    return { mode: 'interactive', interactive: true, fullscreen: false, capturePointer: true, captureWheel: true }
  }
  return {
    mode: 'preview',
    interactive: false,
    fullscreen: false,
    // 关键：预览模式让指针事件穿透到下层节点 —— 这正是"默认模式用来拖拽节点"的实现方式
    capturePointer: false,
    captureWheel: false,
  }
}

/** Esc 该做什么：退全屏 / 退交互 / 什么都不做 */
export type EscapeAction = 'exit-fullscreen' | 'exit-interact' | 'none'

/**
 * 算出 Esc 这一下该退哪一层。
 *
 * **一次只退一层**（对齐老版 PanoramaNode：全屏时 Esc 只退全屏，人仍留在"能转视角"的状态）：
 * 全屏 → 退回节点内但仍在交互 → 再按一次才回到"按住就能拖节点"的预览态。
 * 这样从"看全景"到"拖节点"有明确的中间层，不会一下就跳回去、也不用担心误退。
 */
export function resolveEscapeAction(state: { fullscreen: boolean; interactive: boolean }): EscapeAction {
  if (state.fullscreen) return 'exit-fullscreen'
  if (state.interactive) return 'exit-interact'
  return 'none'
}
