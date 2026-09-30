/**
 * dropdownRegistry —— 「同屏只开一个下拉浮层」的进程内登记表。
 *
 * 为什么单独一个模块（而不是写在 Dropdown.vue 的 <script setup> 里）：
 * `<script setup>` 里的代码会被编译进 **setup() 函数体**，于是每个组件实例各拿一份
 * 「模块级」变量 —— 我第一版就踩了这个坑：登记表在实例之间根本不通，排他自然失效
 * （实测：两个下拉同时开着）。要真模块作用域，就得放在独立 .ts 模块里。
 *
 * 语义：谁打开就把自己的 closer 登记进来，并**先把别的都关掉**；关闭/卸载时摘掉自己。
 */

const openClosers = new Set<() => void>()

/** 打开自己：先把**其它**还开着的浮层关掉（保证同屏只有一个） */
export function claimDropdownExclusive(self: () => void): void {
  for (const closer of [...openClosers]) {
    if (closer !== self) closer()
  }
  openClosers.add(self)
}

/** 关闭自己：从登记表摘掉（幂等，重复调用无副作用） */
export function releaseDropdown(self: () => void): void {
  openClosers.delete(self)
}

/** 当前开着的浮层数（仅供测试/调试：断言排他是否真的生效） */
export function openDropdownCount(): number {
  return openClosers.size
}

