// 文件：packages/docs/public/examples/canvas-data/connection/plugin-conn-demo/src/index.ts
// 格式：TypeScript 模块（插件入口，导出 name / inject / apply）
// 位置：一个可安装插件包的源码入口

import type { Context } from '@mini-canvas/canvas-base'
import type { DocService } from '@mini-canvas/canvas-data'
import { checkEdge, describe } from './connRules'

export const name = 'conn-demo'
// 硬依赖 doc（数据）与 selection（要给选中的节点连线）
export const inject = ['doc', 'selection'] as string[]

export function apply(ctx: Context) {
  const doc = ctx.get<DocService>('doc')

  // ① 一个只接一张图的终点型节点：满了自动挤掉原先那张（capacity: 1 + 缺省 evictOnFull）。
  //    outputs: [] 表示它是终点 —— 别人连不上它的下游。
  ctx.nodes.register({
    type: 'badge',
    label: '徽章',
    size: { w: 200, h: 120 },
    nameTemplate: '徽章 {{ID}}',
    inputs: [{ port: 'target', acceptsTypes: ['image'], capacity: 1 }],
    outputs: [],
    // 数据层不认识组件：这里只声明数据那半边，展示交给渲染层 / 主题
  })

  // ② 一条命令：检查选中前两个节点能不能连，并打印结论
  ctx.commands.register({
    id: 'conn-demo:check',
    title: '连线检查：选中两个看看',
    run: () => {
      const ids = [...ctx.get<{ ids: Set<string> }>('selection').ids]
      if (ids.length < 2) {
        console.log('[conn-demo] 先选中两个节点')
        return false
      }
      const result = checkEdge(doc, { source: ids[0]!, target: ids[1]! })
      console.log('[conn-demo] ' + describe(result))
      if (result.ok && result.canonical) {
        // 通过时拿 canonical（翻正后的端点）去建边，而不是拿原始入参
        const r = doc.connectEdge({ source: result.canonical.source, target: result.canonical.target })
        console.log(
          '[conn-demo] 落边结果：' + r.status +
            (r.evictedEdgeId ? '，挤掉了 ' + r.evictedEdgeId : ''),
        )
      }
      return result.ok
    },
  })

  // ③ 一条命令：把每个选中节点都连到第一个徽章节点上。
  //    逐条连时会自然演示两条真实规则：
  //      · 同一个源连两次 → duplicate（已存在，幂等跳过）
  //      · 第三个不同的源 → ok 且带 evictedEdgeId（capacity: 1 满额挤最老）
  ctx.commands.register({
    id: 'conn-demo:connect-all-to-badge',
    title: '连线：把选中节点都接到徽章上',
    run: () => {
      const badge = doc.getNodes().find((n) => n.type === 'badge')
      if (!badge) {
        console.log('[conn-demo] 先建一个徽章节点')
        return false
      }
      const ids = [...ctx.get<{ ids: Set<string> }>('selection').ids].filter((id) => id !== badge.id)
      // 一次事务：整批连线算一条撤销 —— 想 undo 就整批一起退
      doc.transaction('conn-demo:connect-all', (tx) => {
        for (const id of ids) {
          const r = tx.connectEdge({ source: id, target: badge.id })
          console.log(
            '[conn-demo] ' + id + ' → ' + badge.id + '：' + r.status +
              (r.reason ? '（' + r.reason + '）' : '') +
              (r.evictedEdgeId ? '，挤掉 ' + r.evictedEdgeId : ''),
          )
        }
      })
      return true
    },
  })
}

