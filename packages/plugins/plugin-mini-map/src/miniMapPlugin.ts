/**
 * plugin-mini-map —— 小地图插件（独立包，v2 API）。
 *
 * 复刻老版 canvas-core/src/plugins/mini-map：
 * - 右下角小地图（overlay 槽 occupant，宿主 CanvasSurface 已渲染该槽）；
 *   缩略节点 + 视口矩形 + 拖拽平移 / 点击跳转（组件 MiniMapOverlay.vue，纯 UI 与手势）。
 * - Ctrl/Cmd+M 切换显隐：老版 context.registerShortcut('ctrl+m') → v2 走命令 keys（mod+m），
 *   渲染层 CanvasHost 统一分发键盘，插件不自己绑 window。
 * - 显隐状态 = 本插件注入的 mini-map 服务（{ visible } 响应式）：命令切换与组件读取同一对象。
 *
 * 依赖方向：只依赖内核服务（nodeStore/nodeLayout/viewport 宿主恒在注入）+ canvas-render 只读上下文；
 * 不反向依赖宿主 demo / 其它插件。数据/几何纯逻辑在 miniMapEngine.ts（零 Vue 可单测）。
 */
import { reactive } from 'vue'
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import MiniMapOverlay from './MiniMapOverlay.vue'
import { Config, miniMapConfigFrom } from './miniMapConfig'

export const name = 'mini-map'
export const inject = ['nodeStore', 'nodeLayout', 'viewport'] as string[]

/** mini-map 服务状态（命令与浮层共享同一响应式对象；热卸随服务注入自动回收） */
export interface MiniMapServiceState {
  /** 小地图是否可见（Ctrl/Cmd+M 切换；默认显示） */
  visible: boolean
}

/** mini-map 可配置项（v2 Config schema；默认值/分组对齐老版 panel 设置，登记 ⚙ 设置面板） */
export { Config }
export type { MiniMapConfig } from './miniMapConfig'

export function apply(ctx: Context) {
  // 1. 上架 mini-map 服务（响应式显隐状态；命令与 MiniMapOverlay 共享）
  const initial = miniMapConfigFrom(ctx)
  const state: MiniMapServiceState = reactive({ visible: initial.miniMapVisible })
  ctx.inject('mini-map', state)

  // 1b. settings 面板「显示小地图」开关 ↔ 服务状态双向同步（老版 store.toRef 语义：
  //     面板改 → 浮层即时变；命令 Ctrl/Cmd+M 改 → 面板开关跟着变）。
  const settings = ctx.get<{ get(key: string): string | number | boolean | undefined; set(key: string, v: string | number | boolean): boolean; onChange(cb: (key: string, v: unknown) => void): { dispose(): void } }>('settings')
  if (settings) {
    const off = settings.onChange((key, v) => {
      if (key === 'miniMapVisible' && typeof v === 'boolean') state.visible = v
    })
    ctx.effect(() => () => off.dispose())
  }
  // 命令切换时把显隐写回 settings，保证面板开关状态一致（热卸后重装由 config 持久化恢复）
  const syncVisibleToSettings = (v: boolean): void => {
    if (settings && settings.get('miniMapVisible') !== v) settings.set('miniMapVisible', v)
  }

  // 2. 注册小地图浮层到 overlay 槽（宿主已渲染该槽；热卸随插件 scope 自动移除）
  ctx.slots.register('overlay', {
    id: 'mini-map',
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
      state.visible = !state.visible
      syncVisibleToSettings(state.visible)
    },
  })
}

/** 兼容旧装配的 PluginModule 出口（Config 随模块声明，内核装配时校验 + 登记设置面板） */
export const miniMapPlugin: PluginModule = { name, inject, Config, apply }
