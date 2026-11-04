/**
 * uiCatalog —— 按名取设计系统组件（设计文档 §4.5 / 案例 4 / 决策 4）。
 *
 * 要解决的问题：业务插件想用"按钮/下拉/滑块"时，此前只能 import 具体组件 ——
 * 换一套主题（比如另一份默认皮）就得改所有业务插件的 import。
 * 目录化之后：主题把组件登记进 `registryOf('ui')`，业务插件按名取，**换主题零改动**。
 *
 * 边界：组件库只有默认主题插件可以 import；其它插件与外壳都从这里按名取件，
 * 内部私有小组件留在各自插件里。
 */
import type { Context } from '@mini-canvas/kernel'
import { onScopeDispose, shallowRef, type Ref } from 'vue'
import { useCanvasContextOrRender } from '../context'

/** ui 场的条目值：opaque 组件句柄（内核不解析、不 import Vue） */
export type UiComponentHandle = unknown;

/** 目录里常用的名字（**约定俗成，不是封闭枚举**——主题可登记自定名字） */
/**
 * 目录里常用的名字（**约定俗成，不是封闭枚举**——主题可登记自定名字）。
 *
 * movingHandle / connectionLine：节点端口与拖线临时线的"外观件"。业务插件（如多选）
 * 也要画同款端口与临时线，但它们不该依赖某个具体主题包 —— 从目录按名取即可（T06）。
 *
 * 通用按钮 / 下拉 / 选择器 / 气泡按**组件库导出名**登记（Button / DropdownMenu / Select /
 * Tooltip 及各自的子件）；插件统一 useUiComponent() 取件，主题不再维护第二套实现。
 */
export const UI_NAMES = [
  'nodeEmptyState',
  'slotDebugPopover',
  'mediaViewer',
  'slider',
  'toolParamField',
  'toolParamGroup',
  'toolParamGrid',
  'toolParamRatio',
  'toolParamSlider',
  'color',
  'movingHandle',
  'connectionLine',
  'nodeModeTopBar',
  'nodeModeBottomBar',
  'settingsField',
  'slotDebugOverlay',
  'settingsRow',
  'settingsSection',
] as const;

/**
 * 下拉选项的最小形状（**主题无关**）：业务插件描述选项时不必 import 任何主题包。
 * 真正的选择器由 ui 目录里的 Select 件渲染；这里只保留“值 + 显示名 + 禁用态”
 * 这一层与实现无关的数据形状。
 */
export interface UiSelectOption {
  label: string
  value: string | number
  disabled?: boolean
}

/** 无参取整组时，每个名字对应一个组件 Ref（模板里自动解包）。 */
export type UiComponentRefs = Record<string, Ref<UiComponentHandle | undefined>>

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
 * const Slider = useUiComponent('slider')   // 模板里 <Slider /> 即可（ref 自动解包）
 * ```
 * 子组件多时按导出名一次取一组（解构后模板直接写 `<DropdownMenu>`）：
 * ```ts
 * const { DropdownMenu, DropdownMenuContent, DropdownMenuItem } = useUiComponent()
 * ```
 * 不传名字时返回整个目录：每个值都是稳定的 `shallowRef`，主题热替换时原地更新，
 * 模板里自动解包。
 * 必须在 CanvasProvider 内调用（走 useCanvasContext 拿 ctx）；树外抛清晰错误。
 *
 * **返回 Ref**（返回的是"当前这个名字对应的组件"，而不是一次性快照）：目录被换主题时它当场变，
 * 消费组件不必重挂就跟着换 —— 与 themeRegistry.subscribe 驱动重装配同一套语义。
 * 订阅随本组件作用域自动解除。
 *
 * 名字不存在时 value 为 undefined + console.warn（不静默、也不炸 —— 与决策 9 的缺项策略同调）。
 */
export function useUiComponent(): UiComponentRefs
export function useUiComponent(name: string): Ref<UiComponentHandle | undefined>
export function useUiComponent(name?: string): UiComponentRefs | Ref<UiComponentHandle | undefined> {
  if (name === undefined) return useUiComponentRefs()
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

/**
 * 取整个 ui 目录的响应式组件组：`const { Button, Dialog } = useUiComponent()`。
 *
 * 每个键对应一个稳定的 `shallowRef`：目录里的实现被替换时，ref 原地更新，
 * 解构后模板里的 `<Button />` 仍会跟着主题一起换。未登记的名字不出现在对象里。
 * 只适用于 CanvasProvider 内；树外请用宿主单例那边的 `useUiComponentOutside()`。
 */
export function useUiComponentRefs(): UiComponentRefs {
  const { ctx } = useCanvasContextOrRender();
  return uiComponentRefs(ctx);
}


/** 纯取件版本：给测试与非组件上下文复用，订阅随当前 effectScope 回收。 */
export function uiComponentRefs(ctx: Context | undefined): UiComponentRefs {
  if (!ctx) return {};
  const field = ctx.registryOf<UiComponentHandle>('ui');
  const refs: UiComponentRefs = {};
  for (const key of field.keys()) refs[key] = shallowRef<UiComponentHandle | undefined>(field.top(key)?.value);
  const sync = (): void => {
    for (const [key, ref] of Object.entries(refs)) ref.value = field.top(key)?.value;
  };
  const sub = field.subscribe(sync);
  onScopeDispose(() => sub.dispose());
  return refs;
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
 * 为什么住这里而不住 packages/ui：MediaViewer（plugin-theme-components）要在树外取注册件，
 * 而主题包**不能反向依赖** ui 包（依赖方向 kernel ← canvas-data ← canvas-render ← plugins ← ui）；
 * readyHost 的写入点在 ui 侧，但读取只需要一个“能拿到 ctx”的弱引用 —— 这里提供函数，
 * ui 侧在 @ready 时把 ctx 塞进来（见下方 setUiCatalogHost）。
 */
let hostCtxForCatalog: Context | undefined
export function setUiCatalogHost(ctx: Context | undefined): void {
  hostCtxForCatalog = ctx
}

/**
 * Provider 外的静态目录：由默认主题在**模块加载时**发布一份导出名 → 组件。
 *
 * 项目列表页 / 根组件在 CanvasProvider 之外，首次打开时还没有 host ctx；
 * 如果只能等 @ready，左下按钮会整块消失（真机实测）。主题包仍是唯一 import
 * 组件库的地方，这里只接收它发布过来的句柄。
 */
let staticUiCatalog: Record<string, UiComponentHandle> | undefined
export function setStaticUiCatalog(catalog: Record<string, UiComponentHandle> | undefined): void {
  staticUiCatalog = catalog
}

/** Provider 外按名取件：先宿主目录，再回退到默认主题发布的静态目录。 */
export function uiComponentStatic(name: string): UiComponentHandle | undefined {
  return staticUiCatalog?.[name]
}

/** 目录（宿主 or 静态）里当前登记了哪些名字（诊断/文档用） */
export function uiStaticNames(): string[] {
  return staticUiCatalog ? Object.keys(staticUiCatalog) : []
}

export function uiComponentOutside(name: string): UiComponentHandle | undefined {
  return (
    hostCtxForCatalog?.registryOf<UiComponentHandle>('ui').top(name)?.value ??
    uiComponentStatic(name)
  )
}
