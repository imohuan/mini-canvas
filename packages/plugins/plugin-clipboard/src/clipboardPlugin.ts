/**
 * plugin-clipboard —— 复制/粘贴/剪切/复制一份（v2 复刻老版 canvas-core/src/plugins/clipboard）。
 *
 * 数据流（v2 铁律：只经内核服务读写，不碰 VueFlow/宿主内部；整段原子进 history 一次撤销）：
 * - 复制：读 ctx.selection.ids(节点桶) → doc 取节点 + "两端都在选中集"的边
 *         → 存本画布实例的剪贴板快照（P2-4：按 Context 隔离，不再模块级 static 跨画布串数据）；
 * - 粘贴：克隆快照 → 新 id 重映射(节点 + 边 source/target) → 偏移(有鼠标锚点居中/无则级联 +20)
 *         → doc.transaction（唯一写入口）→ 选中切到新粘贴节点；
 * - 剪切：复制 + 删选中(节点 + 触碰边)，整段 history 一次；
 * - 复制一份：copy + paste 组合（快捷键 mod+d）。
 *
 * 快捷键：不用插件自绑 window，命令 keys 字段由渲染层 CanvasHost 统一分发（masterplan 铁律 7）。
 * 类型缝：declare module 给 ctx.clipboard 直访（对齐 multi-select 的 'multi-select' 服务写法）。
 *
 * 依赖注入：doc/selection 为宿主恒在硬依赖（canvas-data 能力层内置 + 宿主注入）;
 * viewport 由 canvas-render 宿主注入、本插件只做"可选读取"（复制时把最近鼠标屏幕坐标经它换成 flow 锚点）。
 */
import { Service, type Context, type PluginModule } from '@mini-canvas/canvas-base'
import { registerEventName } from '@mini-canvas/canvas-base'
import type { DocService, SelectionService, CanvasNode } from '@mini-canvas/canvas-data'
import {
  CLIPBOARD_COPY_KIND,
  CLIPBOARD_COPY_KEY,
  CLIPBOARD_CUT_KEY,
  CLIPBOARD_PASTE_KIND,
  CLIPBOARD_PASTE_KEY,
  CANVAS_CLIPBOARD_MIME,
  CANVAS_CLIPBOARD_TEXT_PREFIX,
  canvasClipboardPayload,
  hasCanvasClipboardMarker,
  readCanvasClipboardPayload,
  parseCanvasClipboardText,
  pendingMediaRestoreFields,
  type ClipboardPasteHandler,
  type ClipboardWriteHandler,
} from '@mini-canvas/canvas-data'
import {
  makeSnapshot,
  internalEdgesOf,
  touchingEdgesOf,
  toClipboardEdges,
  computePasteOffset,
  remapSnapshot,
  renameClonedNodes,
  coerceClipboardSnapshot,
  type ClipboardSnapshot,
  type ClipboardNode,
  type ClipboardAbsProvider,
} from './clipboardEngine'

/** 剪贴板对外服务形状（其它插件/UI 读选中复制粘贴） */
export interface ClipboardService {
  /** 复制当前选中节点(+内连边)到剪贴板；无选中返回 false */
  copy(): boolean
  /** 粘贴剪贴板内容到画布(鼠标锚点居中/级联偏移)；剪贴板空返回 false */
  paste(): boolean
  /**
   * 粘贴**系统剪贴板里带回来的**画布载荷（别的浏览器页面 / 别的画布实例复制的）。
   * @returns 是否真贴出节点（载荷不可信 → false）
   */
  pasteExternal(payload: { nodes: readonly unknown[]; edges: readonly unknown[]; copyTime?: number }): boolean
  /**
   * 菜单/面板路径的粘贴（没有原生事件）。先贴本页内存快照；没有再去读系统剪贴板里的画布载荷。
   * @returns 本页内存快照是否贴成功；没有快照时返回 true = 已发起异步读剪贴板（结果晚一步）
   */
  pasteFromCommand(): boolean
  /** 剪切当前选中节点(+内连边)到剪贴板并删除；无选中返回 false */
  cut(): boolean
  /** 复制一份当前选中（copy+paste 原子）；无选中返回 false */
  duplicate(): boolean
  /**
   * 把当前内存快照的**完整载荷**写进系统剪贴板（仲裁标记 + 跨页面传数据）。
   * @param write 原生 copy/cut 事件里传它的同步写口（setData，无权限、不竞态）；
   *   缺省走 navigator.clipboard.writeText（菜单/程序化复制用）。
   */
  markSystemClipboard(write?: (mime: string, data: string) => boolean): void
  /** 是否有可粘贴的剪贴板数据 */
  readonly hasData: boolean
}

