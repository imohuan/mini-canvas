import type { AgentServiceContext, AgentServiceDeps } from './context.js'

/** 画布 id / 节点与资产引用 / 消息编辑态（纯本地状态） */
export function createRefsDomain(ctx: AgentServiceContext, deps: AgentServiceDeps) {
  const { state, model } = ctx
  const { sync } = ctx

  function setCanvasId(id: string): void {
    if (id) state.canvasId = id
  }

  /** 记下待引用的节点（去重 + 去掉空 id）；右键给 1 个、多选栏给一批，同一条路 */
  function requestNodeRefs(nodeIds: string[]): void {
    const ids = [...new Set(nodeIds.filter((id) => Boolean(id)))]
    if (ids.length) state.pendingNodeRefs = ids
  }

  /**
   * 引用一份资产到输入框（资产面板「添加到 Agent」调用）。
   *
   * 与「引用到 Agent」**同一条通道**：这里只记**待引用的资产数据**，
   * 由输入框组件用 assetResource() 现造完整标签（带 renderItem/renderEditor）。
   * 早先的写法在服务里塞了个半成品对象（没有 renderItem/renderEditor）—— 插进输入框渲染不出来，
   * 于是「添加到 Agent」看着没反应（用户报的 bug）。
   */
  function referenceAsset(asset: { id?: string; name: string; url: string; path?: string; folderId?: string; isFolder?: boolean; kind?: string }): void {
    state.pendingAsset = {
      id: asset.id, name: asset.name, url: asset.url,
      ...(asset.path ? { path: asset.path } : {}),
      ...(asset.folderId ? { folderId: asset.folderId } : {}),
      ...(asset.isFolder ? { isFolder: true } : {}),
      // 资产类型（image / video / audio）—— 标签图标第二轮靠它（见 resolveRefIcon）。
      // 文件名可能是 UUID、没有扩展名，只看扩展名认不出音频。
      ...(asset.kind ? { kind: asset.kind } : {}),
    }
    // 打开面板并刷新（面板关着时先记下，组件挂载后补插）
    state.open = true
    void deps.refresh()
  }
  /**
   * 批量引用：一次插**多张**资产标签（多选工具栏「加入资产库」调用）。
   *
   * 与单张同一条通道 —— 只是待插项从 1 变成 N。组件消费后一次清空
   * （clearPendingResources，区别于单张的 clearPendingResource）。
   */
  function referenceAssets(assets: Array<{ id?: string; name: string; url: string; path?: string; folderId?: string; isFolder?: boolean; kind?: string }>): void {
    if (!assets.length) return
    state.pendingAssets = assets.map((a) => ({
      id: a.id, name: a.name, url: a.url,
      ...(a.path ? { path: a.path } : {}),
      ...(a.folderId ? { folderId: a.folderId } : {}),
      ...(a.isFolder ? { isFolder: true } : {}),
      ...(a.kind ? { kind: a.kind } : {}),
    }))
    state.open = true
    void deps.refresh()
  }
  /** 输入框组件批量插完后清掉 */
  function clearPendingResources(): void {
    state.pendingAssets = null
  }
  /** 输入框组件插完标签后清掉 */
  function clearPendingResource(): void {
    state.pendingAsset = null
  }

  function clearNodeRefs(): void {
    state.pendingNodeRefs = null
  }

  /** 编辑状态：模型持真值（单选），state 只放只读镜像给模板 */
  function beginEdit(turnId: string): void {
    model.beginEdit(turnId)
    state.editingId = model.editingId
    sync()
  }

  function cancelEdit(): void {
    model.cancelEdit()
    state.editingId = null
    sync()
  }

  return {
    setCanvasId,
    requestNodeRefs,
    referenceAsset,
    referenceAssets,
    clearPendingResources,
    clearPendingResource,
    clearNodeRefs,
    beginEdit,
    cancelEdit,
  }
}



