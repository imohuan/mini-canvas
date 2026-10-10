// 文件：packages/docs/public/examples/theme/palette/plugin-flow-badge/src/index.ts
// 格式：TypeScript 模块（插件入口，导出 name / inject / apply）
// 位置：一个可安装插件包的源码入口

import type { Context } from '@mini-canvas/canvas-base'
import FlowBadge from './FlowBadge.vue'

export const name = 'flow-badge'
// 组件只往 title 位挂东西，不直接碰数据服务
export const inject = [] as string[]

export function apply(ctx: Context) {
  // ① 挂到所有节点的标题位：type 传 * = 通配；随本插件卸载自动摘除
  ctx.nodes.attach('*', {
    region: 'title',
    id: 'flow-badge/dot',
    component: FlowBadge,
  })

  // ② 诊断命令：把色板的 12 格（6 个 token × 亮 / 暗）在 settings 里的当前值念出来
  ctx.commands.register({
    id: 'flow-badge:report',
    title: '流光徽章：念念色板',
    run: () => {
      const settings = ctx.tryGet<{ get(k: string): unknown }>('settings')
      // themeColorSlots 是色板派生的唯一入口：token 表 → 2×N 格
      import('@mini-canvas/canvas-render').then(({ themeColorSlots, resolveThemeColorValue }) => {
        for (const slot of themeColorSlots()) {
          const v = settings
            ? resolveThemeColorValue((k) => settings.get(k), slot.token.key, slot.mode)
            : slot.default
          console.log('[flow-badge] ' + slot.settingKey + ' → ' + slot.cssVar + ' = ' + String(v))
        }
      })
      return true
    },
  })
}

