// 文件：packages/docs/public/examples/canvas-render/render-context/src/index.ts
// 格式：TypeScript 模块（插件入口：导出 name / inject / apply）
// 位置：一个可安装插件包的源码入口
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import NoteContent from './NoteContent.vue'

export const name = 'note-demo'
export const inject = ['doc'] as string[]   // ① 建节点要写图，硬依赖 doc

/** 本节点要声明给画布的形状（尺寸、端口、是否可 resize） */
const NOTE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 4h14v12l-4 4H5z"/></svg>'

export function apply(ctx: Context): void {
  ctx.nodes.register({
    type: 'note',                                     // ② 节点类型名（数据里的 type）
    label: '便签',
    icon: NOTE_ICON,
    size: { w: 260, h: 160 },                         // ③ 类型默认尺寸（没实测、没 node.size 时的兜底）
    resizable: true,                                  // ④ 声明支持 resize → 壳显示右下拖柄
    in: NoteContent,                                  // ⑤ 【关键】content 组件：挂到区域词 in
    create(position) {                                // ⑥ 建节点：走 doc.transaction（自动进历史 + 落盘）
      return ctx.get<{ transaction<T>(name: string, fn: (tx: { createNode(t: string, p: { x: number; y: number }, data: Record<string, unknown>): string }) => T): T }>('doc')
        .transaction('add-note', (tx) => tx.createNode('note', position, { text: '双击编辑' }))
    },
  })
  // ⑦ 不用写清理：注册随本插件作用域自动回收（卸载即摘）
}

/** 兼容旧装配的 PluginModule 出口 */
export const noteDemoPlugin: PluginModule = { name, inject, apply }