declare module '@mini-canvas/canvas-data' {
  interface Context {
    clipboard: ClipboardService
  }
}

export const name = 'clipboard'
export const inject = ['doc', 'selection'] as string[]

// 设计文档 §7.4：**emit 的事件名必须 registerEventName 登记**，否则 dev 下每次 emit 一条
// "[EventBus:dev] emit 了未声明的事件名" warn。模块加载时登记（emit 全在运行期，加载先于此）。
registerEventName('clipboard:copy')
registerEventName('clipboard:cut')
registerEventName('clipboard:paste')

/** 可编辑输入框内不响应粘贴快捷键（与宿主 CanvasHost keydown 同规则；复制 ctrl+c 也避开） */
function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  return Boolean(t.closest('input, textarea, select, [contenteditable="true"]'))
}

class ClipboardServiceImpl extends Service implements ClipboardService {
  /** 本 Context(画布实例)的剪贴板快照 —— P2-4：按实例隔离，不再模块级 static 跨画布串数据；
   *  跨页面/跨窗口互贴走系统剪贴板里的**完整载荷**（见 pasteExternal）。 */
  private shared: ClipboardSnapshot | null = null
  /** 本实例粘贴计数（级联偏移用；copy/cut 时清零） */
  private pasteCount = 0
  /** 最近一次画布内鼠标位置（屏幕坐标；pane mousemove 经 viewport 转 flow 锚点） */
  private lastClient: { x: number; y: number } | null = null

  constructor(ctx: Context) {
    super(ctx, 'clipboard')
  }

  private get selection(): SelectionService {
    return this.ctx.get('selection')
  }
  private get doc(): DocService {
    return this.ctx.get('doc')
  }
  /** 可选：canvas-render 宿主注入的视口服务；无则 null（粘贴退级联偏移） */
  private get viewport() {
    return this.ctx.tryGet('viewport') ?? undefined
  }

  /**
   * 复制时取节点绝对坐标的提供者（父链逐级累加）。
   *
   * 用渲染层的 `nodeLayout`（同一份 absolutePosition 实现，分组插件的建组/解组也用它），
   * 而不是让引擎只看快照里的批内父链 —— 复制**只选了子节点、父没被选**时，批内算不出绝对坐标，
   * 必须回到整张画布的父链上问。缺服务时返回 undefined，引擎退化为"把自身 position 当绝对坐标"。
   */
  private absProvider(): ClipboardAbsProvider | undefined {
    const layout = this.ctx.tryGet('nodeLayout') as
      | { absolutePosition?(id: string): { x: number; y: number } }
      | undefined
    if (!layout || typeof layout.absolutePosition !== 'function') return undefined
    return (id: string) => layout.absolutePosition!(id)
  }

  get hasData(): boolean {
    return this.shared !== null && this.shared.nodes.length > 0
  }

  /** 当前选中节点对象数组（节点桶） */
  private selectedNodes(): CanvasNode[] {
    const ids = this.selection.ids
    if (ids.size === 0) return []
    return this.doc.getNodes().filter((n) => ids.has(n.id))
  }

