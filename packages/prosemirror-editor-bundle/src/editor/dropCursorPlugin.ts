import { Plugin, PluginKey } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

// 拖拽参考线插件配置
interface DropCursorOptions {
  color?: string;
  width?: number;
  class?: string;
}

// 创建拖拽参考线插件
export function createDropCursorPlugin(options: DropCursorOptions = {}) {
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
