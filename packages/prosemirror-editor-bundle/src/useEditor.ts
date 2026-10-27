import { ref, computed, onMounted, onUnmounted, watch, type Ref, unref } from "vue";
import { Schema, type Node as PMNode, type ResolvedPos } from "prosemirror-model";
import { EditorState, Plugin, PluginKey, Selection, TextSelection, type Transaction } from "prosemirror-state";
import { EditorView, Decoration, DecorationSet } from "prosemirror-view";
import { schema as baseSchema } from "prosemirror-schema-basic";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { history, undo, redo } from "prosemirror-history";
import type { MenuPosition, ResourceItem } from "./types";
import { isVideoUrl, getThumbnailUrlFromAssetUrl, loadImageWithThumbnail } from "./utils";
import { encodeNodeRef, formatReferenceMarkup, REF_ICONS } from "./referenceMarkup";
import { filterMentionItems } from "./mentionFilter";

// 拖拽参考线插件配置
interface DropCursorOptions {
  color?: string;
  width?: number;
  class?: string;
}

// 创建拖拽参考线插件
function createDropCursorPlugin(options: DropCursorOptions = {}) {
  const { color = "#2b6df2", width = 2, class: className = "drop-cursor" } = options;

  let dropElement: HTMLDivElement | null = null;
  let currentPos: number | null = null;

  function createDropElement(): HTMLDivElement {
    const el = document.createElement("div");
    el.className = className;
    el.style.cssText = `
      position: absolute;
      background-color: ${color};
      pointer-events: none;
      z-index: 1000;
      transition: opacity 0.15s ease;
    `;
    el.style.display = "none";
    return el;
  }

  function showCursor(view: EditorView, pos: number, horizontal: boolean) {
    if (!dropElement) {
      dropElement = createDropElement();
      document.body.appendChild(dropElement);
    }

    if (currentPos === pos) return;
    currentPos = pos;

    const coords = view.coordsAtPos(pos);
    const editorRect = view.dom.getBoundingClientRect();

    if (horizontal) {
      // 横向参考线（用于块级元素或行间插入）
      dropElement.style.width = `${editorRect.width}px`;
      dropElement.style.height = `${width}px`;
      dropElement.style.left = `${editorRect.left + window.scrollX}px`;
      dropElement.style.top = `${coords.top + window.scrollY - width / 2}px`;
    } else {
      // 竖向参考线（用于行内插入位置）
      dropElement.style.width = `${width}px`;
      dropElement.style.height = `${coords.bottom - coords.top}px`;
      dropElement.style.left = `${coords.left + window.scrollX - width / 2}px`;
      dropElement.style.top = `${coords.top + window.scrollY}px`;
    }

    dropElement.style.display = "block";
  }

  function hideCursor() {
    if (dropElement) {
      dropElement.style.display = "none";
    }
    currentPos = null;
  }

  function destroyCursor() {
    if (dropElement && dropElement.parentNode) {
      dropElement.parentNode.removeChild(dropElement);
    }
    dropElement = null;
  }

  return new Plugin({
    key: new PluginKey("drop-cursor"),
    view(editorView) {
      const view = editorView;

      function handleDragover(event: DragEvent) {
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });

        if (pos) {
          // 判断是行内还是块级位置
          const $pos = view.state.doc.resolve(pos.pos);
          const isInlinePosition = $pos.parent.inlineContent;

          showCursor(view, pos.pos, !isInlinePosition);
          event.preventDefault();
        } else {
          hideCursor();
        }
      }

      function handleDragleave() {
        hideCursor();
      }

      function handleDrop() {
        hideCursor();
      }

      function handleDragend() {
        hideCursor();
      }

      function handleDragstart(event: DragEvent) {
        // 设置拖拽图像，让元素左上角对齐鼠标位置
        if (event.dataTransfer && event.target) {
          const target = event.target as HTMLElement;
          // 设置偏移为 (0, 0)，使元素左上角对齐鼠标
          event.dataTransfer.setDragImage(target, 0, 0);
        }
      }

      view.dom.addEventListener("dragover", handleDragover as any);
      view.dom.addEventListener("dragleave", handleDragleave);
      view.dom.addEventListener("drop", handleDrop);
      view.dom.addEventListener("dragstart", handleDragstart as any);
      document.addEventListener("dragend", handleDragend);

      return {
        destroy() {
          view.dom.removeEventListener("dragover", handleDragover as any);
          view.dom.removeEventListener("dragleave", handleDragleave);
          view.dom.removeEventListener("drop", handleDrop);
          view.dom.removeEventListener("dragstart", handleDragstart as any);
          document.removeEventListener("dragend", handleDragend);
          destroyCursor();
        },
      };
    },
  });
}



// 检查节点是否是 atom 节点
function isAtomNode(nodeType: string): boolean {
  return nodeType === "resource";
}

/**
 * 垫片判定：这段文字里**只有**零宽空格才算垫片（空串也算）。
 * 垫片可能与真实文字并在一个文本节点里（`"\u200Babc"`），所以只认「剥掉零宽空格后为空」。
 */
function isSpacerChars(text: string | undefined): boolean {
  return (text ?? "").replace(/\u200B/g, "") === "";
}

/**
 * 退格：光标跟在标签（atom 节点）后面时，把标签删掉。
 *
 * 为什么需要它（用户 2026-10-11 报，附截图）：光标停在标签后面按退格「没有任何反应」，
 * 得先用左键选中标签才能删。根因是 createCursorFixPlugin 在标签两侧垫了零宽空格：
 *   ① 退格先删掉那个**看不见的**垫片 —— 用户看不到任何变化；
 *   ② 垫片一没，插件下一帧立刻又补回来（它按「标签在行尾 / 相邻」判断）；
 *   ③ 于是表现为「按了没反应」，标签始终不动。
 * 这里显式接管「光标与标签之间只有垫片」的情形：连垫片带标签一起删。
 * 中间还有真实文字时不接管 —— 那时用户要删的正是那些字。
 */
