/**
 * settingsField.ts —— 设置面板「字段渲染器」下发令牌（provide/inject）。
 *
 * 背景：theme-default 的默认设置面板 PluginSettingsDialog 会把标准 schema 字段控件
 * （SettingsSchemaField：color/number/boolean/select/text + 描述）provide 出来，
 * 这样**别的插件自己注册的 settingsGroup/<key> 内容组件**（自定义预览UI等）不必反向依赖
 * theme-default，就能 `inject` 到该渲染器，直接 `<component :is>` 摆出某个字段的标准控件。
 *
 * 依赖方向：canvas-render 只导类型/令牌/辅助函数（不 hold .vue 组件），
 * theme-default 在运行时 provide 实际组件（字段渲染器），插件侧 import 本模块注入使用。
 */
import { inject, type Component, type InjectionKey } from 'vue'

/** 注入 key：SettingsSchemaField（标准 schema 字段控件）组件本身 */
export const SETTINGS_FIELD_RENDERER: InjectionKey<Component | undefined> = Symbol('settings-field-renderer')

/** 拿到面板 provide 的字段渲染器（未在设置面板子树内则 undefined，调用方自行兜底/不渲染） */
export function injectSettingsFieldRenderer(): Component | undefined {
  return inject(SETTINGS_FIELD_RENDERER, undefined)
}
