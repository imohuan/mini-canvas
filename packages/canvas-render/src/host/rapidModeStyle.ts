/**
 * rapidModeStyle —— 拖拽快速模式（dragRapidMode）的层提升样式，与「绝不破坏层序」的判定。
 *
 * 背景（2026-10-27 用户实测）：平移画布时连线会在节点上下反复跳。
 *
 * 画布内节点层的结构是：
 *   .vue-flow__transformationpane
 *     ├─ svg.vue-flow__edges   ← 每条边一支；z = LAYERS.edge / edgeSelected / edgeTop
 *     └─ .vue-flow__nodes      ← 所有节点都在这一层里；z = LAYERS.node / nodeSelected
 *
 * 拖拽快速模式原本给 .vue-flow__nodes 写 will-change: transform 提性能。但这会让节点层
 * 变成层叠上下文：它的 z-index 变成 auto、不再与兄弟边参与 z 比较，于是容器内所有节点
 * （200 / 300）整体掉进父级层叠顺序里，被兄弟边（100 / 250）压住 —— 平移时加、停止 300ms 后摘，
 * 画面就「一会儿线在上、一会儿节点在上」。
 *
 * 因此这里把「安全地提升合成层」收敛成一张白名单：只允许触发合成层提升、但**不创建**层叠
 * 上下文的属性。新增属性前先确认它不在 STACKING_CONTEXT_PROPS 里；测试会兜住。
 */

/** 会创建层叠上下文的 CSS 属性（camelCase，与 HTMLElement.style 一致）。
 *  依据：CSS 2.1 z-index，与 CSS Positioned Layout / Transforms / Filter Effects 规范中
 *  「只要出现就建层叠上下文」的那批条件。 */
const STACKING_CONTEXT_PROPS = new Set([
  'willChange',      // will-change: transform / opacity / filter ...
  'transform',
  'translate',
  'rotate',
  'scale',
  'filter',
  'backdropFilter',
  'perspective',
  'isolation',       // isolation: isolate
  'opacity',         // opacity < 1
  'mixBlendMode',
  'contain',         // contain: paint / layout / strict / content
  'contentVisibility',
  'mask',
  'maskImage',
  'clipPath',
  'zIndex',          // 配合 position 建立层叠上下文（auto 除外）
])

/** 判断某个样式属性是否可能让元素变成层叠上下文 */
export function createsStackingContext(prop: string): boolean {
  return STACKING_CONTEXT_PROPS.has(prop)
}

/** 拖拽快速模式期间应用到节点层的样式：提升为合成层，但不创建层叠上下文。
 *  backface-visibility: hidden 会让 Chrome 把元素提升为合成层，但不满足任何建层叠上下文条件，
 *  所以节点与兄弟边（SVG）之间的 z 比较规则保持不变。 */
export const RAPID_MODE_STYLE = {
  backfaceVisibility: 'hidden',
} as const

/** 把 RAPID_MODE_STYLE 应用到元素（传 null 静默跳过，兼容未挂载/已卸载） */
export function applyRapidModeStyle(el: HTMLElement | null | undefined): void {
  if (!el) return
  for (const [prop, value] of Object.entries(RAPID_MODE_STYLE)) {
    ;(el.style as unknown as Record<string, string>)[prop] = value
  }
}

/** 摘掉拖拽快速模式的样式（恢复元素默认） */
export function clearRapidModeStyle(el: HTMLElement | null | undefined): void {
  if (!el) return
  for (const prop of Object.keys(RAPID_MODE_STYLE)) {
    ;(el.style as unknown as Record<string, string>)[prop] = ''
  }
}

