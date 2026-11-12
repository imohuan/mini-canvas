/**
 * nodeSelection —— 节点"当前是否被**单独**选中"的响应式判定（给节点操作栏/状态栏/生成面板用）。
 *
 * 为什么需要它（而不是直接用 selection.has(id)）：
 * 只判断"我在选中集里"会让**多选时每个被选中的节点都弹出一份操作栏**——三个节点框选在一起，
 * 就并排浮出三份生成面板，既挡视野又互相打架。v1 的 NodeToolbar 用的判定是
 * "恰好选中一个节点且就是我"（`getSelectedNodes.length === 1`），本模块沿用同一语义。
 *
 * 依赖方向：canvas-render 只提供读取逻辑（不 import 任何节点插件）；
 * 节点插件（text/image/video…）统一从这里取，避免各包各写一份、语义漂移。
 */
import { onBeforeUnmount, ref, type Ref } from 'vue'

import { useCanvasRender } from './renderContext'

/** selection 服务的最小形状（只需要"查一个 id + 订阅变化"） */
interface SelectionLike {
  has(id: string): boolean
  onChange(cb: () => void): () => void
  /** 当前选中节点数（内核 SelectionService.ids.size） */
  readonly ids: ReadonlySet<string>
}

/**
 * 纯判定："我是否被单独选中"（Node 可单测，也是 useSoleNodeSelected 里唯一的那点逻辑）。
 *
 * 抽成纯函数是为了不必挂浏览器就能锁住语义 —— 这正是本轮要防的回归：
 * 若只判 `has(id)`，多选时每个节点都会弹出一份操作栏。
 */
export function isSoleSelected(
  selection: { ids: ReadonlySet<string>; has(id: string): boolean } | undefined,
  id: string,
): boolean {
  if (!selection) return false
  return selection.ids.size === 1 && selection.has(id)
}

/**
 * 取"本节点是否被单独选中"的响应式布尔：**选中集里只有我一个**。
 *
 * - 单选 → true（操作栏/面板应该出现）
 * - 多选（含两个及以上）→ false（全部收起，避免一排面板互相叠）
 * - 未选中 → false
 * - 缺 selection 服务（极简宿主/单测桩）→ false，不抛错
 *
 * 订阅在组件卸载时自动解除。
 */
export function useSoleNodeSelected(id: string): Ref<boolean> {
  const { ctx } = useCanvasRender()
  const sole = ref(false)
  const selection = ctx.get<SelectionLike | undefined>('selection')
  // 缺服务或桩件没给 ids（单测里的最小 selection 桩）→ 静默不显示，不抛错
  if (!selection || typeof selection.onChange !== 'function' || !selection.ids) return sole

  const sync = (): void => {
    // ids 每次返回副本，读 size 与 has 是同一次订阅里的同一个快照，语义一致
    sole.value = isSoleSelected(selection, id)
  }
  sync()
  const off = selection.onChange(sync)
  onBeforeUnmount(() => off())
  return sole
}