export function deleteAtomBackward(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const { $head, empty } = state.selection
  if (!empty) return false
  const hit = atomBeforeCaret($head)
  if (!hit) return false
  if (dispatch) {
    const start = $head.start()
    // 从「标签左边那截垫片」一路删到光标：标签、它两侧的垫片一起清干净。
    // 只删到标签左边、留着垫片的话，那截看不见的垫片就是下一次「按了没反应」的元凶。
    dispatch(state.tr.delete(start + hit.from, $head.pos).scrollIntoView())
  }
  return true
}

/**
 * 向前删（Delete）：光标在标签（atom 节点）前面时，把标签删掉。
 * 与 deleteAtomBackward 对称，理由相同 —— 否则一次删除只啃掉看不见的垫片。
 */
export function deleteAtomForward(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const { $head, empty } = state.selection
  if (!empty) return false
  const hit = atomAfterCaret($head)
  if (!hit) return false
  if (dispatch) {
    const start = $head.start()
    dispatch(state.tr.delete($head.pos, start + hit.to).scrollIntoView())
  }
  return true
}

/** 标签（atom 节点）在父块里的内容偏移区间。 */
interface AtomRange {
  from: number
  to: number
}

/**
 * 找光标**前方**那个「与光标之间只隔着垫片」的标签。
 *
 * 为什么不用 `$head.nodeBefore`：光标紧贴标签时它是标签本身，光标落在垫片后面时它是垫片，
 * 光标落在 `"\u200Babc"` 这种混排文本里时它是被切过的文本 —— 三种形态都要认，
 * 只能按父块的孩子逐个往前扫，边扫边要求「除垫片外不许有真实字符」。
 */
function atomBeforeCaret($head: ResolvedPos): AtomRange | null {
  const parent = $head.parent
  if (!parent.isTextblock) return null
  const caret = $head.parentOffset
  const ranges = childRanges(parent)
  // 从光标处往回走：先跨过垫片，碰到的第一个标签就是目标；
  // 碰到真实文字就说明用户要删的是那些字（不是标签），让位给原生命令。
  for (let i = ranges.length - 1; i >= 0; i--) {
    const { child, from, to } = ranges[i]
    if (to > caret) {
      // 光标落在这段中间：只有「左边那一截全是垫片」才算贴在标签后面
      if (child.isText && isSpacerChars((child.text ?? "").slice(0, caret - from))) continue
      return null
    }
    if (child.isText) {
      if (!isSpacerChars(child.text)) return null
      continue
    }
    // 只认标签（resource）；别的行内叶子交给原生命令，不抢它的行为
    if (!isAtomNode(child.type.name)) return null
    // 连同标签左边那截垫片一起删（垫片留着就是下一次「按了没反应」的元凶）
    const prev = i > 0 ? ranges[i - 1] : null
    const from2 = prev && prev.child.isText && isSpacerChars(prev.child.text) ? prev.from : from
    return { from: from2, to }
  }
  return null
}

/** 找光标**后方**那个「与光标之间只隔着垫片」的标签（向前删用，逻辑与上面镜像）。 */
function atomAfterCaret($head: ResolvedPos): AtomRange | null {
  const parent = $head.parent
  if (!parent.isTextblock) return null
  const caret = $head.parentOffset
  const ranges = childRanges(parent)
  for (let i = 0; i < ranges.length; i++) {
    const { child, from, to } = ranges[i]
    if (to <= caret) continue
    if (child.isText) {
      if (!isSpacerChars((child.text ?? "").slice(caret - from))) return null
      continue
    }
    if (!isAtomNode(child.type.name)) return null
    // 连同标签右边那截垫片一起删
    const next = i + 1 < ranges.length ? ranges[i + 1] : null
    const to2 = next && next.child.isText && isSpacerChars(next.child.text) ? next.to : to
    return { from, to: to2 }
  }
  return null
}

/** 父块里每个孩子的内容偏移区间（顺序与 childCount 一致）。 */
function childRanges(parent: PMNode): { child: PMNode; from: number; to: number }[] {
  const out: { child: PMNode; from: number; to: number }[] = []
  let offset = 0
  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i)
    out.push({ child, from: offset, to: offset + child.nodeSize })
    offset += child.nodeSize
  }
  return out
}

// 全局 item 注册表：toDOM 通过 node.attrs.id 查这里获取 ResourceItem（含 renderEditor）
const itemRegistry = new Map<string, ResourceItem>()
/** 供测试读取（回填后标签外观靠它 —— 没有 renderEditor 就退化成 @名字 样式） */
export function registeredItem(id: string): ResourceItem | undefined {
  return itemRegistry.get(id)
}
/**
 * 往编辑器登记/更新一个资源项（toDOM 渲染时按 id 读它拿外观）。
 *
 * 为什么公开：底栏「待输入」标签的内容随**连线**变化（上传/替换/断开），
 * 调用方在内容变化后把最新 item 登记进来、再调 refreshChips()，
 * 两步合起来才能把正文里的虚线标签刷成实线（换名字/缩略图）。
 */
export function registerItem(item: ResourceItem): void {
  itemRegistry.set(item.id, item)
}

