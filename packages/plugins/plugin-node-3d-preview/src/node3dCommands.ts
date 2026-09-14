/**
 * node3dCommands —— 3D 预览节点的快捷键命令：目标判定（纯函数，零 Vue / 零 DOM，Node 可单测）。
 *
 * 用户要求（原话）："给他一些节点操作快捷键…r 重置，f 全屏（切换效果-注意这里画布也可能注册了 f，
 * 你需要有一个优先级，选中节点之后支持这些快捷键）"。
 *
 * 为什么单独一层：`f` / `r` 已经被自动布局插件注册（f=聚焦选中、r=适应视图）。
 * 要让节点在"选中它"时接管这两个键，就必须把"现在归谁"这件事算清楚。
 * 判定写成纯函数后，本插件能把它直接接到命令的 `when` 上 ——
 * 内核分发时 when 为假就**让位**给同键的其它命令（见 kernel/src/command.ts），
 * 于是：选中 3D 节点时 f/r 归节点，没选中时 f/r 照旧是画布的聚焦/适应视图。
 */

/** 全屏切换命令 id（快捷键 f） */
export const PANORAMA_FULLSCREEN_COMMAND = '3d-preview:fullscreen'
/** 重置视角命令 id（快捷键 r） */
export const PANORAMA_RESET_COMMAND = '3d-preview:reset'

/** 本插件拥有的节点类型名（与 node3dPreviewPlugin 的注册保持一致） */
export const PANORAMA_NODE_TYPE_FOR_COMMAND = '3d-preview'

/**
 * 算出这次快捷键该作用在哪个 3D 预览节点上。
 *
 * 只有"**恰好**选中一个、且该节点就是 3D 预览"时才返回它的 id —— 其余一律返回空串（= 不适用）：
 * - 没选：显然不归节点；
 * - 选的不是这个类型：不能抢画布的 f/r；
 * - 选了多个：该操作哪一个不明确，宁可不做也不猜（与"多选时控制栏全部收起"同一条原则）；
 * - 选中集里是已删除的幽灵 id：按"不适用"处理，让位给画布。
 *
 * @param selectedIds 当前选中的节点 id（内核 Selection.ids）
 * @param typeOf      按 id 查节点类型的回调（查不到返回 undefined）
 */
export function resolveCommandTarget(
  selectedIds: readonly string[],
  typeOf: (nodeId: string) => string | undefined,
): string {
  if (selectedIds.length !== 1) return ''
  const id = selectedIds[0]
  return typeOf(id) === PANORAMA_NODE_TYPE_FOR_COMMAND ? id : ''
}
