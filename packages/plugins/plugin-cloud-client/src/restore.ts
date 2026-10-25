// 装载时的「云端优先」：把服务器的画布搬到本地。
//
// 为什么必须有这一步：宿主的启动顺序是**先按默认存储恢复画布、再装外部插件**
// （CanvasHost 先 boot 并 restore，之后才跑 installExternalPlugins）。
// 本插件换 adapter 是在 apply 里，那时画布已经从 localStorage 恢复完了 ——
// 也就是说，不做这一步的话，用户看到的是**本地那份**，而不是服务器的真身。
//
// 两条分支：
// - 服务器有画布 → 用它覆盖本地（云端是真身）
// - 服务器上什么都没有 → 把本地这份推上去（首次上云）

export interface RestoreDeps {
  /** 读服务器那份（nodes / edges / view） */
  readServer(): Promise<{ nodes: unknown[]; edges: unknown[]; view: unknown; revision?: number }>
  /** 本地当前那份 */
  readLocal(): { nodes: unknown[]; edges: unknown[] }
  /** 用服务器那份覆盖本地 */
  replaceLocal(nodes: unknown[], edges: unknown[]): void
  /**
   * 覆盖本地**之前**，按节点里的资源引用重建可显示地址（imageUrl / videoUrl …）。
   *
   * 为什么必须有：服务器存的是节点 data.resourceId（一个引用），而渲染层只认 imageUrl/videoUrl
   * （真地址）。本地加载路径本来就有一遍「按引用重建地址」，但云端恢复发生在那之后、且只做整包
   * 覆盖 —— 没有这一步时，覆盖完的节点只剩引用，图片/视频节点渲染成空白（用户 2026-10-10 报的
   * 「刷新后图/视频变空白」）。缺省不传 = 老行为不变。
   */
  restoreMediaUrls?(nodes: unknown[]): void | Promise<void>
  /** 把本地那份推上去（服务器还没有画布时） */
  pushLocal(nodes: unknown[], edges: unknown[]): Promise<void>
  /** 视图状态（视口）恢复 */
  setViewport?(view: { x: number; y: number; zoom: number }): void
  /**
   * 恢复完成后的“服务器准信”：启动时用这一份同时初始化保存基准与合并基准。
   * 缺省不调（旧宿主/测试兼容）。
   */
  onServerSnapshot?(snapshot: { nodes: unknown[]; edges: unknown[]; view: unknown; revision?: number }): void
  /** 认不认识某个节点类型（不认识的不塞进来：本地渲染不了） */
  knownType?(type: string): boolean
  onError?(msg: string, err?: unknown): void
}

export interface RestoreResult {
  /** 'restored' = 用服务器的覆盖了本地；'seeded' = 首次上云；'empty' = 两边都空 */
  phase: 'restored' | 'seeded' | 'empty'
  nodes: number
  edges: number
}

export async function restoreOrSeed(deps: RestoreDeps): Promise<RestoreResult> {
  const server = await deps.readServer()
  const hasServer = server.nodes.length > 0 || server.edges.length > 0

  if (!hasServer) {
    const local = deps.readLocal()
    if (local.nodes.length === 0 && local.edges.length === 0) {
      return { phase: 'empty', nodes: 0, edges: 0 }
    }
    // 首次上云：把本地这份推上去
    await deps.pushLocal(local.nodes, local.edges)
    // 首云成功后就是“服务器已有这份”的准信；调用方用它同时初始化两份基准。
    deps.onServerSnapshot?.({ nodes: local.nodes, edges: local.edges, view: null })
    return { phase: 'seeded', nodes: local.nodes.length, edges: local.edges.length }
  }

  // ★ 不要因为「本地暂时不认识这个类型」就丢节点。
  //
  // 曾经的写法是按 knownType 过滤，理由是「没有对应组件会渲染成空白」。但它有个更糟的副作用：
  // **类型是运行期热装的**（group / mini-map 这类插件由云清单联网后才 apply，注册时机晚于恢复），
  // 于是恢复那一刻 group 还没注册 → 分组节点被丢 → 它的子节点失去 parentId 变成孤儿平铺，
  // 用户看到的就是「分组没了、名字也不跟随」（实测踩到）。
  // 节点数据是用户的，宁可先留着（渲染层对未注册类型本来就有 orphan 兜底），
  // 也不能因为时序问题把它从画布里抹掉。
  const nodes = server.nodes.filter((n) => !!n && typeof n === 'object')

  // 覆盖本地之前先把「引用」翻成「可显示地址」：服务器只存 data.resourceId，
  // 而渲染层只认 imageUrl/videoUrl。少这一步，图片/视频节点在本机就是空白
  // （用户 2026-10-10 报的「刷新后图片/视频变空白」）。
  if (deps.restoreMediaUrls) await deps.restoreMediaUrls(nodes)

  deps.replaceLocal(nodes, server.edges)

  // 把“服务器那份（已重建媒体地址后的节点）”交回调用方：启动时必须与 save 基准同源，
  // 不能再单独 GET 一次（那可能拿到更新的一版，两份基准就错位了）。
  deps.onServerSnapshot?.({
    nodes,
    edges: server.edges,
    view: server.view,
    ...(typeof (server as { revision?: unknown }).revision === 'number'
      ? { revision: Math.floor((server as { revision: number }).revision) }
      : {}),
  })

  const view = server.view
  if (
    deps.setViewport &&
    view &&
    typeof view === 'object' &&
    typeof (view as { x?: unknown }).x === 'number' &&
    typeof (view as { y?: unknown }).y === 'number' &&
    typeof (view as { zoom?: unknown }).zoom === 'number'
  ) {
    deps.setViewport(view as { x: number; y: number; zoom: number })
  }

  return { phase: 'restored', nodes: nodes.length, edges: server.edges.length }
}
