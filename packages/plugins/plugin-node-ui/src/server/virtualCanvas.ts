/**
 * node-ui 后台：虚拟画布（canvas_fn_call 取返回值用；从 server.ts 原样迁出）。
 */
import type { CanvasStoreLike, ServerCtx } from './shared-types.js'


/** 虚拟画布的 id 前缀：一眼看得出是「为调函数现造的」，也避开用户画布 id（那些不带这个前缀） */
const VIRTUAL_CANVAS_PREFIX = 'fn-probe-'

/** 虚拟画布里那个占位节点（脚本回写产物时会用到它的 id） */
const VIRTUAL_NODE_ID = 'probe'

/**
 * 造（或复用）一张**虚拟画布**，专供 canvas_fn_call 取返回值。
 *
 * ## 为什么要它（用户口径）
 *
 * 「调用时不需要外部传 Canvas ID / Node ID」——但脚本的 ctx 里本来就有这两个字段，
 * 脚本作者会拿它们拼"把结果写回画布"的地址。若不传，脚本里 `ctx.save(...)` 那条路会直接报错，
 * 于是"调用一下看它返回什么"这件事就做不成。
 *
 * 所以这里替调用方**造一个虚拟上下文**：一张固定 id 的空画布 + 一个占位节点。
 * 它落在数据目录里（和真画布同一种文件），但 id 带 `fn-probe-` 前缀 ——
 * 既不是用户列表里那些画布，也不会被 `canvas_list_canvases` 之外的东西误认。
 * 脚本即使真往里写了产物，也只是写进这张临时画布，**碰不到用户的任何画布**。
 *
 * 画布不存在就现建一张（幂等：第二次直接复用）。
 */
export async function ensureVirtualCanvas(ctx: ServerCtx): Promise<{ canvasId: string; nodeId: string }> {
  const store = ctx.tryGet<CanvasStoreLike>('canvasStore')
  const canvasId = VIRTUAL_CANVAS_PREFIX + 'default'
  if (store && typeof store.readCanvas === 'function') {
    const snap = await store.readCanvas(canvasId)
    if (!snap) {
      await store.writeCanvas(canvasId, {
        nodes: [{ id: VIRTUAL_NODE_ID, type: 'ui', position: { x: 0, y: 0 }, data: { label: '函数探针' } }],
        edges: [],
      })
    }
  }
  return { canvasId, nodeId: VIRTUAL_NODE_ID }
}


