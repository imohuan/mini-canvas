/**
 * plugin-demo-kit 的 Config 与设置页身份。
 *
 * 为什么要有占位字段：设置面板的一级导航由 settings 的真实分组推导；
 * 只注册 settings.nav 而没有任何 Config 字段时，右侧正文容器不成立。
 * 这里声明一个只用于形成分组的配置项，正文仍由 settingsGroup 的整页组件接管。
 *
 * key 使用 demoKit 前缀：settings 的键名是全应用平面命名，跨插件不能重名。
 */
import type { ConfigSchema } from '@mini-canvas/canvas-base'

/** 设置面板里的一级导航名（= Config 的扁平分组名，也是 settingsGroup/<此名> 的槽键） */
export const THEME_LAB_NAV_ID = '主题工作台'

export const Config: ConfigSchema = {
  demoKitThemeLabNote: {
    type: 'string',
    default: '',
    label: '主题工作台',
    group: THEME_LAB_NAV_ID,
    description: '这个分组提供一个颜色预览与调色入口；颜色项来自各插件已声明的主题配色。',
  },
}
