/**
 * uiCatalog —— 按名取设计系统组件（设计文档 §4.5 / 案例 4 / 决策 4）。
 *
 * 要解决的问题：业务插件想用"按钮/下拉/滑块"时，此前只能 import 具体组件 ——
 * 换一套主题（比如另一份默认皮）就得改所有业务插件的 import。
 * 目录化之后：主题把组件登记进 `registryOf('ui')`，业务插件按名取，**换主题零改动**。
 *
 * 边界（决策 4）：**只给"希望被主题整体换掉"的设计系统件用**；
 * 插件内部自用的小组件照旧 import（全面目录化 = 字符串驱动，打错字运行时才炸、丢类型提示）。
 */
import type { Context } from '@mini-canvas/canvas-data'
import { useCanvasRender } from './renderContext'

/** ui 场的条目值：opaque 组件句柄（内核不解析、不 import Vue） */
export type UiComponentHandle = unknown;

/** 目录里常用的名字（**约定俗成，不是封闭枚举**——主题可登记自定名字） */
export const UI_NAMES = ['button', 'dropdown', 'select', 'slider', 'toolParamField'] as const;
export type UiName = (typeof UI_NAMES)[number];

/**
 * 从内核 ctx 按名取一个设计系统组件。
 * 找不到时返回 undefined（调用方自行降级），并可按 `warn` 决定是否提示。
 * 无 ctx（组件树外调用）返回 undefined。
 */
export function uiComponent(ctx: Context | undefined, name: string): UiComponentHandle | undefined {
  if (!ctx) return undefined;
  return ctx.registryOf<UiComponentHandle>('ui').top(name)?.value;
}

/**
 * 组件里按名取设计系统组件的便捷入口（首选写法）：
 * ```ts
 * const Button = useUiComponent('button')
 * ```
 * 必须在画布渲染子树内调用（走 useCanvasRender 拿 ctx）；树外抛清晰错误。
 * 名字不存在时返回 undefined + console.warn（不静默、也不炸 —— 与决策 9 的缺项策略同调）。
 */
export function useUiComponent(name: string): UiComponentHandle | undefined {
  const { ctx } = useCanvasRender();
  const found = uiComponent(ctx, name);
  if (found === undefined && typeof console !== 'undefined') {
    console.warn(`[ui] 目录里没有名为 "${name}" 的组件（主题插件没登记它？）。详见设计文档 §4.5。`);
  }
  return found;
}

/** 当前目录里登记了哪些名字（诊断/文档用） */
export function uiNames(ctx: Context | undefined): string[] {
  if (!ctx) return [];
  return ctx.registryOf<UiComponentHandle>('ui').keys();
}
