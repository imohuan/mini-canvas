import { computed, isRef, nextTick, reactive, ref } from 'vue'
import type { TreeNode } from '../../../composables/ui'
import { useUi } from '../../../composables/ui'
import { canvasTreeBlocks } from '../../../composables/canvasTree'

/**
 * LeftDrawer 画布页的树状态与行为。
 *
 * 从 LeftDrawer.vue 原样搬出：搜索过滤、行块拍平、行内改名和右键菜单绑定都不改。
 */
export function useCanvasTree() {
  const ui = useUi()

  /** 展示模式：list（树行）/ grid（宫格卡片），照目标「展示设置」下拉 */
  const viewMode = ref<'list' | 'grid'>('grid')
  const menuOpen = ref(false)

  function expandAll(): void {
    const walk = (list: TreeNode[]): void => { for (const n of list) { if (n.children) { ui.collapsed[n.id] = false; walk(n.children) } } }
    walk(ui.tree)
    ui.showToast('已展开全部分组')
  }
  function collapseAll(): void {
    const walk = (list: TreeNode[]): void => { for (const n of list) { if (n.children) { ui.collapsed[n.id] = true; walk(n.children) } } }
    walk(ui.tree)
    ui.showToast('已收起全部分组')
  }
  /** 搜索过滤后的树：computed 必须放在顶层，模板才会自动解包 .value（ui.filteredTree 嵌在普通对象里不会解包） */
  const visibleTree = computed<TreeNode[]>(() => {
    const t = ui.filteredTree
    return isRef(t) ? t.value : t
  })

  /**
   * 画布 tab 的**行块序列**（分组头 + 同层节点段，任意层嵌套）。
   */
  const canvasBlocks = computed(() => canvasTreeBlocks(visibleTree.value, (id) => ui.collapsed[id] === true))

  // ===== 画布 tab 的行内改名（用户口径 2026-10-08：照资产树的效果，不要浏览器弹框）=====
  /** 正在改名的节点 id（画布节点/分组共用一条） */
  const renamingNodeId = ref<string | null>(null)
  /** 输入的草稿（受控：值只在这里，输入即更新，提交时一次性写回画布数据） */
  const renamingNodeName = ref('')
  /** 进入改名态：聚焦 + 全选，直接敲名字 */
  function startRenameNode(id: string, name: string): void {
    renamingNodeId.value = id
    renamingNodeName.value = name
    nextTick(() => {
      const el = document.querySelector<HTMLInputElement>('input[data-canvas-rename]')
      el?.focus()
      el?.select()
    })
  }
  function cancelRenameNode(): void {
    renamingNodeId.value = null
  }
  /** 提交：写画布数据（ui.renameNode 是唯一写口），再退改名态 */
  function commitRenameNode(): void {
    const id = renamingNodeId.value
    if (!id) return
    renamingNodeId.value = null
    const name = renamingNodeName.value.trim()
    if (name) ui.renameNode(id, name)
  }

  // ===== 画布树的行操作菜单（用户口径 2026-10-08：画布也要右键菜单）=====
  //
  // 机制与资产树完全同一套：每行挂一个 CanvasRowMenu，把它的 openAt 收进这张表；
  // 行上 @contextmenu 时按行 id 取出来、在**鼠标点**打开同一份菜单。
  // 「⋯」按钮与行右键因此走的是同一个浮层实例 —— 不会出现两套定位/互斥/关闭规则。
  const canvasMenuRefs = reactive<Record<string, { openAt: (x: number, y: number) => void } | null>>({})
  function bindCanvasMenu(rowId: string, el: unknown): void {
    const api = (el as { openAt?: (x: number, y: number) => void } | null) ?? null
    canvasMenuRefs[rowId] = api && typeof api.openAt === 'function' ? { openAt: api.openAt } : null
  }
  /** 行右键：在鼠标点打开该行的操作菜单 */
  function openCanvasMenu(_kind: 'group' | 'node', rowId: string, e: MouseEvent): void {
    e.preventDefault()
    canvasMenuRefs[rowId]?.openAt(e.clientX, e.clientY)
  }

  return {
    viewMode,
    menuOpen,
    setMenuOpen: (value: boolean) => { menuOpen.value = value },
    setViewMode: (value: 'list' | 'grid') => { viewMode.value = value },
    expandAll,
    collapseAll,
    canvasBlocks,
    renamingNodeId,
    renamingNodeName,
    startRenameNode,
    cancelRenameNode,
    commitRenameNode,
    bindCanvasMenu,
    openCanvasMenu,
  }
}

export type CanvasTreeState = ReturnType<typeof useCanvasTree>
