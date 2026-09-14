/**
 * textEditSession —— 「哪个文本节点正在编辑」的会话状态（组件本地态，**不写进节点 data**）。
 *
 * 为什么需要它（而不是在组件里放一个 ref）：
 * 用户要的两态里，"编辑态"必须是**可被外部断言**的 —— 项目铁律是"渲染结果要有无头测试兜底"，
 * 而编辑态过去只是一个组件内部 ref，SSR 渲染时永远是预览态，那"编辑态到底有没有滚动条、
 * 有没有拦滚轮"就只能靠肉眼。放成按 nodeId 记名字的模块级响应式集合后，
 * 测试可以先 beginEdit(id) 再渲染，直接断言真 HTML（同包 image 的 cropSession 是同一套路）。
 *
 * 为什么不写进 data（与 cropSession 的三条理由一致）：
 *   1. 会落盘 —— 刷新后"一开画布就停在编辑态"；
 *   2. 会进历史 —— 进/退编辑变成可撤销操作，撤销栈里混进纯 UI 状态；
 *   3. 会被复制 —— 复制节点会把"正在编辑"一起带走。
 *
 * 纯状态逻辑，无 DOM，Node 可单测。
 */
import { reactive } from 'vue'

/** 正在编辑的节点 id 集合（响应式；同包组件共享同一实例） */
const editing = reactive(new Set<string>())

/** 当前正在编辑的节点 id（只读快照，供测试与诊断） */
export function editingTextIds(): string[] {
  return [...editing]
}

/** 该文本节点是否处于编辑态 */
export function isTextEditing(nodeId: string): boolean {
  return editing.has(nodeId)
}

/** 进入编辑态（幂等；空 id 不写入，防幽灵条目） */
export function beginEdit(nodeId: string): void {
  if (!nodeId) return
  editing.add(nodeId)
}

/** 退出编辑态（提交/Esc/节点卸载都调它；幂等） */
export function endEdit(nodeId: string): void {
  editing.delete(nodeId)
}

/** 清空全部会话（仅测试用：避免用例之间互相串状态） */
export function resetTextEditSessions(): void {
  editing.clear()
}
