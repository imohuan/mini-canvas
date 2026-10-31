/**
 * plugin-mini-map —— 小地图插件（独立包，v2 API）。
 *
 * 复刻老版 canvas-core/src/plugins/mini-map：
 * - 小地图（mini-map 专用槽 occupant，宿主经 <SlotHost slot="mini-map"/> 自选位置渲染）；
 *   缩略节点 + 视口矩形 + 拖拽平移 / 点击跳转（组件 MiniMapOverlay.vue，纯 UI 与手势）。
 * - Ctrl/Cmd+M 切换显隐：老版 context.registerShortcut('ctrl+m') → v2 走命令 keys（mod+m），
 *   渲染层 CanvasHost 统一分发键盘，插件不自己绑 window。
 * - 显隐状态 = 设置项 miniMapVisible（SettingsStore 单一数据源）：命令切换、面板开关与
 *   浮层读取同一个值 —— 不再占一个 mini-map 服务名。
 *
 * 依赖方向：只依赖内核服务（doc/view 宿主恒在注入）+ canvas-render 只读上下文；
 * 不反向依赖宿主 demo / 其它插件。数据/几何纯逻辑在 miniMapEngine.ts（零 Vue 可单测）。
 */
import { computed } from 'vue'
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import MiniMapOverlay from './MiniMapOverlay.vue'
import { Config, miniMapConfigFrom } from './miniMapConfig'

export const name = 'mini-map'
export const inject = ['doc', 'view'] as string[]

/** 小地图显隐状态（模块级：命令与浮层共享同一份；不占服务名） */
const visibility = { visible: true }

/** 供同包组件读取的响应式显隐（不入 ctx 服务表） */
export function useMiniMapVisible(): { readonly value: boolean } {
  return computed(() => visibility.visible)
}

/** mini-map 可配置项（v2 Config schema；默认值/分组对齐老版 panel 设置，登记 ⚙ 设置面板） */
export { Config }
export type { MiniMapConfig } from './miniMapConfig'

export function apply(ctx: Context) {
  // 1. 显隐的唯一事实来源 = 设置项 miniMapVisible（可持久化、面板可改）。
  const initial = miniMapConfigFrom(ctx)
  visibility.visible = initial.miniMapVisible

  // 1b. settings 面板「显示小地图」开关 ↔ 服务状态双向同步（老版 store.toRef 语义：
  //     面板改 → 浮层即时变；命令 Ctrl/Cmd+M 改 → 面板开关跟着变）。
  const settings = ctx.tryGet('settings')
  if (settings) {
    const off = settings.onChange((key, v) => {
        if (key === 'miniMapVisible' && typeof v === 'boolean') visibility.visible = v
    })
    ctx.effect(() => () => off.dispose())
  }
  // 命令切换时把显隐写回 settings，保证面板开关状态一致（热卸后重装由 config 持久化恢复）
  const syncVisibleToSettings = (v: boolean): void => {
    if (settings && settings.get('miniMapVisible') !== v) settings.set('miniMapVisible', v)
  }

  // 2. 注册小地图到专用槽（不再占 overlay 槽：位置由宿主决定 —— 宿主 <SlotHost slot="mini-map"/>
  //    放哪儿它就显示在哪儿；没渲染该槽的宿主不显示小地图。热卸随插件 scope 自动移除）
  ctx.slots.register('mini-map', {
    id: 'mini-map/host',
    order: 80,
    component: MiniMapOverlay,
    meta: { title: '小地图' },
  })

  // 3. 显隐切换命令（keys 由渲染层统一分发；热卸随 scope 自动回收）
  ctx.commands.register({
    id: 'mini-map:toggle',
    title: '切换小地图',
    keys: ['mod+m'],
    order: 80,
    icon: 'minimap',
    run: () => {
      visibility.visible = !visibility.visible
      syncVisibleToSettings(visibility.visible)
    },
  })
}

/** 兼容旧装配的 PluginModule 出口（Config 随模块声明，内核装配时校验 + 登记设置面板） */
export const miniMapPlugin: PluginModule = { name, inject, Config, apply }
