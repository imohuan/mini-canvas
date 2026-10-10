// 文件：packages/docs/public/examples/doc/plugin-note-pair/src/index.ts
// 格式：TypeScript 模块（插件的入口，导出 name / inject / apply）
// 位置：一个可安装插件包的源码入口

import { defineComponent, h } from 'vue'
import type { Context } from '@mini-canvas/canvas-base'
import type { DocService } from '@mini-canvas/canvas-data'

export const name = 'note-pair'
// ① 硬依赖：doc 没就绪，本插件停在 PENDING（而不是跑起来后拿到 undefined）
export const inject = ['doc'] as string[]

/** 便签卡片里的内容：只把 data.text 画出来（真实插件会写得更讲究，这里够用） */
const NoteContent = defineComponent({
  name: 'NoteContent',
  props: {
    id: { type: String, required: true },
    data: { type: Object, required: true },
  },
  setup(props) {
    return () =>
      h(
        'div',
        {
          style: {
            padding: '12px',
            fontSize: '14px',
            lineHeight: '1.6',
            whiteSpace: 'pre-wrap',
            overflow: 'hidden',
          },
        },
        String((props.data as { text?: string }).text ?? ''),
      )
  },
})

export function apply(ctx: Context) {
  // ② 注册节点类型：一次把数据（尺寸/类型名）与展示（卡片里用哪个组件）都落表。
  //    这一步由 ctx.nodes.register 代劳，它内部就是 doc.registerType + nodeRegistry.register。
  ctx.nodes.register({
    type: 'note',
    label: '便签',
    size: { w: 200, h: 120 },
    in: NoteContent,
  })

  // ③ 一条命令：在画布上放一对连起来的便签。
  //    建两个节点 + 连一条边必须在**同一个事务**里 —— 否则按一次撤销只退一半。
  ctx.commands.register({
    id: 'note-pair:add',
    title: '加一对便签',
    run: () => {
      const doc = ctx.get<DocService>('doc')
      const [leftId] = doc.transaction('note-pair:add', (tx) => {
        const a = tx.createNode('note', { x: 120, y: 120 }, { text: '上游便签' })
        const b = tx.createNode('note', { x: 420, y: 120 }, { text: '下游便签' })
        // connectEdge 是加边的统一入口：会过守门人（自连/成环/重复/类型/容量）
        tx.connectEdge({ source: a, target: b })
        return [a, b]
      })
      // 建完顺手改一下标题：这是"改名字"的一等入口，不用自己拼 data.label
      doc.setNodeLabel(leftId!, '第一张')
      return true
    },
  })

  // ④ 一条命令：把当前画布情况读出来（读用 getNodes/getEdges，不写任何东西）。
  ctx.commands.register({
    id: 'note-pair:report',
    title: '便签对：报告画布情况',
    run: () => {
      const doc = ctx.get<DocService>('doc')
      const notes = doc.getNodes().filter((n) => n.type === 'note')
      const edges = doc.getEdges()
      const types = [...doc.types.keys()]
      console.log(
        '[note-pair] 便签数：' + notes.length +
          '，边数：' + edges.length +
          '，已注册类型：' + types.join(' / ') +
          '，可撤销：' + String(doc.canUndo()),
      )
      // 想安全地留一份"当时的图"，用 snapshot()（深拷贝）；getNodes() 返回的是同一批对象
      const snap = doc.snapshot()
      console.log('[note-pair] 快照里的节点数：' + snap.nodes.length)
      return true
    },
  })
}

