// 文件：packages/docs/public/examples/node-factory/plugin-sticky-demo/src/index.ts
// 格式：TypeScript 模块（插件入口：导出 name / inject / apply）
// 位置：一个可安装插件包的源码入口
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import StickyContent from './StickyContent.vue'

export const name = 'sticky-demo'

// ① doc 是硬依赖：creator 内部经它写数据；canvas 是建节点门面
export const inject = ['doc', 'canvas'] as string[]

const STICKY_TYPE = 'sticky'
const DEFAULT_TEXT = '点两下改字'

export function apply(ctx: Context): void {
  const doc = ctx.get('doc')

  /**
   * ② 建造师傅：在 position 处建一张便利贴，返回新节点 id。
   *    extra 是调用方给的附加材料——这里约定 { text } 作为初始文字。
   */
  function createSticky(position: { x: number; y: number }, extra?: unknown): string {
    // canvas.createNode 会把附加字段包成 { data }；键位那份调用方可能传 { text }。
    const raw = extra as { text?: unknown; data?: { text?: unknown } } | undefined
    const text = raw?.data?.text ?? raw?.text
    // ③ 建节点走 doc.transaction（一次原子写），不是直接改 store
    return doc.transaction('create-sticky', (tx) =>
      tx.createNode(STICKY_TYPE, position, { text: typeof text === 'string' ? text : DEFAULT_TEXT }),
    )
  }

  // ④ 一次注册三样：数据（type/label/尺寸）+ 展示（in 区域组件）+ 建节点（create → 落进 nodeFactory）
  ctx.nodes.register({
    type: STICKY_TYPE,
    label: '便利贴',
    nameTemplate: '便利贴 {{ID}}',   // 默认名：便利贴 1、便利贴 2……
    description: '贴一张可写字的便签',
    size: { w: 220, h: 160 },
    in: StickyContent,               // 内容组件住在卡片内部的 in 区域
    create: createSticky,            // ⑤ 就是这一行让 canvas.creatableTypes() 多出 'sticky'
  })

  // ⑥ 自己再加一条命令：在画布固定落点贴一张（演示"按类型名建节点"的另一条消费路径）
  ctx.commands.register({
    id: 'sticky-demo:add',
    title: '贴一张便利贴',
    group: 'sticky-demo',
    areas: ['pane'],                 // 声明了 areas → 右键空白处会出现这一项
    order: 5,
    run() {
      const fromExtra = ctx.get('canvas').createNode(STICKY_TYPE, { x: 120, y: 120 }, { data: { text: '从命令建的' } })
      // ⑦ 建完顺手选中它（用户期望"新建的就是选中的"）
      const selection = ctx.get('selection')
      if (selection) {
        selection.clearEdges()
        selection.set([fromExtra])
      }
      return fromExtra
    },
  })

  // ⑧ 自检输出：确认工厂真的认识这个类型（真实插件里一般不写）
  console.log('[sticky-demo] 现在能建的类型：', ctx.get('canvas').creatableTypes())
}

/** 兼容旧装配的 PluginModule 出口 */
export const stickyDemoPlugin: PluginModule = { name, inject, apply }

