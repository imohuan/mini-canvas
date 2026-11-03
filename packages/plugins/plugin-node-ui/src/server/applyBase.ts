/**
 * node-ui 后台：基础路由与节点包注册（从 server.ts 的 apply 原样迁出）。
 */
import type { ServerCtx } from './shared-types.js'
import { selfOrigin } from './nodeSummary.js'
import { registerTaskRoutes, resolveTaskScriptsDir } from '../task/routes.js'
import { registerPackRoutes } from '../task/packRoutes.js'
import { registerImportRoutes } from '../task/importRoutes.js'

export function applyBase(ctx: ServerCtx): void {
  ctx.routes.get('/api/node-ui/info', (c) => c.json({ ok: true, origin: selfOrigin(c) }))

  // ①.5 任务脚本：节点里那段 HTML 请求后台干活的那几条口（call / list / info / events / status / cancel）
  //
  //     目录解析：优先宿主上架的 taskScriptsDir；没有就按"server-plugins 的上一级"推
  //     （两者都挂在数据根下、并列）。**不在这里 mkdir**：目录不存在就是"一个脚本都没有"，
  //     list 回空数组即可；要加脚本的人自己往那儿放文件。
  //     （"放文件 = 能在服务器上跑代码"这件事写在 docs/plan/task-script-router-plan.md §七。）
  registerTaskRoutes(ctx, resolveTaskScriptsDir(ctx))

  // ①.6 节点包：把「这个节点 + 它依赖的脚本」打成一个文件（导出 / 收藏 / 拖回来）。
  //
  //      打包**只能在后台做**：脚本内容在服务器上，前端拿不到。
  //      宿主得给出两件事：读节点（getNode）与存资产（saveAsset）——
  //      少了哪一件都明确报错，不静默降级成"打个空包"。
  registerPackRoutes(ctx, resolveTaskScriptsDir(ctx), {
    // 宿主那份画布文档只有 read()（见 canvasDoc.ts）——按它取节点。
    // 第一版写成同步 getNode，真机上永远拿不到（2026-10-13 实测踩到）。
    //
    // ⚠️ 而且它**只管默认画布**：别的画布（用户在项目里建的那些）在它里面根本找不到，
    //    于是"导出画布 4 的节点"会直接 400「画布 X 上没有节点 Y」（2026-10-13 用户实测）。
    //    所以默认画布走 doc，其余走 canvasStore 快照 —— 与授权那条路的取法**保持一致**。
    getNode: async (canvasId, id) => {
      let raw: Record<string, unknown> | undefined
      if (canvasId === 'default') {
        const doc = ctx.tryGet<{
          read(): Promise<{ nodes?: Array<Record<string, unknown>> }>
        }>('doc')
        if (doc && typeof doc.read === 'function') {
          const snap = await doc.read()
          raw = (snap?.nodes ?? []).find((n) => String(n.id) === String(id))
        }
      }
      if (!raw) {
        const store = ctx.tryGet<{
          readCanvas(cid: string): Promise<{ nodes?: Array<Record<string, unknown>> } | undefined>
        }>('canvasStore')
        if (store && typeof store.readCanvas === 'function') {
          const snap = await store.readCanvas(canvasId)
          raw = (snap?.nodes ?? []).find((n) => String(n.id) === String(id))
        }
      }
      if (!raw) return undefined
      return {
        id: String(raw.id),
        type: String(raw.type ?? ''),
        ...(raw.position ? { position: raw.position as { x: number; y: number } } : {}),
        ...(raw.size ? { size: raw.size as { w: number; h: number } } : {}),
        ...(raw.data ? { data: raw.data as Record<string, unknown> } : {}),
      }
    },
    saveAsset: async (bytes, name, folderId) => {
      const store = ctx.tryGet<{
        saveUpload(
          bytes: Uint8Array,
          name: string,
          folderId?: string,
        ): Promise<{ id: string; name: string; url: string }>
      }>('assetStore')
      if (!store || typeof store.saveUpload !== 'function') throw new Error('宿主没有资产服务（assetStore）')
      return store.saveUpload(bytes, name, folderId)
    },
  })

  // ①.7 导入节点包：体检（会不会升版本）+ 落地（写脚本、还原节点）。
  //      落地**不弹确认**（用户 2026-10-13 口径），护栏靠同源 + 版本隔离
  //      （有冲突就整包升版本，绝不动本机已有的脚本）。
  registerImportRoutes(ctx, resolveTaskScriptsDir(ctx))
}