  /** 复制选中节点(+两端都在选的内连边)到共享剪贴板 */
  copy(): boolean {
    const nodes = this.selectedNodes()
    if (nodes.length === 0) return false
    const edges = internalEdgesOf(this.doc.getEdges(), this.selection.ids)
    // makeSnapshot 内部做剥字段 + 绝对坐标（absProvider 走 nodeLayout）；这里不再自己调 toClipboardNodes
    this.shared = makeSnapshot(nodes, toClipboardEdges(edges), Date.now(), this.absProvider())
    this.pasteCount = 0
    this.ctx.emit('clipboard:copy', { nodeCount: nodes.length, edgeCount: edges.length })
    // 程序化路径（右键菜单 / ui.duplicateNode / duplicate）也要写载荷：
    // 否则"菜单里复制 → *另一个页面* Ctrl+V"会因剪贴板里没有节点数据而贴不出东西。
    // 键盘路径随后由 copy 命令处理器用 setData 再写一次（同步、无权限、不竞态），两者不冲突。
    this.markSystemClipboard()
    return true
  }

  /**
   * 把这次复制的**完整载荷**（节点 + 边）写进系统剪贴板 —— 它同时干两件事：
   * 1. 仲裁标记：粘贴时据它判定"该贴画布节点，还是贴外部拷来的图片/文本"；
   * 2. 跨页面传数据：另一个浏览器页面没有本页的内存快照，只能从剪贴板读（用户 2026-10-12 报的
   *    "复制一个节点，无法在另一个浏览器页面粘贴"）。
   *
   * @param write 可选同步写口（原生 copy 事件里用 setData，同步、无权限、不竞态）。
   *   缺省走 navigator.clipboard.writeText（菜单/程序化复制用；用户手势内允许，尽力而为）。
   *   自定义 MIME 与 text/plain 都写同一份**带前缀的载荷**：真机实测两者都能经 copy→paste 往返；
   *   而程序化路径（writeText）只能写 text/plain，所以那份必须自带数据，不能只有标记。
   */
  markSystemClipboard(write?: (mime: string, data: string) => boolean): void {
    const snap = this.shared
    if (!snap) return
    const payload = this.textPayloadOf(snap)
    if (write) {
      write(CANVAS_CLIPBOARD_MIME, payload)
      write('text/plain', CANVAS_CLIPBOARD_TEXT_PREFIX + payload)
      return
    }
    // 程序化路径：navigator.clipboard 只在安全上下文与用户手势内可用，缺失就静默跳过
    // （标记写不上时粘贴退化为"贴内存快照"，与改造前行为一致，不会更糟）。
    try {
      const clip = (globalThis as { navigator?: { clipboard?: { writeText?(t: string): Promise<void> } } })
        .navigator?.clipboard
      void clip?.writeText?.(CANVAS_CLIPBOARD_TEXT_PREFIX + payload)
    } catch {
      /* 尽力而为：写不上不影响内存快照可用 */
    }
  }

  /** 快照 → 剪贴板载荷文本（自定义 MIME 与 text/plain 共用同一份） */
  private textPayloadOf(snap: ClipboardSnapshot): string {
    return canvasClipboardPayload(snap.nodes, snap.edges, snap.copyTime)
  }

  /** 粘贴：克隆快照 + 重映射 + 偏移 + 原子写入 + 选中新节点 */
  paste(): boolean {
    const snap = this.shared
    if (!snap || snap.nodes.length === 0) return false
    return this.pasteSnapshot(snap)
  }

  /**
   * 命令/菜单路径的粘贴（没有原生事件可用）。
   *
   * 与事件路径的差别：菜单点「粘贴」时宿主不会派发 paste 事件，剪贴板内容只能异步问
   * navigator.clipboard.readText()。先贴本页内存快照（同页复制走这条，同步、不依赖权限），
   * 本页没有快照时再去问系统剪贴板 —— 于是菜单里的「粘贴」在另一个页面也能用。
   *
   * @returns 是否贴出节点（没得贴 → false）
   */
  pasteFromCommand(): boolean {
    if (this.paste()) return true
    void this.pasteFromSystemClipboard()
    return true
  }

