import { ref, computed, onMounted, onUnmounted, watch, type Ref, unref } from "vue";
import { EditorState, NodeSelection, Selection, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { history, undo, redo } from "prosemirror-history";
import type { MenuPosition, ResourceItem } from "./types";
import { isVideoUrl, loadImageWithThumbnail } from "./utils";
import { clipboardTextOf, exportTextOf, plainTextOf } from "./editor/docText";
import { filterMentionItems } from "./mentionFilter";
import { deleteAtomBackward, deleteAtomForward, isAtomNode } from "./editor/atomDelete";
import {
  CHIP_CARET_DELAY,
  buildSlotItem,
  itemRegistry,
  kindOfResource,
  registerSlotItemsFromDoc,
} from "./editor/chipRegistry";
import { createPasteHandlerPlugin, markPlainTextPaste, parsePlainTextToContent, type PasteFilesHandler } from "./editor/clipboard";
import { createCursorFixPlugin } from "./editor/cursorFixPlugin";
import { createDropCursorPlugin } from "./editor/dropCursorPlugin";
import { buildResourceNode } from "./editor/resourceNode";
import { mySchema } from "./editor/schema";
import { createSelectionDecorationPlugin } from "./editor/selectionDecorationPlugin";
import { activeTagSpec, builtinScan } from "./editor/tagSpec";
import { applyChipEditingState, attachChipThumbState, clickInsideChipIcon } from "./editor/chipDom";
import { initialMenuPosition, measuredMenuPosition } from "./editor/menuPosition";
import {
  refreshChips as refreshChipsInDoc,
  replaceResource as replaceResourceInDoc,
  replaceResourceThumbByIds as replaceResourceThumbByIdsInDoc,
  replaceResourceThumbByName as replaceResourceThumbByNameInDoc,
} from "./editor/resourceCommands";

export { deleteAtomBackward, deleteAtomForward } from "./editor/atomDelete";
export {
  CHIP_CARET_DELAY,
  REF_NAME_PREFIX,
  REF_NODE_PREFIX,
  buildRefChipItem,
  kindFromName,
  kindOfResource,
  nodeIdOfChipId,
  refNameChipId,
  refNameOfChipId,
  refNodeChipId,
  registerItem,
  registeredItem,
} from "./editor/chipRegistry";
export {
  pickFilesFromClipboard,
  isPlainTextPasteEvent,
  markPlainTextPaste,
  parsePlainTextToContent,
  type PasteFilesContext,
  type PasteFilesHandler,
} from "./editor/clipboard";
export { applyThumbByIds, chipAttrsNeedUpdate, slotIdFromName } from "./editor/resourceNode";
export {
  builtinScan,
  currentTagSpec,
  registerTagSpec,
  type TagMatch,
  type TagSpec,
} from "./editor/tagSpec";

/**
 * 这条事务是不是「点标签后浏览器就近落光标」产生的噪声选区？（用户 2026-10-27 报、2026-11-08 复述）
 *
 * ⚠️ 别删这个保护、也不要让别的逻辑在这段时间改文档（用户反复遇到的就是它被绕过）：
 * 点标签后 ProseMirror 先把整颗标签选中（NodeSelection），**1 秒后**才由计时器把光标
 * 放到标签之后。这 1 秒里浏览器会先给一个「紧贴标签前面」的原生文本光标，
 * ProseMirror 读到就再派发一条只改选区的事务 —— 用户看到「光标先跳到标签前、再跳回后面」
 * 闪两下，且那一刻标签会失去选中态。
 *
 * 判定条件刻意很窄，宁可漏吞也不要误吞：
 *   · 必须正在等落光标（pending 非空）；
 *   · 事务不能改文档（插入/删除/换绑要照常应用）；
 *   · 当前选区必须还是**那颗标签的整颗选中**（用户中途点了别处 → 放行）；
 *   · 新选区必须是空的、且正好贴在标签前面（pending.from）。
 */
export function isChipCaretNoise(
  tr: { docChanged: boolean; selectionSet: boolean; selection: Selection },
  pending: { from: number } | null,
  current: Selection,
): boolean {
  if (!pending) return false
  if (tr.docChanged || !tr.selectionSet) return false
  if (!(current instanceof NodeSelection) || current.from !== pending.from) return false
  const { selection } = tr
  return selection.empty && selection.from === pending.from
}

export function useEditor(
  editorRef: Ref<HTMLElement | null>,
  props: {
    modelValue?: Ref<string | undefined>
    promptDoc?: Ref<any | undefined>
    resources?: Ref<ResourceItem[] | undefined>
    resolveResource?: Ref<((token: string) => ResourceItem | null) | undefined>
    /**
     * 是否允许编辑（缺省 true）。false = 只读：光标不出现、键盘/粘贴/拖拽改动全禁。
     * 用于「AI 生成期间锁输入」（底栏的用户口径：加载中不允许编辑）。
     */
    editable?: Ref<boolean | undefined>
    /**
     * 粘贴**文件**（图片等）时的外部处理器。
     *
     * 组件本身不知道「建节点、连参考线」这些业务（那是调用方的），所以只负责：
     * 从剪贴板取出文件 → 交给它 → 它决定建什么、并回填标签。
     * 不传 = 保持原来的纯文本粘贴行为。
     */
    onPasteFiles?: Ref<PasteFilesHandler | undefined>
  },
  emit: {
    (e: "update:modelValue", value: string): void
    (e: "update:promptDoc", value: any): void
    (e: "resource-insert", resource: ResourceItem): void
  },
) {
  let view: EditorView | null = null;
  let mutationObserver: MutationObserver | null = null;
  /**
   * 编辑器最后一次「真的在里面」的选区。
   *
   * 底栏的 @ 按钮点击时编辑器已经失焦，但用户光标该留在刚才的位置；
   * 从没进过输入框（这边为空）才按「没有光标」处理，插到文末。
   */
  let lastFocusedSelection: { from: number; to: number } | null = null;

  // 菜单状态
  const menuVisible = ref(false);
  const menuPosition = ref<MenuPosition>({ left: "0px", top: "0px", origin: "top left", side: "bottom" });
  const activeIndex = ref(0);
  const mentionQuery = ref("");
  // 预览状态
  const previewVisible = ref(false);
  const previewUrl = ref("");
  const previewTitle = ref("");
  const previewType = ref<"image" | "video">("image");
  const previewPosition = ref<{ left: string; top: string; transform?: string }>({ left: "0px", top: "0px" });
  /**
   * 当前预览是谁的（标签 id）。
   *
   * 为什么要记：标签 DOM 会随内容刷新被**整颗重建**（换绑 / 失效 / 删除节点），
   * 旧元素被移除时浏览器不会补发 mouseleave —— 预览框就永远停在屏幕上，
   * 图删了还显示旧图（用户 2026-10-29 截图报的正是这条）。
   * 有了 id，DOM 一变就能判断「它还在不在」，不在就立刻收掉。
   */
  let previewChipId = "";

  function hideResourcePreview(): void {
    previewChipId = "";
    previewVisible.value = false;
  }

  // 计时器
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;
  /** 标签点击后的延迟落光标（CHIP_CARET_DELAY）；连点只保留最后一次 */
  let chipClickTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * 「点了标签、正在等光标落到标签后面」的那颗标签（标签在文档里的起始位置）。
   *
   * ⚠️ 别删、也别让这段时间里的选区被别的事务改掉（用户 2026-10-27 报、2026-11-08 复述）：
   * 点标签后 ProseMirror 先把整颗标签选中（NodeSelection），1s 后才把光标放到它后面。
   * 但浏览器在点下去的瞬间就会「就近」给一个原生文本光标，位置在标签**前面**；
   * ProseMirror 读到它会派发一条「光标在标签前」的事务 —— 用户看到「先跳前、再跳后」闪两下。
   * 所以这段时间要用 isChipCaretNoise 把这种纯选区噪声吞掉，只保留计时器那一次落位。
   */
  let pendingChipCaret: { from: number } | null = null;

  // 过滤后的项目
  const filteredItems = ref<ResourceItem[]>([])


  const groupedItems = computed(() => {
    const map = new Map<string, ResourceItem[]>()
    for (const item of filteredItems.value) {
      const key = item.category || 'default'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(item)
    }
    return map
  })

  const categoryOrder = computed(() => Array.from(groupedItems.value.keys()))

  // 获取纯文本
  function getPlainText(): string {
    if (!view) return "";
    return plainTextOf(view.state.doc);
  }

  // 导出文本，将变量替换为真实值

  /**
   * 编辑器正文是否为空（用户 2026-11-10：占位符要靠它判断）。
   * 只看文档里有没有文字/标签 —— 空段落不算内容。
   */
  function isEmpty(): boolean {
    if (!view) return true
    return plainTextOf(view.state.doc).trim() === '' && view.state.doc.childCount <= 1
  }
  function exportText(): string {
    if (!view) return "";
    return exportTextOf(view.state.doc);
  }

  // 序列化文档结构为 JSON
  function serializeDoc(): any {
    if (!view) return null;
    return view.state.doc.toJSON();
  }

  // 从 JSON 恢复文档结构
  function deserializeDoc(docJson: any) {
    if (!view || !docJson) return;
    try {
      const doc = mySchema.nodeFromJSON(docJson);
      /**
       * 反序列化时给 `ref-slot:*` 标签补上 chip 外观。
       *
       * 为什么必须补：节点的 toDOM 会去注册表取 item；冷启动时注册表是空的，
       * 于是标签退化成默认渲染（@图片1 的纯文字样式，用户看到的就是「标签变成文本」）。
       * 这里把样式先登记好，重建出来就是正常 chip。
       */
      doc.descendants((node) => {
        if (node.type.name !== 'resource') return
        const id = String(node.attrs?.id ?? '')
        const m = /^ref-slot:(image|video|audio|av):(\d+)$/.exec(id)
        if (!m) return
        const slotKind = m[1] as 'image' | 'video' | 'audio' | 'av'
        if (!itemRegistry.has(id)) {
          itemRegistry.set(id, buildSlotItem(slotKind, String(node.attrs?.name ?? id)))
        }
      })
      /**
       * **不再迁移标签身份**（用户 2026-10-28 定案：旧格式不兼容）。
       *
       * 以前这里把裸节点 id 改写成 `ref-slot:<kind>:<N>`；新模型认节点 / 认名称，
       * 老格式标签一律按失效显示，由用户重新标记一次。自动改写只会把错的序号带进新模型。
       */
      const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content);
      view.dispatch(tr);
      emit("update:modelValue", getPlainText());
    } catch (error) {
      console.error("反序列化文档失败:", error);
    }
  }

  // 显示菜单
  function showMenu(coords: { left: number; top: number; bottom: number; right: number }) {
    menuVisible.value = true;
    menuPosition.value = initialMenuPosition(coords);
    activeIndex.value = 0;
  }

  /**
  * 用菜单**真实测量**的高度重新决定上下翻转与位置（修实测 bug：估算 280 会把菜单顶到屏幕上方）。
  * 由 MentionMenu 在 nextTick 里量完自己的 rect 后调用。
  */
  function reflowMenu(rect: { width: number; height: number }) {
    const pos = menuPosition.value;
    if (!menuVisible.value) return;
    const next = measuredMenuPosition(pos, rect);
    if (!next) return;
    menuPosition.value = next;
  }

  // 隐藏菜单
  function hideMenu() {
    menuVisible.value = false;
    mentionQuery.value = "";
    filteredItems.value = [];
  }

  // 插入选中的资源
  function insertSelectedItem(item: ResourceItem) {
    // **动作项**（如「压缩」）：不往正文里插任何东西，只执行一次命令。
    // 为什么先判它：这些项没有 ref / renderEditor，走下面的插入路径会插出一个空标签
    // （用户看到输入框里多了一颗没有名字的 chip）。
    if (item.onPick) {
      // 把用户为搜索打进去的 `@关键词` 一起清掉：动作执行后它还留在输入框里就是垃圾
      //（真机实测：点完「压缩」，输入框里剩着「@压缩」）。
      // 必须在 hideMenu() 之前取长度 —— 它会清掉 mentionQuery。
      const from = view ? view.state.selection.from : 0
      const typed = mentionQuery.value.length
      hideMenu()
      item.onPick()
      if (view && view.state.selection.from === from && from - 1 - typed >= 0) {
        view.dispatch(view.state.tr.delete(from - 1 - typed, from))
      }
      view?.focus()
      return
    }
    if (!view) return
    const { from } = view.state.selection
    const nodeType = mySchema.nodes.resource
    if (!nodeType) return

    const node = buildResourceNode(nodeType, item)
    const tr = view.state.tr.replaceWith(
      from - 1 - mentionQuery.value.length,
      from,
      node,
    )
    tr.insertText(" ")
    /**
     * 注册到**落进文档的那个 id**（统一后的 ref-slot:*），不是菜单项的原始 id。
     * toDOM 拿 node.attrs.id 回查注册表，注册键对不上就会落回默认渲染（下划线文字）。
     */
    const actualId = String(node.attrs?.id ?? item.id)
    itemRegistry.set(actualId, actualId === item.id ? item : { ...item, id: actualId })
    view.dispatch(tr)
    emit("resource-insert", item)
    hideMenu()
    view.focus()
  }

  // 处理资源节点鼠标进入
  function handleResourceMouseEnter(el: HTMLElement) {
    const isSelected = el.classList.contains("ProseMirror-selectednode") || el.classList.contains("resource-node-selected")
    /**
     * 选中的标签**也要能 hover 预览**（用户 2026-10-29 第 3 点：hover 标签没有预览）。
     *
     * 旧逻辑在这里直接 return —— 理由是「选中时已经高亮、弹预览会挡视线」。但底栏里点过
     * 标签后它会保持 NodeSelection（用户刚插完标签就是选中态），于是**永远不弹预览**：
     * 真机表现为「之前还能看到预览，现在没有了」。选中态只影响选中样式，不该影响预览。
     */
    void isSelected
    if (hoverTimer) clearTimeout(hoverTimer)

    const id = el.getAttribute("data-id")
    const item = id ? itemRegistry.get(id) : undefined
    if (item?.onMouseEnter) { item.onMouseEnter(item); return }

    hoverTimer = setTimeout(() => {
      const url = el.getAttribute("data-url") || ""
      const name = el.getAttribute("data-name") || ""
      /**
       * 没有 data-url 但有 hoverPreview 时仍要弹（用户 2026-11-06：视频帧图还没取到时，
       * 标签左侧只能是图标，data-url 是空的 —— 但视频本身是能放的，hover 预览不该因此消失）。
       */
      if (!url && !item?.hoverPreview) return
      /**
       * 音频 / 文本**不弹 hover 预览**（用户 2026-10-28），但**必须按类型判断**。
       *
       * 旧实现拿 `kindFromName(name)` 猜类型 —— 它只认「图片3 / 视频2」这种自动名，
       * 用户给节点起的真名（如「泳装少女」）一律返回 'text'。于是图片标签永远被判成
       * 「文本不弹预览」：hover 时预览框存在但 display:none（用户 2026-10-29 报的第 3 点）。
       * 现在先看注册表里的真实类型（chipKind / mediaType），再看地址扩展名，最后才看名字。
       */
      const kind = kindOfResource(item, { name, url })
      if (kind === 'audio' || kind === 'text') return
      const rect = el.getBoundingClientRect()
      const margin = 12; const previewMaxWidth = 400
      let left = rect.left + rect.width / 2
      let top = rect.bottom + margin
      if (left + previewMaxWidth / 2 > window.innerWidth) left = window.innerWidth - previewMaxWidth / 2 - 10
      if (left - previewMaxWidth / 2 < 0) left = previewMaxWidth / 2 + 10
      const spaceBelow = window.innerHeight - rect.bottom
      if (spaceBelow < 200) {
        top = rect.top - margin
        previewPosition.value = { left: `${left}px`, top: `${top}px`, transform: "translateX(-50%) translateY(-100%)" }
      } else {
        previewPosition.value = { left: `${left}px`, top: `${top}px`, transform: "translateX(-50%)" }
      }
      /**
       * 素材自带 `hoverPreview` 时优先用它（用户 2026-10-28：hover 看到的应该是**视频的一帧
       * 原图**，不能是卡片里那张 50px 缩略图放大糊掉）。它是异步的（要现截帧 / 读资源），
       * 所以先算好位置、拿到地址再显示，避免「先弹一张糊图再换」的闪动。
       */
      const show = (src: string) => {
        previewUrl.value = src
        previewTitle.value = name
        /**
         * 预览类型按**实际拿到的地址**判断（用户 2026-11-06 报视频 hover 黑屏）。
         *
         * 以前写成 `kind === 'video' || isVideoUrl(src)`：视频标签的 hoverPreview
         * 可能给的是帧图（png/jpeg），这里仍判成 video，于是 `<video src="data:image/png">`
         * 放不出画面 —— 用户看到的就是一块黑的。
         * 现在只有真的视频地址（扩展名 / data:video / blob 且类型是视频）才用 <video>，
         * 帧图当图片展示。
         */
        previewType.value = isVideoUrl(src) || /^data:video\//i.test(src)
          || (/^blob:/i.test(src) && kind === 'video')
          ? "video"
          : "image"
        previewChipId = id ?? ""
        previewVisible.value = true
      }
      if (item?.hoverPreview) {
        void Promise.resolve(item.hoverPreview())
          .then((src) => { if (src) show(src) })
          .catch(() => { /* 取不到高清图：不弹，别拿糊图凑数 */ })
        return
      }
      show(url)
    }, 500)
  }

  // 处理资源节点鼠标离开
  function handleResourceMouseLeave(el: HTMLElement) {
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null }
    const id = el.getAttribute("data-id")
    const item = id ? itemRegistry.get(id) : undefined
    if (item?.onMouseLeave) { item.onMouseLeave(item); return }
    // 离开的如果不是当前预览的那颗标签（鼠标从 A 划到 B 只触发 B 的 enter、A 的 leave），不动预览
    if (previewChipId && id && id !== previewChipId) return
    hideResourcePreview()
  }

  // 处理资源节点点击
  function handleResourceClick(el: HTMLElement, e?: MouseEvent) {
    const id = el.getAttribute("data-id")
    const item = id ? itemRegistry.get(id) : undefined
    /**
     * 点**左侧图标**（用户 2026-10-29 定案）：不在编辑器里弹菜单，只把「点了哪颗标签、
     * 图标在屏幕上的矩形」交给调用方 —— 由底栏在外部用 Dropdown 打开菜单。
     * 点右侧文字仍走下面的默认行为（1s 后光标落到标签后）。
     *
     * ⚠️ 这里必须**先判图标位置**：上一版把「有替换回调」当成整颗标签都可点，
     * 结果点右侧文字也会弹菜单（用户 2026-10-29 明确要求文字走默认行为）。
     */
    if ((item?.onIconClick || item?.onReplaceClick) && clickInsideChipIcon(el, e)) {
      // 菜单要开了：把还在等的「落光标」取消掉，否则 1s 后光标会跳走、菜单跟着闪
      if (chipClickTimer) { clearTimeout(chipClickTimer); chipClickTimer = null }
      /**
       * 锚点用**整颗标签**的矩形，不是图标格：
       * 图标格在标签内部（上下各留了内边距），拿它当锚点时，菜单翻到上方会压住标签本体。
       * 命中判定仍只看图标格（见上），定位则跟着标签走 —— 用户口径是「菜单在标签正下方/正上方」。
       */
      const box = el.getBoundingClientRect()
      const anchor = { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height }
      if (item.onIconClick) item.onIconClick(item, anchor)
      else item.onReplaceClick?.(item)
      return
    }
    /**
     * 点标签：**先**保持 ProseMirror 默认的节点选中（NodeSelection，视觉上整颗高亮），
     * 1s 后再把光标落到标签**之后**（用户口径 2026-10-27 / 2026-10-29 复述）。
     *
     * 为什么延后：直接跳光标会让人看不到"这一下点中了什么"；先选中再落光标，
     * 既确认了点击对象，又能让用户紧接着在标签后面打字（默认落点在标签之前）。
     *
     * ⚠️ 这里会进入「等落光标」状态（pendingChipCaret）。这 1 秒里**绝不能有任何事务
     * 重建这颗标签节点**（setNodeMarkup / 改 attrs）：atom 节点一重建，整颗选中就没了，
     * 浏览器把光标就近放到标签前面、计时器再挪到后面 —— 视觉上就是闪两下。
     * 2026-10-27 修过一次（让 chipAttrsNeedUpdate 在内容没变时不写文档），
     * 2026-11-08 因为把序号塞进节点属性又踩了一次，所以这里再钉一遍。
     */
    if (view) {
      const pos = view.posAtDOM(el, 0)
      const node = view.state.doc.nodeAt(pos)
      if (node && isAtomNode(node.type.name)) {
        const after = pos + node.nodeSize
        pendingChipCaret = { from: pos }
        if (chipClickTimer) clearTimeout(chipClickTimer)
        chipClickTimer = setTimeout(() => {
          chipClickTimer = null
          pendingChipCaret = null
          if (!view) return
          try {
            view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, after)))
          } catch {
            /* 文档已变（用户又点了别处/删了标签）：忽略 */
          }
        }, CHIP_CARET_DELAY)
      }
    }
    if (item?.onClick) { item.onClick(item); return }
  }

  // 存储资源节点图片的取消加载函数
  const resourceCleanupMap = new WeakMap<HTMLImageElement, () => void>();

  // 绑定 atom 节点事件（资源和变量）
  function bindResourceEvents() {
    /**
     * hover 预览跟着标签的**存在**走（用户 2026-10-29：图片节点删了、hover 还显示旧图）。
     *
     * 根因：ProseMirror 刷新标签时整个 DOM 元素被替换，旧元素直接移除 ——
     * 浏览器不会给被移除的元素补 mouseleave，于是预览框一直留在屏幕上。
     * 这里每次（DOM 变化后）按 id 回查：标签已经不在了就立刻收掉。
     */
    if (previewChipId) {
      const still = Array.from(document.querySelectorAll('.resource-chip'))
        .some((n) => (n as HTMLElement).getAttribute('data-id') === previewChipId)
      if (!still) hideResourcePreview()
    }
    // 查询所有 atom 节点
    const selector = ".resource-node";
    const atomNodes = document.querySelectorAll(selector);

    atomNodes.forEach((node) => {
      const el = node as HTMLElement;

      // 菜单开着时这颗标签要固定显示铅笔（DOM 重建后也要补回来）
      applyChipEditingState(el);

      /**
       * hover 状态由 JS 打类，不依赖 CSS 的 :hover（用户 2026-11-07 反复报「就是不亮」）。
       *
       * 为什么：标签 DOM 会被 ProseMirror 整颗重建，重建后的元素上 :hover 规则要么不命中，
       * 要么被别的样式层按优先级压掉 —— 用户看到的就是「hover 有预览、图标却不变」。
       * 现在进入/离开标签时直接 toggle 两个类，样式按类写，行为可预测、也能被单测覆盖：
       *   · resource-chip--hot      → 整颗 hover：藏缩略图、露铅笔
       *   · resource-chip--icon-hot → 指针在图标格：铅笔从灰加深
       */
      el.onmouseenter = () => {
        el.classList.add('resource-chip--hot')
        handleResourceMouseEnter(el)
      };
      el.onmouseleave = () => {
        el.classList.remove('resource-chip--hot')
        el.classList.remove('resource-chip--icon-hot')
        handleResourceMouseLeave(el)
      };
      const iconEl = el.querySelector('.resource-chip-icon') as HTMLElement | null
      if (iconEl) {
        iconEl.onmouseenter = () => el.classList.add('resource-chip--icon-hot')
        iconEl.onmouseleave = () => el.classList.remove('resource-chip--icon-hot')
      }
      el.onclick = (event: MouseEvent) => {
        handleResourceClick(el, event);
      };

      // 处理缩略图加载
      const img = el.querySelector("img");
      /**
       * 参考标签（resource-chip）走**自己的**加载状态（用户 2026-10-29）：
       * 图标垫底，图片加载成功才显示；加载中图标位转圈，失败保持图标。
       * 不能用 loadImageWithThumbnail —— 它会覆盖 onerror 并把失败的图 display:none，
       * 把我们的图标重置回未覆盖状态（表现就是「加载完左边忽然空了」）。
       */
      if (img && el.classList.contains('resource-chip')) {
        attachChipThumbState(el)
      } else if (img) {
        const assetUrl = el.getAttribute("data-url") || "";
        const assetName = el.getAttribute("data-name") || "";
        const assetId = el.getAttribute("data-id") || "";

        // 清理之前的加载
        const oldCleanup = resourceCleanupMap.get(img);
        if (oldCleanup) oldCleanup();

        // 使用新的加载方式
        const resourceItem: ResourceItem = {
          id: assetId,
          url: assetUrl,
          name: assetName,
          category: el.getAttribute("data-category") || "resource",
        };
        const cleanup = loadImageWithThumbnail(img, resourceItem, true);
        resourceCleanupMap.set(img, cleanup);
      }
    });
  }

  // 键盘上移
  function moveUp() {
    if (!menuVisible.value) return false
    const total = filteredItems.value.length
    if (total === 0) return false
    activeIndex.value = (activeIndex.value - 1 + total) % total
    return true
  }

  // 键盘下移
  function moveDown() {
    if (!menuVisible.value) return false
    const total = filteredItems.value.length
    if (total === 0) return false
    activeIndex.value = (activeIndex.value + 1) % total
    return true
  }

  // 键盘确认
  function handleEnter() {
    if (menuVisible.value) {
      const item = filteredItems.value[activeIndex.value]
      if (item) {
        insertSelectedItem(item)
        return true
      }
    }
    return false
  }

  // 初始化编辑器
  onMounted(() => {
    if (!editorRef.value) return;

    const mentionKeymap = keymap({
      // 光标停在标签（atom）后面/前面时，退格与删除要真的把标签拿掉。
      // 为什么必须排在 baseKeymap 之前：标签两侧垫了看不见的零宽空格（见 createCursorFixPlugin），
      // 原生命令只会先啃掉那个垫片，用户看到的是「按了没反应」。
      Backspace: deleteAtomBackward,
      Delete: deleteAtomForward,
      ArrowUp: () => moveUp(),
      ArrowDown: () => moveDown(),
      Enter: () => handleEnter(),
      "Shift-Enter": (state, dispatch) => {
        const hardBreak = state.schema.nodes.hard_break;
        if (!hardBreak) return false;
        if (dispatch) {
          dispatch(state.tr.replaceSelectionWith(hardBreak.create()).scrollIntoView());
        }
        return true;
      },
      Escape: () => {
        if (!menuVisible.value) return false;
        hideMenu();
        return true;
      },
      "Mod-z": () => {
        if (menuVisible.value) return false;
        return undo(view?.state || ({} as any), view?.dispatch);
      },
      "Mod-y": () => {
        if (menuVisible.value) return false;
        return redo(view?.state || ({} as any), view?.dispatch);
      },
      "Mod-Shift-z": () => {
        if (menuVisible.value) return false;
        return redo(view?.state || ({} as any), view?.dispatch);
      },
    });

    const promptDocJson = unref(props.promptDoc);
    /**
     * 冷启动恢复前先按 doc JSON 把槽位标签的样式登记进注册表。
     *
     * 为什么必须在这一步：节点的 toDOM 渲染时要去注册表取 item（决定 chip 外观）。
     * 底栏刚打开时注册表还是空的，标签就会退化成默认渲染 —— 用户看到的就是
     * 「重开底栏后标签变成 @图片1 这种文本」（2026-10-27 报的那个）。
     */
    registerSlotItemsFromDoc(promptDocJson);
    let paragraphs: any[];
    if (promptDocJson) {
      // 优先用 JSON 恢复完整文档结构
      try {
        const doc = mySchema.nodeFromJSON(promptDocJson)
        paragraphs = []
        doc.forEach(child => paragraphs.push(child))
      } catch {
        // JSON 恢复失败，降级到文本解析
        const initialValue = unref(props.modelValue)
        paragraphs = initialValue
          ? initialValue.split('\n').map(line => {
              const content = parsePlainTextToContent(line, unref(props.resolveResource), unref(props.resources))
              return mySchema.node("paragraph", null, content.length > 0 ? content : undefined)
            })
          : [mySchema.node("paragraph")]
      }
    } else {
      const initialValue = unref(props.modelValue)
      paragraphs = initialValue
        ? initialValue.split('\n').map(line => {
            const content = parsePlainTextToContent(line, unref(props.resolveResource), unref(props.resources))
            return mySchema.node("paragraph", null, content.length > 0 ? content : undefined)
          })
        : [mySchema.node("paragraph")]
    }
    const state = EditorState.create({
      schema: mySchema,
      doc: mySchema.node("doc", null, paragraphs),
      plugins: [
        history(),
        mentionKeymap,
        createSelectionDecorationPlugin(),
        createPasteHandlerPlugin(
          () => unref(props.resolveResource),
          () => unref(props.onPasteFiles),
        ),
        createCursorFixPlugin(),
        createDropCursorPlugin({ color: "#2b6df2", width: 2 }),
        keymap(baseKeymap),
      ],
    });

    view = new EditorView(editorRef.value, {
      state,
      /**
       * 记录「纯文本粘贴」意图（用户 2026-10-28 规范）。
       *
       * Ctrl/Cmd+Shift+V 与 Ctrl+V 的剪贴板内容完全一样，区别只在按了什么键；
       * paste 事件本身不带这个信息，所以在 keydown 时先记一笔，paste 时消费。
       */
      handleDOMEvents: {
        keydown: (_view, event) => {
          const e = event as KeyboardEvent
          if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'v' || e.key === 'V')) {
            markPlainTextPaste()
          }
          return false
        },
      },
      // 缺省可编辑；props.editable === false 时只读（contenteditable 移除、输入全禁）
      editable: () => unref(props.editable) !== false,
      dispatchTransaction(transaction) {
        if (!view) return;
        /**
         * 点标签后的 1 秒里，浏览器会先给一个「紧贴标签前面」的原生光标，
         * ProseMirror 读到会派发一条只改选区的事务 —— 用户看到光标先跳到标签前、
         * 再被计时器挪到后面，闪两下，标签还会在中途丢选中。
         *
         * ⚠️ 这一段必须排在 apply 之前（旧代码把它整个删过，问题就复发了）。
         * 判定写得很窄，只吞「等待落光标 + 当前是这颗标签的整颗选中 + 新选区紧贴标签前」
         * 这一种；用户点别处、或真的改了文档，都照常应用。
         * 详见 isChipCaretNoise 的注释。
         */
        if (isChipCaretNoise(transaction, pendingChipCaret, view.state.selection)) return;
        const newState = view.state.apply(transaction);
        view.updateState(newState);

        if (view.hasFocus()) {
          lastFocusedSelection = { from: newState.selection.from, to: newState.selection.to }
        }

        emit("update:modelValue", getPlainText());
        emit("update:promptDoc", serializeDoc());

        const sel = newState.selection;
        if (sel.empty && (sel as any).$cursor) {
          const $cursor = (sel as any).$cursor;
          const nodeBefore = $cursor.nodeBefore;
          if (nodeBefore && nodeBefore.isText) {
            const textBefore = nodeBefore.text;
            if (textBefore && textBefore.endsWith("@")) {
              mentionQuery.value = "";
              const coords = view.coordsAtPos(sel.from);
              const allItems = unref(props.resources) || [];
              filteredItems.value = filterMentionItems(allItems, "");
              if (filteredItems.value.length > 0) {
                showMenu({ left: coords.left, top: coords.top, bottom: coords.bottom, right: coords.right });
              }
            } else if (textBefore) {
              const atIndex = textBefore.lastIndexOf("@");
              if (atIndex !== -1) {
                mentionQuery.value = textBefore.slice(atIndex + 1);
                const coords = view.coordsAtPos(sel.from);
                const allItems = unref(props.resources) || [];
                if (allItems.length > 0) {
                  filteredItems.value = filterMentionItems(allItems, mentionQuery.value);
                  if (filteredItems.value.length > 0) {
                    showMenu({ left: coords.left, top: coords.top, bottom: coords.bottom, right: coords.right });
                  } else {
                    hideMenu();
                  }
                } else {
                  hideMenu();
                }
              } else {
                hideMenu();
              }
            } else {
              hideMenu();
            }
          } else {
            hideMenu();
          }
        } else {
          hideMenu();
        }
      },
      clipboardTextSerializer: (slice) => clipboardTextOf(slice),
    });

    // 监听 DOM 变化
    mutationObserver = new MutationObserver(() => {
      bindResourceEvents();
    });

    mutationObserver.observe(editorRef.value, {
      childList: true,
      subtree: true,
    });

    bindResourceEvents();
  });

  onUnmounted(() => {
    if (mutationObserver) {
      mutationObserver.disconnect();
    }
    if (hoverTimer) {
      clearTimeout(hoverTimer);
    }
    if (chipClickTimer) {
      clearTimeout(chipClickTimer);
      chipClickTimer = null;
    }
    if (view) {
      view.destroy();
    }
  });

  // 监听外部 modelValue / promptDoc 变化
  // promptDoc 仅在文本不匹配时用于 JSON 恢复（避免破坏正常编辑流程）
  watch(
    () => [unref(props.modelValue), unref(props.promptDoc)] as const,
    ([newModelValue, newPromptDoc]) => {
      if (!view) return

      // 正常编辑流程：文本匹配则跳过
      if (getPlainText() === newModelValue) return

      // 文本不匹配（外部变更），优先用 JSON 完整恢复
      if (newPromptDoc) {
        deserializeDoc(newPromptDoc)
        return
      }
      /**
       * 再一道保护（用户 2026-10-27 报「重开底栏后标签变回文字」）：
       * 没有富文本快照、且纯文本看起来一样时**别重建**。
       * 标签导出成纯文本仍是 @图片1，两边相等；按文本重建会把它当普通文字，
       * 把刚恢复好的标签节点冲掉。
       */
      if ((newModelValue ?? '') === getPlainText()) return

      // 降级：纯文本恢复（无 promptDoc 的向后兼容路径）
      //
      // 为什么不再「先 delete 再 insert(tr.doc.content.size)」：删除后 `tr.doc.content.size` 变成 0，
      // 后续每次 insert 又让 size 长大，于是段落被插到不断变化的位置上 —— 实测第一个空段落
      // 会残留在开头，表现为「外部设值后文本前面多一个空行」。
      // 改成一次 replaceWith(0, 当前 doc 全长, 新内容)：原子替换，不留残段。
      const originalSize = view.state.doc.content.size;
      const lines = (newModelValue ?? '').split('\n')
      const paragraphs = lines.map((line) => {
        const content = parsePlainTextToContent(line, unref(props.resolveResource), unref(props.resources))
        return mySchema.node('paragraph', null, content.length > 0 ? content : undefined)
      })
      const doc = mySchema.node('doc', null, paragraphs.length ? paragraphs : [mySchema.node('paragraph')])
      view.dispatch(view.state.tr.replaceWith(0, originalSize, doc.content))
    },
  );

  // 监听 resources 变化，更新过滤列表
  /**
   * 编辑中状态外部变了（AI 生成开始/结束）→ 同步 ProseMirror 的 contenteditable。
   * 为什么不能用别的方式：ProseMirror 自己管 DOM，外部只能走 view.editable 布尔位。
   */
  watch(
    () => unref(props.editable),
    (next) => {
      if (view) view.editable = next !== false
    },
  );
  watch(
    () => unref(props.resources),
    (newResources) => {
      if (menuVisible.value && newResources) {
        filteredItems.value = filterMentionItems(newResources, mentionQuery.value)
      }
    },
    { deep: true },
  );

  function focusEnd() {
    if (!view) return
    const { state } = view
    const selection = Selection.atEnd(state.doc)
    if (selection) {
      view.dispatch(state.tr.setSelection(selection))
    }
    view.focus()
  }

  /**
   * 在**当前光标**处插入纯文本（没有光标就落到文末）。
   *
   * 底栏最左侧的「@」按钮用它：插进去的 @ 会走编辑器自己的 dispatchTransaction，
   * 于是 @ 下拉菜单自然弹出来，不需要底栏再认识菜单的实现。
   */
  function insertText(text: string) {
    if (!view || !text) return
    const { state } = view
    const { selection } = state
    const fallback = Selection.atEnd(state.doc)
    let from = lastFocusedSelection?.from ?? fallback.from
    let to = lastFocusedSelection?.to ?? fallback.to
    if (view.hasFocus()) {
      from = selection.from
      to = selection.to
    }
    // 整颗标签被选中时，插在它后面（替换掉用户没打算删的标签会很意外）
    if (selection instanceof NodeSelection) {
      from = selection.to
      to = selection.to
    }
    // 位置可能已失效（文档被别的操作改短）：退回文末，别让按钮点下去没反应
    from = Math.min(Math.max(from, 0), state.doc.content.size)
    to = Math.min(Math.max(to, 0), state.doc.content.size)
    if (from > to) [from, to] = [to, from]
    /**
     * 插入后必须**显式**把选区放到插入内容之后（用户 2026-11-06 实测）。
     *
     * 只调 insertText 时，ProseMirror 会保留原来那个 selection 再映射位置；
     * 从「没有光标（落在文末）」这一路进来时，映射后浏览器把 DOM 选区放回了
     * contenteditable 开头 —— 文字确实加在末尾，光标却在最前面，@ 菜单看不到 @，
     * 于是根本不弹。这里直接 setSelection 到 from + text.length，光标必然跟着字符走。
     */
    const insertAt = (start: number, end: number) => {
      const tr = state.tr.insertText(text, start, end).scrollIntoView()
      try {
        tr.setSelection(TextSelection.create(tr.doc, Math.min(start + text.length, tr.doc.content.size)))
      } catch {
        /* 位置落在非文本节点上：保留默认映射，至少文字不会丢 */
      }
      view?.dispatch(tr)
    }
    try {
      insertAt(from, to)
    } catch {
      insertAt(fallback.from, fallback.to)
    }
    view.focus()
  }

  /**
   * 用代码往输入框里插入一个资源**标签**（图片/技能/MCP 那种内联 chip），
   * 等价于用户在 @ 菜单里点了一项。
   *
   * 供「工具栏下拉直接插入」的场景使用（如 Agent 面板点技能列表就插一个标签，
   * 而不是切换一个开关）。标签的 DOM 由该 item 的 renderEditor 决定；
   * 插入前把 item 登记进 registry —— toDOM 是异步渲染的，登记晚了标签会退化成
   * 默认样式（实测：不登记就渲染不出图标/自定义外观）。
   */
  function insertResource(item: ResourceItem) {
    if (!view) return
    const nodeType = mySchema.nodes.resource
    if (!nodeType) return
    /**
     * 先登记一次（后面按落进文档的 id 再对齐，保证 toDOM 查得到）。
     *
     * **合并已有条目**，不要直接覆盖：调用方往往先 registerItem 了完整条目
     * （带 onIconClick / hoverPreview / renderEditor），再调这里插入。
     * 直接 set(item) 会把那些回调全冲掉 —— 真机表现就是「标签插进来后左侧图标点不动、
     * hover 也不换编辑图标」。item 里显式给了的字段仍然优先（新名字/新图要生效）。
     */
    const prevItem = itemRegistry.get(item.id)
    itemRegistry.set(item.id, prevItem ? { ...prevItem, ...item } : item)
    // 光标不在编辑器里（用户刚点了工具栏按钮）时，退到文末再插：
    // 否则会插到旧的 selection 位置，甚至因为 selection 失效而插错地方。
    if (!view.hasFocus()) {
      const end = Selection.atEnd(view.state.doc)
      if (end) view.dispatch(view.state.tr.setSelection(end))
    }
    const { from, to } = view.state.selection
    const node = buildResourceNode(nodeType, item)
    const actualId = String(node.attrs?.id ?? item.id)
    if (actualId !== item.id) itemRegistry.set(actualId, { ...item, id: actualId })
    const tr = view.state.tr.replaceWith(from, to, node)
    tr.insertText(' ')
    view.dispatch(tr)
    emit('resource-insert', item)
    view.focus()
  }

  function replaceResource(item: ResourceItem): boolean {
    return replaceResourceInDoc(view, item)
  }

  function replaceResourceThumbByName(name: string, url: string): boolean {
    return replaceResourceThumbByNameInDoc(view, name, url)
  }

  function replaceResourceThumbByIds(ids: readonly string[], url: string): boolean {
    return replaceResourceThumbByIdsInDoc(view, ids, url)
  }

  function refreshChips(): void {
    refreshChipsInDoc(view)
  }

  /**
   * 按标签 id **删除**正文里的参考标签（用户 2026-10-29：「清理失效」按钮用）。
   *
   * 为什么要这个入口：失效标签的清理必须**只动用户点名的那几颗**，
   * 不能整段重写（会把用户的正文排版、光标、别的标签一起弄乱）。
   * 找到几颗删几颗；找不到 → false，调用方据此跳过落盘。
   *
   * @returns 是否真的删掉了东西（true = 文档改了，调用方要同步 modelValue/promptDoc）
   */
  function removeRefChips(ids: readonly string[]): boolean {
    if (!view) return false
    const set = new Set(ids.filter(Boolean))
    if (set.size === 0) return false
    const hits: Array<{ from: number; to: number }> = []
    view.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'resource') return
      if (!set.has(String(node.attrs.id ?? ''))) return
      hits.push({ from: pos, to: pos + node.nodeSize })
    })
    if (hits.length === 0) return false
    const tr = view.state.tr
    // 从后往前删：前面的位置不受影响
    for (const h of hits.sort((a, b) => b.from - a.from)) tr.delete(h.from, h.to)
    view.dispatch(tr)
    emit('update:modelValue', getPlainText())
    emit('update:promptDoc', serializeDoc())
    return true
  }

  /**
   * 用纯文本整体覆盖编辑器内容（覆盖式，非追加）。


  /**
   * 用纯文本整体覆盖编辑器内容（覆盖式，非追加）。
   * 供「模板选择」等外部场景直接替换输入框文字使用；
   * 会同步 @ 资源节点解析与 update:modelValue。
   */
  function setText(text: string) {
    if (!view) return
    const trimmed = text ?? ''
    const paragraphs = trimmed.split('\n').map((line) => {
      const content = parsePlainTextToContent(line, unref(props.resolveResource), unref(props.resources))
      return mySchema.node('paragraph', null, content.length > 0 ? content : undefined)
    })
    const doc = mySchema.node('doc', null, paragraphs.length > 0 ? paragraphs : [mySchema.node('paragraph')])
    view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content))
    emit('update:modelValue', getPlainText())
    emit('update:promptDoc', doc.toJSON())
  }

  /**
   * 把正文里的 @图片N / @视频N / @音频N / @音视频N **文字** 转成素材标签（用户口径 2026-10-27）。
   *
   * 为什么改成手动触发：以前编辑器自动扫（每敲一个字都可能命中），于是
   * 「输入 @图片1 时数字还没敲完就被转成标签、菜单闪没」，而且这些标签不落富文本，
   * 底栏一重挂载就退回成纯文字。
   *
   * 现在的规则（用户口述）：
   *   - 输入框里的文字永远只是文字，@ 符号本身不解析；
   *   - 只有点「标记」按钮，才把认得出的 @图片N 转成标签；
   *   - 转好的标签是富文本节点，会跟着 promptDoc 一起存，重开底栏不会再退回文字。
   *
   * @returns 转了几个（0 = 没有可转换的文字）
   */
  function markRefSlots(): number {
    if (!view) return 0
    const nodeType = mySchema.nodes.resource
    if (!nodeType) return 0
    /**
     * 识别规则优先用外部注册的 tagSpec（用户 2026-10-27：标签实现交给插件）。
     * 没注册时退回组件内置的「@图片N / @视频N / @音频N」规则，保证老调用方不受影响。
     */
    const spec = activeTagSpec
    const hits: Array<{ start: number; len: number; item: ResourceItem }> = []
    view.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'paragraph' || !node.isTextblock) return
      node.forEach((child, offset) => {
        if (!child.isText || !child.text) return
        const text = child.text
        const matches = spec
          ? spec.scan(text)
          : builtinScan(text)
        for (const m of matches) {
          if (m.to <= m.from) continue
          hits.push({ start: pos + 1 + offset + m.from, len: m.to - m.from, item: m.item })
        }
      })
    })
    if (hits.length === 0) return 0
    /**
     * 不再做「按类型重编号」（用户 2026-10-28 定案：标签认节点 / 认名称，序号只做观察）。
     *
     * 以前这里把 `@图片1 @图片100 @图片10` 归一化成 1,2,3 并改写成 `ref-slot:*`；
     * 现在标签身份由调用方的 scan 直接给出（ref-node:<id> 或 ref-name:<名>），
     * 编辑器只负责替换，不改身份、不改名字。
     */
    const tr = view.state.tr
    for (const h of hits.sort((a, b) => b.start - a.start)) {
      itemRegistry.set(h.item.id, h.item)
      tr.replaceWith(h.start, h.start + h.len, buildResourceNode(nodeType, h.item))
    }
    view.dispatch(tr)
    emit('update:modelValue', getPlainText())
    emit('update:promptDoc', serializeDoc())
    return hits.length
  }

  return {
    // 菜单
    menuVisible, menuPosition, activeIndex,
    filteredItems,
    groupedItems,
    categoryOrder,
    insertSelectedItem,
    reflowMenu,
    // 预览
    previewVisible,
    previewUrl,
    previewTitle,
    previewType,
    previewPosition,
    // 导出方法
    exportText,
    /** 正文是否为空（占位符判断用） */
    isEmpty,
    serializeDoc,
    deserializeDoc,
    focusEnd,
    insertText,
    setText,
    /** 把正文里的 @图片N 文字转成素材标签（底栏「标记」按钮调用） */
    markRefSlots,
    insertResource,
    replaceResource,
    replaceResourceThumbByName,
    replaceResourceThumbByIds,
    refreshChips,
    /** 按标签 id 删除参考标签（「清理失效」用） */
    removeRefChips,
    /**
     * 动态切换可编辑态（AI 生成开始 = false，结束 = true）。
     * 与 props.editable 双通道：prop 管声明式场景，这个方法管命令式场景；内部同一个布尔位。
     */
    setEditable(next: boolean) {
      if (view) view.editable = next
      if (props.editable && 'value' in props.editable) {
        (props.editable as { value: boolean }).value = next
      }
    },
  };
}
