/**
 * region —— 节点区域词层（设计文档 §五 十个区域词 / 步骤 3；步骤 9 已删老段名垫片）。
 *
 * 两个职责，全部是纯函数、零 Vue：
 * 1. **词表与守卫**：十个闭合区域词（in/title/out:top/out:bottom/out:left/out:right/
 *    on:top/on:bottom/over:inset/over:outset）是节点上**唯一合法**的位置名。
 *    老五段名（content / top-toolbar / bottom-toolbar / overlay）已在步骤 9 下线：
 *    类型上它们不再是 NodeRegion（编译期报错），运行时经 assertRegion 抛清晰错误。
 *    不留映射、不做归一 —— 垫片永久化就是"分不清谁是谁"的病根（决策 3 的退役安排）。
 * 2. **读取合成**：BaseNode 按区域渲染时，把「NodeRegistry 的基座 + 区域级贡献（键 = type/region）」
 *    与「node/region 注册场（attach 落点，键 = type/region，含 type='*' 通配）」合成同一摞。
 *
 * 栈序沿用既有语义：基座在最前（id='base'），随后条目按 order 升序（order 小者在外）。
 * 同一条目经两条写路径（contribute 糖 / attach 场）出现时以**注册 id 去重**，NodeRegistry 侧优先 ——
 * 两者同 id 的条目是同一次注册，重复渲染会让同一区域组件挂两份。
 */
import type { Registry } from '@mini-canvas/kernel'
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

/** 词表查询用集合（守卫的热路径形式） */
const REGION_SET: ReadonlySet<string> = new Set(NODE_REGIONS)

/** 是不是十个区域词之一（闭合词表判定） */
export function isRegion(value: string): value is NodeRegion {
  return REGION_SET.has(value)
}

/**
 * 老段名 content 的拼写（步骤 9 已下线）。
 *
 * 为什么单独命名：作者侧字段过去就叫这个名字（现为区域词 in），收到它必须当场报错而**不能静默丢弃**
 * ——静默丢弃会表现为"注册成功了却什么都不显示"。把拼写放这里，全仓生产代码就只有本文件认得老词。
 */
export const RETIRED_CONTENT_FIELD = 'content'

/**
 * 步骤 9 已下线的老段名 —— **只用来报错，不参与任何放行 / 归一 / 映射**。
 *
 * 留这张表的唯一理由：报错时得认出"这是老写法"，才能给出"已下线 + 改用哪个区域词"的明确提示；
 * 否则只剩笼统的"未知区域词"，作者还得多翻一轮文档。
 * 它不是垫片：这里没有任何到区域词的映射，读到只抛错（对照表见本文件顶部注释与设计文档 §五）。
 */
export const RETIRED_SEGMENT_NAMES = [
  RETIRED_CONTENT_FIELD,
  'top-toolbar',
  'bottom-toolbar',
  'overlay',
] as const

/** 是不是已下线的老段名（守卫认词用；认证后一律抛错，不放行） */
export function isRetiredSegmentName(value: string): boolean {
  return RETIRED_SEGMENT_NAMES.some((name) => name === value)
}

/**
 * 区域词守卫（步骤 9 运行时兜底）：只放行十个区域词，其余一律抛清晰错误。
 *
 * 决策 3 的退役安排：垫片不再存在。老五段名传进来**不静默、不错位渲染**，而是当场报错并
 * 列出全部合法词 —— 静默忽略会让人以为"注册成功了却不显示"，比报错难查得多。
 */
export function assertRegion(value: string): NodeRegion {
  if (isRegion(value)) return value
  const retired = isRetiredSegmentName(value) ? '（老段名，步骤 9 已下线）' : ''
  throw new Error(
    `[nodeRegion] "${value}" 不是合法区域词${retired}；合法区域词只有十个：` +
      `${NODE_REGIONS.join(' / ')}（老段名到区域词的对照见 canvas/region.ts 顶部注释与设计文档 §五）`,
  )
}

/** 场键：type/region（type 可为 '*' 通配所有节点类型） */
export function regionKey(type: string, region: NodeRegion): string {
  return `${type}/${region}`
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
 * 某节点某区域的完整渲染摞：NodeRegistry 基座/区域贡献 + node/region 场条目。
 *
 * 两条写路径都按区域词落键（contribute 糖写 NodeRegistry 的段槽、attach 写 node/region 场），
 * 这里把同一区域的摞合成一份。
 *
 * @param registry   节点展示注册表（基座 + 区域级贡献；缺省 = 不读它）
 * @param regionField node/region 注册场（attach 落点；缺省 = 只读 NodeRegistry）
 * @param type       节点类型
 * @param region     区域词（十个之一；老段名传进来当场抛错）
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
  const reg = assertRegion(region)
  const entries: NodeSegmentEntry[] = []
  const seen = new Set<string>()
  const push = (
    id: string,
    component: unknown,
    props?: Record<string, unknown>,
    needs?: string[],
  ): void => {
    if (seen.has(id)) return
    seen.add(id)
    // 只有真带了才写字段：不凭空造 `props: undefined` / `needs: []`（消费者判空即"没声明"）
    entries.push({
      id,
      component,
      ...(props ? { props } : {}),
      ...(needs && needs.length > 0 ? { needs } : {}),
    })
  }

  // ① NodeRegistry：基座固定 id='base'，随后区域级贡献按 order
  if (registry) {
    const base = registry.get(type)?.segments[reg]
    if (base !== undefined) push('base', base)
    for (const e of registry.contributionOccupants(type, reg)) {
      push(e.id, e.component)
    }
  }

  // ② 注册场：attach 落点（具体 type 键 + '*' 通配键），按 order 升序（小者在外）。
  //    同 id 去重：contribute 糖落场与 attach 撞同 id 时，一次注册只出现一份。
  if (regionField) {
    const keys = [`${type}/${reg}`, `*/${reg}`]
    for (const key of keys) {
      for (const e of regionField.list(key)) {
        const value = (e as RegionFieldEntry).value as NodeRegionAttachment
        // props 透传给组件（规则 3：专属数据走 props；此前只取 component，props 是哑字段 ——
        // 严格审查 P1 指出「注册时传的共享状态到不了组件」，即此处断链）。
        // needs 同链透传（决策 9：组件只拿得到自己声明过的能力包）。
        push(e.id, value?.component, value?.props, value?.needs)
      }
    }
  }
  return entries
}
