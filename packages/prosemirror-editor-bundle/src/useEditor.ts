import { ref, computed, onMounted, onUnmounted, watch, type Ref, unref } from "vue";
import { Schema } from "prosemirror-model";
import { EditorState, Plugin, PluginKey, Selection } from "prosemirror-state";
import { EditorView, Decoration, DecorationSet } from "prosemirror-view";
import { schema as baseSchema } from "prosemirror-schema-basic";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { history, undo, redo } from "prosemirror-history";
import type { MenuPosition, ResourceItem } from "./types";
import { isVideoUrl, getThumbnailUrlFromAssetUrl, loadImageWithThumbnail } from "./utils";

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

// 全局 item 注册表：toDOM 通过 node.attrs.id 查这里获取 ResourceItem（含 renderEditor）
const itemRegistry = new Map<string, ResourceItem>()

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
function createPasteHandlerPlugin() {
  return new Plugin({
    key: new PluginKey("paste-handler"),
    props: {
      handlePaste(view, event) {
        const html = event.clipboardData?.getData("text/html");
        if (html && html.includes("resource-node")) {
          return false;
        }

        const text = event.clipboardData?.getData("text/plain");
        if (text && !html) {
          const cleanedText = text.replace(/\n+/g, " ").trim();
          const { from, to } = view.state.selection;
          const tr = view.state.tr.replaceWith(from, to, view.state.schema.text(cleanedText));
          view.dispatch(tr);
          return true;
        }

        return false;
      },
    },
  });
}

// 将纯文本（含 @name 标记）解析为 ProseMirror content 节点数组
// 如果提供了 resolver，尝试将 @name 还原为 resource node；否则全当纯文本
function parsePlainTextToContent(
  text: string,
  resolver: ((name: string) => ResourceItem | null) | undefined,
): any[] {
  if (!resolver) {
    return text ? [mySchema.text(text)] : []
  }
  const content: any[] = []
  // 匹配 @xxx，其中 xxx 为非空白字符序列
  const regex = /@(\S+)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    // match 前的纯文本
    if (match.index > lastIndex) {
      content.push(mySchema.text(text.slice(lastIndex, match.index)))
    }
    const name = match[1]
    const item = resolver(name)
    if (item) {
      content.push(mySchema.nodes.resource.create({
        id: item.id,
        name: item.name,
        category: item.category || 'resource',
        url: item.url || '',
        thumbnail_url: item.thumbnail_url || '',
        value: item.value || '',
      }))
      // 注册到全局 registry，toDOM 需要
      itemRegistry.set(item.id, item)
    } else {
      // 未解析到，保留为纯文本
      content.push(mySchema.text(`@${name}`))
    }
    lastIndex = regex.lastIndex
  }
  // 剩余文本
  if (lastIndex < text.length) {
    content.push(mySchema.text(text.slice(lastIndex)))
  }
  return content
}

export function useEditor(
  editorRef: Ref<HTMLElement | null>,
  props: {
    modelValue?: Ref<string | undefined>
    resources?: Ref<ResourceItem[] | undefined>
    resolveResource?: Ref<((name: string) => ResourceItem | null) | undefined>
  },
  emit: {
    (e: "update:modelValue", value: string): void
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
        text += `@${node.attrs.name} `;
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
        text += node.attrs.value ? node.attrs.value : `@${node.attrs.name} `;
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

    // 智能定位逻辑：预估菜单尺寸并进行边界检测
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

    // 垂直边界检测
    if (coords.bottom + menuMaxHeight + gap > window.innerHeight) {
      finalY = coords.top - menuMaxHeight - gap; // 往上弹
      originV = "bottom";
      side = "top";
    }

    menuPosition.value = {
      left: `${Math.max(minMargin, finalX)}px`,
      top: `${Math.max(minMargin, finalY)}px`,
      origin: `${originV} ${originH}`,
      side: side,
    };
    activeIndex.value = 0;
  }

  // 隐藏菜单
  function hideMenu() {
    menuVisible.value = false;
    mentionQuery.value = "";
    filteredItems.value = [];
  }

  // 插入选中的资源
  function insertSelectedItem(item: ResourceItem) {
    if (!view) return
    const { from } = view.state.selection
    const nodeType = mySchema.nodes.resource
    if (!nodeType) return

    const tr = view.state.tr.replaceWith(
      from - 1 - mentionQuery.value.length,
      from,
      nodeType.create({
        id: item.id,
        name: item.name,
        category: item.category || 'resource',
        url: item.url || '',
        thumbnail_url: item.thumbnail_url || (item.url ? getThumbnailUrlFromAssetUrl(item.url, item.mediaType) : ''),
        value: item.value || '',
      }),
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
      el.onclick = (e) => {
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

    const initialValue = unref(props.modelValue);
    const initialContent = initialValue
      ? parsePlainTextToContent(initialValue, unref(props.resolveResource))
      : undefined
    const state = EditorState.create({
      schema: mySchema,
      doc: mySchema.node(
        "doc", null,
        initialContent ? [mySchema.node("paragraph", null, initialContent)] : [mySchema.node("paragraph")],
      ),
      plugins: [
        history(),
        mentionKeymap,
        createSelectionDecorationPlugin(),
        createPasteHandlerPlugin(),
        createCursorFixPlugin(),
        createDropCursorPlugin({ color: "#2b6df2", width: 2 }),
        keymap(baseKeymap),
      ],
    });

    view = new EditorView(editorRef.value, {
      state,
      dispatchTransaction(transaction) {
        if (!view) return;
        const newState = view.state.apply(transaction);
        view.updateState(newState);

        emit("update:modelValue", getPlainText());

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
              filteredItems.value = allItems;
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
                  if (mentionQuery.value) {
                    filteredItems.value = allItems.filter(
                      item => item.name.toLowerCase().includes(mentionQuery.value.toLowerCase())
                    );
                  } else {
                    filteredItems.value = allItems;
                  }
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
              text += `@${node.attrs.name} `;
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

  // 监听外部 modelValue 变化
  watch(
    () => unref(props.modelValue),
    (newValue) => {
      if (view && getPlainText() !== newValue) {
        const tr = view.state.tr;
        tr.delete(0, view.state.doc.content.size);
        if (newValue) {
          const content = parsePlainTextToContent(newValue, unref(props.resolveResource));
          if (content.length > 0) {
            const paragraph = mySchema.node("paragraph", null, content);
            tr.insert(0, paragraph);
          }
        }
        view.dispatch(tr);
      }
    },
  );

  // 监听 resources 变化，更新过滤列表
  watch(
    () => unref(props.resources),
    (newResources) => {
      if (menuVisible.value && newResources) {
        if (mentionQuery.value) {
          filteredItems.value = newResources.filter(
            item => item.name.toLowerCase().includes(mentionQuery.value.toLowerCase())
          )
        } else {
          filteredItems.value = newResources
        }
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

  return {
    // 菜单
    menuVisible, menuPosition, activeIndex,
    filteredItems,
    groupedItems,
    categoryOrder,
    insertSelectedItem,
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
  };
}
