/**
 * canvasTree —— 把**真实画布节点**折成左侧抽屉要的树（纯函数，Node 可单测）。
 *
 * 为什么单独一个纯函数：左抽屉的树以前是写死的假数组；现在要"跟着画布数据实时画"，
 * 但真正容易出错的只是"parentId → 分组树"这一段，把它抽出来单测，组件只管画。
 *
 * 规则（用户口径）：
 * - 分组 = 有 children 的节点（画布里的 group 节点就是 parentId 指向它）；
 * - 名字**全部来自节点自身**（图片用 imageName、音频用 audioName、文本用首行 text…）；
 * - 父节点不存在（被删的孤儿）时把子节点升为根 —— 宁可平铺，也不丢节点；
 * - 带上画布坐标，点击时用它 `setCenter` 居中。
 */
import type { TreeNode } from './ui'

/** 抽屉能认的节点最小形状（画布节点 + 我们读得到的字段；不 import 数据层类型） */
export interface CanvasNodeLike {
  id: string
  type: string
  position?: { x: number; y: number }
  parentId?: string | null
  data?: Record<string, unknown>
}

/** 类型 → 抽屉图标（与旧假数据同一套：group/image/video/text） */
function iconOf(type: string): TreeNode['icon'] {
  if (type === 'video') return 'video'
  if (type === 'text') return 'text'
  if (type === 'group') return 'group'
  if (type === 'audio') return 'audio'
  return 'image'
}

/** 节点真正的语义类型：data.nodeType 优先（组/图片/视频会写在 data 里），否则 node.type */
function effectiveType(node: CanvasNodeLike): string {
  const t = (node.data ?? {}).nodeType
  return (typeof t === 'string' && t) || node.type
}

/** 类型 → 中文名（兜底标题用） */
const TYPE_LABEL: Record<string, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  text: '文本',
  group: '分组',
  '3d-preview': '3D 预览',
}

/**
 * 节点显示名：与画布里的名字一致。
 *
 * 优先 data.label（用户改名写在它上面：标题条双击改的就是它）—— 这是用户口径
 * 「侧边栏要跟随画布里的名字」。没有 label 时回落节点自带的名字字段，最后才用**类型名**。
 * **不加"节点"后缀**（用户口径），也**不拿节点文本当名字**（同样是他明确不要的）。
 */
export function nodeDisplayName(node: CanvasNodeLike): string {
  const d = (node.data ?? {}) as Record<string, unknown>
  const candidates = [d.label, d.imageName, d.audioName, d.videoName, d.title, d.name]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim().split('\n')[0].slice(0, 60)
  }
  // 类型名（data.nodeType 优先，它才是节点真正的类型；node.type 可能是渲染层包出来的 custom）
  const t = (typeof d.nodeType === 'string' && d.nodeType) || node.type
  return TYPE_LABEL[t] ?? t
}

/**
 * 节点的缩略图地址（图片用 imageUrl、视频用 posterUrl/thumbUrl）。拿不到就 undefined（用类型图标兜底）。
 */
export function nodeThumbUrl(node: CanvasNodeLike): string | undefined {
  const d = (node.data ?? {}) as Record<string, unknown>
  const t = effectiveType(node)
  const candidates = t === 'video' ? [d.posterUrl, d.thumbUrl, d.videoUrl] : [d.imageUrl, d.thumbUrl, d.panoUrl]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim() && !c.startsWith('res:')) return c
  }
  return undefined
}

/** meta 小字：尺寸 / 时长能给就给，给不了就空串（不硬编"待确认"那类假文案） */
function metaOf(node: CanvasNodeLike): string {
  const d = (node.data ?? {}) as Record<string, unknown>
  const w = typeof d.imageWidth === 'number' ? d.imageWidth : undefined
  const h = typeof d.imageHeight === 'number' ? d.imageHeight : undefined
  if (w && h) return w + ' × ' + h
  const dur = typeof d.audioDuration === 'number' ? d.audioDuration : undefined
  if (dur && dur > 0) return Math.round(dur) + ' 秒'
  return ''
}

/**
 * 由画布节点构建抽屉树。
 *
 * 两遍：先建 id → 节点，再把有父的挂上去、没父的（或父不存在的）当根。
 * 这样即使是"子节点先到、父节点后到"的顺序也不受影响。
 */
export function buildCanvasTree(nodes: CanvasNodeLike[]): TreeNode[] {
  const byId = new Map<string, CanvasNodeLike>()
  for (const n of nodes) byId.set(n.id, n)

  const childrenOf = new Map<string, CanvasNodeLike[]>()
  const roots: CanvasNodeLike[] = []
  for (const n of nodes) {
    const p = typeof n.parentId === 'string' && n.parentId ? n.parentId : ''
    if (p && byId.has(p)) {
      const arr = childrenOf.get(p) ?? []
      arr.push(n)
      childrenOf.set(p, arr)
    } else {
      roots.push(n)
    }
  }

  const toTree = (n: CanvasNodeLike): TreeNode => {
    const kids = childrenOf.get(n.id)
    const t = effectiveType(n)
    const node: TreeNode = {
      id: n.id,
      name: nodeDisplayName(n),
      meta: metaOf(n),
      icon: iconOf(t),
      x: n.position?.x ?? 0,
      y: n.position?.y ?? 0,
    }
    const thumb = nodeThumbUrl(n)
    if (thumb) node.thumb = thumb
    if (kids && kids.length) node.children = kids.map(toTree)
    return node
  }

  return roots.map(toTree)
}

/** 类型过滤的中文名 → 树的 icon 值（'全部' 不在表里 = 不过滤） */
export const TYPE_FILTER: Record<string, string> = {
  图片: 'image', 视频: 'video', 音频: 'audio', 文本: 'text', 分组: 'group',
}

/**
 * 搜索 + 类型过滤（纯函数，Node 可单测）。
 *
 * 规则：叶子要**文本命中且类型命中**才留；分组在自己命中或过滤后还有子节点留下时保留
 * （点分组 = 看它里面的东西）。命中时把分组标记为需要展开（否则命中项藏在折叠里看不见）。
 */
export function filterTree(
  tree: TreeNode[],
  opts: { query?: string; type?: string },
): { nodes: TreeNode[]; expandIds: string[] } {
  const q = (opts.query ?? '').trim().toLowerCase()
  const wantType = opts.type ? TYPE_FILTER[opts.type] : undefined // undefined = 全部
  const expandIds: string[] = []
  const walk = (list: TreeNode[]): TreeNode[] =>
    list
      .map((n) => {
        const isGroup = !!n.children
        const matchesText = !q || n.name.toLowerCase().includes(q)
        const matchesType = !wantType || n.icon === wantType
        if (isGroup) {
          const kids = walk(n.children!)
          if ((matchesText && matchesType) || kids.length) {
            expandIds.push(n.id)
            return { ...n, children: kids }
          }
          return null
        }
        return matchesText && matchesType ? n : null
      })
      .filter((n): n is TreeNode => n !== null)
  return { nodes: walk(tree), expandIds }
}