  /**
   * 异步读系统剪贴板找画布载荷（菜单/面板路径用）。
   *
   * 失败/没权限/不是画布载荷 → 静默返回 false（读剪贴板失败不该弹错，用户看到的就是"没反应"）。
   */
  async pasteFromSystemClipboard(): Promise<boolean> {
    let text = ''
    try {
      const clip = (globalThis as {
        navigator?: { clipboard?: { readText?(): Promise<string> } }
      }).navigator?.clipboard
      text = (await clip?.readText?.()) ?? ''
    } catch {
      return false
    }
    if (!text) return false
    const external = parseCanvasClipboardText(text)
    if (!external) return false
    return this.pasteExternal(external)
  }

  /**
   * 粘贴**来自系统剪贴板**的快照（可能是别的页面 / 别的画布实例 / 别的浏览器复制的）。
   *
   * 与 paste() 的差别只有一处：这些节点在本页从没加载过，data 里指向资源的地址（blob: …）
   * 只在**原来那个页面**有效，这里得按资源引用（resourceId）重建一份本页可用的地址再落节点，
   * 否则图片/视频节点贴出来是空白。
   *
   * 但"本页自己刚复制的那一份"回来时**不重建**：那份地址在本页就是活的，重建一遍只会白写一次
   * （而且那张图的地址一字未变）。判据是载荷里的 copyTime 与本页内存快照是否同一个时刻，
   * 见 isOwnSnapshot。
   *
   * @returns 是否真贴出了节点（不是画布载荷 / 载荷不可信 → false，让位给 file-drop）
   */
  pasteExternal(payload: { nodes: readonly unknown[]; edges: readonly unknown[]; copyTime?: number }): boolean {
    const snap = coerceClipboardSnapshot(payload)
    if (snap.nodes.length === 0) return false
    // 本页自己刚复制的那份回卷回来时**不重建**：那份地址在本页就是活的，重建一遍只会白写一次。
    return this.isOwnSnapshot(payload.copyTime) ? this.pasteSnapshot(snap) : this.pasteWithFreshMedia(snap)
  }

  /**
   * 粘贴来自**别处**的快照：先把资源引用换成地址，再落节点（见 prepareSnapshotMedia）。
   *
   * 为什么这里同步返回 boolean：宿主/菜单调它的时候要立刻知道"这次归不归我"（要不要 preventDefault）。
   * 地址重建是异步的，故内部先等它（通常只是 IndexedDB 一次读，毫秒级），再同步落节点。
   */
  private pasteWithFreshMedia(snap: ClipboardSnapshot): boolean {
    void (async () => {
      await this.prepareSnapshotMedia(snap)
      try {
        this.pasteSnapshot(snap)
      } catch {
        /* 粘贴失败（类型已注销等）→ 不打断事件处理栈 */
      }
    })()
    return true
  }

  /** 剪贴板载荷是不是"本页自己刚复制的那一份"（copyTime 与本页内存快照同一时刻） */
  private isOwnSnapshot(copyTime: number | undefined): boolean {
    const mine = this.shared
    return mine !== null && copyTime !== undefined && mine.copyTime === copyTime
  }

