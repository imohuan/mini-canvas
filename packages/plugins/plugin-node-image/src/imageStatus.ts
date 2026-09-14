/**
 * imageStatus —— "这张图当前加载失败了吗"的跨组件共享态（组件本地，**不写节点 data**）。
 *
 * 需求来源：状态栏要显示"图片已失效"，但 <img> 的加载成败只有内容组件（ImageContent）知道，
 * 状态栏是它的兄弟组件。
 *
 * 为什么不写进 data：
 * - 会落盘。`imageBroken: true` 存下去后，刷新时图片其实能正常显示，状态栏却仍报失效；
 * - 会进历史。纯展示态不该占用撤销栈；
 * - 语义上它是"本次会话这个 URL 解不出来"，不是图片的固有属性。
 *
 * 所以用模块级响应式集合按 nodeId 记标记，出画布即消失。纯状态逻辑，node 可单测。
 */
import { reactive } from 'vue'

/** 加载失败的节点 id 集合（响应式；同包组件共享） */
const broken = reactive(new Set<string>())

/** 当前标记为失效的节点 id（供测试与诊断；只读快照） */
export function brokenIds(): string[] {
  return [...broken]
}

/** 该节点的图片是否加载失败 */
export function isImageBroken(nodeId: string): boolean {
  return broken.has(nodeId)
}

/** 标记加载失败（幂等） */
export function markImageBroken(nodeId: string): void {
  if (!nodeId) return
  broken.add(nodeId)
}

/** 清除标记（图片换新/重新加载成功时调用；幂等） */
export function clearImageBroken(nodeId: string): void {
  broken.delete(nodeId)
}
