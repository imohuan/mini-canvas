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
        let item = itemRegistry.get(node.attrs.id)
        /**
         * 冷启动（刷新页面 / 重开底栏）时，注册表里只有 `registerSlotItemsFromDoc`
         * 造出来的**最小条目**（没有 url）。若直接拿它渲染，标签会画成「待输入」虚线
         * —— 用户看到的「刷新后标签退回原样」就是这个（2026-10-28 报）。
         *
         * 富文本节点自己存了 url（落盘的 doc JSON 里有），先用它补齐注册表再渲染：
         * 视觉一次就对，不依赖底栏之后的异步刷新。
         */
        const urlFromAttrs = String(node.attrs.url ?? '')
        if (item && urlFromAttrs && !item.url) {
          item = { ...item, url: urlFromAttrs }
          itemRegistry.set(node.attrs.id, item)
        }
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
        /**
         * 外部注册的 tagSpec 优先兜底渲染（用户 2026-10-27：标签实现交给插件）。
         * 放在内置 ref-slot 分支之前：插件可能用自己的 id 规则（@角色1 之类），
         * 内置规则认不出来，但只要它给了 render 就能画对。
         */
        const spec = activeTagSpec
        if (spec?.render) {
          const item = itemRegistry.get(String(id ?? ''))
          if (item) {
            const rendered = spec.render(item)
            if (rendered instanceof HTMLElement) {
              rendered.classList.add('resource-node')
              rendered.setAttribute('data-id', String(id ?? ''))
              rendered.setAttribute('data-name', String(name ?? ''))
              rendered.setAttribute('data-category', category || '素材')
              return rendered
            }
            return rendered
          }
        }
        /**
         * 槽位标签（ref-slot:image:3 这种）兜底走 chip 外观。
         *
         * 为什么：注册表冷启动时可能还没有条目（或者被别的路径覆盖），走到这里的默认渲染
         * 会画成 `@图片1` 的下划线文字 —— 用户看到的就是「重开底栏后标签变成文本」
         *（2026-10-27 报）。槽位标签的外观是确定的，不依赖注册表也能画对（缩略图靠
         * renderEditor 再刷新）。
         */
        const slotHit = /^ref-slot:(image|video|audio|av):(\d+)$/.exec(String(id ?? ''))
        if (slotHit) {
          const slotKind = slotHit[1] as 'image' | 'video' | 'audio' | 'av'
          const slotItem = buildSlotItem(slotKind, String(name ?? id))
          itemRegistry.set(String(id), { ...slotItem, ...(url ? { url } : {}) })
          const rendered = slotItem.renderEditor?.(slotItem)
          if (rendered instanceof HTMLElement) {
            rendered.setAttribute('data-category', category || '素材')
            return rendered
          }
        }
        /**
         * **按节点 id 插入的标签**（`data-id` = 上游节点 id，如 `204`）也要画成同一副卡片。
         *
         * 用户 2026-10-28 报「刷新后出现两种标签，一种是带下划线的文字」：
         * 这类标签的外观全赖注册表（`itemRegistry`），而注册表是运行时态 —— 刷新/冷启动后
         * 没有对应条目，就落到下面的默认分支（`@名字` + 下划线），和 `ref-slot:*` 的卡片
         * 并排出现，看起来像两套 UI。
         *
         * 兜底规则：名字能认出类型（图片2 / 视频1 / 音频3 / 文本1）就按同一套 chip 画，
         * 不依赖注册表。认不出（用户手打的裸引用）才走原来的默认渲染。
         */
        const byName = /^(图片|视频|音频|文本)\s*\d+$/.exec(String(name ?? '').trim())
        if (byName) {
          const nameKind =
            byName[1] === '图片' ? 'image'
            : byName[1] === '视频' ? 'video'
            : byName[1] === '音频' ? 'audio'
            : 'text'
          /**
           * id 用**节点自己的 id**（不是 buildSlotItem 推出来的 ref-slot:xxx）：
           * renderEditor 里会拿 `self.id` 回注册表读最新条目，这里注册到哪个键就必须用哪个，
           * 否则读到的是别处那份（可能没 url，画出来又是待输入虚线）。
           */
          const fallbackItem = buildSlotItem(nameKind, String(name ?? id))
          const withUrl = {
            ...fallbackItem,
            id: String(id ?? fallbackItem.id),
            ...(url ? { url } : {}),
            ...(node.attrs.value ? { value: String(node.attrs.value) } : {}),
          }
          if (id) itemRegistry.set(String(id), withUrl)
          const rendered = withUrl.renderEditor?.(withUrl)
          if (rendered instanceof HTMLElement) {
            rendered.classList.add('resource-node')
            rendered.setAttribute('data-id', String(id ?? ''))
            rendered.setAttribute('data-url', url || '')
            rendered.setAttribute('data-name', String(name ?? ''))
            rendered.setAttribute('data-category', category || '素材')
            return rendered
          }
        }
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
/** 四种资源类型的默认图标（用户 2026-10-28：图片/视频/音频/文本各有自己的图标） */
const KIND_ICON_SVG: Record<'image' | 'video' | 'audio' | 'text', string> = {
  image:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="m21 15-4.6-4.6a1.5 1.5 0 0 0-2.1 0L6 20"/></svg>',
  video:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="12" height="12" rx="2"/><path d="m15 10 6-4v12l-6-4z"/></svg>',
  audio:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V6l10-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg>',
  text:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3"/><path d="M12 4v16"/><path d="M8 20h8"/></svg>',
}

