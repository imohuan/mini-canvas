/**
 * transient —— 画布"中间态元素"的通用契约（纯逻辑，零 Vue）。
 *
 * 什么是中间态：为完成一次交互而临时出现在画布上的节点/边（例：拖线落空白时那张"待选择"的
 * 菜单卡、以及它到源节点的占位连线）。它不是用户的作品，交互结束就该消失或被换成正式元素。
 *
 * 这些语义是**通用的**（任何插件都可能需要临时元素），所以判定收在本文件一处，内核/渲染层/主题
 * 统一读它 —— 而不是各自去认识某个插件发明的私有标记：
 *   - 不落盘：刷新后不复活；
 *   - 不进历史：撤销栈里不该有它，undo 也不该把它恢复出来；
 *   - 不参与连接校验：既不算重复边，也不算环；
 *   - 不可交互：不能拖动/选中/删除（否则点空白会连带删掉别的元素）。
 *
 * 标记位置：元素的 `data` 扩展包（与 v1 `data._overlay` 同一惯用法），因为 `data` 是唯一能同时被
 * 内核读到、又被节点/边组件通过 props 读到的通道。
 *
 * 兼容：内核 M5 起沿用的 `data.isTemp` 仍被认作中间态（存量持久化数据与既有测试依赖它）。
 */

/** 中间态标记键（放在元素的 `data` 里） */
export const TRANSIENT_KEY = 'transient'

/** 历史遗留的中间态标记键（内核 M5 起沿用，保留兼容） */
export const TRANSIENT_LEGACY_KEY = 'isTemp'

/** 可判定"是否中间态"的最小形状：任何带 data 的节点/边 */
export interface TransientLike {
  data?: unknown
}

/**
 * 该元素是否中间态。
 *
 * 读 `data.transient`；缺省时回退历史遗留的 `data.isTemp`，保证新旧两种标记行为一致。
 */
export function isTransient(el: TransientLike | undefined | null): boolean {
  const d = el?.data as Record<string, unknown> | undefined | null
  if (!d) return false
  return d[TRANSIENT_KEY] === true || d[TRANSIENT_LEGACY_KEY] === true
}
