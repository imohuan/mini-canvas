/**
 * plugin-node-ui · 后台半 —— 给 AI 的「怎么画」工具（**这是本插件的核心缝**）。
 *
 * ## 为什么必须有它
 *
 * 用户在画布里引用一个可视化节点时，AI 只拿到一个节点 id。它**不知道**：
 *   - 这个节点是什么（一块会渲染 HTML 的画布）；
 *   - 内容该写进哪个字段；
 *   - 写出来的 HTML 跑在什么环境里、有什么约定；
 *   - 能调哪些后台接口。
 * 少任何一条，AI 都只能瞎猜（或者干脆不画）。所以把它做成 MCP 工具：
 * AI 调一次拿到完整约定，再调一次就把界面写进去。
 *
 * ## 四个工具（**其余用内置的**）
 *
 *   canvas_ui_guide    读「怎么画」的手册（含这张画布现有的节点，便于引用别的节点）
 *   canvas_ui_write    把界面整段写进可视化节点（第一次画 / 整段重画）
 *   canvas_ui_update   在现有 HTML 里**局部替换**（old → new）：改一个 class 不必重写整段
 *   canvas_ui_read     读节点现在的内容（改之前先看一眼）
 *
 * 改**已有节点**的字段、删节点，都用云服务**内置的** canvas_batch_nodes（它本来就支持
 * update / delete，而且是增量、带写锁的）—— 本插件不再各造一个重复工具。
 * 2026-10-12 用户指出：「我不是有一个删除的功能吗」，对，重复了。
 *
 * ## 这个文件怎么被加载、能用什么
 *
 * 打成单文件 dist/server.js → 丢进 cloud-server 的 server-plugins → 启动时用
 * import(data:text/javascript) 加载。**data: URL 里解析不了裸模块名**，所以产物必须自包含：
 * 除了 node: 内置模块，什么都不许 external（见 scripts/build-server.mjs）。
 * 于是这里只用 ctx 给的能力段（routes / mcp / tryGet），零第三方依赖。
 */

export { selfOrigin } from './server/nodeSummary.js'
export { ensureVirtualCanvas } from './server/virtualCanvas.js'
export { waitRun } from './server/waitRun.js'
export type {
  AssetStoreLike,
  AssetLike,
  BuildDebugDocsInput,
  CanvasStoreLike,
  DocLike,
  DocPoolLike,
  NodeLike,
  PatchResult,
  ServerCtx,
  ServerCtxLike,
} from './server/shared-types.js'

import type { ServerCtx } from './server/shared-types.js'
import { applyBase } from './server/applyBase.js'
import { applyTools } from './server/applyTools.js'
import { applyFavorites } from './server/applyFavorites.js'
import { applyFunctions } from './server/applyFunctions.js'
import { applyDebug } from './server/applyDebug.js'

/**
 * 后台插件的名字（cloud-server 的外挂加载器按它判「是不是合法后台插件」，也用它去重）。
 *
 * 漏了它不会在编译期报错：产物能生成、能复制进 server-plugins，服务也能启动，
 * 只是启动日志里多一句「不是合法后台插件（需导出 name 与 apply）」并被跳过 ——
 * 表现成 /api/node-packages/* 全部 404、导出节点包失败（2026-11-05 实测）。
 * 与 plugin-manager 里的插件 id 对齐，装 / 卸时报错也认得出来。
 */
export const name = 'plugin-node-ui'

export function apply(ctx: ServerCtx): void {
  applyBase(ctx)
  applyTools(ctx)
  applyFavorites(ctx)
  applyFunctions(ctx)
  applyDebug(ctx)
}

