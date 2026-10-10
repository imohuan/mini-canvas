// 文件：packages/docs/public/examples/node-registry/plugin-counter-badge/src/index.ts
// 格式：TypeScript 模块（插件的入口，导出 name / inject / apply）
// 位置：一个可安装插件包的源码入口

import type { Context } from '@mini-canvas/canvas-base'
import type { NodeRegistry } from '@mini-canvas/canvas-data'
import CounterContent from './CounterContent.vue'
import BadgeLabel from './BadgeLabel.vue'

export const name = 'counter-badge'
// 硬依赖 nodeRegistry：本插件做的事就是往这本说明书里写东西
export const inject = ['nodeRegistry'] as string[]

export function apply(ctx: Context) {
  // ① 注册一个新节点类型。ctx.nodes.register 一次落两处：
  //    数据侧（type/label/尺寸/端口）落 doc，展示侧（in 区域的组件）落 nodeRegistry。
  ctx.nodes.register({
    type: 'counter',
    label: '计数器',
    size: { w: 160, h: 90 },
    in: CounterContent,
    create(position) {
      return ctx.get('doc').createNode('counter', position, { count: 0 })
    },
  })

  // ② 给**所有**节点的标题位叠一个角标（type 传 '*' = 通配所有类型）。
  //    落点是 node/region 注册场（场键 = 类型名 + '/' + 区域词，这里就是 '*' + '/' + 'title'），
  //    外壳渲染时把它与 nodeRegistry 的基座合成同一摞。
  //    随本插件卸载自动摘除，不用手写取消。
  ctx.nodes.attach('*', {
    region: 'title',
    id: 'counter-badge/title',
    component: BadgeLabel,
  })

  // ③ 一条命令：读这本说明书（诊断用）—— 看看当前登记了哪些类型、counter 型登记了什么。
  ctx.commands.register({
    id: 'counter-badge:inspect',
    title: '计数器：看看展示注册表里有什么',
    run: () => {
      const registry = ctx.get<NodeRegistry>('nodeRegistry')
      const all = registry.types()
      const counter = registry.get('counter')
      console.log('[counter-badge] 已登记展示的类型：' + all.join(' / '))
      console.log('[counter-badge] counter 的展示定义：' + JSON.stringify(Object.keys(counter?.segments ?? {})))
      // 取某位置当前叠了哪些 occupant（按 order 升序，第一条在最外）
      const stacked = registry.contributionOccupants('counter', 'title')
      console.log('[counter-badge] counter 的 title 位叠加层：' + stacked.map((e) => e.id + '@' + e.order).join(' / '))
      return true
    },
  })
}

