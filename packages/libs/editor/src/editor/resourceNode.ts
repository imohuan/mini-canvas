import type { Node as PMNode } from "prosemirror-model";
import type { ResourceItem } from "../types";
import { getThumbnailUrlFromAssetUrl } from "../utils";

export function buildResourceNode(nodeType: any, item: ResourceItem): any {
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
  /**
   * 新身份（ref-node / ref-name）**原样保留**（用户 2026-10-28 定案）。
   *
   * 只有既不是新身份、又不是显式引用（技能/MCP/资产）的裸标签，才按老规则
   * 从名字推 `ref-slot:*`（兼容别的调用方，底栏已经不再产生这种 id）。
   */
  const keepId =
    item.ref != null ||
    item.id.startsWith('ref-node:') ||
    item.id.startsWith('ref-name:') ||
    item.id.startsWith('ref-slot:')
  const canonicalId = keepId ? item.id : slotIdFromName(item.name) ?? item.id
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
    // 参考标签的类型（用户 2026-10-28）：落进文档，冷启动注册表为空也能画对图标。
    chipKind: item.chipKind || '',
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
 * 这颗标签需要改文档吗？（url / 名字真的变了才需要）
 *
 * 为什么单独抽出来（用户 2026-10-27 报「点标签后光标先跳到前面再跳回来」）：
 * 底栏的标签刷新（replaceResourceThumbByName / refreshChips）会被 watcher 反复调用。
 * 以前它们无条件 setNodeMarkup —— attrs 一个字没变也算「文档改动」，ProseMirror 会
 * 重建节点，整颗选中随之销毁，浏览器就把光标就近放到标签**前面**。
 * 内容相同就绝不产生事务，从这个源头掐掉"先跳前面"的那一步。
 */
export function chipAttrsNeedUpdate(
  attrs: { url?: string | null; name?: string | null; thumbnail_url?: string | null; id?: string | null },
  want: { url?: string | null; name?: string | null; id?: string | null },
): boolean {
  if (want.id != null && String(attrs.id ?? '') !== String(want.id)) return true
  if ((attrs.url ?? '') !== (want.url ?? '')) return true
  if (want.name != null && String(attrs.name ?? '') !== String(want.name)) return true
  return false
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
