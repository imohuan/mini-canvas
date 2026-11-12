import { Plugin, PluginKey } from "prosemirror-state";
import { isAtomNode } from "./atomDelete";

// 创建光标修复插件：在特殊情况下插入零宽空格文本节点
// 只处理：1. 行首/行尾的标签 2. 两个标签相邻的情况
export function createCursorFixPlugin() {
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