/**
 * 从标签名解析资源类型（用户 2026-10-28：标签名自带类型+索引，别再绕注册表猜）。
 *
 * 为什么必须用名字：类型存在注册表的 mediaType 里，而注册表是运行时态 —— 底栏重开/
 * 组件刷新时条目会被重建（只剩 name/id），mediaType 丢失 → 所有图标退化成文本图标。
 * 名字（图片2 / 视频1 / 音频3 / 文本1）是节点属性，永远在。
 */
export function kindFromName(name: string | null | undefined): 'image' | 'video' | 'audio' | 'text' {
  const s = String(name ?? '').trim()
  if (/^视频\s*\d+$/.test(s)) return 'video'
  if (/^音频\s*\d+$/.test(s)) return 'audio'
  if (/^图片\s*\d+$/.test(s)) return 'image'
  if (/^文本\s*\d+$/.test(s)) return 'text'
  return 'text'
}

/** 待输入标签的小图标（与底栏槽位同一套线性图标） */
const SLOT_CHIP_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="1.6"/><path d="m21 15-4.5-4.5L6 21"/></svg>'

/** 造一个「待输入 / 已填」槽位素材项（renderEditor 读注册表，缩略图跟着连线变化） */
function buildSlotItem(
  slotKind: 'image' | 'video' | 'audio' | 'av' | 'text',
  name: string,
): ResourceItem {
  const id = 'ref-slot:' + slotKind + ':' + name.replace(/\D/g, '')
  const item: ResourceItem = {
    id,
    name,
    category: '素材',
    // av / text 都没有单一媒体类型：av 是混合，text 靠名字识别
    mediaType: slotKind === 'av' || slotKind === 'text' ? undefined : slotKind,
  }
  item.renderEditor = (self) => {
    // 渲染时读注册表：待输入 → 已填（连线变化）时外观要跟着变
    const latest = itemRegistry.get(self.id) ?? self
    const span = document.createElement('span')
    /**
     * 「待输入」只对**靠地址判断有没有内容**的类型成立（图片/视频/音频）。
     * 文本标签本来就没有 url（内容是 value），拿 !url 判会把已填的文本标签画成虚线待输入
     *（用户 2026-10-28 截图里「文本1」就是虚线框）。
     */
    const isTextChip = kindFromName(latest.name) === 'text' && /^文本\s*\d+$/.test(String(latest.name ?? '').trim())
    const isPending = !isTextChip && !latest.url
    span.className = 'resource-node resource-chip' + (isPending ? ' is-pending' : '')
    span.dataset.id = self.id
    span.dataset.name = latest.name
    /**
     * 有图就画图（含视频：视频存的 url 是**帧图**，不是 mp4）。
     *
     * 为什么不能只认 `mediaType === 'image'`（用户 2026-10-28 报「刷新后标签变回默认」）：
     * 冷启动时注册表里只有 `registerSlotItemsFromDoc` 造的最小条目，mediaType 可能缺失，
     * 于是视频/图片标签一起落到图标分支 —— 看上去就是「刷新后缩略图没了、变回基础标签」。
     */
    /**
     * 只有「能把 url 当图片」的类型才画 `<img>`；音频是 mp3，塞进去必然加载失败、
     * 编辑器再把失败元素隐藏 —— 标签就只剩名字（用户 2026-10-28 报音频标签没图标）。
     * 视频的 url 是帧图（data:image/…），所以允许。
     */
    const urlIsImage = !!latest.url && !/\.(mp3|wav|ogg|m4a|mp4|webm|mov)(\?|#|$)/i.test(latest.url)
    const canThumb = urlIsImage && !/^文本\s*\d+$/.test(String(latest.name ?? '').trim()) && latest.mediaType !== 'audio'
    if (canThumb) {
      const img = document.createElement('img')
      img.className = 'resource-chip-thumb'
      img.src = latest.url
      img.alt = ''
      span.append(img)
    } else {
      const ic = document.createElement('span')
      ic.className = 'resource-chip-icon'
      /**
       * 按类型出图标（用户 2026-10-28）：图片/视频/音频/文本各有自己的图标。
       *
       * 类型来源**优先看标签名**（图片2 / 视频1 / 音频3 / 文本1）——名字是节点属性，
       * 刷新多少次都在；mediaType 只存在注册表里，重开底栏时会丢（用户截图 2 全变
       * 文本图标就是这个原因）。名字解析不出来时才退回 mediaType。
       */
      const fromName = kindFromName(latest.name)
      const kindKey: 'image' | 'video' | 'audio' | 'text' =
        fromName !== 'text' || /^文本\s*\d+$/.test(String(latest.name ?? '').trim())
          ? fromName
          : latest.mediaType === 'video' ? 'video'
          : latest.mediaType === 'audio' ? 'audio'
          : latest.mediaType === 'image' ? 'image'
          : 'text'
      ic.innerHTML = KIND_ICON_SVG[kindKey] || SLOT_CHIP_ICON
      span.append(ic)
    }
    const nm = document.createElement('span')
    nm.className = 'resource-chip-name'
    nm.textContent = latest.name
    span.append(nm)
    return span
  }
  return item
}
/**
 * 按 doc JSON 把 `ref-slot:*` 标签的样式登记进注册表（幂等）。
 *
 * 为什么需要：标签的 toDOM 渲染时去注册表取 item（决定 chip 外观）。冷启动
 * （底栏刚打开、注册表还是空的）时直接建节点，标签就会退化成默认渲染 ——
 * 用户看到的就是「重开底栏后标签变成 @图片1 文本」（2026-10-27 报的那个）。
 */
function registerSlotItemsFromDoc(docJson: unknown): void {
  const walk = (nodes: unknown): void => {
    if (!Array.isArray(nodes)) return
    for (const raw of nodes) {
      const node = raw as { type?: string; attrs?: { id?: unknown; name?: unknown }; content?: unknown } | null
      if (!node || typeof node !== 'object') continue
      if (node.type === 'resource') {
        const id = String(node.attrs?.id ?? '')
        const m = /^ref-slot:(image|video|audio|av):(\d+)$/.exec(id)
        if (m && !itemRegistry.has(id)) {
          const slotKind = m[1] as 'image' | 'video' | 'audio' | 'av'
          itemRegistry.set(id, buildSlotItem(slotKind, String(node.attrs?.name ?? id)))
        }
      }
      walk(node.content)
    }
  }
  const root = docJson as { content?: unknown } | null | undefined
  walk(root?.content)
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

/**
 * 从剪贴板里取出文件。
 *
 * 为什么要有 items 兜底：真实浏览器里复制图片时，`clipboardData.files` 经常是空的，
 * 文件挂在 `items` 上（`kind === 'file'`，用 `getAsFile()` 取）。只读 files 会漏掉这类粘贴。
 */
export function pickFilesFromClipboard(data: DataTransfer | null | undefined): File[] {
  if (!data) return []
  const files = Array.from(data.files ?? [])
  if (files.length > 0) return files
  const out: File[] = []
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file') continue
    const file = typeof item.getAsFile === 'function' ? item.getAsFile() : null
    if (file) out.push(file)
  }
  return out
}

/** 粘贴文件时交给外部的上下文 */
export interface PasteFilesContext {
  /** 在**当前**光标处插入一颗标签（执行时才读光标，避免异步导致位置漂移） */
  insert(item: ResourceItem): void
}

/** 外部粘贴处理：返回 true = 已处理（编辑器不再走默认粘贴） */
export type PasteFilesHandler = (files: File[], ctx: PasteFilesContext) => boolean | Promise<boolean>
/**
 * 这次粘贴是不是「纯文本粘贴」（Ctrl+Shift+V / Cmd+Shift+V）。
 *
 * 为什么不能靠 clipboardData 判断：剪贴板内容一样，区别只在用户按的键。
 * 所以在 keydown 时记一个标记，paste 时读走并清空。
 */
let lastPasteWasPlainText = false

export function isPlainTextPasteEvent(_event: ClipboardEvent): boolean {
  const v = lastPasteWasPlainText
  lastPasteWasPlainText = false
  return v
}

/** 由 keydown 监听调用：记录「用户按的是纯文本粘贴快捷键」 */
export function markPlainTextPaste(): void {
  lastPasteWasPlainText = true
}


// 粘贴处理插件
function createPasteHandlerPlugin(
  getResolver: () => ((name: string) => ResourceItem | null) | undefined,
  /** 外部粘贴处理器：有文件时优先交给它（底栏用它做「建节点 + 连线 + 标签」） */
  getPasteFiles: () => PasteFilesHandler | undefined,
) {
  return new Plugin({
    key: new PluginKey("paste-handler"),
    props: {
      handlePaste(view, event) {
        /**
         * 剪贴板里有**文件**时，先问外部愿不愿意接管。
         *
         * 为什么必须交给外部（用户 2026-10-27）：粘贴图片要「建节点 + 连参考线 + 建标签」，
         * 这些是画布业务，输入框组件不该知道；它只提供能力。
         */
        const files = pickFilesFromClipboard(event.clipboardData)
        const handler = files.length > 0 ? getPasteFiles() : undefined
        if (handler) {
          void handler(files, {
            insert(item) {
              const type = view.state.schema.nodes.resource
              if (!type) return
              itemRegistry.set(item.id, item)
              // 执行时读光标：handler 是异步的，粘贴那一刻的位置可能已经失效
              const { from, to } = view.state.selection
              const tr = view.state.tr.replaceWith(from, to, buildResourceNode(type, item))
              tr.insertText(' ')
              view.dispatch(tr)
            },
          })
          return true
        }

        /**
         * 粘贴规范（用户 2026-10-28）：
         *
         * ① 普通粘贴（Ctrl+V）：复制的是标签 → 粘贴出来还是标签；复制的是文字 → 文字。
         *    浏览器的富文本通道里，标签是带 `resource-node` 的 HTML，交给 ProseMirror 的
         *    默认粘贴即可原样还原（下面 `return false` 就是这条）。只有「没有 HTML、
         *    或 HTML 里没有标签」的纯文本，才走我们的 @ 文本解析兜底。
         * ② 纯文本粘贴（Ctrl+Shift+V）：**强制当文本**，绝不把 @图片1 之类转成标签。
         *    ProseMirror 的默认粘贴不认这个快捷键，只能我们拦下来自己插纯文本。
         */
        const isPlainTextPaste = isPlainTextPasteEvent(event)
        if (isPlainTextPaste) {
          const raw = event.clipboardData?.getData('text/plain') ?? ''
          if (!raw) return false
          const { from, to } = view.state.selection
          const lines = raw.split('\n')
          const nodes = lines.map((line) =>
            view.state.schema.node('paragraph', null, line ? view.state.schema.text(line) : undefined),
          )
          view.dispatch(view.state.tr.replaceWith(from, to, nodes))
          return true
        }

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
      /**
       * `@图片3` / `@音频2` 这种槽位引用：连线素材的回查表里没有它（还没连图），
       * 但它本来就是一个「待输入」素材标签。以前回查失败就退化成纯文字 ——
       * 底栏重新挂载后标签全变成 `@图片10` 文本，还被当成声明了第 10 格，凭空长出一排空槽。
       */
      const slotHit = /^(图片|视频|音频|音视频|image|video|audio|media|av)\s*(\d{1,4})$/i.exec(token)
      if (slotHit) {
        const sk = slotHit[1].toLowerCase()
        const slotKind: 'image' | 'video' | 'audio' | 'av' =
          sk === '图片' || sk === 'image' ? 'image'
          : sk === '视频' || sk === 'video' ? 'video'
          : sk === '音频' || sk === 'audio' ? 'audio'
          : 'av'
        const label =
          slotKind === 'image' ? '图片' : slotKind === 'video' ? '视频' : slotKind === 'audio' ? '音频' : '音视频'
        const index = Number(slotHit[2])
        if (index) {
          const slotItem = buildSlotItem(slotKind, label + index)
          itemRegistry.set(slotItem.id, slotItem)
          content.push(mySchema.nodes.resource.create({
            id: slotItem.id,
            name: slotItem.name,
            category: slotItem.category,
            url: '',
            value: '',
          }))
          lastIndex = regex.lastIndex
          continue
        }
      }

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
  /**
   * 标签身份**统一**成 `ref-slot:<kind>:<N>`（用户 2026-10-28 明确要求）。
   *
   * 以前两种写法并存：@ 下拉插入用上游节点 id（如 `204`），「标记」转换用 `ref-slot:*`。
   * 同一颗标签两种身份，刷新后注册表一空，节点 id 那种就画成下划线文字 ——
   * 用户看到的就是「两种标签」。现在不论从哪条路进来，落进文档的 id 都是同一个。
   *
   * 只有名字能认出类型（图片N/视频N/音频N/文本N）才改写；技能/MCP/资产那类引用
   * 有自己的 id 规则（item.ref），保持原样。
   */
  const canonicalId = item.ref ? item.id : slotIdFromName(item.name) ?? item.id
  return nodeType.create({
    id: canonicalId,
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

/**
 * 由引用名推出**唯一的标签身份**：图片3 → `ref-slot:image:3`。
 * 认不出（技能名、资产名、用户手打的自由文本）返回 null，调用方沿用原 id。
 */
export function slotIdFromName(name: string | null | undefined): string | null {
  const s = String(name ?? '').trim()
  const m = /^(图片|视频|音频|文本)\s*(\d+)$/.exec(s)
  if (!m) return null
  const kind =
    m[1] === '图片' ? 'image'
    : m[1] === '视频' ? 'video'
    : m[1] === '音频' ? 'audio'
    : 'text'
  return 'ref-slot:' + kind + ':' + Number(m[2])
}

/**
 * 把老存档里「按上游节点 id 存」的素材标签就地改成 `ref-slot:<kind>:<N>`。
 *
 * 递归重建（ProseMirror 节点不可变，不能直接改 attrs）；没命中的节点**原样返回**，
 * 于是内容没变时 `=== doc`，调用方可以据此跳过事务。
 */
export function migrateLegacyChipIds(doc: PMNode): PMNode {
  const walk = (node: PMNode): PMNode => {
    if (node.type.name === 'resource') {
      const id = String(node.attrs.id ?? '')
      if (id.startsWith('ref-slot:')) return node
      const canonical = slotIdFromName(String(node.attrs.name ?? ''))
      if (!canonical) return node
      return node.type.create({ ...node.attrs, id: canonical }, null, node.marks)
    }
    if (node.childCount === 0) return node
    let changed = false
    const kids: PMNode[] = []
    node.forEach((child) => {
      const next = walk(child)
      if (next !== child) changed = true
      kids.push(next)
    })
    return changed ? node.type.create(node.attrs, kids, node.marks) : node
  }
  return walk(doc)
}

/**
 * 这颗标签需要改文档吗？（url / 名字真的变了才需要）
 *
 * 为什么单独抽出来（用户 2026-10-27 报「点标签后光标先跳到前面再跳回来」）：
 * 底栏的标签刷新（replaceResourceThumbByName / refreshChips）会被 watcher 反复调用。
 * 以前它们无条件 setNodeMarkup —— attrs 一个字没变也算「文档改动」，ProseMirror 会
 * 重建节点，整颗选中随之销毁，浏览器就把光标就近放到标签**前面**。
 * 内容相同就绝不产生事务，从这个源头掐掉"先跳前面"的那一步。
 */
export function chipAttrsNeedUpdate(
  attrs: { url?: string | null; name?: string | null; thumbnail_url?: string | null },
  want: { url?: string | null; name?: string | null },
): boolean {
  if ((attrs.url ?? '') !== (want.url ?? '')) return true
  if (want.name != null && String(attrs.name ?? '') !== String(want.name)) return true
  return false
}
/**
 * 文字 → 标签的匹配结果。
 *
 * `from` / `to` 是**这段文字在文本节点内的偏移**（不含节点起始位置，由调用方加上）。
 */
export interface TagMatch {
  from: number
  to: number
  item: ResourceItem
}

/**
 * 标签识别规格：由调用方提供（用户口径 2026-10-27）。
 *
 * 为什么外置：编辑器不该知道「图片N 就是槽位」这种业务规则。
 * 插件想用 `@角色1`、`@素材A` 或完全不同的写法，只提供自己的 scan 即可。
 *
 * `scan` 必须支持一段文字里的**多个**匹配（`看 @图片1 和 @图片2` 要转两个）。
 */
export interface TagSpec {
  scan(text: string): TagMatch[]
  /**
   * 兜底渲染：注册表里没有条目时才用（例如冷启动恢复文档）。
   * 不传 = 组件内置 chip。
   */
  render?(item: ResourceItem): HTMLElement | [string, Record<string, any>, ...any[]]
}

/**
 * 全局标签规格。
 *
 * 为什么用模块级而不是 prop：toDOM 是 schema 的静态方法（mySchema 是模块级单例），
 * 渲染时拿不到组件实例，只能从这里读。
 */
let activeTagSpec: TagSpec | null = null

/** 注册标签规格（传 null = 取消注册，恢复组件默认规则） */
export function registerTagSpec(spec: TagSpec | null): void {
  activeTagSpec = spec
}

/** 读当前标签规格（渲染兜底用） */
export function currentTagSpec(): TagSpec | null {
  return activeTagSpec
}
/**
 * 组件内置的标签识别规则（没注册 tagSpec 时使用）。
 *
 * 认 `@图片N / @视频N / @音频N / @文本N / @音视频N`（中英双写），
 * 生成 `ref-slot:<kind>:<N>` 的槽位标签。插件注册了 tagSpec 就不会走到这里。
 */
export function builtinScan(text: string): TagMatch[] {
  const out: TagMatch[] = []
  // 用户 2026-10-28：@文本N 也要能转成标签（之前只认图片/视频/音频）
  const re = /@(图片|视频|音频|文本|音视频|image|video|audio|text|media|av)\s*(\d{1,4})/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const kind = m[1].toLowerCase()
    const slotKind: 'image' | 'video' | 'audio' | 'av' | 'text' =
      kind === '图片' || kind === 'image' ? 'image'
      : kind === '视频' || kind === 'video' ? 'video'
      : kind === '音频' || kind === 'audio' ? 'audio'
      : kind === '文本' || kind === 'text' ? 'text'
      : 'av'
    const label =
      slotKind === 'image' ? '图片'
      : slotKind === 'video' ? '视频'
      : slotKind === 'audio' ? '音频'
      : slotKind === 'text' ? '文本'
      : '音视频'
    const index = Number(m[2])
    if (!index) continue
    out.push({ from: m.index, to: m.index + m[0].length, item: buildSlotItem(slotKind, label + index) })
  }
  return out
}



/**
 * 按「节点 id 列表」批量替换资源标签的缩略图（用户口径 2026-10-27）。
 *
 * 为什么不再按名字匹配：拖拽排序后标签名不变、指向的图变了，名字匹配会漏/错；
 * 而正文里的标签有两种身份 ——
 *   - 资源面板插入：`attrs.id = 节点 id`；
 *   - 「标记」转出来：`attrs.id = ref-slot:<kind>:<N>`。
 * 两种都要能命中，所以接口收一个 id 列表。
 *
 * **只改 url，绝不改 name**（名字是用户提示词里的引用名）。
 * 没有命中或内容未变时返回同一个 doc 引用，调用方据此跳过 dispatch。
 */
export function applyThumbByIds(doc: PMNode, ids: readonly string[], url: string): PMNode {
  const set = new Set(ids.filter(Boolean))
  if (set.size === 0) return doc
  let changed = false
  const walk = (node: PMNode): PMNode => {
    if (
      node.type.name === 'resource' &&
      set.has(String(node.attrs.id ?? '')) &&
      (node.attrs.url ?? '') !== url
    ) {
      changed = true
      return node.type.create({ ...node.attrs, url, thumbnail_url: '' }, null, node.marks)
    }
    if (node.childCount === 0) return node
    const kids: PMNode[] = []
    let same = true
    node.forEach((child) => {
      const next = walk(child)
      if (next !== child) same = false
      kids.push(next)
    })
    return same ? node : node.type.create(node.attrs, kids, node.marks)
  }
  const next = walk(doc)
  return changed ? next : doc
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
  /** 标签点击后的延迟落光标（0.5s）；连点只保留最后一次 */
  let chipClickTimer: ReturnType<typeof setTimeout> | null = null;

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
       * 老存档迁移（用户 2026-10-28 统一 id）：
       * 以前 @ 下拉插入的标签存的是**上游节点 id**（如 `204`），现在统一成
       * `ref-slot:<kind>:<N>`。
       *
       * 只认「名字能认出类型」的（图片N/视频N/音频N/文本N）；技能/MCP/资产那类引用
       * 有自己的 id 语义，绝不改。迁移走**重建节点**（node.type.create），不动旧 attrs ——
       * ProseMirror 的节点是不可变的，直接改字段不会生效。
       */
      const migrated = migrateLegacyChipIds(doc)
      const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, migrated.content);
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
    if (isSelected) return
    if (hoverTimer) clearTimeout(hoverTimer)

    const id = el.getAttribute("data-id")
    const item = id ? itemRegistry.get(id) : undefined
    if (item?.onMouseEnter) { item.onMouseEnter(item); return }

    hoverTimer = setTimeout(() => {
      const url = el.getAttribute("data-url") || ""
      const name = el.getAttribute("data-name") || ""
      if (!url) return
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
        previewType.value = isVideoUrl(src) ? "video" : "image"
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
    previewVisible.value = false
  }

  // 处理资源节点点击
  function handleResourceClick(el: HTMLElement) {
    const id = el.getAttribute("data-id")
    const item = id ? itemRegistry.get(id) : undefined
    /**
     * 点标签：**先**保持 ProseMirror 默认的节点选中（NodeSelection，视觉上整颗高亮），
     * 0.5s 后再把光标落到标签**之后**（用户口径 2026-10-27）。
     *
     * 为什么延后：直接跳光标会让人看不到"这一下点中了什么"；先选中再落光标，
     * 既确认了点击对象，又能让用户紧接着在标签后面打字（默认落点在标签之前）。
     */
    if (view) {
      const pos = view.posAtDOM(el, 0)
      const node = view.state.doc.nodeAt(pos)
      if (node && isAtomNode(node.type.name)) {
        const after = pos + node.nodeSize
        if (chipClickTimer) clearTimeout(chipClickTimer)
        chipClickTimer = setTimeout(() => {
          chipClickTimer = null
          if (!view) return
          try {
            view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, after)))
          } catch {
            /* 文档已变（用户又点了别处/删了标签）：忽略 */
          }
        }, 500)
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
    // 先登记一次（后面按落进文档的 id 再对齐，保证 toDOM 查得到）
    itemRegistry.set(item.id, item)
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
    let changed = false
    const tr = view.state.tr
    view.state.doc.descendants((node, pos) => {
      if (found || node.type.name !== 'resource' || node.attrs.name !== name) return
      found = true
      /**
       * 内容没变就一个字都别动（用户 2026-10-27 报：点标签后光标先跳到前面再跳回来）。
       *
       * 根因：底栏的标签刷新会反复调用这个函数，以前无条件 setNodeMarkup —— 即使 url
       * 一模一样，也会重建标签节点、让文档"改"一次。节点一重建，整颗选中就没了，
       * 浏览器顺手把光标就近放到标签**前面**，0.5s 计时器再把它挪到后面。
       */
      if (!chipAttrsNeedUpdate(node.attrs, { url })) {
        // 文档不动；注册表仍需同步（toDOM 读的是它），这一步不产生事务
        const reg0 = itemRegistry.get(node.attrs.id)
        if (!reg0 || reg0.url !== url) {
          itemRegistry.set(node.attrs.id, {
            ...(reg0 ?? { id: node.attrs.id, category: node.attrs.category }),
            url,
            thumbnail_url: '',
            name: String(node.attrs.name ?? reg0?.name ?? name),
          })
        }
        return
      }
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
      changed = true
    })
    if (!found) return false
    if (changed) view.dispatch(tr)
    return true
  }

  /**
   * 按 id 列表换缩略图（拖拽排序后按「该类型数组第 N 项」取图时用）。
   *
   * 只改 url、不改 name；没有命中或内容未变时不产生事务。
   */
  function replaceResourceThumbByIds(ids: readonly string[], url: string): boolean {
    if (!view) return false
    const next = applyThumbByIds(view.state.doc, ids, url)
    if (next === view.state.doc) return false
    // registry 也同步：chip 走 renderEditor(registry item) 渲染，只改 attrs 不改 registry，
    // 重渲染时缩略图还是旧图（真机踩过）。
    const set = new Set(ids.filter(Boolean))
    for (const id of set) {
      const reg = itemRegistry.get(id)
      if (reg) itemRegistry.set(id, { ...reg, url, thumbnail_url: '' })
    }
    view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, next.content))
    return true
  }

  /**
   * 把正文里所有 ref-slot 标签**就地重渲染**一遍（注册表里已是最新 item）。
   *
   * 为什么需要整体刷新：底栏的参考内容随连线变化（上传/替换/断开），同一颗「待输入」
   * 标签要跟着从虚线变实线、换名字与缩略图。逐个 replaceResource 也可以，但调用方
   * 得自己枚举 id；给一个"全刷"入口，调用方一行就够。只对 ref-slot:* 生效，
   * 用户手工插入的其它引用不受影响。没有可刷的节点 → 不 dispatch。
   */
  function refreshChips(): void {
    if (!view) return
    /**
     * 先做一次 id 迁移（用户 2026-10-28 统一标签身份）。
     * 为什么放在这里：老存档里按节点 id 存的标签要变成 ref-slot:*；
     * 这个函数正是「底栏数据变化后统一刷一遍」的入口，挂载后也会跑一次。
     * 迁移没命中时返回同一个 doc，不会产生多余事务。
     */
    const before = view.state.doc
    const migrated = migrateLegacyChipIds(before)
    if (migrated !== before) {
      view.dispatch(view.state.tr.replaceWith(0, before.content.size, migrated.content))
    }
    // 注册表已更新（调用方先 itemRegistry.set），toDOM 每次渲染都会读 ——
    // 这里用一行**无操作事务**（带标记）逼 ProseMirror 重画这些节点：
    // setNodeMarkup 用原 attrs 也会触发 toDOM 重建（注册表已新，外观即为新）。
    const tr = view.state.tr
    let changed = false
    view.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'resource') return
      // 刷所有**注册表里有条目**的资源节点：正文标签的身份有两种（@声明的 ref-slot:*、
      // 资源面板插入的节点 id）—— 只刷 ref-slot:* 会漏掉后者（真机踩过：排序后那类
      // 标签的缩略图不更新）。registry 没有的（用户手打的裸引用）不动。
      const item = itemRegistry.get(String(node.attrs.id ?? ''))
      if (!item) return
      /**
       * 只刷「外观真的变了」的标签。
       *
       * 用户 2026-10-27 报「点标签后光标先跳到前面再跳回来」：这个函数被底栏 watcher
       * 反复调用，以前**无条件**对每颗标签 setNodeMarkup —— attrs 一个字没变也算文档
       * 改动，节点被重建、整颗选中被销毁，浏览器顺手把光标放到标签前面。
       * 外观相同就不该产生事务。
       */
      if (!chipAttrsNeedUpdate(node.attrs, { url: item.url ?? '', name: item.name ?? node.attrs.name ?? '' })) return
      tr.setNodeMarkup(pos, undefined, { ...node.attrs })
      changed = true
    })
    if (changed) view.dispatch(tr)
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
     * 归一化（用户 2026-10-28 报：标记后仍出现 图片100 这种序号）。
     *
     * 同类型按**出现顺序**重编成 1..n：正文写 `@图片1 @图片100 @图片10`，
     * 转换后应该是 图片1、图片2、图片3 —— 序号连续，格子数 = 声明数，
     * 缩略图才能按「该类型数组第 N 项」取。这是文档里「归一化」的直接落点。
     *
     * 具体做法：转换时直接用新 id/名字建节点（一个事务内完成，不产生中间态）。
     */
    const seq: Record<string, number> = {}
    const order = [...hits].sort((a, b) => a.start - b.start)  // 按出现顺序
    for (const h of order) {
      const kind = h.item.mediaType ?? 'image'
      seq[kind] = (seq[kind] ?? 0) + 1
      const index = seq[kind]
      if (h.item.id !== 'ref-slot:' + kind + ':' + index) {
        h.item = { ...h.item, id: 'ref-slot:' + kind + ':' + index, name: (h.item.name || '').replace(/\d+$/, '') + index }
      }
    }
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
    serializeDoc,
    deserializeDoc,
    focusEnd,
    setText,
    /** 把正文里的 @图片N 文字转成素材标签（底栏「标记」按钮调用） */
    markRefSlots,
    insertResource,
    replaceResource,
    replaceResourceThumbByName,
    replaceResourceThumbByIds,
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
