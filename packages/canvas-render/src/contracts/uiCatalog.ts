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
import { onScopeDispose, shallowRef, type Ref } from 'vue'
import { useCanvasContextOrRender } from './canvasContext'

/** ui 场的条目值：opaque 组件句柄（内核不解析、不 import Vue） */
export type UiComponentHandle = unknown;

/** 目录里常用的名字（**约定俗成，不是封闭枚举**——主题可登记自定名字） */
/**
 * 目录里常用的名字（**约定俗成，不是封闭枚举**——主题可登记自定名字）。
 *
 * toolbarButton：工具栏里那条按钮（纯图标 / 图标 + 文字），与 toolbarDropdown 成对。
 * 旧名 'button' 仍由默认主题登记为别名，但新代码一律用 toolbarButton ——
 * 「button」在别处会被读成通用表单按钮，两者不是一回事。
 *
 * movingHandle / connectionLine：节点端口与拖线临时线的"外观件"。业务插件（如多选）
 * 也要画同款端口与临时线，但它们不该依赖某个具体主题包 —— 从目录按名取即可（T06）。
 */
export const UI_NAMES = [
  'toolbarButton',
  'dropdown',
  'tooltip',
  'select',
  'slider',
  'toolParamField',
  'color',
  'movingHandle',
  'connectionLine',
] as const;

/**
 * 下拉选项的最小形状（**主题无关**）：与 theme-default 的 SelectOption 同构，
 * 但住在这里 —— 业务插件描述选项时不必 import 任何主题包。
 * 主题自己的 Select 组件按结构兼容消费（props 类型由主题侧声明）。
 */
export interface UiSelectOption {
  label: string
  value: string | number
  disabled?: boolean
}

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
 * const Button = useUiComponent('toolbarButton')   // 模板里 <Button /> 即可（ref 自动解包）
 * ```
 * 必须在 CanvasProvider 内调用（走 useCanvasContext 拿 ctx）；树外抛清晰错误。
 *
 * **返回 Ref**（返回的是"当前这个名字对应的组件"，而不是一次性快照）：目录被换主题时它当场变，
 * 消费组件不必重挂就跟着换 —— 与 themeRegistry.subscribe 驱动重装配同一套语义。
 * 订阅随本组件作用域自动解除。
 *
 * 名字不存在时 value 为 undefined + console.warn（不静默、也不炸 —— 与决策 9 的缺项策略同调）。
 */
export function useUiComponent(name: string): Ref<UiComponentHandle | undefined> {
  // 设计系统件的读取是“有 ctx 就行”：优先基础上下文（Provider），
  // 老的单测/极简宿主只 provide 渲染上下文时回退到它 —— 这是读入口的兼容，
  // 不影响 useCanvasContext 本身“只认 Provider”的约束。
  const { ctx } = useCanvasContextOrRender();
  const field = ctx.registryOf<UiComponentHandle>('ui');
  const found = shallowRef<UiComponentHandle | undefined>(field.top(name)?.value);
  /** 缺名提示只给一次（同一文案别写两遍）：首次就缺时立刻给，之后只在"变过再变缺"时给 */
  const warnMissing = (): void => {
    if (typeof console === 'undefined') return;
    console.warn(`[ui] 目录里没有名为 "${name}" 的组件（主题插件没登记它？）。详见设计文档 §4.5。`);
  };
  const sync = (): void => {
    const next = field.top(name)?.value;
    if (next === found.value) return;
    found.value = next;
    if (next === undefined) warnMissing();
  };
  // 首次就缺：立刻提示一次（此时值没"变"，sync 里的分支不会触发）
  if (found.value === undefined) warnMissing();
  const sub = field.subscribe(sync);
  onScopeDispose(() => sub.dispose());
  return found;
}

/** 当前目录里登记了哪些名字（诊断/文档用） */
export function uiNames(ctx: Context | undefined): string[] {
  if (!ctx) return [];
  return ctx.registryOf<UiComponentHandle>('ui').keys();
}

/**
 * 树外按名取件：给「不在画布渲染子树里」的消费方用（生成历史弹窗 / 资产抽屉 / Teleport 到 body 的全屏预览）。
 *
 * 与 useUiComponent 的分工：useUiComponent 走 provide/inject（树内、且是响应式 Ref）；
 * 本函数走**宿主单例**（ui.ts 的 readyHost 在 @ready 时把 ctx 存进来）—— 树里树外都能取，
 * 但它是**一次性取值**（非响应式）。全屏预览这类“打开时取一次就渲染”的场景用它正合适。
 *
 * 为什么住这里而不住 packages/ui：MediaViewer（plugin-theme-default）要在树外取注册件，
 * 而主题包**不能反向依赖** ui 包（依赖方向 kernel ← canvas-data ← canvas-render ← plugins ← ui）；
 * readyHost 的写入点在 ui 侧，但读取只需要一个“能拿到 ctx”的弱引用 —— 这里提供函数，
 * ui 侧在 @ready 时把 ctx 塞进来（见下方 setUiCatalogHost）。
 */
let hostCtxForCatalog: Context | undefined
export function setUiCatalogHost(ctx: Context | undefined): void {
  hostCtxForCatalog = ctx
}

export function uiComponentOutside(name: string): UiComponentHandle | undefined {
  return hostCtxForCatalog?.registryOf<UiComponentHandle>('ui').top(name)?.value
}