// Schema 定义
const mySchema = new Schema({
  nodes: baseSchema.spec.nodes.append({
    resource: {
      attrs: {
        id: {},
        name: {},
        category: { default: 'resource' },
        url: { default: '' },
        thumbnail_url: { default: '' },
        value: { default: '' },
        // 引用标记（技能 / MCP / 节点）：纯文本导出时还原成 `@[kind:name](value)`。
        // 只有这三类引用带它；图片/视频素材标签留空，仍旧导出 `@名字`。
        refKind: { default: '' },
        refValue: { default: '' },
        // 资产引用专用（见 referenceMarkup.ts）：
        //   refExt      扩展名（png / mp4 / mp3…）—— 点标签预览时靠它决定用哪个预览器；
        //   refFolderId 资产库文件夹 id —— 点文件夹标签时靠它定位到资产管理的那一层。
        // 必须存成节点属性：导出（getPlainText / 复制）要原样写回标记，靠 itemRegistry 会丢
        // （回填出来的最小 item 没有这两个字段）。
        refExt: { default: '' },
        refFolderId: { default: '' },
      },
      group: "inline",
      inline: true,
      selectable: true,
      draggable: true,
      atom: true,
      toDOM: (node) => {
        const item = itemRegistry.get(node.attrs.id)
        if (item?.renderEditor) {
          const result = item.renderEditor(item)
          if (result instanceof HTMLElement) {
            result.classList.add("resource-node")
            result.setAttribute("data-id", node.attrs.id)
            result.setAttribute("data-url", node.attrs.url || "")
            result.setAttribute("data-name", node.attrs.name || "")
            result.setAttribute("data-category", node.attrs.category || "")
            result.setAttribute("data-ref-kind", node.attrs.refKind || "")
            result.setAttribute("data-ref-value", node.attrs.refValue || "")
            result.setAttribute("data-ref-ext", node.attrs.refExt || "")
            result.setAttribute("data-ref-folder", node.attrs.refFolderId || "")
            return result
          }
          return result  // DOMOutputSpec 数组，直接透传
        }
        // 默认渲染
        const { id, name, url, thumbnail_url, category } = node.attrs
        if (url) {
          const thumbUrl = thumbnail_url || getThumbnailUrlFromAssetUrl(url)
          return [
            "span",
            { class: "resource-node", "data-id": id, "data-url": url, "data-name": name, "data-category": category },
            ["img", { src: thumbUrl || url, draggable: "false", class: "object-cover" }],
            ["span", { class: "label" }, name],
          ]
        }
        return [
          "span",
          { class: "resource-node resource-node-text", "data-id": id, "data-name": name, "data-value": node.attrs.value, "data-category": category },
          ["span", { class: "label" }, `@${name}`],
        ]
      },
      parseDOM: [{
        tag: "span.resource-node",
        getAttrs: (dom) => {
          const el = dom as HTMLElement
          return {
            id: el.getAttribute("data-id") || "",
            name: el.getAttribute("data-name") || "",
            category: el.getAttribute("data-category") || "resource",
            url: el.getAttribute("data-url") || "",
            thumbnail_url: getThumbnailUrlFromAssetUrl(el.getAttribute("data-url") || ""),
            value: el.getAttribute("data-value") || "",
          }
        },
      }],
    },
  }),
});

// 创建选中装饰插件
function createSelectionDecorationPlugin() {
  return new Plugin({
    key: new PluginKey("selection-decoration"),
    state: {
      init() {
        return DecorationSet.empty;
      },
      apply(tr, set, _oldState, newState) {
        set = set.map(tr.mapping, tr.doc);

        if (tr.selectionSet || tr.docChanged) {
          const { selection, doc } = newState;
          const decorations: Decoration[] = [];

          doc.descendants((node, pos) => {
            if (isAtomNode(node.type.name)) {
              const nodeFrom = pos;
              const nodeTo = pos + node.nodeSize;
              const isInSelection = selection.from <= nodeFrom && selection.to >= nodeTo;
              const isNodeSelection = (selection as any).node && selection.from === nodeFrom;

              if (isInSelection || isNodeSelection) {
                const className = "resource-node-selected";
                decorations.push(
                  Decoration.node(nodeFrom, nodeTo, {
                    class: className,
                  }),
                );
              }
            }
          });

          set = DecorationSet.create(doc, decorations);
        }

        return set;
      },
    },
    props: {
      decorations(state) {
        return this.getState(state);
      },
    },
  });
}

// 创建光标修复插件：在特殊情况下插入零宽空格文本节点
// 只处理：1. 行首/行尾的标签 2. 两个标签相邻的情况
/** 待输入标签的小图标（与底栏槽位同一套线性图标） */
const SLOT_CHIP_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="1.6"/><path d="m21 15-4.5-4.5L6 21"/></svg>'

