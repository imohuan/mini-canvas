// 文件：packages/docs/public/examples/kernel/topo-demo/src/manifest.ts
// 格式：TypeScript 模块（装配清单 + 依赖声明）
// 位置：一个静态插件清单，预检用
import type { PluginModule } from '@mini-canvas/kernel'

/** 一份清单，故意把「依赖方」写在「提供方」前面，看 topoSort 能不能排对 */
export const manifest: Array<Pick<PluginModule, 'name' | 'inject'>> = [
  { name: 'agent', inject: ['tool-registry', 'canvas-base'] },   // 依赖两个
  { name: 'canvas-base', inject: [] },                           // 谁都不依赖
  { name: 'tool-registry', inject: ['canvas-base'] },            // 依赖 canvas-base
  { name: 'theme-default', inject: ['canvas-base'] },
]

/** 宿主已经注入的外部服务名（不是插件；排序时应当忽略它们） */
export const KNOWN_SERVICES = new Set(['tools', 'settings', 'slots', 'nodeLayout', 'viewport'])

