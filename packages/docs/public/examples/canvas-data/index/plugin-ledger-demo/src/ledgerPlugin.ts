// 文件：packages/docs/public/examples/canvas-data/index/plugin-ledger-demo/src/ledgerPlugin.ts
// 格式：TypeScript 模块（插件入口，导出 name / inject / apply）
// 位置：一个可安装插件包的源码入口；这里故意**不注册任何组件**（数据层不认识屏幕）

import type { Context } from '@mini-canvas/canvas-base'
import type { DocService } from '@mini-canvas/canvas-data'

export const name = 'ledger-demo'
// ① 硬依赖：doc 没就绪，本插件停在 PENDING（而不是跑起来后拿到 undefined）
export const inject = ['doc'] as string[]

export function apply(ctx: Context) {
  const doc = ctx.get<DocService>('doc')

  // ② 注册一个节点类型。in 区域放哪个组件是渲染层的事 ——
  //    纯数据场景只落“数据那一半”：类型名 / 标题 / 默认尺寸 / 连接约束。
  doc.registerType({
    type: 'ledger-entry',
    label: '账目',
    defaultSize: { w: 200, h: 100 },
    nameTemplate: '账目 {{ID}}',
    // 不声明 capacity = 不限条数；这里只收文本类型的上游
    inputs: [{ port: 'target', acceptsTypes: ['text'] }],
    outputs: [{ port: 'source', contentType: 'text' }],
  })

  // ③ 一条命令：记一笔账。写操作包在事务里 —— 一次撤销退掉整批。
  ctx.commands.register({
    id: 'ledger-demo:add-entry',
    title: '记一笔账',
    run: () => {
      doc.transaction('ledger:add-entry', (tx) => {
        const id = tx.createNode('ledger-entry', { x: 0, y: 0 }, { text: '', amount: 0 })
        return id
      })
      return true
    },
  })

  // ④ 一条命令：把账本念出来（读操作不需要事务，也不改任何东西）
  ctx.commands.register({
    id: 'ledger-demo:report',
    title: '账本：念一遍',
    run: () => {
      const rows = doc.getNodes().filter((n) => n.type === 'ledger-entry')
      const edges = doc.getEdges()
      console.log(
        '[ledger-demo] 账目 ' + rows.length + ' 笔，连线 ' + edges.length +
          ' 条，可撤销：' + String(doc.canUndo()) + '，撤销栈深度：' + String(doc.undoDepth),
      )
      return true
    },
  })
}
