/**
 * dropdownRegistry —— 主题默认件自己那份「同屏只开一个下拉浮层」登记表。
 *
 * 用户口径（2026-10-15）：「他们每一个插件都是独立的……你就需要单独的对他们两个库里面
 * 单独的进行一个实现，你复制成两份，放在这两个地方都行，但是你不能动核心层」。
 * 所以本插件不再转发渲染层那份，自己留一份实现 —— 本插件的 Dropdown 与直接复用它的
 * Select 共用这一份，互斥在本插件内部照旧生效。
 *
 * 与 `@mini-canvas/ui` 那份（它的 `hooks/dropdownExclusive.ts`）**只共享 DOM 契约**：
 * 浮层根的 `data-floating-chain` 属性（见 floatingChain.ts）。共享的是契约，不是代码。
 *
 * 为什么必须是独立模块（不写在 Dropdown.vue 的 <script setup> 里）：
 * `<script setup>` 的顶层代码会被编译进 **setup() 函数体**，于是每个组件实例各拿一份
 * 「模块级」变量 —— 登记表在实例之间根本不通、互斥自然失效（实测：两个下拉同时开着）。
 */
import { isChainAncestorOf } from './floatingChain'

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
 *              传了它，登记表就会**放过自己的祖先**（内层下拉不关掉它所在的父面板）。
 */
export function claimDropdownExclusive(self: () => void, chain: () => string[] = NO_CHAIN): void {
  const mine = chain()
  for (const entry of [...openEntries]) {
    if (entry.close === self) continue
    if (isChainAncestorOf(entry.chain(), mine)) continue
    entry.close()
  }
  const dup = openEntries.findIndex((e) => e.close === self)
  if (dup !== -1) openEntries.splice(dup, 1)
  openEntries.push({ close: self, chain })
}

/** 关闭自己：从登记表摘掉（幂等，重复调用无副作用） */
export function releaseDropdown(self: () => void): void {
  const at = openEntries.findIndex((e) => e.close === self)
  if (at !== -1) openEntries.splice(at, 1)
}

/** 当前开着的浮层数（仅供测试/调试：断言互斥是否真的生效） */
export function openDropdownCount(): number {
  return openEntries.length
}

/** 把当前开着的浮层**全关掉**（一个不留）；拖拽/缩放这类"环境变了"的时刻用 */
export function closeAllDropdowns(): void {
  for (const entry of [...openEntries]) entry.close()
}
