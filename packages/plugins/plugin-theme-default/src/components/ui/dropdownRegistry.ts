/**
 * dropdownRegistry —— 「同屏只开一个下拉浮层」的登记表（**转发**到渲染层那一份）。
 *
 * 为什么改成转发：这份表要跨实现共用才有意义。应用里同时存在两处下拉实现 ——
 * 成品应用注册进 ui 目录的全局下拉、以及本主题默认件（Dropdown 与直接复用它的 Select）。
 * 两处各拿一份表 → 同屏会开出两个浮层。真源收在 `@mini-canvas/canvas-render` 的
 * `contracts/dropdownExclusive`，本文件只做转发，保证两处 import 到的是同一个 Set。
 *
 * 为什么必须是独立模块（不写在 Dropdown.vue 的 <script setup> 里）：
 * `<script setup>` 的顶层代码会被编译进 **setup() 函数体**，于是每个组件实例各拿一份
 * 「模块级」变量 —— 登记表在实例之间根本不通、互斥自然失效（实测：两个下拉同时开着）。
 */
export { claimDropdownExclusive, releaseDropdown, openDropdownCount } from '@mini-canvas/canvas-render'
