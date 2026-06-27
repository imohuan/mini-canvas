import { ref, onMounted, onUnmounted, watch, type Ref, unref } from "vue";
import { Schema } from "prosemirror-model";
import { EditorState, Plugin, PluginKey } from "prosemirror-state";
import { EditorView, Decoration, DecorationSet } from "prosemirror-view";
import { schema as baseSchema } from "prosemirror-schema-basic";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { history, undo, redo } from "prosemirror-history";
import type { MenuPosition, ResourceItem, VariableItem } from "./types";
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



// 全局配置：需要特殊处理的 atom 节点类型
const ATOM_NODE_TYPES = ["resource", "variable"] as const;
const ATOM_NODE_CLASSES = ["resource-node", "variable-node"] as const;

// 检查节点是否是 atom 节点
function isAtomNode(nodeType: string): boolean {
  return ATOM_NODE_TYPES.includes(nodeType as any);
}

// Schema 定义
const mySchema = new Schema({
  nodes: baseSchema.spec.nodes.append({
    variable: {
      attrs: { id: {}, name: {}, value: {} },
      group: "inline",
      inline: true,
      selectable: true,
      draggable: true,
      atom: true,
      toDOM: (node) => {
        return [
          "span",
          {
            class: "variable-node",
            "data-id": node.attrs.id,
            "data-name": node.attrs.name,
            "data-value": node.attrs.value,
            style: "padding: 0 2px;",
          },
          [
            "span",
            {
              class: "variable-node-inner",
            },
            `@${node.attrs.name}`,
          ],
        ];
      },
      parseDOM: [
        {
          tag: "span.variable-node",
          getAttrs: (dom) => {
            const el = dom as HTMLElement;
            return {
              id: el.getAttribute("data-id") || "",
              name: el.getAttribute("data-name") || "",
              value: el.getAttribute("data-value") || "",
            };
          },
        },
      ],
    },
    resource: {
      attrs: { id: {}, url: {}, name: {}, thumbnail_url: { default: "" } },
      group: "inline",
      inline: true,
      selectable: true,
      draggable: true,
      atom: true,
      toDOM: (node) => {
        // 对于视频，使用缩略图作为 img src；对于图片，直接使用 url
        const thumbnailUrl = node.attrs.thumbnail_url || getThumbnailUrlFromAssetUrl(node.attrs.url);
        const imgSrc = thumbnailUrl || node.attrs.url;
        return [
          "span",
          {
            class: "resource-node",
            "data-id": node.attrs.id,
            "data-url": node.attrs.url,
            "data-name": node.attrs.name,
          },
          ["img", { src: imgSrc, draggable: "false", class: "object-cover" }],
          ["span", { class: "label" }, node.attrs.name],
        ];
      },
      parseDOM: [
        {
          tag: "span.resource-node",
          getAttrs: (dom) => {
            const el = dom as HTMLElement;
            const id = el.getAttribute("data-id") || "";
            const url = el.getAttribute("data-url") || "";
            const name = el.getAttribute("data-name") || "";
            // 根据资源URL自动拼接缩略图URL
            const thumbnailUrl = getThumbnailUrlFromAssetUrl(url);

            return {
              id,
              url,
              name,
              thumbnail_url: thumbnailUrl,
            };
          },
        },
      ],
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
                const className = node.type.name === "resource" ? "resource-node-selected" : "variable-node-selected";
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

export function useEditor(
  editorRef: Ref<HTMLElement | null>,
  props: {
    modelValue?: Ref<string | undefined>;
    resources?: Ref<ResourceItem[] | undefined>;
    variables?: Ref<VariableItem[] | undefined>;
  },
  emit: {
    (e: "update:modelValue", value: string): void;
    (e: "resource-insert", resource: ResourceItem): void;
    (e: "variable-insert", variable: VariableItem): void;
  },
) {
  let view: EditorView | null = null;
  let mutationObserver: MutationObserver | null = null;

  // 菜单状态
  const menuVisible = ref(false);
  const menuPosition = ref<MenuPosition>({ left: "0px", top: "0px", origin: "top left", side: "bottom" });
  const activeIndex = ref(0);
  const mentionQuery = ref("");
  const menuType = ref<"resource" | "variable">("variable"); // 当前激活的分类

  // 预览状态
  const previewVisible = ref(false);
  const previewUrl = ref("");
  const previewTitle = ref("");
  const previewType = ref<"image" | "video">("image");
  const previewPosition = ref<{ left: string; top: string; transform?: string }>({ left: "0px", top: "0px" });

  // 全屏预览状态
  const fullscreenVisible = ref(false);
  const fullscreenUrl = ref("");
  const fullscreenType = ref<"image" | "video">("image");

  // 计时器
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;

  // 过滤后的资源和变量
  const filteredResources = ref<ResourceItem[]>([]);
  const filteredVariables = ref<VariableItem[]>([]);

  // 获取纯文本
  function getPlainText(): string {
    if (!view) return "";
    let text = "";
    view.state.doc.descendants((node) => {
      if (node.type.name === "resource") {
        text += `@${node.attrs.name} `;
      } else if (node.type.name === "variable") {
        text += `@${node.attrs.name}`;
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
        text += `@${node.attrs.name} `;
      } else if (node.type.name === "variable") {
        text += node.attrs.value;
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
  function showMenu(coords: { left: number; top: number; bottom: number; right: number }, type: "resource" | "variable" = "variable") {
    menuType.value = type;
    // 同时显示变量和资源
    filteredVariables.value = unref(props.variables) || [];
    filteredResources.value = unref(props.resources) || [];

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
    filteredResources.value = [];
    filteredVariables.value = [];
  }

  // 插入选中的资源
  function insertSelectedItem(item: ResourceItem | VariableItem, type?: "resource" | "variable") {
    if (!view) return;
    const { from } = view.state.selection;

    // 使用传入的 type 参数，如果没有则使用 menuType.value
    const itemType = type || menuType.value;

    if (itemType === "resource") {
      const resourceItem = item as ResourceItem;
      const thumbnailUrl = resourceItem.thumbnail_url || getThumbnailUrlFromAssetUrl(resourceItem.url, resourceItem.type);
      const resourceNode = mySchema.nodes.resource;
      if (!resourceNode) return;
      const tr = view.state.tr.replaceWith(
        from - 1 - mentionQuery.value.length,
        from,
        resourceNode.create({
          id: resourceItem.id,
          url: resourceItem.url,
          name: resourceItem.name,
          thumbnail_url: thumbnailUrl,
        }),
      );
      tr.insertText(" ");
      view.dispatch(tr);
      emit("resource-insert", resourceItem);
    } else {
      const variableItem = item as VariableItem;
      const variableNode = mySchema.nodes.variable;
      if (!variableNode) return;
      const tr = view.state.tr.replaceWith(
        from - 1 - mentionQuery.value.length,
        from,
        variableNode.create({
          id: variableItem.id,
          name: variableItem.name,
          value: variableItem.value,
        }),
      );
      view.dispatch(tr);
      emit("variable-insert", variableItem);
    }

    hideMenu();
    view.focus();
  }

  // 处理菜单悬停
  function handleMenuHover(index: number, type: "resource" | "variable") {
    activeIndex.value = index;
    menuType.value = type;
  }

  // 处理菜单类型切换（已废弃，保留接口兼容性）
  function handleMenuTypeSwitch(type: "resource" | "variable") {
    // 不再需要切换，只更新当前激活的类型
    menuType.value = type;
    activeIndex.value = 0;
  }

  // 处理资源节点鼠标进入
  function handleResourceMouseEnter(node: HTMLElement) {
    const isSelected = node.classList.contains("ProseMirror-selectednode") || node.classList.contains("resource-node-selected");

    if (isSelected) return;

    if (hoverTimer) clearTimeout(hoverTimer);

    hoverTimer = setTimeout(() => {
      const url = node.getAttribute("data-url") || "";
      const name = node.getAttribute("data-name") || "";

      if (!url) return;

      const isVideoFile = isVideoUrl(url);

      previewUrl.value = url;
      // previewTitle.value = `${isVideoFile ? "视频" : "图片"} ${name}`;
      previewTitle.value = name;
      previewType.value = isVideoFile ? "video" : "image";

      const rect = node.getBoundingClientRect();
      const margin = 12;
      const previewMaxWidth = 400;

      // 水平居中：标签中心点 - 预览框宽度的一半
      let left = rect.left + rect.width / 2;

      // 默认显示在标签下方
      let top = rect.bottom + margin;

      // 边缘检测：如果超出视口右边界，调整 left
      if (left + previewMaxWidth / 2 > window.innerWidth) {
        left = window.innerWidth - previewMaxWidth / 2 - 10;
      }
      // 边缘检测：如果超出视口左边界
      if (left - previewMaxWidth / 2 < 0) {
        left = previewMaxWidth / 2 + 10;
      }

      // 垂直方向：如果下方空间不足，显示在标签上方
      const spaceBelow = window.innerHeight - rect.bottom;
      if (spaceBelow < 200) {
        top = rect.top - margin;
        // 标记为显示在上方（用于 CSS 调整）
        previewPosition.value = {
          left: `${left}px`,
          top: `${top}px`,
          transform: "translateX(-50%) translateY(-100%)",
        };
      } else {
        previewPosition.value = {
          left: `${left}px`,
          top: `${top}px`,
          transform: "translateX(-50%)",
        };
      }

      previewVisible.value = true;
    }, 500);
  }

  // 处理资源节点鼠标离开
  function handleResourceMouseLeave() {
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    previewVisible.value = false;
  }

  // 处理资源节点点击
  function handleResourceClick(node: HTMLElement) {
    const url = node.getAttribute("data-url") || "";
    if (!url) return;

    fullscreenUrl.value = url;
    fullscreenType.value = isVideoUrl(url) ? "video" : "image";
    fullscreenVisible.value = true;
  }

  // 关闭全屏预览
  function closeFullscreen() {
    fullscreenVisible.value = false;
  }

  // 存储资源节点图片的取消加载函数
  const resourceCleanupMap = new WeakMap<HTMLImageElement, () => void>();

  // 绑定 atom 节点事件（资源和变量）
  function bindResourceEvents() {
    // 查询所有 atom 节点
    const selector = ATOM_NODE_CLASSES.map(cls => `.${cls}`).join(", ");
    const atomNodes = document.querySelectorAll(selector);

    atomNodes.forEach((node) => {
      const el = node as HTMLElement;

      // 只为资源节点绑定鼠标事件（变量节点不需要预览）
      if (el.classList.contains("resource-node")) {
        el.onmouseenter = () => handleResourceMouseEnter(el);
        el.onmouseleave = handleResourceMouseLeave;
        el.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
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
          };
          const cleanup = loadImageWithThumbnail(img, resourceItem, true);
          resourceCleanupMap.set(img, cleanup);
        }
      }
    });
  }

  // 键盘上移
  function moveUp() {
    if (!menuVisible.value) return false;

    const variablesCount = filteredVariables.value.length;
    const resourcesCount = filteredResources.value.length;
    const totalCount = variablesCount + resourcesCount;

    if (totalCount === 0) return false;

    // 计算当前全局索引
    let currentGlobalIndex = menuType.value === "variable"
      ? activeIndex.value
      : variablesCount + activeIndex.value;

    // 向上移动
    currentGlobalIndex = (currentGlobalIndex - 1 + totalCount) % totalCount;

    // 更新类型和索引
    if (currentGlobalIndex < variablesCount) {
      menuType.value = "variable";
      activeIndex.value = currentGlobalIndex;
    } else {
      menuType.value = "resource";
      activeIndex.value = currentGlobalIndex - variablesCount;
    }

    return true;
  }

  // 键盘下移
  function moveDown() {
    if (!menuVisible.value) return false;

    const variablesCount = filteredVariables.value.length;
    const resourcesCount = filteredResources.value.length;
    const totalCount = variablesCount + resourcesCount;

    if (totalCount === 0) return false;

    // 计算当前全局索引
    let currentGlobalIndex = menuType.value === "variable"
      ? activeIndex.value
      : variablesCount + activeIndex.value;

    // 向下移动
    currentGlobalIndex = (currentGlobalIndex + 1) % totalCount;

    // 更新类型和索引
    if (currentGlobalIndex < variablesCount) {
      menuType.value = "variable";
      activeIndex.value = currentGlobalIndex;
    } else {
      menuType.value = "resource";
      activeIndex.value = currentGlobalIndex - variablesCount;
    }

    return true;
  }

  // 键盘确认
  function handleEnter() {
    if (menuVisible.value) {
      const item = menuType.value === "variable"
        ? filteredVariables.value[activeIndex.value]
        : filteredResources.value[activeIndex.value];

      if (item) {
        insertSelectedItem(item, menuType.value);
        return true;
      }
    }
    return false;
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
    const state = EditorState.create({
      schema: mySchema,
      doc: mySchema.node("doc", null, [mySchema.node("paragraph", null, initialValue ? [mySchema.text(initialValue)] : [])]),
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
              // 同时显示变量和资源
              const allVariables = unref(props.variables) || [];
              const allResources = unref(props.resources) || [];

              if (allVariables.length > 0 || allResources.length > 0) {
                // 优先激活变量分类
                showMenu({ left: coords.left, top: coords.top, bottom: coords.bottom, right: coords.right }, allVariables.length > 0 ? "variable" : "resource");
              }
            } else if (textBefore) {
              const atIndex = textBefore.lastIndexOf("@");
              if (atIndex !== -1) {
                mentionQuery.value = textBefore.slice(atIndex + 1);
                const coords = view.coordsAtPos(sel.from);

                // 同时搜索变量和资源
                const allVariables = unref(props.variables) || [];
                const allResources = unref(props.resources) || [];
                const matchedVariables = allVariables.filter((v) => v.name.toLowerCase().includes(mentionQuery.value.toLowerCase()));
                const matchedResources = allResources.filter((r) => r.name.toLowerCase().includes(mentionQuery.value.toLowerCase()));

                filteredVariables.value = matchedVariables;
                filteredResources.value = matchedResources;

                if (matchedVariables.length > 0 || matchedResources.length > 0) {
                  // 优先激活有匹配结果的分类
                  showMenu({ left: coords.left, top: coords.top, bottom: coords.bottom, right: coords.right }, matchedVariables.length > 0 ? "variable" : "resource");
                } else if (allVariables.length > 0 || allResources.length > 0) {
                  // 如果都没有匹配，显示所有项
                  filteredVariables.value = allVariables;
                  filteredResources.value = allResources;
                  showMenu({ left: coords.left, top: coords.top, bottom: coords.bottom, right: coords.right }, allVariables.length > 0 ? "variable" : "resource");
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
        slice.content.forEach((node) => {
          if (node.type.name === "resource") {
            text += `@${node.attrs.name} `;
          } else if (node.type.name === "variable") {
            text += `@${node.attrs.name}`;
          } else if (node.isText) {
            // 过滤掉零宽空格
            text += node.text?.replace(/\u200B/g, "") || "";
          } else if (node.isBlock) {
            text += "\n";
          }
        });
        return text;
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
          tr.insert(0, mySchema.text(newValue));
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
          filteredResources.value = newResources.filter((r) => r.name.toLowerCase().includes(mentionQuery.value.toLowerCase()));
        } else {
          filteredResources.value = newResources;
        }
      }
    },
    { deep: true },
  );

  // 监听 variables 变化，更新过滤列表
  watch(
    () => unref(props.variables),
    (newVariables) => {
      if (menuVisible.value && newVariables) {
        if (mentionQuery.value) {
          filteredVariables.value = newVariables.filter((v) => v.name.toLowerCase().includes(mentionQuery.value.toLowerCase()));
        } else {
          filteredVariables.value = newVariables;
        }
      }
    },
    { deep: true },
  );

  return {
    // 菜单
    menuVisible,
    menuPosition,
    activeIndex,
    menuType,
    filteredResources,
    filteredVariables,
    insertSelectedItem,
    handleMenuHover,
    handleMenuTypeSwitch,
    // 预览
    previewVisible,
    previewUrl,
    previewTitle,
    previewType,
    previewPosition,
    // 全屏预览
    fullscreenVisible,
    fullscreenUrl,
    fullscreenType,
    closeFullscreen,
    // 导出方法
    exportText,
    serializeDoc,
    deserializeDoc,
  };
}
