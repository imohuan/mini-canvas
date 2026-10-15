/**
 * floatingGroup —— 「这一串浮层是同一次弹出的组」的 DOM 契约。
 *
 * 背景（用户报「嵌套菜单无法点击」的根因）：
 *   二级菜单（AxSubMenu）的面板是 teleport 到 body 的**另一个元素**，DOM 上不在父菜单面板里。
 *   父级下拉的 click-outside 只看自己的触发器和面板，于是点在二级菜单项上被判成「点了外面」——
 *   父菜单先关、二级菜单随父卸载，click 派发时目标已脱离文档，Vue 的 click 回调不再执行
 *   （表现为：嵌套菜单看着能展开，点下去菜单消失了、动作没生效）。
 *
 * 契约：每个浮层根元素写 `data-floating-chain`，值为**从最初的一级面板到自己**的 id 链
 * （空格分隔）。子浮层打开时把自己的 panel 链 = 父链 + 自己 id。
 * 判定「某次点击是否算我这一组内」只需看命中的链上有没有我的 id ——
 * 三级嵌套时链是 `A B C`，对一级 A 判定也自然成立，不需要额外的注册表/生命周期同步。
 *
 * **本文件是 `@mini-canvas/ui` 自己的一份实现**（不跨包共享）：插件都是独立的，
 * 各库自带自己那份，谁也不改核心层（用户口径 2026-10-15）。
 * 主题默认件 `@mini-canvas/plugin-theme-default` 里另有一份等价的实现（见其
 * `components/ui/floatingChain.ts`）—— 两份都读同一个 DOM 属性 `data-floating-chain`，
 * 所以两边浮层混在一起时照样认得出父子关系。
 */

/** 浮层链属性名（写入 / 读取都用它，避免两处各写一遍字符串） */
export const FLOATING_CHAIN_ATTR = 'data-floating-chain'

/**
 * 只要能「往上找最近的浮层根」就够（鸭子类型）：真实 DOM 元素天然满足，
 * 单测在 node 环境下可以喂最小假对象 —— 本模块是纯函数，不需要真 DOM。
 */
interface ChainHostLike {
  closest(selector: string): { dataset?: { floatingChain?: string } } | null
  parentElement?: ChainHostLike | null
}

function asChainHost(el: unknown): ChainHostLike | null {
  return el && typeof (el as ChainHostLike).closest === 'function' ? (el as ChainHostLike) : null
}

/** 事件目标 → 最近的元素（Text 节点没有 closest，往上找父元素） */
function elementOf(node: unknown): ChainHostLike | null {
  const host = asChainHost(node)
  if (host) return host
  return asChainHost((node as ChainHostLike | null)?.parentElement)
}

/** 读取元素所在的浮层链（没命中任何浮层 → 空数组） */
export function floatingChainOf(el: unknown): string[] {
  const raw = asChainHost(el)?.closest('[' + FLOATING_CHAIN_ATTR + ']')?.dataset?.floatingChain
  return raw ? raw.split(' ').filter(Boolean) : []
}

/** 事件目标是否落在 id 为 chainId 的那一组浮层里（含它派生出的子浮层） */
export function isInFloatingGroup(node: unknown, chainId: string): boolean {
  return floatingChainOf(elementOf(node)).includes(chainId)
}

/**
 * 子浮层该写什么链：**父链 + 自己 id**。
 * anchor 是子浮层的「锚点元素」—— 二级菜单传自己那一行（它在父面板里），
 * 所以 closest 会先命中父面板的链；一级下拉没有父面板，传触发器也行（拿不到链就是空）。
 */
export function childChainFor(anchor: unknown, selfId: string): string {
  return [...floatingChainOf(anchor), selfId].join(' ')
}

/**
 * 一组浮层里，某一条目是不是我（或我的后代）的**祖先**。
 *
 * 用途：下拉互斥 —— 内层下拉打开时不该关掉自己所在的那块父面板（用户报的「点内部的下拉，
 * 它触发了外部下拉的关闭」）。判定 = 祖先的链是我链的严格前缀。
 */
export function isChainAncestorOf(ancestorChain: ReadonlyArray<string>, mineChain: ReadonlyArray<string>): boolean {
  if (ancestorChain.length === 0) return false
  if (ancestorChain.length > mineChain.length) return false
  return ancestorChain.every((id, i) => mineChain[i] === id)
}
