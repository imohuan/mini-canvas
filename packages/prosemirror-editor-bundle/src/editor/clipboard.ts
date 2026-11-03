import { Plugin, PluginKey } from "prosemirror-state";
import type { ResourceItem } from "../types";
import { encodeNodeRef, REF_ICONS } from "../referenceMarkup";
import { buildResourceNode } from "./resourceNode";
import { buildSlotItem, itemRegistry } from "./chipRegistry";
import { mySchema } from "./schema";

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
export function createPasteHandlerPlugin(
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
