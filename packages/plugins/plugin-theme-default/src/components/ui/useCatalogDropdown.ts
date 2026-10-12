/**
 * useCatalogDropdown —— 取「注册场里登记的那一份下拉实现」，取不到回落到本包自带的那一份。
 *
 * 为什么要有它（用户口径 2026-10-12）：「你底部下拉菜单可以使用我插件系统注册的那个组件啊
 * ……你直接使用他作为下拉菜单的组件」。此前本包的下拉（Select / ToolParamGroup）直接
 * import 自家的 Dropdown.vue —— 于是成品应用在注册场里顶替了 dropdown（ui 包的 AxDropdown），
 * 底栏那两处却仍跑着主题包这份私有实现，注册等于没生效。
 *
 * 三条口径：
 * 1. 树内：走 useUiComponent('dropdown')（响应式 Ref）—— 热替换时当场跟着换，不必重挂；
 * 2. 树外（SSR 单测 / 独立渲染）：useUiComponent 会抛（没有 provide），改用全局注册表的一次性
 *    入口 uiComponentOutside，取到就一样用；
 * 3. 注册场里没有 dropdown（只装主题包、没装注册件）→ 回落本包自带的 Dropdown.vue，
 *    与改造前逐像素一致（单测与独立渲染都走这条）。
 *
 * 返回值是 computed（不是一次性快照）：注册件被热替换时，消费组件不必重挂就跟着换 ——
 * 与 useUiComponent 的语义一致。
 */
import { computed, ref, type Component, type Ref } from 'vue'
import { useUiComponent, uiComponentOutside } from '@mini-canvas/canvas-render'
import ThemeDropdown from './Dropdown.vue'

export function useCatalogDropdown(): Ref<Component> {
  let live: Ref<unknown>
  try {
    live = useUiComponent('dropdown')
  } catch {
    // 树外：注册表本身是全局单例，用一次性入口照常取得到（取不到就是 undefined → 回落）
    live = ref(uiComponentOutside('dropdown'))
  }
  return computed<Component>(() => (live.value as Component | undefined) ?? (ThemeDropdown as Component))
}

