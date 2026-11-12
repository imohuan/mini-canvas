/**
 * tabPageOnly —— 键盘 Tab 的落点规则（纯函数，可在 node 里单测）。
 *
 * 为什么要这个文件（用户口径 2026-10-14）：
 *   ①「按理说，这边树状图里面的所有内容都不支持聚焦，应该说整个页面的内容都不支持聚焦，
 *      除了弹出框最底下的几个按钮。」
 *   ② 我把焦点环用 CSS 关掉之后，用户指出「你 CSS 是关闭了，看不见了，但是它的实际功能依然
 *      存在。比如说 table 的时候，它依然会进行一个聚焦」——
 *      这句话点破了要害：隐藏焦点环只是**看不见**，Tab 照样在满屏的按钮之间跳。
 *      要真的解决，必须改**行为**：让 Tab 不要到处乱跑。
 *
 * 定稿行为（三句话）：
 *   - **页面上没有浮层时，Tab 什么也不做** —— 焦点留在原处（通常就是 body）。
 *     这条是 ① 的直接落地：整个页面不做 Tab 漫游。
 *   - **浮层（弹窗 / 菜单 / 预览器 / 设置面板）打开时，Tab 只在浮层内部循环走** ——
 *     这就是 ① 里「除了弹出框最底下的几个按钮」那些例外，也是 aria-modal 本来就该有的样子
 *     （模态的键盘焦点不该跑到底下页面上）。
 *   - **正在打字时 Tab 不劫持** —— 输入框 / 文本域 / 可编辑里的 Tab 有自己的含义
 *     （Agent 输入框里就是补全）。只在「按 Tab 会移动焦点」的场合才拦。
 *
 * 为什么不做「Tab 循环整个页面」（很多桌面应用的做法）：用户明确说了不要页面漫游。
 * 页面上本来就没有哪个元素需要靠 Tab 才够得到 —— 所有控件点得到、也有全局快捷键。
 */

/** 浮层根节点（覆盖层）的标记类名。**结构契约**，与 App.vue 的 Tab 处理器成对使用。 */
export const OVERLAY_ROOT_CLASS = 'tab-scope-overlay'

/**
 * 浮层判定用的类名表：**只在打开时存在于 DOM** 的浮层根节点。
 *
 * 这些是全仓浮层件的既有类名（AxDialog 面板 / Dropdown 面板 / 画布菜单 / MediaViewer /
 * 风格库 / 特效库 / 媒体帧覆盖层 / 参考选择 / 设置面板）。多列一个不碍事；漏一个的后果是
 * 「那个浮层里 Tab 又会跑到底下页面去」。
 *
 * ★ 这里**不能**放常驻存在的包壳 —— 实测踩过：AxTooltip 的 `.axt-root` 是触发器的包壳，
 *   只要按钮渲染了它就在 DOM 里（真机实测首页 11 个、`.axt-bubble` 0 个），把它算成浮层会让
 *   topOverlay() 永远返回非空，「页面上不漫游」直接失效。本表只收**挂载即出现、卸载即消失**
 *   的浮层根。若某个浮层改用 v-show（一直挂着），就要在它根上补 `.tab-scope-overlay` 标记。
 */
const OVERLAY_CLASSES = [
  'axdlg-panel',
  'dd-menu',
  'canvas-menu',
  'mv-root',
  'slol-layer',
  'elol-layer',
  'mfo',
  'rs-root',
  'psd-dialog',
]

/** 最外层（贴到 body 上）的浮层标记：命中即视为「当前有模态在最高层」 */
const TOP_LAYER_CLASS = 'tab-scope-top'

/**
 * 当前打开着的浮层根节点：取**最后**（DOM 顺序最靠后）那个 —— 后面那个既是最新打开的，
 * 也是叠在最上面的（浮层都是 Teleport 到 body 末尾 + 大 z-index）。
 * 没有浮层 → null。
 */
export function topOverlay(doc: Document): HTMLElement | null {
  // 注意：OVERLAY_ROOT_CLASS 是**裸类名**（别的地方按 classList.contains 用它），
  // 拼选择器时要自己补点号 —— 漏了它这条会静默变成标签名选择器，永远匹配不到。
  const selector = ['.' + OVERLAY_ROOT_CLASS, ...OVERLAY_CLASSES.map((c) => '.' + c)].join(', ')
  const all = doc.querySelectorAll<HTMLElement>(selector)
  if (!all.length) return null
  // 优先用显式标了「我在最高层」的那个
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].classList.contains(TOP_LAYER_CLASS)) return all[i]
  }
  return all[all.length - 1]
}

/**
 * 元素是不是「文本输入面」：这类里面 Tab 有它自己的语义，不劫持。
 * 用 tagName 而不是 instanceof（node 里没有 HTMLElement，纯函数才好测）。
 */
export function isTextEntryElement(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'TEXTAREA') return true
  if (tag === 'INPUT') {
    const type = (el.getAttribute('type') ?? 'text').toLowerCase()
    // 按钮类 input 的 Tab 仍是「移动焦点」，不算文本输入；其余（text/搜索/密码…）照旧放行
    return !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'range', 'color'].includes(type)
  }
  if (el.getAttribute('contenteditable') === 'true') return true
  // ProseMirror（Agent 输入区 / 底栏编辑器）的可编辑根
  if (el.classList.contains('ProseMirror')) return true
  return false
}

/**
 * 在 root 内部按文档顺序取「可 Tab 到」的元素（真实可见、未被禁用、tabindex >= 0）。
 * 与浏览器自己的算法同源：禁用 / tabindex=-1 / 隐藏 的都不算。
 */
function tabbablesIn(root: HTMLElement): HTMLElement[] {
  const sel = 'a[href], button, input, select, textarea, [tabindex]'
  const all = Array.from(root.querySelectorAll<HTMLElement>(sel))
  return all.filter((el) => {
    if ((el as HTMLInputElement).disabled) return false
    const idx = el.getAttribute('tabindex')
    if (idx !== null && Number(idx) < 0) return false
    // 被 display:none / visibility:hidden 的子树排除（offsetParent 在 fixed 元素上可能是 null，故不用它）
    if (!el.isConnected) return false
    return true
  })
}

/**
 * 处理一次 Tab 按下：返回 true = 已接管（调用方要 preventDefault）。
 *
 * @param doc     文档（浏览器里传 document）
 * @param active  当前焦点元素
 * @param shift   是否 Shift+Tab
 */
export function handleTab(doc: Document, active: Element | null, shift: boolean): boolean {
  // 打字中：Tab 有自己的语义（补全 / 缩进），不管
  if (isTextEntryElement(active)) return false
  const overlay = topOverlay(doc)
  if (!overlay) {
    // 页面上没有浮层：不漫游，Tab 什么也不做
    return true
  }
  const items = tabbablesIn(overlay)
  if (!items.length) return true
  const i = active ? items.indexOf(active as HTMLElement) : -1
  const next = shift
    ? items[i <= 0 ? items.length - 1 : i - 1]
    : items[i < 0 || i === items.length - 1 ? 0 : i + 1]
  next?.focus()
  return true
}
