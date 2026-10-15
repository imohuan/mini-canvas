/**
 * dropdownExclusive —— `@mini-canvas/ui` 自己的「同屏只开一个下拉浮层」登记表。
 *
 * **为什么本包自带一份**（用户口径 2026-10-15：「他们每一个插件都是独立的……
 * 你就需要单独的对他们两个库里面单独的进行一个实现，你复制成两份，放在这两个地方都行，
 * 但是你不能动核心层」）：下拉这件事有两套实现 —— 本包的 `AxDropdown`（成品应用顶替进 ui
 * 目录的那份）与主题默认件 `plugin-theme-default` 的 `Dropdown`。两边都要「开一个先把别的收起」
 * 与「祖先豁免」，但谁都不该去改核心层，于是各留一份自己的实现（主题包那份见它的
 * `components/ui/dropdownRegistry.ts`）。
 *
 * 两份实现的**共同语言只有一条**：浮层根的 `data-floating-chain` 属性（见 floatingGroup.ts）。
 * 靠它，两套浮层混在一起时也能认出父子关系 —— 共享的是 DOM 契约，不是代码。
 * 互斥本身只在各自实现内部生效（跨库互斥不是这里的目标）。
 *
 * 为什么必须是独立模块（不写在组件的 `<script setup>` 里）：
 * `<script setup>` 的顶层代码会被编译进 **setup() 函数体**，于是每个组件实例各拿一份
 * 「模块级」变量 —— 登记表在实例之间根本不通、互斥自然失效（实测：两个下拉同时开着）。
 *
 * 语义：谁打开就把自己的 closer 登记进来，并**先把别的都关掉**；关闭/卸载时摘掉自己。
 *       **自己的祖先除外** —— 见 `claimDropdownExclusive` 的 `chain` 参数。
 */
import { isChainAncestorOf } from './floatingGroup'

/** 一个开着浮层的登记项 */
interface OpenEntry {
  close: () => void
  /** 它的浮层链 id 列表（父链 + 自己；一级浮层就是 [自己]） */
  chain: () => string[]
}

const openEntries: OpenEntry[] = []

/** 兜底链：没声明链的登记项用这个（永远是空，谁都不豁免） */
const NO_CHAIN = (): string[] => []

/**
 * 打开自己：先把**其它**还开着的浮层关掉（同屏只留一个）。
 *
 * @param self  自己的 closer
 * @param chain 自己的浮层链（父链 + 自己）。可省略 —— 省略 = 空链 = 谁都不豁免。
 *              传了它，登记表就会**放过自己的祖先**：内层下拉打开时，
 *              它所在的那块父面板（如底栏的参数面板）留着不关
 *              （用户报的「点内部的下拉，它触发了外部下拉的关闭」）。
 */
export function claimDropdownExclusive(self: () => void, chain: () => string[] = NO_CHAIN): void {
  const mine = chain()
  for (const entry of [...openEntries]) {
    if (entry.close === self) continue
    // 祖先豁免：关掉祖先等于把自己也一起收走（用户看到的就是「点了没反应」）
    if (isChainAncestorOf(entry.chain(), mine)) continue
    entry.close()
  }
  // 同一个 closer 重复 claim（开着时又调一次）：先摘旧的，避免登记表里积压同一条
  const dup = openEntries.findIndex((e) => e.close === self)
  if (dup !== -1) openEntries.splice(dup, 1)
  openEntries.push({ close: self, chain })
}

/** 关闭自己：从登记表摘掉（幂等，重复调用无副作用） */
export function releaseDropdown(self: () => void): void {
  const at = openEntries.findIndex((e) => e.close === self)
  if (at !== -1) openEntries.splice(at, 1)
}

/** 把当前开着的浮层**全关掉**（一个不留）；供拖拽/缩放这类"环境变了"的时刻用 */
export function closeAllDropdowns(): void {
  for (const entry of [...openEntries]) entry.close()
}

/** 当前开着的浮层数（仅供测试/调试：断言互斥是否真的生效） */
export function openDropdownCount(): number {
  return openEntries.length
}