function createSlotTagPlugin() {
  return new Plugin({
    key: new PluginKey('ref-slot-tag'),
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null
      const tr = newState.tr
      const nodeType = mySchema.nodes.resource
      if (!nodeType) return null
      // 先收集所有命中（含位置），再**从后往前**替换 —— 从前往后会让后面的位置随
      // 前面的替换整体偏移，第二处开始就替换错位（实测：一段里只有第一个 @ 转成了标签）
      const hits: Array<{ start: number; len: number; item: any }> = []
      newState.doc.descendants((node, pos) => {
        if (node.type.name !== 'paragraph' || !node.isTextblock) return
        node.forEach((child, offset) => {
          if (!child.isText || !child.text) return
          const m = /@(图片|视频|音频|音视频|image|video|audio|media|av)\s*(\d{1,4})/i.exec(child.text)
          if (!m) return
          const kind = m[1].toLowerCase()
          const slotKind: 'image' | 'video' | 'audio' | 'av' =
            kind === '图片' || kind === 'image' ? 'image'
            : kind === '视频' || kind === 'video' ? 'video'
            : kind === '音频' || kind === 'audio' ? 'audio'
            : 'av'
          const label =
            slotKind === 'image' ? '图片' : slotKind === 'video' ? '视频' : slotKind === 'audio' ? '音频' : '音视频'
          const index = Number(m[2])
          if (!index) return
          const nodeType = mySchema.nodes.resource
          if (!nodeType) return
          const id = 'ref-slot:' + slotKind + ':' + index
          const item: ResourceItem = {
            id,
            name: label + index,
            category: '素材',
            mediaType: slotKind === 'av' ? undefined : (slotKind as 'image' | 'video' | 'audio'),
          }
          item.renderEditor = (self) => {
            // **渲染时**读注册表：正文标签的内容随连线变化（上传/替换后从待输入变已填），
            // 如果这里读闭包里的旧 item，标签就永远是虚线（实测：上传成功后正文标签不变）
            const latest = itemRegistry.get(self.id) ?? self
            const span = document.createElement('span')
            const isPending = !latest.url
            span.className = 'resource-node resource-chip' + (isPending ? ' is-pending' : '')
            span.dataset.id = self.id
            span.dataset.name = latest.name
            if (latest.url && latest.mediaType === 'image') {
              const img = document.createElement('img')
              img.className = 'resource-chip-thumb'
              img.src = latest.url
              img.alt = ''
              span.append(img)
            } else {
              const ic = document.createElement('span')
              ic.className = 'resource-chip-icon'
              ic.innerHTML = SLOT_CHIP_ICON
              span.append(ic)
            }
            const nm = document.createElement('span')
            nm.className = 'resource-chip-name'
            nm.textContent = latest.name
            span.append(nm)
            return span
          }
          itemRegistry.set(item.id, item)
          const start = pos + 1 + offset + m.index
          hits.push({ start, len: m[0].length, item })
        })
      })
      for (const h of hits.sort((a, b) => b.start - a.start)) {
        tr.replaceWith(h.start, h.start + h.len, buildResourceNode(nodeType, h.item))
      }
      return hits.length ? tr : null
    },
  })
}

function createCursorFixPlugin() {
  return new Plugin({
    key: new PluginKey("cursor-fix"),
    appendTransaction(transactions, _oldState, newState) {
      // 只在文档变化时处理
      if (!transactions.some(tr => tr.docChanged)) {
        return null;
      }

      const tr = newState.tr;
      let modified = false;
      const insertions: { pos: number; text: string }[] = [];

      newState.doc.descendants((node, pos) => {
        if (node.type.name === "paragraph") {
          let currentPos = pos + 1;

          for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            const childEnd = currentPos + child.nodeSize;

            // 使用全局配置检查是否是 atom 节点
            if (isAtomNode(child.type.name)) {
              const prevChild = i > 0 ? node.child(i - 1) : null;
              const nextChild = i < node.childCount - 1 ? node.child(i + 1) : null;

              // 检查前面是否需要插入零宽空格
              // 情况1：标签在行首
              // 情况2：前面是另一个标签
              if (!prevChild) {
                // 行首，直接插入
                insertions.push({ pos: currentPos, text: "\u200B" });
              } else if (isAtomNode(prevChild.type.name)) {
                // 前面是标签，检查中间是否已有零宽空格
                const hasSpacer = prevChild.isText && prevChild.text === "\u200B";
                if (!hasSpacer) {
                  insertions.push({ pos: currentPos, text: "\u200B" });
                }
              }

              // 检查后面是否需要插入零宽空格
              // 情况1：标签在行尾
              // 情况2：后面是另一个标签
              if (!nextChild) {
                // 行尾，直接插入
                insertions.push({ pos: childEnd, text: "\u200B" });
              } else if (isAtomNode(nextChild.type.name)) {
                // 后面是标签，检查中间是否已有零宽空格
                const hasSpacer = nextChild.isText && nextChild.text === "\u200B";
                if (!hasSpacer) {
                  insertions.push({ pos: childEnd, text: "\u200B" });
                }
              }
            }

            currentPos = childEnd;
          }
        }
      });

      // 按位置从后往前插入，避免位置偏移
      if (insertions.length > 0) {
        insertions.sort((a, b) => b.pos - a.pos);
        insertions.forEach(({ pos, text }) => {
          tr.insert(pos, newState.schema.text(text));
          modified = true;
        });
      }

      return modified ? tr : null;
    },
  });
}

// 粘贴处理插件
function createPasteHandlerPlugin(
  getResolver: () => ((name: string) => ResourceItem | null) | undefined,
) {
  return new Plugin({
    key: new PluginKey("paste-handler"),
    props: {
      handlePaste(view, event) {
        const html = event.clipboardData?.getData("text/html");
        if (html && html.includes("resource-node")) {
          return false;
        }

        const text = event.clipboardData?.getData("text/plain");
        if (text && (!html || text.includes('\n'))) {
          const { from, to } = view.state.selection;
          const lines = text.split('\n')
          const resolver = getResolver()
          if (lines.length > 1) {
            const nodes: any[] = []
            for (const line of lines) {
              const content = parsePlainTextToContent(line, resolver)
              nodes.push(view.state.schema.node("paragraph", null, content.length > 0 ? content : undefined))
            }
            const tr = view.state.tr.replaceWith(from, to, nodes);
            view.dispatch(tr);
          } else {
            const content = parsePlainTextToContent(text.trim(), resolver)
            const tr = view.state.tr.replaceWith(from, to, content.length > 0 ? content : view.state.schema.text(''));
            view.dispatch(tr);
          }
          return true;
        }

        return false;
      },
    },
  });
}

