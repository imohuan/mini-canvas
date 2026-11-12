import type { CanvasHostHandle } from '../createPlumeHost'

export function useCanvasSave(opts: { hostRef: { value: CanvasHostHandle | undefined } }) {
  function flushSave(): void {
    const h = opts.hostRef.value
    if (!h) return
    // 资源引用扫描（P1-14）：落盘前回收"不再被任何存活节点引用"的 object URL。
    // 延迟到 flush 而非删除即时 revoke，保证 undo 恢复节点时 URL 仍有效。
    //
    // 派生资源（缩略图 / 视频帧图）不在此列：它们本来就不写进节点的 resourceId
    // （只由插件按可推算的名字取用），拿"没被引用"当判据会把它们全清掉 ——
    // 现象是"每次落盘都把刚生成的缩略图清掉、下次打开又重算一遍"。
    // 由 ResourceStore 按条目的 derived 标记跳过（见那里的说明）。
    if (h.resources) {
      const alive = new Set<string>()
      // 资源引用字段的完整清单：主引用 + 派生引用（帧图 / 左右图）。
      // 只扫 resourceId 会把 frameResourceId / leftResourceId / rightResourceId 误判为“未引用”，
      // 落盘后这些资源被回收，界面表现为“刷新后帧图/对比图消失”。
      const REF_FIELDS = ['resourceId', 'frameResourceId', 'leftResourceId', 'rightResourceId'] as const
      for (const n of h.nodeStore.getNodes()) {
        const data = n.data as Record<string, unknown> | undefined
        if (!data) continue
        for (const key of REF_FIELDS) {
          const rid = data[key]
          if (typeof rid === 'string' && rid) alive.add(rid)
        }
      }
      h.resources.disposeUnreferenced(alive)
    }
    if (h.save.isDirty()) void h.save.flush()
  }

  function onVisibilityChange(): void {
    if (document.visibilityState === 'hidden') flushSave()
  }

  return { flushSave, onVisibilityChange }
}
