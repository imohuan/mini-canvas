import { formatReferenceMarkup } from "../referenceMarkup";

export function plainTextOf(doc: any): string {
  let text = "";
  doc.descendants((node: any) => {
    if (node.type.name === "resource") {
      // 引用类标签（技能 / MCP / 节点）导出成**标记文本**：`@[kind:name](value)`。
      // 它是后端认「引用了哪一种、引用了谁」的唯一凭据，也是删标签即失效的那份真相。
      // 其它标签（图片 / 视频素材）维持旧的 `@名字` —— 它们只是展示，不需要后端解析。
      if (node.attrs.refKind) {
        text += formatReferenceMarkup(node.attrs.refKind, node.attrs.name || node.attrs.id, node.attrs.refValue, {
          ...(node.attrs.refExt ? { ext: node.attrs.refExt } : {}),
          ...(node.attrs.refFolderId ? { folderId: node.attrs.refFolderId } : {}),
          // 内容类型（image / video / audio / text）：重开会话后靠它画对标签图标
          ...(node.attrs.chipKind ? { contentKind: node.attrs.chipKind } : {}),
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

/** 导出文本，将变量替换为真实值 */
export function exportTextOf(doc: any): string {
  let text = "";
  doc.descendants((node: any) => {
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

/** 复制走的文本要和输入框里的一致：引用类标签复制成标记，其它照旧 @名字。 */
export function clipboardTextOf(slice: { content: any }): string {
  let text = "";
  function collect(fragment: any) {
    fragment.forEach((node: any) => {
      if (node.type.name === "resource") {
        // 复制走的文本要和输入框里的一致：引用类标签复制成标记，其它照旧 @名字。
        text += node.attrs.refKind
          ? formatReferenceMarkup(node.attrs.refKind, node.attrs.name || node.attrs.id, node.attrs.refValue, {
              ...(node.attrs.refExt ? { ext: node.attrs.refExt } : {}),
              ...(node.attrs.refFolderId ? { folderId: node.attrs.refFolderId } : {}),
              ...(node.attrs.chipKind ? { contentKind: node.attrs.chipKind } : {}),
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
}