  /**
   * 跨页面粘贴时把资源**引用**翻成**本页可用的地址**（await 在落节点前，见 pasteExternal）。
   *
   * 为什么值得专门做一步：节点里存的 imageUrl/videoUrl 多半是 blob: 地址（上传/生成时由资源库
   * 按引用现算的临时地址），它**只属于原来那个页面** —— 换一个页面贴过来就是死链，图片全白。
   * 而 resourceId 是持久的（本地 IndexedDB / 云端画布文件夹），本页可以按它重建。
   *
   * 重建得一处处 await（每个资源一次），故 pasteExternal 先等它把地址写回快照、再同步落节点 ——
   * 这样贴出来的节点当场就能显示，不会先白一下再补图。地址重建失败（资源不在）就保持原值。
   */
  private async prepareSnapshotMedia(snap: ClipboardSnapshot): Promise<void> {
    const resources = this.ctx.tryGet('resources')
    if (!resources) return
    for (const node of snap.nodes) {
      const resourceId = node.data.resourceId
      if (typeof resourceId !== 'string' || resourceId.length === 0) continue
      const fields = pendingMediaRestoreFields(node)
      if (fields.length === 0) continue
      const url = await resources.resolve(resourceId)
      if (!url) continue
      // 直接就地改**快照**（不是已落盘的节点）：随后的 pasteSnapshot 会把这份 data 一并带进新节点。
      // 就地改安全 —— 快照是快照（coerceClipboardSnapshot 已深拷贝过，与剪贴板/外部对象不共享）。
      for (const key of fields) node.data[key] = url
    }
  }

  /** 克隆快照 → 重映射 → 偏移 → 原子写入 → 选中新节点（paste / pasteExternal 共用） */
  private pasteSnapshot(snap: ClipboardSnapshot): boolean {
    const anchor = this.flowAnchor()
    const offset = computePasteOffset(snap.nodes, anchor, this.pasteCount)
    // 新 id 统一向内核要（自增数字），插件不再自造 `原id-copy-时间戳-随机` 那种形态。
    // 注意 genId 会被 remapSnapshot 对每个节点调用一次，顺序即节点顺序。
    const remapped = remapSnapshot(snap, offset, () => this.doc.nextNodeId())
    // 改名：粘贴出来的节点不能和原节点同名（"文本 1"贴出第二个"文本 1"）。
    // 走 doc.nextTypeName = 与新建节点**同一份**按类型计数，所以号是连续的、不会撞。
    const nodes = renameClonedNodes(remapped.nodes, (type) => this.doc.nextTypeName(type))
    const { edges } = remapped
    if (nodes.length === 0) return false

    const added: string[] = []
    // 一次原子批量插入克隆节点 + 重连边，统一走 graph（历史 + 提交落盘）。
    this.doc.transaction('clipboard-paste', (tx) => {
      tx.addNodes(
        nodes.map((n) => ({
          id: n.id,
          type: n.type,
          position: n.position,
          data: n.data,
          ...(n.parentId !== undefined ? { parentId: n.parentId } : {}),
          ...(n.size !== undefined ? { size: n.size } : {}),
        })),
      )
      for (const n of nodes) added.push(n.id)
      // 边按新 id 重连（edgeStore 语义不变，graph 内 addEdge 提交去重）
      for (const e of edges) {
        // 粘贴也过守门人：剪贴板里的旧数据可能带着当前图上已非法的连接（类型改过/容量改过）。
        // 挤出语义照常：目标口满额就挤最老 —— 与其它所有建线路径一致。
        tx.connectEdge({
          source: e.source,
          target: e.target,
          ...(e.type !== undefined ? { type: e.type } : {}),
          ...(e.sourceHandle !== undefined ? { sourceHandle: e.sourceHandle } : {}),
          ...(e.targetHandle !== undefined ? { targetHandle: e.targetHandle } : {}),
        })
      }
    })
    this.pasteCount += 1
    // 选中切到本次粘贴节点（保持"粘贴后可整体拖动/删除"）；清边选
    this.selection.set(added)
    this.selection.clearEdges()
    this.ctx.emit('clipboard:paste', {
      nodeCount: added.length,
      edgeCount: edges.length,
      position: offset,
    })
    return true
  }

