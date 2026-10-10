// 文件：packages/docs/public/examples/canvas-data/node-types/plugin-stamp-node/src/index.ts
// 格式：TypeScript 模块（插件入口，导出 name / inject / apply）
// 位置：一个可安装插件包的源码入口

import type { Context } from '@mini-canvas/canvas-base'
import StampContent from './StampContent.vue'
import StampTitle from './StampTitle.vue'
import TitleBadge from './TitleBadge.vue'
import TopPin from './TopPin.vue'
import SelectionPin from './SelectionPin.vue'

export const name = 'stamp-node'
// 类型图标（opaque 句柄）：仓库里的节点插件都传 SVG 字符串，主题按 currentColor 上色
const STAMP_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 10h8M8 14h5"/></svg>'
// 硬依赖：doc（数据那半边）与 nodeRegistry（展示那半边）
export const inject = ['doc', 'nodeRegistry'] as string[]

export function apply(ctx: Context) {
  // ① 注册一种新节点：数据 + 展示 + 建法，一次给全。
  //    字段名就是区域词 —— in 是“卡片内部”，title 是“标题那一行”。
  //    写老名字 content 会被 TS 拦住，纯 JS 调用方传进来会当场抛错。
  ctx.nodes.register({
    type: 'stamp',
    label: '邮票',
    description: '一张带编号的小卡片，可当备忘或标签用',
    size: { w: 240, h: 96 },
    nameTemplate: '邮票 {{ID}}',
    in: StampContent,
    title: StampTitle,
    icon: STAMP_ICON,
    resizable: true,
    // 只接文本上游；不声明 capacity = 不限条数
    inputs: [{ port: 'target', acceptsTypes: ['text'] }],
    outputs: [{ port: 'source', contentType: 'stamp' }],
    // ② create：给“从菜单 / 命令建一个邮票”提供实现，自动挂进 nodeFactory
    create(position) {
      return ctx.get('doc').createNode('stamp', position, { rank: 1, note: '' })
    },
  })

  // ③ 往**所有节点类型**的标题位叠一个角标（type 传 * = 通配）。
  //    落点是 node/region 注册场（键 = '*' + '/' + 'title'），随本插件卸载自动摘除。
  ctx.nodes.attach('*', {
    region: 'title',
    id: 'stamp-node/title-badge',
    component: TitleBadge,
  })

  // ④ 往**图片节点**的上控制栏挂一个按钮。
  //    needs 声明组件要用哪些能力包（BaseNode 按名造实例喂给它）；
  //    props 是这条自己的数据，会透传给组件。
  ctx.nodes.attach('image', {
    region: 'out:top',
    id: 'stamp-node/top-pin',
    component: TopPin,
    needs: ['node'],
    props: { tip: '盖个章' },
  })

  // ⑤ 往**多选框**的上控制栏挂一项。形状与节点那边逐字同形，**唯一差别是没有 type**
  //    —— 多选框不是某一种节点，它就是“当前选中的一批”。
  ctx.selectionRegion.attach({
    region: 'out:top',
    id: 'stamp-node/selection-pin',
    component: SelectionPin,
    needs: ['selection'],
    order: 20,
  })

  // ⑥ 诊断命令：把展示注册表里登记了什么念出来（读操作，不改任何东西）
  ctx.commands.register({
    id: 'stamp-node:inspect',
    title: '邮票：看看展示注册表',
    run: () => {
      const reg = ctx.get<{
        types(): string[]
        get(type: string): { segments: Record<string, unknown> } | undefined
      }>('nodeRegistry')
      console.log('[stamp-node] 已登记展示的类型：' + reg.types().join(' / '))
      console.log('[stamp-node] stamp 的区域：' + Object.keys(reg.get('stamp')?.segments ?? {}).join(' / '))
      return true
    },
  })
}