// 将纯文本（含 @id 标记）解析为 ProseMirror content 节点数组
// 如果提供了 resolver，尝试将 @id 还原为 resource node；否则全当纯文本
export function parsePlainTextToContent(
  text: string,
  resolver: ((token: string) => ResourceItem | null) | undefined,
  /** 现成资源清单：回填时按名字复用（**它带 renderEditor，标签才是漂亮 chip**）。 */
  resources?: readonly ResourceItem[] | undefined,
): any[] {
  if (!text) return []
  const content: any[] = []
  // 三种形态都认：
  //   ① XML 引用元素 `<ref type=... ... />`（当前格式；字段自带完整信息，不需要 resolver）——
  //      直接建 resource chip，refKind/refValue 从属性取。
  //   ② 旧引用标记 `@[kind:name](value)` —— 兼容旧转录/粘贴内容。
  //   ③ 旧 `@token` —— 按 token 交给 resolver。
  // 用一个组合正则一次扫完，顺序天然保持。
  const regex = /<ref\b[^>]*\/>|@\[([a-zA-Z][a-zA-Z0-9_-]*):([^\]]+)\](?:\(([^)]*)\))?|@(\S+)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    // match 前的纯文本
    if (match.index > lastIndex) {
      content.push(mySchema.text(text.slice(lastIndex, match.index)))
    }
    const isRefElement = match[0].startsWith("<ref")
    const isMarkup = match[1] !== undefined
    if (isRefElement) {
      // XML 元素：解析属性，直接建 chip（不依赖 resolver —— 字段自带完整信息）
      const attrs: Record<string, string> = {}
      let a: RegExpExecArray | null
      const are = /(\w+)="([^"]*)"/g
      while ((a = are.exec(match[0])) !== null) attrs[a[1]] = a[2]
      const kind = (attrs.type || '').toLowerCase()
      let refValue = attrs.path || ""
      if (kind === 'node') refValue = encodeNodeRef(attrs.canvasId || '', attrs.nodeId || '')
      // 资产专用：ext（挑预览器）/ folderId（定位到资产管理那一层）。
      // 文件夹标签没有 path 也没有 ext，只有 folderId —— 靠它区分「目录」与「文件」。
      const refExt = kind === 'asset' ? (attrs.ext || '') : ''
      const refFolderId = kind === 'asset' ? (attrs.folderId || '') : ''
      // 优先复用现成清单里的同款 item（带 renderEditor / 图标 / 点击聚焦）——
      // 否则回填出来的标签退化成默认「@名字」样式，与右键插入的标签长得不一样（用户报过）。
      const cleanName = (attrs.name || '').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
      let item = resources?.find((r) => r.ref?.kind === kind && r.name === cleanName)
      if (!item) {
        // 清单里没有（节点已删 / MCP 已卸 / 资产挪走）→ 造最小 item；也带 renderEditor，
        // 样式与现成标签一致（只是点了没反应、预览取不到）。
        const minimalRef = {
          kind: kind as any,
          name: cleanName,
          value: refValue,
          ...(refExt ? { ext: refExt } : {}),
          ...(refFolderId ? { folderId: refFolderId } : {}),
        }
        item = {
          id: 'ref:' + kind + ':' + (attrs.nodeId || attrs.path || cleanName),
          name: cleanName,
          category: kind === 'asset' ? '资产' : kind === 'node' ? '节点' : kind === 'skill' ? '技能' : 'MCP',
          url: '',
          value: refValue,
          ref: minimalRef,
          renderEditor: (it: ResourceItem) => {
            const el = document.createElement('span')
            el.className = 'ac-tag'
            // 图标取唯一那份 REF_ICONS（referenceMarkup.ts）—— 与 @ 菜单 / 右键插入的标签同源
            const ic = document.createElement('span')
            ic.className = 'ac-tag-icon'
            ic.innerHTML = REF_ICONS[kind as keyof typeof REF_ICONS] || REF_ICONS.asset
            el.append(ic)
            const lb = document.createElement('span')
            lb.className = 'ac-tag-label'
            lb.textContent = it.name
            el.append(lb)
            return el
          },
        }
      }
      content.push(mySchema.nodes.resource.create({
        id: item.id,
        name: item.name,
        category: item.category,
        url: item.url,
        value: item.value,
        refKind: kind,
        refValue,
        refExt: item.ref?.ext || refExt,
        refFolderId: item.ref?.folderId || refFolderId,
      }))
      itemRegistry.set(item.id, item)
    } else if (isMarkup) {
      const kind = match[1].toLowerCase()
      const name = match[2]
      const refValue = match[3] ?? ""
      const token = name
      const item = resolver ? resolver(token) : null
      if (item) {
        content.push(mySchema.nodes.resource.create({
          id: item.id,
          name: item.name,
          category: item.category || "resource",
          url: item.url || "",
          thumbnail_url: item.thumbnail_url || "",
          value: item.value || "",
          refKind: kind || item.ref?.kind || "",
          refValue: refValue || item.ref?.value || "",
        }))
        itemRegistry.set(item.id, item)
      } else {
        content.push(mySchema.text(match[0]))
      }
    } else {
      // 旧 @token
      const token = match[4]
      const item = resolver ? resolver(token) : null
      if (item) {
        content.push(mySchema.nodes.resource.create({
          id: item.id,
          name: item.name,
          category: item.category || "resource",
          url: item.url || "",
          thumbnail_url: item.thumbnail_url || "",
          value: item.value || "",
          refKind: item.ref?.kind || "",
          refValue: item.ref?.value || "",
        }))
        itemRegistry.set(item.id, item)
      } else {
        content.push(mySchema.text(match[0]))
      }
    }
    lastIndex = regex.lastIndex
  }
  // 剩余文本
  if (lastIndex < text.length) {
    content.push(mySchema.text(text.slice(lastIndex)))
  }
  return content
}
function buildResourceNode(nodeType: any, item: ResourceItem): any {
  return nodeType.create({
    id: item.id,
    name: item.name,
    category: item.category || 'resource',
    url: item.url || '',
    thumbnail_url: item.thumbnail_url || (item.url ? getThumbnailUrlFromAssetUrl(item.url, item.mediaType) : ''),
    value: item.value || '',
    refKind: item.ref?.kind || '',
    refValue: item.ref?.value || '',
    // 资产引用额外字段（见 schema 注释）：导出/复制时要原样写回标记，必须进节点属性。
    refExt: item.ref?.ext || '',
    refFolderId: item.ref?.folderId || '',
  })
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
  },
  emit: {
    (e: "update:modelValue", value: string): void
    (e: "update:promptDoc", value: any): void
    (e: "resource-insert", resource: ResourceItem): void
  },
) {
  let view: EditorView | null = null;
  let mutationObserver: MutationObserver | null = null;

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

  // 计时器
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;

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
    let text = "";
    view.state.doc.descendants((node) => {
      if (node.type.name === "resource") {
        // 引用类标签（技能 / MCP / 节点）导出成**标记文本**：`@[kind:name](value)`。
        // 它是后端认「引用了哪一种、引用了谁」的唯一凭据，也是删标签即失效的那份真相。
        // 其它标签（图片 / 视频素材）维持旧的 `@名字` —— 它们只是展示，不需要后端解析。
        if (node.attrs.refKind) {
          text += formatReferenceMarkup(node.attrs.refKind, node.attrs.name || node.attrs.id, node.attrs.refValue, {
            ...(node.attrs.refExt ? { ext: node.attrs.refExt } : {}),
            ...(node.attrs.refFolderId ? { folderId: node.attrs.refFolderId } : {}),
          }) + " ";
        } else {
          text += `@${node.attrs.name || node.attrs.id} `;
        }
      } else if (node.isText) {
        // 过滤掉零宽空格（用于修复光标问题）
        text += node.text?.replace(/\u200B/g, "") || "";
      } else if (node.isBlock && text.length > 0) {
        text += "\n";
      }
    });
    return text.trim();
  }

  // 导出文本，将变量替换为真实值
  function exportText(): string {
    if (!view) return "";
    let text = "";
    view.state.doc.descendants((node) => {
      if (node.type.name === "resource") {
        // 文本资源导出其正文；图片/视频导出**可读引用名** token（图片1 这种）
        text += node.attrs.value ? node.attrs.value : `@${node.attrs.name || node.attrs.id} `;
      } else if (node.isText) {
        text += node.text?.replace(/\u200B/g, "") || "";
      } else if (node.isBlock && text.length > 0) {
        text += "\n";
      }
    });
    return text.trim();
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

    // 智能定位逻辑：**先用写死的宽高给出初值**，真实翻转由 MentionMenu 测完自己尺寸后
    // 通过 anchorTop/anchorBottom 再修正（见下面的 reflowMenu）。
    // 为什么不在这一步就定死：这里拿不到菜单真实高度，估成 280 会把明明放得下的菜单顶到屏幕上方。
    const menuWidth = 200;
    const menuMaxHeight = 280;
    const gap = 8; // 离触发点的偏移量
    const minMargin = 8; // 最小边距

    let finalX = coords.left;
    let finalY = coords.bottom + gap;
    let originH = "left";
    let originV = "top";
    let side: 'top' | 'bottom' = "bottom";

    // 水平边界检测
    if (coords.left + menuWidth > window.innerWidth) {
      finalX = coords.left - menuWidth; // 靠左显示
      originH = "right";
    }

    // 垂直方向先用估算值兜底；真实尺寸出来后由 reflowMenu 修正
    if (coords.bottom + menuMaxHeight + gap > window.innerHeight) {
      finalY = Math.max(minMargin, coords.top - menuMaxHeight - gap);
      originV = "bottom";
      side = "top";
    }

    menuPosition.value = {
      left: `${Math.max(minMargin, finalX)}px`,
      top: `${Math.max(minMargin, finalY)}px`,
      origin: `${originV} ${originH}`,
      side: side,
      anchorTop: coords.top,
      anchorBottom: coords.bottom,
    };
    activeIndex.value = 0;
  }

  /**
  * 用菜单**真实测量**的高度重新决定上下翻转与位置（修实测 bug：估算 280 会把菜单顶到屏幕上方）。
  * 由 MentionMenu 在 nextTick 里量完自己的 rect 后调用。
  */
  function reflowMenu(rect: { width: number; height: number }) {
    const pos = menuPosition.value;
    if (!menuVisible.value || pos.anchorTop === undefined || pos.anchorBottom === undefined) return;
    const gap = 8;
    const minMargin = 8;
    const anchorTop = pos.anchorTop;
    const anchorBottom = pos.anchorBottom;
    const innerW = window.innerWidth;
    const innerH = window.innerHeight;

    // 水平：默认贴光标左侧（showMenu 已算好）；右边放不下就往左挪，且保证不出左边框
    let left = Number.parseFloat(pos.left) || 0;
    if (left + rect.width > innerW - minMargin) {
      left = Math.max(minMargin, innerW - rect.width - minMargin);
    }

    // 垂直：下方放得下就往下弹；放不下且上方更宽裕才往上弹（两者都不够时选空间大的一侧）
    const spaceBelow = innerH - anchorBottom - gap - minMargin;
    const spaceAbove = anchorTop - gap - minMargin;
    const fitsBelow = rect.height <= spaceBelow;
    const fitsAbove = rect.height <= spaceAbove;
    const placeBelow = fitsBelow || (!fitsAbove && spaceBelow >= spaceAbove);
    const top = placeBelow ? anchorBottom + gap : Math.max(minMargin, anchorTop - rect.height - gap);

    menuPosition.value = {
      ...pos,
      left: `${left}px`,
      top: `${top}px`,
      origin: `${placeBelow ? 'top' : 'bottom'} left`,
      side: placeBelow ? 'bottom' : 'top',
    };
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

    const tr = view.state.tr.replaceWith(
      from - 1 - mentionQuery.value.length,
      from,
      buildResourceNode(nodeType, item),
    )
    tr.insertText(" ")
    itemRegistry.set(item.id, item)
    view.dispatch(tr)
    emit("resource-insert", item)
    hideMenu()
    view.focus()
  }

  // 处理资源节点鼠标进入
  function handleResourceMouseEnter(el: HTMLElement) {
    const isSelected = el.classList.contains("ProseMirror-selectednode") || el.classList.contains("resource-node-selected")
    if (isSelected) return
    if (hoverTimer) clearTimeout(hoverTimer)

    const id = el.getAttribute("data-id")
    const item = id ? itemRegistry.get(id) : undefined
    if (item?.onMouseEnter) { item.onMouseEnter(item); return }

    hoverTimer = setTimeout(() => {
      const url = el.getAttribute("data-url") || ""
      const name = el.getAttribute("data-name") || ""
      if (!url) return
      previewUrl.value = url
      previewTitle.value = name
      previewType.value = isVideoUrl(url) ? "video" : "image"
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
      previewVisible.value = true
    }, 500)
  }

  // 处理资源节点鼠标离开
  function handleResourceMouseLeave(el: HTMLElement) {
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null }
    const id = el.getAttribute("data-id")
    const item = id ? itemRegistry.get(id) : undefined
    if (item?.onMouseLeave) { item.onMouseLeave(item); return }
    previewVisible.value = false
  }

  // 处理资源节点点击
  function handleResourceClick(el: HTMLElement) {
    const id = el.getAttribute("data-id")
    const item = id ? itemRegistry.get(id) : undefined
    /**
     * 点标签后把光标放到**标签之后**（用户口径 2026-10-27）。
     * 默认行为是 NodeSelection（整颗选中）→ 随后焦点变化时光标落到标签**之前**，
     * 用户接着打字就会跑到标签前面。这里显式落一个文本光标在节点末尾。
     */
    if (view) {
      const pos = view.posAtDOM(el, 0)
      const node = view.state.doc.nodeAt(pos)
      if (node && isAtomNode(node.type.name)) {
        const after = pos + node.nodeSize
        try {
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, after)))
        } catch {
          /* 文档已变等边界：忽略，交给 PM 默认处理 */
        }
      }
    }
    if (item?.onClick) { item.onClick(item); return }
  }

  // 存储资源节点图片的取消加载函数
  const resourceCleanupMap = new WeakMap<HTMLImageElement, () => void>();

  // 绑定 atom 节点事件（资源和变量）
  function bindResourceEvents() {
    // 查询所有 atom 节点
    const selector = ".resource-node";
    const atomNodes = document.querySelectorAll(selector);

    atomNodes.forEach((node) => {
      const el = node as HTMLElement;

      el.onmouseenter = () => handleResourceMouseEnter(el);
      el.onmouseleave = () => handleResourceMouseLeave(el);
      el.onclick = () => {
        handleResourceClick(el);
      };

      // 处理缩略图加载
      const img = el.querySelector("img");
      if (img) {
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
        createPasteHandlerPlugin(() => unref(props.resolveResource)),
        createSlotTagPlugin(),
        createCursorFixPlugin(),
        createDropCursorPlugin({ color: "#2b6df2", width: 2 }),
        keymap(baseKeymap),
      ],
    });

    view = new EditorView(editorRef.value, {
      state,
      // 缺省可编辑；props.editable === false 时只读（contenteditable 移除、输入全禁）
      editable: () => unref(props.editable) !== false,
      dispatchTransaction(transaction) {
        if (!view) return;
        const newState = view.state.apply(transaction);
        view.updateState(newState);

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
      clipboardTextSerializer: (slice) => {
        let text = "";
        function collect(fragment: any) {
          fragment.forEach((node: any) => {
            if (node.type.name === "resource") {
              // 复制走的文本要和输入框里的一致：引用类标签复制成标记，其它照旧 @名字。
              text += node.attrs.refKind
                ? formatReferenceMarkup(node.attrs.refKind, node.attrs.name || node.attrs.id, node.attrs.refValue, {
                    ...(node.attrs.refExt ? { ext: node.attrs.refExt } : {}),
                    ...(node.attrs.refFolderId ? { folderId: node.attrs.refFolderId } : {}),
                  }) + " "
                : `@${node.attrs.name || node.attrs.id} `;
            } else if (node.isText) {
              // 过滤掉零宽空格
              text += node.text?.replace(/\u200B/g, "") || "";
            } else if (node.isBlock) {
              // 递归深入 block 内部，遍历其子节点（text / resource 等）
              collect(node.content);
              if (text.length > 0 && !text.endsWith("\n")) {
                text += "\n";
              }
            }
          });
        }
        collect(slice.content);
        return text.trim();
      },
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
    itemRegistry.set(item.id, item)
    // 光标不在编辑器里（用户刚点了工具栏按钮）时，退到文末再插：
    // 否则会插到旧的 selection 位置，甚至因为 selection 失效而插错地方。
    if (!view.hasFocus()) {
      const end = Selection.atEnd(view.state.doc)
      if (end) view.dispatch(view.state.tr.setSelection(end))
    }
    const { from, to } = view.state.selection
    const tr = view.state.tr.replaceWith(
      from,
      to,
      buildResourceNode(nodeType, item),
    )
    tr.insertText(' ')
    view.dispatch(tr)
    emit('resource-insert', item)
    view.focus()
  }

  /**
   * 找到正文里 id 相同的资源标签并**原地替换**它的样子（url / name / 状态）。
   *
   * 为什么需要它：底栏的「待输入」槽位填好内容后，正文里那个标签要立刻从虚线变实线、
   * 显示缩略图/新名字 —— 删了重插会丢光标位置，而且用户的正文顺序会跳（标签会跑到文末）。
   * 只在文档里那个节点存在时改属性，不碰选区。
   *
   * @returns 找到并替换了 → true；正文里没有这个 id → false（调用方自行决定要不要插入）
   */
  function replaceResource(item: ResourceItem): boolean {
    if (!view) return false
    const nodeType = mySchema.nodes.resource
    if (!nodeType) return false
    // 名字 undefined = 保留注册表里原条目的名字（引用名是提示词的一部分，
    // 排序/替换只换图 —— 注册表条目如果被 undefined 覆盖，chip 文字会漂移）。
    const prev = itemRegistry.get(item.id)
    // renderEditor 等外观字段也要从 prev 继承（item 只带数据，不带渲染函数）。
    itemRegistry.set(item.id, item.name === undefined && prev ? { ...prev, ...item, name: prev.name } : item)
    let found = false
    const tr = view.state.tr
    view.state.doc.descendants((node, pos) => {
      if (found || node.type.name !== 'resource' || node.attrs.id !== item.id) return
      found = true
      // registry（按节点 id 存）也要同步 url —— chip 走 renderEditor 分支渲染时
      // 读的是 registry 条目，只改 attrs 不改 registry 的话缩略图不会变（真机踩过）。
      const reg = itemRegistry.get(node.attrs.id)
      if (reg) itemRegistry.set(node.attrs.id, { ...reg, url: item.url ?? '', thumbnail_url: '', name: String(node.attrs.name ?? reg.name) })
      tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        // name 传 undefined = 保留原名字：标签名是用户提示词的一部分（引用名），
        // 排序/替换只换缩略图，绝不能改写它（真机踩过：排序后"图片3"被改成别的名字）。
        name: item.name ?? node.attrs.name,
        url: item.url ?? '',
        // 缩略图必须跟着新 url 重算：留着旧 attrs 的话 toDOM 会继续用旧 thumbnail_url，
        // 表现为「排序/替换后标签缩略图不更新」（真机踩过）。
        thumbnail_url: item.thumbnail_url ?? '',
        value: item.value ?? '',
        category: item.category,
      })
    })
    if (!found) return false
    view.dispatch(tr)
    return true
  }
  /**
   * 按**标签名字**（图片2）更新正文中该标签的缩略图 —— 名字（引用）保持不动。
   * 用户口径：资源卡片排序只换「第 N 格现在放哪张图」，正文标签的名字绝不能变。
   * 找不到同名标签 → false（调用方决定要不要插入）。
   */
  function replaceResourceThumbByName(name: string, url: string): boolean {
    if (!view) return false
    const nodeType = mySchema.nodes.resource
    if (!nodeType) return false
    let found = false
    const tr = view.state.tr
    view.state.doc.descendants((node, pos) => {
      if (found || node.type.name !== 'resource' || node.attrs.name !== name) return
      found = true
      // registry（按节点 id 存）同步 url —— chip 走 renderEditor(registry item) 渲染，
      // 只改 attrs 不改 registry，toDOM 重渲染时缩略图还是旧图（真机踩过）。
      const reg = itemRegistry.get(node.attrs.id)
      // 名字固定为正文 attrs.name（用户提示词的引用名，绝不改写）；图随格子换。
      if (reg) itemRegistry.set(node.attrs.id, { ...reg, url, thumbnail_url: '', name: String(node.attrs.name ?? reg.name) })
      tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        url,
        // 缩略图跟着新 url 重算（旧 thumbnail_url 不清会显示旧图，真机踩过）
        thumbnail_url: '',
      })
    })
    if (!found) return false
    view.dispatch(tr)
    return true
  }

  /**
   * 把正文里所有 `ref-slot:*` 标签**就地重渲染**一遍（注册表里已是最新 item）。
   *
   * 为什么需要整体刷新：底栏的参考内容随连线变化（上传/替换/断开），同一颗「待输入」
   * 标签要跟着从虚线变实线、换名字与缩略图。逐个 replaceResource 也可以，但调用方
   * 得自己枚举 id；给一个"全刷"入口，调用方一行就够。只对 ref-slot:* 生效，
   * 用户手工插入的其它引用不受影响。没有可刷的节点 → 不 dispatch。
   */
  function refreshChips(): void {
    if (!view) return
    // 注册表已更新（调用方先 itemRegistry.set），toDOM 每次渲染都会读 ——
    // 这里用一行**无操作事务**（带标记）逼 ProseMirror 重画这些节点：
    // setNodeMarkup 用原 attrs 也会触发 toDOM 重建（注册表已新，外观即为新）。
    const tr = view.state.tr
    view.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'resource') return
      // 刷所有**注册表里有条目**的资源节点：正文标签的身份有两种（@声明的 ref-slot:*、
      // 资源面板插入的节点 id）—— 只刷 ref-slot:* 会漏掉后者（真机踩过：排序后那类
      // 标签的缩略图不更新）。registry 没有的（用户手打的裸引用）不动。
      if (!itemRegistry.has(String(node.attrs.id ?? ''))) return
      tr.setNodeMarkup(pos, undefined, { ...node.attrs })
    })
    view.dispatch(tr)
  }



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
    serializeDoc,
    deserializeDoc,
    focusEnd,
    setText,
    insertResource,
    replaceResource,
    replaceResourceThumbByName,
    refreshChips,
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