  /** 剪切：先复制(进剪贴板)，再删选中节点+触碰边（history 一次，可撤销） */
  cut(): boolean {
    const nodes = this.selectedNodes()
    if (nodes.length === 0) return false
    const allEdges = this.doc.getEdges()
    const internalEdges = internalEdgesOf(allEdges, this.selection.ids)
    this.shared = makeSnapshot(nodes, toClipboardEdges(internalEdges), Date.now(), this.absProvider())
    this.pasteCount = 0
   const nodeIds = nodes.map((n) => n.id)
 const touching = touchingEdgesOf(allEdges, nodeIds)
  // 一次原子事务内删边+删节点（graph 内层 withRecord 会合并成一条历史），
  // 避免 removeEdges/removeNodes 各自成记录导致一次 undo 只能恢复一半。
  this.doc.transaction('clipboard-cut', (tx) => {
    tx.removeEdges(touching.map((e) => e.id))
    tx.removeNodes(nodeIds)
  })
 this.selection.clear()
   this.ctx.emit('clipboard:cut', { nodeCount: nodes.length, edgeCount: touching.length })
    return true
  }

  /** 复制一份 = copy + paste */
  duplicate(): boolean {
    if (!this.copy()) return false
    return this.paste()
  }

  /**
   * 记录最近一次画布鼠标位置（供粘贴居中锚点；模块逻辑监听 window pointermove，非宿主内部）。
   * 由 apply 里 ctx.effect 装配：ctx.on 事件 / DOM 监听都随插件 scope 自动回收。
   */
  trackClientPoint(x: number, y: number): void {
    this.lastClient = { x, y }
  }

  /** 最近鼠标屏幕坐标 → flow 锚点（viewport 未就绪/无坐标返回 null → 级联偏移） */
  private flowAnchor(): { x: number; y: number } | null {
    if (!this.lastClient) return null
    const vp = this.viewport
    if (!vp) return null
    return vp.screenToFlow(this.lastClient.x, this.lastClient.y)
  }
}

