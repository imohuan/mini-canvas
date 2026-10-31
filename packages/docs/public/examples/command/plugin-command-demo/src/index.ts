// 文件：packages/docs/public/examples/command/plugin-command-demo/src/index.ts
// 格式：TypeScript 模块（插件入口：导出 name / inject / apply）
// 位置：一个可安装插件包的源码入口
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import CommandBar from './CommandBar.vue'

export const name = 'command-demo'

// ① 硬依赖：没有 doc/selection 本插件没意义；命令用 canvas 门面执行
export const inject = ['doc', 'selection', 'canvas'] as string[]

/** 本插件命令的分组名（工具条按它筛选；也是菜单里的分组名） */
export const DEMO_COMMAND_GROUP = 'command-demo'

const NUDGE_STEP = 32

export function apply(ctx: Context): void {
  const selection = ctx.get('selection')
  const doc = ctx.get('doc')

  // ② 注册命令：经注册场那条路（条目归本插件，卸载自动摘除）
  ctx.commands.register({
    id: 'command-demo:nudge-right',
    title: '选中节点右移',
    keys: ['alt+arrowright'],        // ③ 键位串：修饰键 + 主键，'+' 分隔
    areas: ['toolbar'],              // ④ 声明进工具栏区域（不声明 = 纯快捷键）
    group: DEMO_COMMAND_GROUP,
    order: 10,                       // ⑤ 越小越靠前；同键多命令时也是它定胜负
    icon: 'arrow-right',
    // ⑥ when：没选中节点时这条命令"不适用"。
    //    快捷键分发时它会**让位**（不满足就不吃掉这次按键）；
    //    直接 execute 时不满足则静默 no-op。
    when: () => selection.ids.size > 0,
    run() {
      const ids = [...selection.ids]
      // ⑦ 多个节点一起移动 = 一次事务，撤销一步就回来
      doc.transaction('command-demo:nudge-right', (tx) => {
        for (const id of ids) {
          const node = doc.getNode(id)
          if (!node) continue
          tx.updateNode(id, { position: { x: node.position.x + NUDGE_STEP, y: node.position.y } })
        }
      })
      return ids.length
    },
  })

  // ⑧ 工具条：只负责显示与点击，逻辑全在命令里
  ctx.slots.register('overlay', {
    id: 'command-demo/bar',
    order: 25,
    component: CommandBar,
    meta: { title: '命令演示工具条' },
  })
}

/** 兼容旧装配的 PluginModule 出口 */
export const commandDemoPlugin: PluginModule = { name, inject, apply }

