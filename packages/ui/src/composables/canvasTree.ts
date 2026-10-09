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

/**
 * 这个节点在抽屉里**算不算「分组」**（要排在普通节点前面）。
 *
 * 判据与会话里其它地方一致（图标映射 / 分组能力都认这两个字段）：
 * - type === 'group'（分组插件注册的类型名）；
 * - 或 data.nodeType === 'group'（渲染层把节点包成 custom 时类型写在 data 里）。
 * 刻意**不**用「有没有 children」判：那会把「只有一个孩子的普通节点」也算成分组（不成立）。
 */
function isGroupLike(node: CanvasNodeLike): boolean {
  return effectiveType(node) === 'group'
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
 * 节点的**缩略图**地址（能塞进 <img> 的图）。拿不到就 undefined（用类型图标兜底）。
 *
 * 视频节点**不再回落到 videoUrl**（裂图根因，用户 2026-10-08 报「视频没有缩略图」）：
 * mp4 地址塞进 <img> 必然裂图，还给不出任何视频标识。视频的播放地址改走 nodeVideoUrl，
 * 抽屉用 <video preload=metadata> 显示首帧；没有海报图时缩略图就是"没有"，
 * 由渲染方用**视频图标 + 播放角标**兜底（不再是裂图）。
 */
export function nodeThumbUrl(node: CanvasNodeLike): string | undefined {
  const d = (node.data ?? {}) as Record<string, unknown>
  const t = effectiveType(node)
  const candidates = t === 'video' ? [d.posterUrl, d.thumbUrl] : [d.imageUrl, d.thumbUrl, d.panoUrl]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c
  }
  return undefined
}

/**
 * 视频节点的**播放地址**（抽屉缩略图用 <video preload="metadata"> 显示首帧）。
 *
 * 只对视频节点给值；拿不到就 undefined（给不出就用图标兜底）。
 * 为什么抽屉要单独一个字段：thumb 只认图（见上），而视频需要真正的 <video> 才能出首帧。
 */
export function nodeVideoUrl(node: CanvasNodeLike): string | undefined {
  if (effectiveType(node) !== 'video') return undefined
  const d = (node.data ?? {}) as Record<string, unknown>
  const v = d.videoUrl
  return typeof v === 'string' && v.trim() ? v : undefined
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

  /**
   * 排序：**分组在前、普通节点在后**（用户口径 2026-10-08：「分组类似于文件夹，统一显示在最上面」）。
   *
   * 为什么在数据层排、而不是在渲染层排：树的每一层都有这个需求（顶层分组要提前，
   * 分组里的子分组同样要提前 —— 否则「分组 2 在图片 3 下面」这种还是刺眼），
   * 在 `toTree` 里对 kids 递归调用同一个函数，一次就能覆盖所有层。
   * 组内相对顺序 / 普通节点之间的相对顺序一律**保持画布节点的原始顺序**（Array.sort 稳定），
   * 不引入第二套排序键（画布顺序才是用户能感知、能拖拽调整的那个顺序）。
   */
  const groupsFirst = (list: CanvasNodeLike[]): CanvasNodeLike[] =>
    list.every(isGroupLike) || list.every((n) => !isGroupLike(n))
      ? list // 全是分组 / 全是普通节点：顺序无关，省一次拷贝
      : [...list].sort((a, b) => Number(isGroupLike(b)) - Number(isGroupLike(a)))

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
    const video = nodeVideoUrl(n)
    if (video) node.video = video
    if (kids && kids.length) node.children = groupsFirst(kids).map(toTree)
    return node
  }

  return groupsFirst(roots).map(toTree)
}

/** 类型过滤的中文名 → 树的 icon 值（'全部' 不在表里 = 不过滤） */
export const TYPE_FILTER: Record<string, string> = {
  图片: 'image', 视频: 'video', 音频: 'audio', 文本: 'text', 分组: 'group',
}

/** 树里的一段同层节点（行块；宫格模式下一段 = 一个三列网格） */
export interface CanvasTreeNodeRow {
  id: string
  name: string
  icon: TreeNode['icon']
  /** 缩略图地址（图片/视频节点） */
  thumb?: string
  /** 视频播放地址（缩略图出首帧用；与 TreeNode.video 同源） */
  video?: string
}

/**
 * 抽屉「画布」树的行块：分组头 + 一段同层节点。
 *
 * 为什么不是嵌套结构：递归渲染在模板里要子组件才能自引用，而「分组头 + 缩进节点」
 * 本质上是一维有序块 —— 拍平（= 前序遍历）后模板一个循环就能画，测试也能纯函数锁。
 * 分组头带 depth（缩进 = depth × 24px），节点段同理；宫格模式下每段自成一组三列。
 */
export type CanvasTreeBlock =
  | { kind: 'group'; key: string; id: string; name: string; depth: number; collapsed: boolean }
  | { kind: 'run'; key: string; depth: number; nodes: CanvasTreeNodeRow[] }

/**
 * 把嵌套树拍平成「行块」序列（前序：分组头 → 其子块递归），支持任意层嵌套。
 *
 * 关键行为（用户报的「第二层没实现」就是缺这段递归）：
 * - 子节点自己也是分组（有 children）时，它出**分组头块**并继续往下走 ——
 *   老模板只画一层孩子，嵌套分组的整棵子树会被丢掉；
 * - 折叠的分组只出分组头，不出子块；
 * - 连续的同层节点并成一个 run（宫格模式一个 run 画成一个三列网格，
 *   这样每层各自成网格、缩进不打架）。
 *
 * @param tree 树（可见性/搜索过滤后的都行）
 * @param isCollapsed 某分组是否折叠（宿主给，函数本身不持状态）
 */
export function canvasTreeBlocks(
  tree: TreeNode[],
  isCollapsed: (id: string) => boolean,
): CanvasTreeBlock[] {
  const out: CanvasTreeBlock[] = []
  let run: CanvasTreeNodeRow[] = []
  let runDepth = 0
  const flush = (): void => {
    if (run.length === 0) return
    out.push({ kind: 'run', key: `run:${runDepth}:${run[0].id}`, depth: runDepth, nodes: run })
    run = []
  }
  const walk = (list: TreeNode[], depth: number): void => {
    for (const n of list) {
      if (n.children && n.children.length > 0) {
        flush() // 分组头是整行，隔断同层节点段（宫格里不会和上一段挤在同一行）
        const collapsed = isCollapsed(n.id)
        out.push({ kind: 'group', key: `group:${n.id}`, id: n.id, name: n.name, depth, collapsed })
        if (!collapsed) walk(n.children, depth + 1)
        continue
      }
      if (run.length > 0 && runDepth !== depth) flush()
      runDepth = depth
      const row: CanvasTreeNodeRow = { id: n.id, name: n.name, icon: n.icon }
      if (n.thumb) row.thumb = n.thumb
      if (n.video) row.video = n.video
      run.push(row)
    }
  }
  walk(tree, 0)
  flush()
  return out
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
