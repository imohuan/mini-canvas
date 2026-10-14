import type { Component } from 'vue'
import DemoCounter from './demos/DemoCounter.vue'
import ThemeKitProbe from './demos/ThemeKitProbe.vue'
import ThemeKitDemo from './demos/ThemeKitDemo.vue'
import MiniCanvasStage from './demos/MiniCanvasStage.vue'

/**
 * 组件预览注册表：把「名字」映射到「可跑的组件」。
 *
 * 为什么需要它：文档页里写 <ComponentPreview name="X"/> 时，得有人告诉站点 X 是哪个组件。
 * 插件页想做到「点一下就看到这个插件注册的界面」，也在这里登记一条即可。
 *
 * 注意：能内联预览的组件必须**能独立渲染**（不依赖画布宿主 ctx）。
 * 依赖完整宿主才能跑的界面，请改用 <ComponentPreviewFrame src="..."/>。
 *
 * 登记方式：
 *   import MyPanel from '@mini-canvas/plugin-xxx/src/components/MyPanel.vue'
 *   'MyPanel': { component: MyPanel, title: '我的面板', description: '...' }
 */
export interface PreviewEntry {
  component: Component
  title?: string
  description?: string
  /** 想在「显示代码」里展示的源码片段（可选） */
  code?: string
}

export const previewRegistry: Record<string, PreviewEntry> = {
  // 组件文档页的活演示台（按件展示；MD 里 <ThemeKitDemo name="button" /> 直接传组件用）
  ThemeKitDemo: {
    component: ThemeKitDemo,
    title: '组件演示台',
  },
  // 真画布：节点壳 / 连线 / 背景 / 浮动端口的活演示
  MiniCanvasStage: {
    component: MiniCanvasStage,
    title: '真画布（默认主题在跑）',
  },
  // 渲染实验：默认主题的纯 UI 件（验证文档站能否直接跑主题包组件）
  ThemeKitProbe: {
    component: ThemeKitProbe,
    title: '渲染实验：默认主题纯 UI 件',
    description: '这些是真的在跑的组件（按钮 / 气泡 / 下拉 / 滑块 / 取色器）。',
  },
  // 示例条目：证明「按名字取组件」这条路是通的。
  DemoCounter: {
    component: DemoCounter,
    title: '示例：计数器',
    description: '文档里真的在跑一个 Vue 组件（点一下按钮试试）。',
    code: '<DemoCounter />',
  },
}

export function resolvePreview(name: string): PreviewEntry | undefined {
  return previewRegistry[name]
}
