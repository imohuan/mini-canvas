// 文件：packages/docs/public/examples/settings-persist/plugin-theme-toggle/src/index.ts
// 格式：TypeScript 模块（插件入口：导出 name / inject / Config / apply）
// 位置：一个可安装插件包的源码入口
import type { Context, PluginModule, ConfigSchema } from '@mini-canvas/canvas-base'

export const name = 'theme-toggle'

// ① 模块级 Config：声明"我有哪些可配置项"。
//    内核激活插件时经 schema 校验 + 补默认，并把字段登记进 settings 单一数据源
//    （设置的初值优先取"用户已保存值"——这正是桥 restore() 注入的快照）。
export const Config: ConfigSchema = {
  gridColor: {
    type: 'color',
    default: '#808080',
    label: '网格颜色',
    group: 'theme-toggle/外观',
    description: '网格线的颜色；改完立刻生效。',
  },
  gridOpacity: {
    type: 'number',
    default: 0.2,
    min: 0,
    max: 1,
    step: 0.05,
    label: '网格透明度',
    group: 'theme-toggle/外观',
  },
}

export function apply(ctx: Context): void {
  // ② 读"生效值"：settings 是单一数据源（改一项就通知一次）
  const settings = ctx.get('settings')
  const applyVisual = (): void => {
    const color = String(settings.get('gridColor') ?? '#808080')
    const opacity = Number(settings.get('gridOpacity') ?? 0.2)
    console.log('[theme-toggle] 应用外观：', { color, opacity })
  }
  applyVisual()
  const off = settings.onChange(() => applyVisual())  // 面板一改，这里跟着重画
  ctx.effect(() => () => off.dispose())

  // ③ 程序化改值：写的是 settings（单一数据源）。
  //    落盘由 save.settings 桥自动完成——本插件**不需要 import 桥**，也不需要知道存哪。
  const changed = settings.set('gridOpacity', 0.6)
  console.log('[theme-toggle] 透明度过 0.6 是否写入成功：', changed)

  // ④ 可选：暴露成一条命令，方便在控制台里试
  ctx.commands.register({
    id: 'theme-toggle:reset-opacity',
    title: '恢复网格透明度默认',
    run() {
      // 想"连保存的旧值一起忘掉"时走 save.settings.resetKey；只想临时改值就直接 settings.set
      const persist = ctx.tryGet('save')?.settings
      return persist ? persist.resetKey('gridOpacity') : settings.set('gridOpacity', 0.2)
    },
  })
}

/** 兼容旧装配的 PluginModule 出口 */
export const themeTogglePlugin: PluginModule = { name, inject: [], Config, apply }

