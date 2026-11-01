/**
 * 本插件组件之间共享的形状。
 *
 * DrawerHost 与宿主抽屉的窄接口同构（见 @mini-canvas/ui 的 composables/drawerTabs.ts）。
 * 插件不 import 宿主 UI 包，只按形状对齐 —— 依赖方向仍是 插件 → 上下文。
 */
export interface DrawerHost {
  readonly activeTab: string
  readonly width: number
  readonly collapsed: boolean
  openTab(id: string): void
  close(): void
  toggleCollapsed(): void
}
