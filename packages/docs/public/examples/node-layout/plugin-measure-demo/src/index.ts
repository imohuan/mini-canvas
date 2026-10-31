// 文件：packages/docs/public/examples/node-layout/plugin-measure-demo/src/index.ts
// 格式：TypeScript 模块（插件入口：导出 name / inject / apply）
// 位置：一个可安装插件包的源码入口
import type { Context, PluginModule } from '@mini-canvas/canvas-base'

export const name = 'measure-demo'

// ① 硬依赖写 view：这个插件的全部意义就是"按实测尺寸排列"，
//    没有渲染层（拿不到服务）它就不该启动 —— 框架会让它停在 PENDING 等依赖。
export const inject = ['doc', 'selection', 'view'] as string[]

/** 排列时的间距（px） */
const GAP = 24

export function apply(ctx: Context): void {
  const doc = ctx.get('doc')
  const selection = ctx.get('selection')
  const view = ctx.tryGet('view')           // ② 几何与视口合并在这一个服务里

  ctx.commands.register({
    id: 'measure-demo:row',
    title: '选中节点排成一行',
    group: 'measure-demo',
    when: () => selection.ids.size > 1,     // ③ 只有一个节点时这条命令没意义
    run() {
      const ids = [...selection.ids]

      // ④ 每个节点的实测矩形：绝对坐标 + 真实尺寸
      const rects = ids
        .map((id) => view?.getNodeRect(id) ?? null)
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .sort((a, b) => a.x - b.x)          // 按当前从左到右的顺序排，避免"跳位"

      if (rects.length === 0) return 0

      // ⑤ 行的基线：所有节点的顶边对齐到最靠上的那一个
      const baselineY = Math.min(...rects.map((r) => r.y))
      let cursorX = Math.min(...rects.map((r) => r.x))

      const moves: Array<{ id: string; position: { x: number; y: number } }> = []
      for (const rect of rects) {
        const current = doc.getNode(rect.id)
        if (!current) continue
        // ⑥ 目标绝对坐标 → 换算回"这个节点所在坐标系里的 position"：
        //    有父（组内）时存的是相对父的局部坐标，要减掉父的绝对坐标。
        const abs = { x: cursorX, y: baselineY }
        const parentAbs = current.parentId
          ? view?.absolutePosition(current.parentId) ?? { x: 0, y: 0 }
          : { x: 0, y: 0 }
        moves.push({ id: rect.id, position: { x: abs.x - parentAbs.x, y: abs.y - parentAbs.y } })
        cursorX += rect.w + GAP              // ⑦ 步进用的是**实测宽度**，不是声明宽度
      }

      // ⑧ 一次事务：整批移动 = 一步撤销
      doc.transaction('measure-demo:row', (tx) => {
        tx.updateNodes(moves.map((m) => ({ id: m.id, patch: { position: m.position } })))
      })

      // ⑨ 可选：把排好的这一行带回视野中心
      if (view) {
        const totalW = rects.reduce((sum, r) => sum + r.w, 0) + GAP * (rects.length - 1)
        view.setCenter(cursorX - totalW / 2, baselineY, view.getViewport().zoom)
      }
      return moves.length
    },
  })
}

/** 兼容旧装配的 PluginModule 出口 */
export const measureDemoPlugin: PluginModule = { name, inject, apply }

