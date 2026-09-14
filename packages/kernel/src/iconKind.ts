/**
 * iconKind —— 图标句柄形态判定（全局唯一判定点）。
 *
 * 归属：@mini-canvas/kernel 通用能力——判定的是"opaque 句柄该怎么渲染"，与画布无关。
 *
 * 节点类型注册时声明的 icon 是**不透明句柄**：可以是 SVG 字符串，也可以是 Vue 组件，
 * 内核不解析、不依赖 Vue（与 content 的 opaque 语义一致）。谁来渲染，谁就在这里问一句
 * "它该怎么渲染"——避免菜单层与节点标题层各写一套 typeof 判断而漂移。
 */

/** 图标渲染方式：html=v-html 字符串 / component=<component :is> / none=不渲染 */
export type IconRenderMode = 'html' | 'component' | 'none'

/**
 * 判定图标句柄该怎么渲染。
 * - null / undefined / false / ''（未声明或空）→ 'none'
 * - 非空字符串 → 'html'（调用方 v-html）
 * - 其它（Vue 组件、自定义对象等）→ 'component'（调用方 <component :is>）
 */
export function iconRenderMode(icon: unknown): IconRenderMode {
  if (icon === null || icon === undefined || icon === false) return 'none'
  if (typeof icon === 'string') return icon === '' ? 'none' : 'html'
  return 'component'
}
