// 文件：packages/docs/public/examples/canvas-render/create-host/src/host.ts
// 格式：TypeScript 模块（Node，无需浏览器 / 无需 Vue）
// 位置：整个示例唯一建宿主的地方
import { createPlumeHost } from '@plume-canvas/canvas-render'
import { MemoryStorageAdapter, type CanvasNode } from '@plume-canvas/canvas-data'
import { themeComponentsPlugin } from '@plume-canvas/plugin-theme-components'
import { themeCanvasPlugin } from '@plume-canvas/plugin-theme-canvas'
import { nodeTextPlugin } from '@plume-canvas/plugin-node-text'

// ① 首次打开时的那张默认画布
function seed(): CanvasNode[] {
  return [{ id: 'welcome', type: 'text', position: { x: 120, y: 120 }, data: { text: '双击编辑' } }]
}

export async function boot() {
  return createPlumeHost({
    adapter: new MemoryStorageAdapter(),                 // ② 换 LocalStorageAdapter 就能跨刷新持久化
    coldPlugins: [themeComponentsPlugin, themeCanvasPlugin, nodeTextPlugin], // ③ 通用件 + 画布皮在前
    seedDefault: seed,                                   // ④ 只在「从未保存过」时跑
    dev: true,                                           // ⑤ 能力缺项当场抛错，方便发现漏声明
  })
}
