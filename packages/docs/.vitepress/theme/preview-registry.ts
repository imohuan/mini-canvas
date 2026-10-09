import type { Component } from 'vue'
import DemoCounter from './demos/DemoCounter.vue'

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
