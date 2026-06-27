import { Schema } from "prosemirror-model";
import { EditorState, Plugin, PluginKey } from "prosemirror-state";
import { EditorView, Decoration, DecorationSet } from "prosemirror-view";
import { schema as baseSchema } from "prosemirror-schema-basic";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { history } from "prosemirror-history";
import type { ResourceItem } from "./types";
import { getThumbnailUrlFromAssetUrl } from "./utils";

// 创建 Schema
const mySchema = new Schema({
  nodes: baseSchema.spec.nodes.append({
    resource: {
      attrs: { id: {}, url: {}, name: {}, thumbnail_url: { default: "" } },
      group: "inline",
      inline: true,
      selectable: true,
      draggable: true,
      atom: true,
      toDOM: (node) => {
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
          ["img", { src: imgSrc, draggable: "false" }],
          ["span", { class: "label" }, node.attrs.name],
          ["span", { class: "cursor-anchor" }, "\u200B"],
        ];
      },
      parseDOM: [
        {
          tag: "span.resource-node",
          getAttrs: (dom) => {
            const el = dom as HTMLElement;
            return {
              id: el.getAttribute("data-id") || "",
              url: el.getAttribute("data-url") || "",
              name: el.getAttribute("data-name") || "",
              thumbnail_url: getThumbnailUrlFromAssetUrl(el.getAttribute("data-url") || ""),
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
            if (node.type.name === "resource") {
              const nodeFrom = pos;
              const nodeTo = pos + node.nodeSize;
              const isInSelection = selection.from <= nodeFrom && selection.to >= nodeTo;
              const isNodeSelection = (selection as any).node && selection.from === nodeFrom;

              if (isInSelection || isNodeSelection) {
                decorations.push(
                  Decoration.node(nodeFrom, nodeTo, {
                    class: "resource-node-selected",
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

class ProseMirrorEditorElement extends HTMLElement {
  private view: EditorView | null = null;
  private resources: ResourceItem[] = [];
  private menuElement: HTMLElement | null = null;
  private menuVisible = false;
  private filteredResources: ResourceItem[] = [];
  private activeIndex = 0;
  private mentionQuery = "";

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  static get observedAttributes() {
    return ["value", "resources", "placeholder"];
  }

  connectedCallback() {
    this.render();
    this.initEditor();
  }

  disconnectedCallback() {
    if (this.view) {
      this.view.destroy();
    }
  }

  attributeChangedCallback(name: string, _oldValue: string, newValue: string) {
    if (name === "resources" && newValue) {
      try {
        this.resources = JSON.parse(newValue);
      } catch (e) {
        console.error("解析 resources 失败:", e);
      }
    }
  }

  private render() {
    if (!this.shadowRoot) return;

    const style = document.createElement("style");
    style.textContent = `
      :host { display: block; width: 100%; height: 100%; }
      .prose-mirror-editor { width: 100%; height: 100%; outline: none; }
      .editor-container { width: 100%; height: 100%; min-height: 120px; }
      .ProseMirror { outline: none !important; min-height: 120px; font-size: 16px; line-height: 1.5; color: #111; }
      .resource-node { display: inline-flex; align-items: center; padding: 0 4px; cursor: pointer; vertical-align: bottom; user-select: none; background: transparent; line-height: 1; position: relative; height: 24px; border-bottom: 1px solid #111; }
      .resource-node img { width: 18px; height: 18px; border-radius: 2px; margin-right: 4px; display: block; pointer-events: none; background-color: transparent; align-self: center; }
      .resource-node .label { color: #374151; white-space: nowrap; pointer-events: none; font-size: 16px; align-self: center; font-weight: 600; line-height: 1.2; }
      .resource-node .cursor-anchor { display: inline; width: 0; height: 0; overflow: hidden; }
      .ProseMirror-selectednode.resource-node { background-color: #2b6df2 !important; color: #ffffff !important; outline: none; height: 24px; align-items: center; }
      .ProseMirror-selectednode.resource-node .label { color: #ffffff !important; }
      .ProseMirror-selectednode.resource-node img { background-color: transparent !important; }
      .resource-node-selected { background-color: #2b6df2 !important; color: #ffffff !important; outline: none; height: 24px; align-items: center; }
      .resource-node-selected .label { color: #ffffff !important; }
      .ProseMirror ::selection { background-color: #2b6df2 !important; color: #ffffff !important; }
      .resource-node img::selection { background: transparent !important; }
      .mention-menu { position: fixed; z-index: 9999; background: white; border-radius: 8px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15); border: 1px solid #e5e7eb; width: 200px; padding: 6px; max-height: 280px; overflow-y: auto; }
      .mention-menu .menu-item { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 6px; cursor: pointer; transition: background-color 0.15s ease; }
      .mention-menu .menu-item:hover { background-color: #f3f4f6; }
      .mention-menu .menu-item.active { background-color: #eff6ff; color: #2b6df2; }
      .mention-menu .menu-item img { width: 24px; height: 24px; border-radius: 4px; object-fit: cover; flex-shrink: 0; background-color: #f3f4f6; }
      .mention-menu .menu-item span { font-size: 14px; color: #374151; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .mention-menu .menu-item.active span { color: #2b6df2; }
    `;

    const container = document.createElement("div");
    container.className = "prose-mirror-editor";

    const editorContainer = document.createElement("div");
    editorContainer.className = "editor-container";
    container.appendChild(editorContainer);

    this.menuElement = document.createElement("div");
    this.menuElement.className = "mention-menu";
    this.menuElement.style.display = "none";
    container.appendChild(this.menuElement);

    this.shadowRoot.appendChild(style);
    this.shadowRoot.appendChild(container);
  }

  private initEditor() {
    if (!this.shadowRoot) return;

    const editorContainer = this.shadowRoot.querySelector(".editor-container") as HTMLElement;
    if (!editorContainer) return;

    const initialValue = this.getAttribute("value") || "";

    const state = EditorState.create({
      schema: mySchema,
      doc: mySchema.node("doc", null, [
        mySchema.node("paragraph", null, initialValue ? [mySchema.text(initialValue)] : [])
      ]),
      plugins: [
        history(),
        createSelectionDecorationPlugin(),
        this.createMentionKeymap(),
        keymap(baseKeymap),
      ],
    });

    this.view = new EditorView(editorContainer, {
      state,
      dispatchTransaction: (transaction) => {
        if (!this.view) return;
        const newState = this.view.state.apply(transaction);
        this.view.updateState(newState);

        const plainText = this.getPlainText();
        this.dispatchEvent(new CustomEvent("change", { detail: { value: plainText } }));

        this.handleMentionMenu(newState);
      },
    });
  }

  private createMentionKeymap() {
    return keymap({
      ArrowUp: () => this.moveUp(),
      ArrowDown: () => this.moveDown(),
      Enter: () => this.handleEnter(),
      Escape: () => {
        if (!this.menuVisible) return false;
        this.hideMenu();
        return true;
      },
    });
  }

  private handleMentionMenu(state: EditorState) {
    const sel = state.selection;
    if (sel.empty && (sel as any).$cursor) {
      const $cursor = (sel as any).$cursor;
      const nodeBefore = $cursor.nodeBefore;

      if (nodeBefore && nodeBefore.isText) {
        const textBefore = nodeBefore.text;
        if (textBefore && textBefore.endsWith("@")) {
          this.mentionQuery = "";
          this.showMenu();
        } else if (textBefore) {
          const atIndex = textBefore.lastIndexOf("@");
          if (atIndex !== -1) {
            this.mentionQuery = textBefore.slice(atIndex + 1);
            this.filteredResources = this.resources.filter((r) =>
              r.name.toLowerCase().includes(this.mentionQuery.toLowerCase())
            );
            this.showMenu();
          } else {
            this.hideMenu();
          }
        } else {
          this.hideMenu();
        }
      } else {
        this.hideMenu();
      }
    } else {
      this.hideMenu();
    }
  }

  private showMenu() {
    if (!this.menuElement || !this.view) return;

    this.filteredResources = this.resources;
    this.menuVisible = true;
    this.activeIndex = 0;

    const coords = this.view.coordsAtPos(this.view.state.selection.from);
    this.menuElement.style.display = "block";
    this.menuElement.style.left = `${coords.left}px`;
    this.menuElement.style.top = `${coords.bottom + 4}px`;

    this.renderMenu();
  }

  private hideMenu() {
    if (!this.menuElement) return;
    this.menuVisible = false;
    this.menuElement.style.display = "none";
  }

  private renderMenu() {
    if (!this.menuElement) return;

    this.menuElement.innerHTML = "";
    this.filteredResources.forEach((resource, index) => {
      const item = document.createElement("div");
      item.className = `menu-item ${index === this.activeIndex ? "active" : ""}`;
      item.innerHTML = `
        <img src="${resource.thumbnail_url || resource.url}" alt="${resource.name}">
        <span>${resource.name}</span>
      `;
      item.onclick = () => this.insertResource(resource);
      this.menuElement!.appendChild(item);
    });
  }

  private moveUp() {
    if (!this.menuVisible) return false;
    this.activeIndex = (this.activeIndex - 1 + this.filteredResources.length) % this.filteredResources.length;
    this.renderMenu();
    return true;
  }

  private moveDown() {
    if (!this.menuVisible) return false;
    this.activeIndex = (this.activeIndex + 1) % this.filteredResources.length;
    this.renderMenu();
    return true;
  }

  private handleEnter() {
    if (this.menuVisible && this.filteredResources.length > 0) {
      const item = this.filteredResources[this.activeIndex];
      if (item) {
        this.insertResource(item);
      }
      return true;
    }
    return false;
  }

  private insertResource(item: ResourceItem) {
    if (!this.view) return;

    const { from } = this.view.state.selection;
    const thumbnailUrl = item.thumbnail_url || getThumbnailUrlFromAssetUrl(item.url, item.type);
    const resourceNode = mySchema.nodes.resource;

    if (!resourceNode) return;

    const tr = this.view.state.tr.replaceWith(
      from - 1 - this.mentionQuery.length,
      from,
      resourceNode.create({
        id: item.id,
        url: item.url,
        name: item.name,
        thumbnail_url: thumbnailUrl,
      })
    );
    tr.insertText(" ");
    this.view.dispatch(tr);
    this.hideMenu();
    this.view.focus();

    this.dispatchEvent(new CustomEvent("resource-insert", { detail: item }));
  }

  private getPlainText(): string {
    if (!this.view) return "";
    let text = "";
    this.view.state.doc.descendants((node) => {
      if (node.type.name === "resource") {
        text += `@${node.attrs.name} `;
      } else if (node.isText) {
        text += node.text?.replace(/\u200B/g, "") || "";
      } else if (node.isBlock && text.length > 0) {
        text += "\n";
      }
    });
    return text.trim();
  }

  getValue() {
    return this.getPlainText();
  }

  setValue(value: string) {
    if (!this.view) return;
    const tr = this.view.state.tr;
    tr.delete(0, this.view.state.doc.content.size);
    if (value) {
      tr.insert(0, mySchema.text(value));
    }
    this.view.dispatch(tr);
  }

  setResources(resources: ResourceItem[]) {
    this.resources = resources;
  }
}

if (!customElements.get("prosemirror-editor")) {
  customElements.define("prosemirror-editor", ProseMirrorEditorElement);
}

export { ProseMirrorEditorElement };