/** 装配入口（cordis 形态） */
export function apply(ctx: Context): void {
  const svc = new ClipboardServiceImpl(ctx)

  // 追踪画布鼠标位置：只在浏览器环境绑 window pointermove（node 测试/装配跳过），
  // ctx.effect 包 DOM 监听 → 插件卸载自动解绑。
  ctx.effect(() => {
    if (typeof window === 'undefined') return
    function onPointerMove(e: PointerEvent): void {
      // 跳过可编辑目标内的拖动（粘贴锚点不该被输入框内指针污染）
      if (isEditableTarget(e.target)) return
      // 只在指针位于画布区域(.vue-flow，VueFlow 渲染约定，与 canvas-export 同源)时记录：
      // 避免把工具栏/侧边栏上的鼠标误当"粘贴锚点"
      const el = e.target as HTMLElement | null
      if (!el || !el.closest('.vue-flow')) return
      svc.trackClientPoint(e.clientX, e.clientY)
    }
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    return () => window.removeEventListener('pointermove', onPointerMove)
  })

  // ===== 剪贴板仲裁（注册场，见 canvas-data/canvas/clipboardActions）=====
  // 复制/剪切/粘贴三个键都声明了 deferToNative（见下方命令），宿主不再在 keydown 里
  // preventDefault，而是放行原生 copy/cut/paste 事件到宿主，再由宿主按 order 问各处理器。
  // 本插件在这里认领"画布节点"这一类：
  // - copy/cut：把选中节点快照存内存 + 把**完整载荷**写进系统剪贴板（另一个页面靠它粘贴）；
  // - paste：剪贴板里能读出画布载荷 → 贴它；只剩"来自画布"的标记 → 贴本页内存快照（旧格式兜底）；
  //   两者都不是 → 让位给 file-drop（外部拷来的图片/文本）。
  //   这正是修掉"复制的图片贴不进来、反倒贴出旧节点"的关键，也是跨页面粘贴的入口。
  ctx.registryOf<ClipboardWriteHandler>(CLIPBOARD_COPY_KIND).add(
    CLIPBOARD_COPY_KEY,
    (payload) => {
      if (!svc.copy()) return false // 无选中 → 不认领，放行浏览器默认复制
      svc.markSystemClipboard(payload.write)
      return true
    },
    { id: name, order: 10 },
  )
  ctx.registryOf<ClipboardWriteHandler>(CLIPBOARD_COPY_KIND).add(
    CLIPBOARD_CUT_KEY,
    (payload) => {
      if (!svc.cut()) return false
      svc.markSystemClipboard(payload.write)
      return true
    },
    { id: name, order: 10 },
  )
  ctx.registryOf<ClipboardPasteHandler>(CLIPBOARD_PASTE_KIND).add(
    CLIPBOARD_PASTE_KEY,
    (payload) => {
      // ① 系统剪贴板里带**完整画布载荷** → 直接用它贴（同页复制走这条；另一个浏览器页面
      //    没有本页内存快照，也只有这条能走 —— 用户 2026-10-12 报的"换个页面粘不了"）。
      const external = readCanvasClipboardPayload(payload)
      if (external) {
        if (svc.pasteExternal(external)) return true
        // 载荷在但一个节点都不可信（别的应用塞的同名 JSON）→ 继续看内存快照
      }
      // ② 剪贴板里只有"来自画布"的标记/纯文本标记（旧格式、或 text/plain 被外部工具改写）：
      //    同页粘贴退化为贴本页内存快照。注意这里**不再要求 hasData** —— 另一个页面没有内存
      //    快照，若因此让位，就会去建一个文本节点（把标记 JSON 当成用户文本，比不响应更糟）。
      //    （两条路互斥：上面那条只认带 nodes/edges 的新载荷，老标记 JSON 到不了它那里。）
      if (!hasCanvasClipboardMarker(payload)) return false
      if (!svc.hasData) return true
      return svc.paste()
    },
    { id: name, order: 10 },
  )

  // 命令：快捷键 keys 由渲染层 CanvasHost 统一分发（不插件自绑 window）
  ctx.commands.register({
    id: 'clipboard:copy',
    title: '复制选中节点',
    keys: ['mod+c'],
    // 仅 node 右键：复制作用于选中集，node 右键开菜单前会把被右键节点选为唯一选中；
    // pane 空白处没有可复制对象，不声明 pane。
    areas: ['node'],
    group: 'clipboard',
    order: 10,
    // 键交给原生 copy 事件（否则 keydown preventDefault 会掐掉它）；工由仲裁场做。
    deferToNative: true,
    run: () => svc.copy(),
  })
  ctx.commands.register({
    id: 'clipboard:paste',
    title: '粘贴',
    keys: ['mod+v'],
    areas: ['pane'],
    group: 'clipboard',
    order: 20,
    // 键交给原生 paste 事件（同上）；工由仲裁场按 order 决定贴节点还是贴外部媒体。
    deferToNative: true,
    // 菜单/快捷键两条路都到这里：快捷键命中时 deferToNative 已放行给原生事件（真正的工在上面的
    // 仲裁场处理器里）；从**菜单**点进来时没有原生事件，故这里的 run 要能自己找内容贴 ——
    // 先贴本页快照，没有再去读系统剪贴板（跨页面粘贴就是这条）。
    run: () => svc.pasteFromCommand(),
  })
  ctx.commands.register({
    id: 'clipboard:cut',
    title: '剪切选中节点',
    keys: ['mod+x'],
    group: 'clipboard',
    order: 30,
    deferToNative: true,
    run: () => svc.cut(),
  })
  ctx.commands.register({
    id: 'clipboard:duplicate',
    title: '复制一份选中节点',
    keys: ['mod+d'],
    // 仅 node 右键（同 copy）
    areas: ['node'],
    group: 'clipboard',
    order: 40,
    run: () => svc.duplicate(),
  })
}

/** 兼容旧装配的 PluginModule 出口 */
export const clipboardPlugin: PluginModule = { name, inject, apply }
