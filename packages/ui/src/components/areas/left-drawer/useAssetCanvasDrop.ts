import { onBeforeUnmount, onMounted } from 'vue'
import { useUi } from '../../../composables/ui'
import { assetKindOf } from '../../../composables/assetModel'

/** 拖出资源树的资产 MIME（AssetTree 写入，宿主在 drop 时兜底读取） */
const ASSET_DRAG_MIME = 'application/x-mini-canvas-asset'

/**
 * LeftDrawer 的「把资源拖到画布」监听。
 *
 * 从 LeftDrawer.vue 原样搬出，仍在 document 捕获阶段监听 dragstart/dragover/drop/dragend。
 * 资产 id 的会话变量与落点判定都不变。
 */
export function useAssetCanvasDrop() {
  const ui = useUi()

  /** 拖拽中的资产 id（dataTransfer 在 dragover 阶段读不出自定义数据，用这个变量做会话内的兜底） */
  let draggingAssetId: string | null = null
  function assetOfDrag(e: DragEvent): { id: string; name: string; url: string; assetKind: string } | null {
    // dataTransfer 里存的是 JSON（{ id }）；dragstart 之后、drop 之前浏览器**不允许读自定义 MIME**，
    // 所以优先用会话变量（draggingAssetId），drop 那一刻才用 dataTransfer 兜底。
    let id = draggingAssetId
    if (!id) {
      const raw = e.dataTransfer?.getData(ASSET_DRAG_MIME) ?? ''
      if (raw) {
        try {
          id = (JSON.parse(raw) as { id?: string }).id ?? raw
        } catch {
          id = raw
        }
      }
    }
    if (!id) return null
    const item = ui.assetItems.value.find((a) => a.id === id)
    if (!item) return null
    return { id: item.id, name: item.name, url: item.url, assetKind: assetKindOf(item) }
  }
  /** 画布区域：落点必须落在画布上才算「拖到画布」（抽屉/弹窗自己的区域不算） */
  function overCanvas(e: DragEvent): boolean {
    const el = e.target as HTMLElement | null
    return Boolean(el?.closest?.('.vue-flow'))
  }
  /** 拖过画布：告诉浏览器「这里可以放下」（不给 preventDefault 的话浏览器会禁止 drop） */
  function onCanvasDragOver(e: DragEvent): void {
    if (!draggingAssetId && !e.dataTransfer?.types.includes('Files')) return
    if (!overCanvas(e)) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  }
  /** 落在画布上：建节点（图片/视频/音频都支持；未知类型给明确反馈） */
  function onCanvasDrop(e: DragEvent): void {
    if (!overCanvas(e)) return

    // ★ 从**文件系统**拖进来的东西：先把节点包(.mcnode)抽出来单独走导入，剩下的交给 file-drop。
    //   为什么要在这拦一道：file-drop 只认图片/视频/文本，包会被它当成"不支持的文件"直接丢掉；
    //   而包这条路的落点完全不同（写脚本 + 还原节点，见 ui.importPackFile）。
    const dropped = Array.from(e.dataTransfer?.files ?? [])
    const packs = dropped.filter((f) => f.name.toLowerCase().endsWith('.mcnode'))
    if (packs.length) {
      e.preventDefault()
      e.stopPropagation()
      const rest = dropped.filter((f) => !packs.includes(f))
      // 落点 = 指针位置（与拖媒体文件、拖资产完全同一条口径）：
      //   用户口径「拖拽之后和直接从文件夹中拖拽进来的效果是一样的」——
      //   所以这里也把指针换算成 flow 坐标传下去，别再让包落到级联默认位。
      const atFlow = ui.screenToFlow(e.clientX, e.clientY) ?? undefined
      void (async () => {
        for (const p of packs) await ui.importPackFile(p, atFlow)
        if (rest.length) await ui.addFilesToCanvas(rest)
      })()
      return
    }

    const asset = assetOfDrag(e)
    if (!asset) return
    e.preventDefault()
    e.stopPropagation()
    // 图片/视频都要先量真实尺寸再建节点（否则卡片会先按默认比例画、留白边），所以这里必须等它
    void ui.dropAssetToCanvas(
      { name: asset.name, url: asset.url, assetKind: asset.assetKind },
      { x: e.clientX, y: e.clientY },
    ).then((created) => { if (created) ui.showToast('已添加节点：' + asset.name) })
    draggingAssetId = null
  }

  /**
   * 把「拖出资源树的资产」记进会话变量。
   */
  function onDocDragStart(e: DragEvent): void {
    const el = e.target as HTMLElement | null
    const row = el?.closest?.('[data-asset-row][data-row-kind=asset]') as HTMLElement | null
    if (!row) { draggingAssetId = null; return }
    draggingAssetId = row.dataset.rowId ?? null
  }
  function onDocDragEnd(): void {
    draggingAssetId = null
  }

  onMounted(() => {
    // 全部挂**捕获**阶段：画布（VueFlow 的 pane）在冒泡路径上会拦掉 dragover ——
    // 冒泡阶段收不到，就没法 preventDefault，浏览器随即禁止 drop（实测：drop 不触发）。
    document.addEventListener('dragstart', onDocDragStart, true)
    document.addEventListener('dragover', onCanvasDragOver, true)
    document.addEventListener('drop', onCanvasDrop, true)
    document.addEventListener('dragend', onDocDragEnd, true)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('dragstart', onDocDragStart, true)
    document.removeEventListener('dragover', onCanvasDragOver, true)
    document.removeEventListener('drop', onCanvasDrop, true)
    document.removeEventListener('dragend', onDocDragEnd, true)
  })
}
