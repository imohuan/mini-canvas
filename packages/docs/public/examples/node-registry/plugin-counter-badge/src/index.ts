// 文件：packages/docs/public/examples/node-registry/plugin-counter-badge/src/index.ts
// 格式：TypeScript 模块（插件的入口，导出 name / inject / apply）
// 位置：一个可安装插件包的源码入口

import type { Context } from '@mini-canvas/canvas-base'
import CounterContent from './CounterContent.vue'
import BadgeLabel from './BadgeLabel.vue'

export const name = 'counter-badge'
// 硬依赖 doc：节点注册一次落数据与展示两处
export const inject = ['doc'] as string[]

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
  //    外壳渲染时把它与展示容器里的基座合成同一摞。
  //    随本插件卸载自动摘除，不用手写取消。
  ctx.nodes.attach('*', {
    region: 'title',
    id: 'counter-badge/title',
    component: BadgeLabel,
  })

  // ③ 一条命令：从注册场读（诊断用）—— 看看 node/region 当前有哪些键。
  ctx.commands.register({
    id: 'counter-badge:inspect',
    title: '计数器：看看展示注册表里有什么',
    run: () => {
      const field = ctx.surface().registries.find((r) => r.kind === 'node/region')
      if (!field) return false
      console.log('[counter-badge] node/region 场的键：' + field.keys.map((k) => k.key).join(' / '))
      return true
    },
  })
}

