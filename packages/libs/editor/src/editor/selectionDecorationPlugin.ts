import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { isAtomNode } from "./atomDelete";

// 创建选中装饰插件
export function createSelectionDecorationPlugin() {
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
