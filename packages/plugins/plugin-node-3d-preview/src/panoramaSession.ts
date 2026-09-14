/**
 * panoramaSession —— 「哪个 3D 预览节点正在交互」的会话状态（组件本地态，**不写进节点 data**）。
 *
 * 为什么不直接写 data._editing（v1 是这么干的）：
 *   1. 会落盘 —— v1 得靠 sanitizeForSave 手动把 _editing 抠掉，否则刷新后一开画布就停在
 *      "转视角"模式（连拖节点都拖不动）；v2 没有这层兜底，写进去必然踩同一个坑；
 *   2. 会进历史 —— 双击进/出交互会变成可撤销操作，撤销栈里混进纯 UI 状态；
 *   3. 会被复制 —— 复制节点把"正在交互"一起带走。
 *
 * 放成按 nodeId 记名字的模块级响应式集合还有第二个好处：模式是可被无头测试断言的 ——
 * 测试先 beginInteract(id) 再渲染，就能直接拿真 HTML 断言"交互模式到底有没有接管指针/滚轮"。
 * （同包思路与 plugin-node-text 的 textEditSession、plugin-node-image 的 cropSession 一致。）
 *
 * 纯状态逻辑，无 DOM，Node 可单测。
 */
import { reactive } from 'vue'

/** 正在交互的节点 id 集合（响应式；同包组件共享同一实例） */
const interacting = reactive(new Set<string>())

/** 正在全屏查看的节点 id 集合（f 切换；同样不写 data） */
const fullscreen = reactive(new Set<string>())

/**
 * 「重置视角」请求计数器（按节点记）。
 * 视角状态在组件内部（three 的相机朝向），而命令与组件是两处地方，所以需要一个信号通道：
 * 命令只负责 +1，组件 watch 到变化就把相机拉回初始朝向。用计数器而不是布尔，
 * 是为了"连按两次 r"也能各触发一次。
 */
const resetTokens = reactive(new Map<string, number>())

/** 当前正在交互的节点 id（只读快照，供测试与诊断） */
export function interactingIds(): string[] {
  return [...interacting]
}

/** 该 3D 预览节点是否处于交互模式 */
export function isInteracting(nodeId: string): boolean {
  return interacting.has(nodeId)
}

/** 进入交互模式（幂等；空 id 不写入，防幽灵条目） */
export function beginInteract(nodeId: string): void {
  if (!nodeId) return
  interacting.add(nodeId)
}

/**
 * 退出交互模式（Esc / 点画布空白 / 节点卸载都调它；幂等）。
 * 一并退出全屏：全屏是交互的"更强形态"，不允许出现"全屏但不在交互"的悬空状态
 * （那会让模式判定与用户看到的画面不一致）。
 */
export function endInteract(nodeId: string): void {
  interacting.delete(nodeId)
  fullscreen.delete(nodeId)
}

/** 清空全部会话（仅测试用：避免用例之间互相串状态） */
export function resetInteractSessions(): void {
  interacting.clear()
  fullscreen.clear()
  resetTokens.clear()
}

/** 该 3D 预览节点是否正在全屏查看 */
export function isFullscreen(nodeId: string): boolean {
  return fullscreen.has(nodeId)
}

/**
 * 进入全屏（幂等；空 id 不写入）。
 * **同时进入交互模式**：全屏是交互的"更强形态"，两者不能各自为政 ——
 * 否则会出现"全屏但 interacting=false"的悬空状态，Esc 退出逻辑与滚轮接管都会判错。
 */
export function enterFullscreen(nodeId: string): void {
  if (!nodeId) return
  interacting.add(nodeId)
  fullscreen.add(nodeId)
}

/** 退出全屏（幂等） */
export function exitFullscreen(nodeId: string): void {
  fullscreen.delete(nodeId)
}

/** 切换全屏，返回切换后是否处于全屏（命令 run 用） */
export function toggleFullscreen(nodeId: string): boolean {
  if (!nodeId) return false
  if (fullscreen.has(nodeId)) {
    fullscreen.delete(nodeId)
    return false
  }
  enterFullscreen(nodeId)
  return true
}

/** 当前正在全屏的节点 id（只读快照，供测试与诊断） */
export function fullscreenIds(): string[] {
  return [...fullscreen]
}

/** 请求"重置视角"（命令侧调用；同一节点每调一次 token +1） */
export function requestResetView(nodeId: string): void {
  if (!nodeId) return
  resetTokens.set(nodeId, (resetTokens.get(nodeId) ?? 0) + 1)
}

/** 某节点已收到的重置请求次数（组件 watch 它；0 表示还没请求过） */
export function resetViewToken(nodeId: string): number {
  return resetTokens.get(nodeId) ?? 0
}
