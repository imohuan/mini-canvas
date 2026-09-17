/**
 * region —— 节点区域词层（设计文档 §五 十个区域词 / 步骤 3）。
 *
 * 两个职责，全部是纯函数、零 Vue：
 * 1. **词表与映射**：十个闭合区域词（in/title/out:top/out:bottom/out:left/out:right/
 *    on:top/on:bottom/over:inset/over:outset）；老五段（NodeSegment）到区域词的一一映射，
 *    读写两条路径最终落同一个场。
 * 2. **读取合成**：BaseNode 按区域渲染时，把「NodeRegistry 的老段（基座 + 段级贡献，
 *    经映射层归一）」与「node/region 注册场（attach 落点，键 = type/region，含 type='*' 通配）」
 *    合成同一摞 —— 老五段词继续可用（垫片），新区域词同时可读。
 *
 * 栈序沿用既有语义：基座在最前（id='base'），随后条目按 order 升序（order 小者在外）。
 * 同一条目经两条写路径（contribute 兼容层 / attach 场）出现时以**注册 id 去重**，contribute 侧优先 ——
 * 兼容层与场里同 id 的条目是同一次注册，重复渲染会让同一段组件挂两份。
 */
import type { Registry } from '@mini-canvas/kernel'
import type { NodeSegment } from './registry/nodeRegistry'
import type { NodeRegistry } from './registry/nodeRegistry'
import type { NodeSegmentEntry } from './registry/nodeRenderer'

/** 十个区域词（闭合词表；§五：位置决定贴在哪，名字自由） */
export type NodeRegion =
  | 'in'
  | 'title'
  | 'out:top'
  | 'out:bottom'
  | 'out:left'
  | 'out:right'
  | 'on:top'
  | 'on:bottom'
  | 'over:inset'
  | 'over:outset'

/** 词表本体（诊断/枚举用；顺序与设计文档 §五 表格一致） */
export const NODE_REGIONS = [
  'in',
  'title',
  'out:top',
  'out:bottom',
  'out:left',
  'out:right',
  'on:top',
  'on:bottom',
  'over:inset',
  'over:outset',
] as const

/** 老五段 → 区域词（§五「今天的对应（老段名）」列；迁移期垫片的归一表） */
const SEGMENT_TO_REGION: Record<NodeSegment, NodeRegion> = {
  content: 'in',
  title: 'title',
  'top-toolbar': 'out:top',
  'bottom-toolbar': 'out:bottom',
  overlay: 'over:inset',
}

/** 老段词对应哪个区域词 */
export function regionOfSegment(segment: NodeSegment): NodeRegion {
  return SEGMENT_TO_REGION[segment]
}

/** 该区域词是否是老段映射来的（= 迁移期五个「已有」区域；其余五个是本次新增渲染位） */
export function isLegacyRegion(region: string): region is NodeRegion {
  return region === 'in' || region === 'title' || region === 'out:top' ||
    region === 'out:bottom' || region === 'over:inset'
}

/** 场键：type/region（type 可为 '*' 通配所有节点类型） */
export function regionKey(type: string, region: NodeRegion): string {
  return `${type}/${region}`
}

/** 兼容层键：type/老段词（nodeRegistry 段级贡献槽的既有键形） */
export function legacySegmentKey(type: string, segment: NodeSegment): string {
  return `${type}/${segment}`
}

/** 区域侧参数容错：老段词当区域词传入时归一到区域词（读写两条路径最终落同一个场） */
export function normalizeRegionKey(region: string): NodeRegion {
  const segs: NodeSegment[] = ['content', 'title', 'top-toolbar', 'bottom-toolbar', 'overlay']
  for (const s of segs) {
    if (s === region) return SEGMENT_TO_REGION[s]
  }
  return region as NodeRegion
}

/**
 * attach 场条目的值形状（§8.3：needs/props 是这条目自己的数据，随 value 存）。
 */
export interface NodeRegionAttachment {
  component: unknown
  needs?: string[]
  props?: Record<string, unknown>
}

/** 场条目读回形状（component 取出后 id/order 与 NodeSegmentEntry 同构） */
interface RegionFieldEntry {
  id: string
  order: number
  value: NodeRegionAttachment | unknown
}

/**
 * 某节点某区域的完整渲染摞：NodeRegistry 老段（若有，经映射层）+ node/region 场条目。
 *
 * @param registry   节点展示注册表（老五段读写路径；缺省 = 不读兼容层）
 * @param regionField node/region 注册场（attach 落点；缺省 = 只读兼容层）
 * @param type       节点类型
 * @param region     区域词（老段词也容忍，内部归一）
 */
export function nodeRegionStackEntries(
  registry: NodeRegistry | undefined,
  regionField:
    | Pick<Registry<unknown>, 'list'>
    | { list(key: string): RegionFieldEntry[] }
    | undefined,
  type: string,
  region: string,
): NodeSegmentEntry[] {
  const reg = normalizeRegionKey(region)
  const entries: NodeSegmentEntry[] = []
  const seen = new Set<string>()
  const push = (id: string, component: unknown): void => {
    if (seen.has(id)) return
    seen.add(id)
    entries.push({ id, component })
  }

  // ① 兼容层：仅老段映射的区域有（基座固定 id='base'，随后段级贡献按 order）
  if (registry && isLegacyRegion(reg)) {
    const seg = (Object.keys(SEGMENT_TO_REGION) as NodeSegment[]).find(
      (s) => SEGMENT_TO_REGION[s] === reg,
    )!
    const base = registry.get(type)?.segments[seg]
    if (base !== undefined) push('base', base)
    for (const e of registry.contributionOccupants(type, seg)) {
      push(e.id, e.component)
    }
  }

  // ② 注册场：attach 落点（具体 type 键 + '*' 通配键），按 order 升序（小者在外）。
  //    兼容期顺带读该区域对应的老段词键（contribute 场落点用老段词），同 id 去重：
  //    两条写路径的同一次注册在摞里只出现一份。
  if (regionField) {
    const legacyWord = isLegacyRegion(reg)
      ? (Object.keys(SEGMENT_TO_REGION) as NodeSegment[]).find((s) => SEGMENT_TO_REGION[s] === reg)
      : undefined
    const keys = [`${type}/${reg}`, `*/${reg}`]
    if (legacyWord) keys.push(`${type}/${legacyWord}`)
    for (const key of keys) {
      for (const e of regionField.list(key)) {
      const value = (e as RegionFieldEntry).value as NodeRegionAttachment
      push(e.id, value?.component)
      }
    }
  }
  return entries
}
