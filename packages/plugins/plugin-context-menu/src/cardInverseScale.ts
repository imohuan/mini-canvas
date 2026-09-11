/**
 * cardInverseScale —— 菜单卡的"反缩放"几何（纯函数，可单测）。
 *
 * 需求：菜单卡在**屏幕上的大小恒定**，不随画布 zoom 变化（反缩放）。
 *
 * 做法：卡片 CSS `transform: scale(1/zoom)` —— 画布放大多少，卡片就缩回多少。
 * 参考 v1 `canvas-core/src/components/Decoration/NodeToolbar.vue`：它读 `viewport.zoom`
 * 把浮层定位/缩放到屏幕空间；v2 这张菜单卡是**节点内部**的卡片，等价做法就是让卡片自己反缩放。
 *
 * 锚点：`transform-origin` 取**端口所在那条边的竖直中点**。
 * 因为松手点 = 新节点端口位置，缩放必须钉住这个点，否则菜单会从松手点飘走：
 * 端口在左（新节点是 target）→ `left center`；端口在右（新节点是 source）→ `right center`。
 *
 * 附带好处（重要）：反缩放正好抵消画布缩放，端口相对节点框的位置恒为 (0, h/2)，与 zoom 无关 ——
 * VueFlow 缓存的 handleBounds 因此不会随缩放失效，连线端点始终贴住端口，
 * 不需要 updateNodeInternals 硬刷新（那条路在端口显隐问题上已被否掉）。
 */

/** 端口所在边 */
export type PortSide = 'left' | 'right'

/**
 * 反缩放系数 k（卡片 `transform: scale(k)`）。
 *
 * zoom=1 → 1（不缩放）；zoom=0.5 → 2（画布缩到一半，卡片放大两倍抵消）；zoom=2 → 0.5。
 * 非正 / 非法 zoom 兜底为 1，避免除零与负缩放。
 *
 * 不变量：`卡片布局尺寸 × k × zoom === 卡片布局尺寸`（屏幕尺寸恒定）。
 */
export function inverseScaleForZoom(zoom: number): number {
  return Number.isFinite(zoom) && zoom > 0 ? 1 / zoom : 1
}

/**
 * 反缩放锚点（CSS `transform-origin`）：端口在哪条边，就从那条边的竖直中点钉住。
 */
export function inverseScaleOrigin(side: PortSide | null | undefined): string {
  return side === 'right' ? 'right center' : 'left center'
}

/** 把端口侧归一成合法的左右值（缺省/非法 → 'left'） */
export function normalizePortSide(side: unknown): PortSide {
  return side === 'right' ? 'right' : 'left'
}
