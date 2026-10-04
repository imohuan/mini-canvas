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
  readServer(): Promise<{ nodes: unknown[]; edges: unknown[]; view: unknown }>
  /** 本地当前那份 */
  readLocal(): { nodes: unknown[]; edges: unknown[] }
  /** 用服务器那份覆盖本地 */
  replaceLocal(nodes: unknown[], edges: unknown[]): void
  /** 把本地那份推上去（服务器还没有画布时） */
  pushLocal(nodes: unknown[], edges: unknown[]): Promise<void>
  /** 视图状态（视口）恢复 */
  setViewport?(view: { x: number; y: number; zoom: number }): void
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
    return { phase: 'seeded', nodes: local.nodes.length, edges: local.edges.length }
  }

  // 本地不认识的节点类型不该塞进来：渲染层没有对应组件，加进去只会是一片空白/报错
  const known = deps.knownType ?? (() => true)
  const nodes = server.nodes.filter((n) => {
    const type = n && typeof n === 'object' ? (n as { type?: unknown }).type : undefined
    return typeof type === 'string' ? known(type) : true
  })

  deps.replaceLocal(nodes, server.edges)

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
