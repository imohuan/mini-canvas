/**
 * 同屏只开一个下拉浮层：全局登记表。
 *
 * 为什么必须是模块级而不是 `<script setup>` 里的变量：Vue 会把 setup 顶层代码
 * 编进每个实例，实例之间互不相通，登记表就失效了（表现为两个菜单同时开着）。
 *
 * 嵌套浮层（比如参数下拉里再点「格式」）需要豁免自己的祖先：内层面板 teleport 到 body，
 * DOM 上不在父面板里，只看 DOM 会把这次点击判成“点外”，父菜单先关、内层随父卸载。
 * 这里用 `data-mck-floating-chain`（空格分隔的祖先链 + 自己）识别这一点。
 */

export const FLOATING_CHAIN_ATTR = 'data-mck-floating-chain'

/**
 * 宿主与默认主题的旧属性名。同一个浮层链**两份都写、两份都读**，
 * 否则 ui-kit 下拉和主题二级菜单混在同屏时互相看不见对方的父子关系，
 * 一点子菜单就被父级判成「点了外面」。
 */
export const LEGACY_FLOATING_CHAIN_ATTR = 'data-floating-chain'

const CHAIN_SELECTOR =
  '[' + FLOATING_CHAIN_ATTR + '], [' + LEGACY_FLOATING_CHAIN_ATTR + ']'

/** 读最近的浮层链；两个属性都认，优先新名。 */
export function floatingChainRaw(el: Element | null | undefined): string {
  const panel = el?.closest(CHAIN_SELECTOR)
  if (!panel) return ''
  return panel.getAttribute(FLOATING_CHAIN_ATTR) ?? panel.getAttribute(LEGACY_FLOATING_CHAIN_ATTR) ?? ''
}

/** 点击目标是否落在本实例的浮层链里（含内层 teleport 出去的面板）。 */
export function isInsideChain(target: Node | null, chainId: string): boolean {
  if (!target || !(target instanceof Element)) return false
  const raw = floatingChainRaw(target)
  return raw.split(/\s+/).includes(chainId)
}

interface OpenEntry {
  close: () => void
  chain: () => string[]
}

const openEntries: OpenEntry[] = []

/** 打开自己：把其它还开着的浮层关掉，但放过自己的祖先。 */
export function claimFloating(self: () => void, chain: () => string[]): void {
  const mine = new Set(chain())
  for (const entry of [...openEntries]) {
    if (entry.close === self) continue
    const theirs = entry.chain()
    // 对方是自己的祖先（它的链是 mine 的真子集）→ 不关它。
    if (theirs.length > 0 && theirs.every((id) => mine.has(id)) && theirs.length < mine.size) continue
    entry.close()
  }
  const dup = openEntries.findIndex((e) => e.close === self)
  if (dup !== -1) openEntries.splice(dup, 1)
  openEntries.push({ close: self, chain })
}

/** 关闭自己：从登记表摘掉（幂等）。 */
export function releaseFloating(self: () => void): void {
  const at = openEntries.findIndex((e) => e.close === self)
  if (at !== -1) openEntries.splice(at, 1)
}

/** 当前开着的浮层数（测试/调试用）。 */
export function openFloatingCount(): number {
  return openEntries.length
}

/** 把一个浮层链的祖先读出来（供内层构造自己的链）。 */
export function floatingChainOf(el: Element | null | undefined): string[] {
  return floatingChainRaw(el).split(/\s+/).filter(Boolean)
}
