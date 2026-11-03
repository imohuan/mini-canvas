/**
 * node-ui 后台：生成独立调试产物（从 server.ts 原样迁出）。
 */
import type { BuildDebugDocsInput, CanvasStoreLike, ServerCtx } from './shared-types.js'
import { pathJoin } from './canvasAccess.js'
import {
  buildContextJs,
  buildDebugHtml,
  debugDirOf,
  debugFileNames,
  normalizeUpstreamShared,
  writeDebugFile,
} from '../debugDocServer.js'
import { renderSdkJs } from '../debugDocAssets.js'

/**
 * 生成一份独立调试产物（html / context / sdk 三份），返回可打开的 URL。
 *
 * 为什么抽出来：`canvas_ui_build_debug_doc`（Agent 走 MCP）和
 * `POST /api/canvases/:id/debug-docs`（画布上的「调试」按钮）要做的事完全一样。
 * 抄两份的下场是"工具里修好的 bug，按钮那条路还留着"。
 *
 * 两处地址的区别：
 *   · 页面 URL 走**调试源**（`debugOrigin`，另一个端口）—— 用户 HTML 在后台同源执行 = 令牌可被读走；
 *   · `__CANVAS_UI__.baseUrl` 仍是**后台地址**—— 产物要写回画布，那是后台的接口。
 */
export async function buildDebugDocs(
  ctx: ServerCtx,
  input: BuildDebugDocsInput,
): Promise<
  | ({ ok: true } & Record<string, unknown>)
  | { ok: false; error: string }
> {
  const store = ctx.tryGet<CanvasStoreLike>('canvasStore')
  if (!store) return { ok: false, error: '后台没有画布存储服务' }
  let names: ReturnType<typeof debugFileNames>
  try {
    names = debugFileNames(input.nodeId, input.version)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  const backend = ctx.tryGet<string>('selfOrigin') ?? ''
  if (!backend) return { ok: false, error: '拿不到后台地址（selfOrigin 是空的）' }
  const debugOrigin = ctx.tryGet<{ url: string }>('debugOrigin')
  const warnings: string[] = []
  if (!debugOrigin || !debugOrigin.url) {
    /*
     * 调试源没起来就**不生成**调试页。
     *
     * 曾经这里会退回后台同源（`/api/canvases/:id/resources/debug/*`），只往返回值塞一条
     * warnings。但画布上那个「调试」按钮从不读 warnings —— 用户拿到的就是一个
     * 能在后台源上执行自己 HTML、能读走管理令牌的页面，而界面上一个字都不提示。
     * 现在改成明确失败：宁可没有调试页，也不给一个会泄露令牌的页面。
     */
    return {
      ok: false,
      error:
        '调试源没起来（独立调试页要另开一个端口）。为了不把节点 HTML 放到后台同源执行，这次不生成调试页；' +
        '重启后台时看启动日志里「调试页」那一行，端口被占用就换一个。',
    }
  }
  // 独立源：/<canvasId>/<file>
  const resBase = debugOrigin.url.replace(/\/+$/, '') + '/' + encodeURIComponent(input.canvasId) + '/'
  const urls = { html: resBase + names.html, context: resBase + names.context, sdk: resBase + names.sdk }
  const upstream = normalizeUpstreamShared(input.upstream)
  // 短令牌：只允许写「本画布本节点」的槽位，10 分钟后失效。签不出来就留空（sdk 会给人话错误）。
  let token = ''
  try {
    const taskTokens = ctx.tryGet<{ issue(canvasId: string, nodeId: string, ttlMs?: number): string }>('taskTokens')
    if (taskTokens) token = taskTokens.issue(input.canvasId, input.nodeId, 10 * 60 * 1000)
  } catch {
    token = ''
  }
  if (!token) warnings.push('没签出调试写入令牌：这个页面里 CanvasUI.save 会报错（其它调试照常）')
  const uiPayload = {
    theme: 'light',
    baseUrl: backend,
    canvasId: input.canvasId,
    nodeId: input.nodeId,
    debug: 'standalone',
    // 令牌**必须**跟着数据走：页面每 5 秒用 <script> 重载一次 context.js，
    // 而 context.js 会整体重写 __CANVAS_UI__ —— 只写在 HTML 里的话，5 秒后就被冲掉了。
    debugToken: token,
  }
  try {
    // 顺序：先写 sdk（HTML 引用它），再 context（数据），最后 HTML 壳
    await writeDebugFile(store, input.canvasId, names.sdk, renderSdkJs(urls.context))
    await writeDebugFile(
      store,
      input.canvasId,
      names.context,
      buildContextJs({ inputs: input.inputs, upstream, ui: uiPayload, contextUrl: urls.context }),
    )
    await writeDebugFile(
      store,
      input.canvasId,
      names.html,
      buildDebugHtml({
        html: input.html,
        theme: 'light',
        baseUrl: backend,
        sdkFileUrl: urls.sdk,
        contextFileUrl: urls.context,
        debugToken: token,
      }),
    )
  } catch (err) {
    return { ok: false, error: '写调试文件失败：' + (err instanceof Error ? err.message : String(err)) }
  }
  const dataRoot = typeof store.dataRoot === 'function' ? store.dataRoot() : ''
  const dir = dataRoot ? debugDirOf(store, input.canvasId) : ''
  return {
    ok: true,
    canvasId: input.canvasId,
    nodeId: input.nodeId,
    ...(input.version ? { version: input.version } : {}),
    files: names,
    urls,
    token,
    ...(input.withPaths && dir
      ? { paths: { html: pathJoin(dir, names.html), context: pathJoin(dir, names.context), sdk: pathJoin(dir, names.sdk) } }
      : {}),
    ...(warnings.length ? { warnings } : {}),
    summary: { upstreamCount: upstream.length, inputKeys: Object.keys(input.inputs) },
    hint: input.hint,
  }
}


