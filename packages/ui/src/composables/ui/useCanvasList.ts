import { ref, computed } from 'vue'
import {
  listCanvases as apiListCanvases,
  createCanvas as apiCreateCanvas,
  duplicateCanvas as apiDuplicateCanvas,
  deleteCanvas as apiDeleteCanvas,
  renameCanvas as apiRenameCanvas,
  renameProject as apiRenameProject,
  type CanvasSummary,
} from '../projectsApi'
import { unregisterPendingSave } from '../pendingSave'
import type { UiState } from './createUiState'
import type { UiHostScope } from './useUiHost'

/**
 * 当前画布、项目名与画布列表行动作。
 *
 * 与原实现同序：URL 解析 → 当前 id → 清单 → 切画布（先落盘）→ 新建/改名/复制/删除。
 * 画布树的树总量/过滤视图仍留在 useCanvasTreeScope；这里只管“哪张画布”。
 */
export function createCanvasListScope(state: UiState, host: UiHostScope) {
  const { hostCtx } = host
  // ===== 当前画布 / 项目的画布列表（多画布）=====
  // 数据来自 cloud-server 的 `/api/projects/:id/canvases`；当前画布 id 从 URL 的
  // `#/canvas/<id>` 读（与 cloud-client 的 canvasId() 同一口径）。切画布 = 换 hash → Root 重新挂载。
  /** 从当前 URL 读画布 id（#/canvas/<id> 或 ?canvas=<id>），取不到回落 default */
  function canvasIdFromUrl(): string {
    if (typeof window === 'undefined') return 'default'
    const m = /\/canvas\/([A-Za-z0-9_-]{1,64})/.exec(window.location.hash)
    if (m) return m[1]
    const q = new URLSearchParams(window.location.search).get('canvas')
    return q && /^[A-Za-z0-9_-]{1,64}$/.test(q) ? q : 'default'
  }
  const currentCanvasId = ref('default')
  /** 当前项目的画布清单（下拉用）；名字来自后端索引 */
  const canvasListItems = ref<CanvasSummary[]>([])
  /** 读当前画布在清单里的名字（拿不到回落 id） */
  function canvasNameOf(id: string): string {
    return canvasOptions.value.find((c) => c.id === id)?.label ?? '画布'
  }
  /**
   * 画布下拉的选项：把「没有真名字」的画布（如内置的 `default`、手工丢进来的目录）
   * 显示成「画布 N」（按清单顺序）—— 用户口径：要么显示「画布1」，要么显示自定义名，
   * 不该把内部 id（default / 一串哈希）露给用户。
   */
  const canvasOptions = computed<Array<{ id: string; label: string }>>(() =>
    canvasListItems.value.map((c, i) => {
      const hasName = typeof c.name === 'string' && c.name && c.name !== c.id
      return { id: c.id, label: hasName ? c.name : '画布 ' + (i + 1) }
    }),
  )
  /** 拉当前项目的画布清单（项目 id 从「含当前画布的那一项」反查；独立画布回落 default） */
  async function refreshCanvasList(): Promise<void> {
    try {
      const all = await apiListCanvases('default').catch(() => [] as CanvasSummary[])
      // default 项目未必含当前画布 —— 再尝试从项目清单里找。简单起见：先放 default 的，
      // 若当前画布不在其中，用一个「查询全部项目」的兜底：遍历项目很少（通常个位数）。
      let list = all
      if (!list.some((c) => c.id === currentCanvasId.value)) {
        const projects = await listProjectsLoose()
        for (const p of projects) {
          const cs = await apiListCanvases(p.id).catch(() => [] as CanvasSummary[])
          if (cs.some((c) => c.id === currentCanvasId.value)) { list = cs; break }
        }
      }
      canvasListItems.value = list
    } catch {
      canvasListItems.value = []
    }
  }
  async function listProjectsLoose(): Promise<Array<{ id: string }>> {
    try {
      const res = await fetch('/api/projects')
      const body = (await res.json()) as { projects?: Array<{ id: string }> }
      return body.projects ?? []
    } catch {
      return []
    }
  }
  /** 切到另一张画布：换 hash → Root 按 key 重新挂载画布 */
  async function openCanvas(id: string): Promise<void> {
    if (typeof window === 'undefined' || id === currentCanvasId.value) return
    // ★ 换画布之前**先把当前这张落盘**（await 到真正写完）——否则切走时那次保存还在半路上，
    //   旧画布的改动就丢了（用户实测：切了画布回来发现改动没了）。
    await flushCanvasSave()
    window.location.hash = '#/canvas/' + id
  }

  /**
   * 把当前画布的脏改动**真正写完**（await 到存储层返回）。
   * 离开画布（切画布 / 回项目页）前调用它，保证不丢最后一次编辑。
   */
  async function flushCanvasSave(): Promise<void> {
    try {
      const save = hostCtx()?.get<{ flush?(): Promise<void> }>('save')
      await save?.flush?.()
    } catch (err) {
      console.warn('[ui] 保存画布失败', err)
    }
  }
  /**
   * 注销给路由守卫的落盘钩子（宿主卸载时调）。
   *
   * 注册**不在这里**做：单例只建一次，而 App 每次卸载都会注销 —— 注册若只在建单例时
   * 做一次，第二次进画布就再也没人注册，路由守卫 await 到 undefined，切画布的落盘
   * 静默失效。注册放在 onReady（每次宿主就绪都跑）。
   */
  function releasePendingSave(): void {
    unregisterPendingSave(flushCanvasSave)
  }
  /** 在当前项目下新建一张画布，并切过去 */
  async function newCanvas(): Promise<void> {
    const pid = canvasListItems.value.find((c) => c.id === currentCanvasId.value)?.projectId
      ?? canvasListItems.value[0]?.projectId
      ?? 'default'
    try {
      const made = await apiCreateCanvas(pid, '画布 ' + (canvasListItems.value.length + 1))
      openCanvas(made.id)
    } catch (err) {
      console.warn('[ui] 新建画布失败', err)
    }
  }

  /**
   * 改**当前画布**的名字（左上角那个可编辑名字；双击改名后调它）。
   * 写回 `/api/canvases/:id/meta`（后端同时更新索引与 canvas.json 的 name），再刷新下拉清单。
   */
  async function renameCanvas(name: string): Promise<void> {
    const next = name.trim()
    const id = currentCanvasId.value
    if (!next) return
    try {
      await apiRenameCanvas(id, next)
      // 本地先改，界面立刻跟上（随后 refreshCanvasList 会用后端真值覆盖）
      const item = canvasListItems.value.find((c) => c.id === id)
      if (item) item.name = next
      await refreshCanvasList()
    } catch (err) {
      console.warn('[ui] 改画布名失败', err)
    }
  }

  /** 当前画布所属的项目 id（独立画布回落 default） */
  function currentProjectId(): string {
    return (
      canvasListItems.value.find((c) => c.id === currentCanvasId.value)?.projectId ??
      canvasListItems.value[0]?.projectId ??
      'default'
    )
  }

  // ===== 画布列表行的操作菜单（用户口径 2026-10-09）=====
  // 「在新窗口打开 / 重命名画布 / 复制画布 / 删除画布」四件事的实现都收在这里：
  // 组件只发事件（它不知道数据在哪），落盘/请求/导航全在宿主这一层。

  /**
   * 在新窗口打开某张画布：走 `#/canvas/<id>` 的新标签页。
   *
   * 为什么要先把当前画布写完：新标签页会读同一份后端数据，但**当前这张**的脏改动
   * 可能还在防抖队列里；此时另开一个页面读到的就是旧数据，看起来像「新窗口没带我的改动」。
   */
  async function openCanvasInNewWindow(id: string): Promise<void> {
    if (typeof window === 'undefined') return
    await flushCanvasSave()
    const base = window.location.href.split('#')[0]
    window.open(base + '#/canvas/' + id, '_blank', 'noopener')
  }

  /**
   * 重命名**指定**画布（列表行菜单用）。
   *
   * 名字从哪来：`window.prompt` 与「项目页新建项目 / 改名」同一种口径，不另造一套弹窗组件。
   * 改的不是当前画布时，改完只要刷新列表；改的正是当前这张，界面上的名字框靠 computed 自己跟上。
   */
  async function renameCanvasById(id: string): Promise<void> {
    if (typeof window === 'undefined') return
    const cur = canvasOptions.value.find((c) => c.id === id)?.label ?? ''
    const input = window.prompt('重命名画布', cur)
    if (input === null) return
    const next = input.trim()
    if (!next || next === cur) return
    try {
      await apiRenameCanvas(id, next)
      const item = canvasListItems.value.find((c) => c.id === id)
      if (item) item.name = next
      await refreshCanvasList()
    } catch (err) {
      console.warn('[ui] 改画布名失败', err)
    }
  }

  /**
   * 复制一张画布（节点 / 边 / 资源 / 历史一起；**视口不带走** —— 复制内容不复制「我当时看到哪儿」）。
   * 复制完刷新列表，副本就出现在下拉里（不自动切过去：用户多半是拿它做另一版，不是当场改它）。
   */
  async function duplicateCanvas(id: string): Promise<void> {
    try {
      await apiDuplicateCanvas(id)
      await refreshCanvasList()
    } catch (err) {
      console.warn('[ui] 复制画布失败', err)
    }
  }

  /**
   * 删掉一张画布（连带文件夹与资源）。
   *
   * 用户口径（2026-10-09）：「不管是哪个画布都支持删除，即使是当前选中的也支持删除。
   * 只不过你删除之后，跳转到第一个画布就行了呀」。所以**没有例外**：内置画布也删，
   * 当前正在看的也删；删完跳到剩下清单里的第一张。
   *
   * 两条必须保留的收尾（否则会白屏）:
   * ① 删的正是当前这张时，先把脏改动落盘让路，再删、再导航 —— 删完还停在已不存在的 hash 上就白屏了；
   * ② 删空了（一张不剩）时**补建一张空画布**再跳过去 —— 没画布可跳同样白屏，而且用户回到下拉里
   *    必须还能看见至少一张。
   */
  async function deleteCanvas(id: string): Promise<void> {
    if (typeof window !== 'undefined' && !window.confirm('删除画布「' + (canvasNameOf(id)) + '」及其全部内容？')) return
    const wasCurrent = id === currentCanvasId.value
    try {
      if (wasCurrent) await flushCanvasSave()
      await apiDeleteCanvas(id)
      if (wasCurrent) {
        // 跳到剩下清单里的第一张；一张不剩就现建一张（删空了也得有画布可看）
        const next = canvasListItems.value.find((c) => c.id !== id)
        if (next) {
          // openCanvas 会先 flush + 换 hash；此处 next 一定与当前 id 不同，能真正导航
          await openCanvas(next.id)
          await refreshCanvasList()
          return
        }
        await newCanvas()
        return
      }
      await refreshCanvasList()
    } catch (err) {
      console.warn('[ui] 删除画布失败', err)
    }
  }

  /** 读项目名 → 工作区名（用户口径：工作区名就是这个项目文件夹的名字） */
  async function loadProjectName(): Promise<void> {
    try {
      const res = await fetch('/api/projects')
      const body = (await res.json()) as { projects?: Array<{ id: string; name: string }> }
      const pid = currentProjectId()
      const p = body.projects?.find((x) => x.id === pid)
      if (p?.name) state.projectName = p.name
    } catch {
      /* 拿不到就保持默认名 */
    }
  }
  /** 改工作区名 → 写回后端项目名（用户口径：工作区命名 = 项目文件夹名） */
  async function renameProject(name: string): Promise<void> {
    const next = name.trim()
    if (!next) return
    try {
      await apiRenameProject(currentProjectId(), next)
      state.projectName = next
    } catch (err) {
      console.warn('[ui] 改工作区名失败', err)
    }
  }
  return {
    currentCanvasId, canvasListItems, canvasNameOf, canvasIdFromUrl, refreshCanvasList, openCanvas, newCanvas, renameCanvas,
    openCanvasInNewWindow, renameCanvasById, duplicateCanvas, deleteCanvas,
    canvasOptions, loadProjectName, renameProject, currentProjectId, flushCanvasSave, releasePendingSave,
  }
}

export type CanvasListScope = ReturnType<typeof createCanvasListScope>

