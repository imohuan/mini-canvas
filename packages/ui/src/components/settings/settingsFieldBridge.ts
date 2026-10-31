/**
 * 设置字段下发的桥组件。
 *
 * 背景：设置面板把「标准字段控件」通过 provide 下发给插件自绘的 settingsGroup 页。
 * provide 的值不会自动解包 —— 直接塞 ComputedRef 时，下游 `<component :is>` 拿到的是
 * 一个 ref 对象，页面不报错但什么都不画。
 *
 * 桥组件是**稳定对象**：provide 它一次即可，内部每次渲染现读目录赢家。
 * 这样换主题/热替换字段控件时，已经挂载的插件自绘页也会跟着换。
 */
import { defineComponent, h, type Component, type PropType } from 'vue'
import type { SettingsPanelSource } from '@mini-canvas/canvas-render'

export interface SettingsFieldBridgeProps {
  group: string
  fieldKey: string
  settings: SettingsPanelSource
}

/** resolve 应当是响应式的（读 ref/computed 即可），桥的渲染函数会自动收集依赖。 */
export function createSettingsFieldBridge(
  resolve: () => Component | undefined,
  fallback: Component,
): Component {
  return defineComponent({
    name: 'MiniCanvasSettingsFieldBridge',
    props: {
      group: { type: String, required: true },
      fieldKey: { type: String, required: true },
      settings: { type: Object as PropType<SettingsPanelSource>, required: true },
    },
    setup(props) {
      return () => h(resolve() ?? fallback, {
        group: props.group,
        fieldKey: props.fieldKey,
        settings: props.settings,
      })
    },
  })
}
