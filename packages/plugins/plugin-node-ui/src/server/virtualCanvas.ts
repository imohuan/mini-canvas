/**
 * node-ui 后台：虚拟画布（**只用来单测脚本**，不参与界面开发）。
 *
 * ## 什么时候用它（用户口径 2026-11-25）
 *
 * 「有时候我需要单独测试后台脚本是否可用」—— 那件事不该逼着用户先摆一张画布、
 * 连好素材、建出一个节点。但脚本的 `ctx` 里带着 `canvasId` / `nodeId`，
 * 它回写产物的 `ctx.save(...)` 就是拿这两个值拼地址的；一个都不给，保存必然失败。
 *
 * 所以给**只验脚本**这条路造一张草稿画布：固定 id、一个占位节点。产物写在这里，
 * 用户自己的画布一个字节都不碰。要看效果时再换真实画布与节点跑一次即可。
 *
 * ## 和以前那版的区别（必须知道）
 *
 * 以前 `canvas_fn_call` **永远**用虚拟画布，界面开发时产物也落这里 ——
 * 用户在自己的画布上什么都看不到。现在的规矩是：
 *   · 调 `canvas_fn_call` **给了** canvasId + nodeId → 就在那个真节点上跑（界面开发走这条）；
 *   · **没给** → 才落到这张草稿画布（只验脚本走这条）。
 * 两条路都由宿主签发短时令牌，`ctx.save` 都能成功。
 *
 * 画布不存在就现建一张（幂等：第二次直接复用）。
 */
import type { CanvasStoreLike, ServerCtx } from './shared-types.js'

/** 虚拟画布的 id 前缀：一眼看得出是「为调函数现造的」，也避开用户画布 id（那些不带这个前缀） */
export const VIRTUAL_CANVAS_PREFIX = 'fn-probe-'

/** 虚拟画布里那个占位节点（脚本回写产物时会用到它的 id） */
export const VIRTUAL_NODE_ID = 'probe'

/**
 * 造（或复用）一张虚拟画布，专供「只验脚本」的调用落产物。
 *
 * 它落在数据目录里（和真画布同一种文件），但 id 带 `fn-probe-` 前缀 ——
 * 既不是用户列表里那些画布（cloud-server 的列表会过滤这个前缀），
 * 也不会被误当成用户的画布。
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
