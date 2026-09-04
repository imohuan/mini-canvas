/**
 * themeRegistry —— 画布"外观/UI"注册表（纯逻辑，零 Vue 依赖，Node 可单测）。
 *
 * 定位：宿主把画布的"看得见的部分"抽成可被插件替换的槽位，插件(主题插件)经 registerThemeSlot
 * 把自写 vue 组件填进来顶替默认实现。本表只存 opaque 组件句柄，不 import Vue。
 *
 * 与 nodeRegistry 分工：
 * - nodeRegistry：某"业务 type"的内容(content/title/toolbar) —— 业务/节点插件填。
 * - themeRegistry：整幅画布通用的渲染器 —— 主题插件填（节点外壳、连线、背景）。
 *
 * 槽位(默认由宿主 demo/主题插件提供)：
 * - nodeShell     节点总壳（含端口/title/toolbar 分发；不填用宿主默认壳）
 * - edge          连线渲染器（edgeTypes 里的那个组件）
 * - edgeDefaultType 所有边默认走的 type 键（缺省 'custom'）
 * - background    画布背景（铺满底层）
 * - connectionLine 拖拽预览线（可选）
 * 组件句柄 opaque；缺省 undefined = 用宿主默认。
 */
export type ThemeSlot =
  | 'nodeShell'
  | 'edge'
  | 'edgeDefaultType'
  | 'background'
  | 'connectionLine'

/** 主题定义：slot → 组件句柄(或字面值如 edgeDefaultType 是 string) */
export type ThemePresentation = Partial<Record<ThemeSlot, unknown>>

/**
 * 主题/外观注册表。宿主(demo)与测试都读它决定渲染用哪套组件。
 * 插件注册、宿主消费；热卸插件时 unregister 即回退默认。
 */
export class ThemeRegistry {
  private bySlot = new Map<ThemeSlot, unknown>()

  /** 注册某槽位的组件。重复注册抛错（防覆盖，语义同 nodeStore.registerType）。 */
  register(slot: ThemeSlot, value: unknown): void {
    if (this.bySlot.has(slot)) {
      throw new Error(`[themeRegistry] theme slot "${slot}" already registered`)
    }
    this.bySlot.set(slot, value)
  }

  /** 取某槽位值；未注册返回 undefined（宿主回退默认） */
  get(slot: ThemeSlot): unknown {
    return this.bySlot.get(slot)
  }

  /** 注销某槽位；不存在 no-op。热卸主题插件时调用以回退默认。 */
  unregister(slot: ThemeSlot): void {
    this.bySlot.delete(slot)
  }

  /** 覆盖式重设（宿主/主题升级）；未注册则新建 */
  set(slot: ThemeSlot, value: unknown): void {
    this.bySlot.set(slot, value)
  }

  /** 是否已注册某槽位 */
  has(slot: ThemeSlot): boolean {
    return this.bySlot.has(slot)
  }

  /** 已注册的槽位名 */
  slots(): ThemeSlot[] {
    return [...this.bySlot.keys()]
  }
}
