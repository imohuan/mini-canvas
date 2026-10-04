/**
 * sharedGlobals —— 把渲染运行时挂到 window，供**外部 UMD 插件**取用。
 *
 * 为什么需要这一步：仓库里多数插件打的是 UMD（`external: ['vue', '@mini-canvas/canvas-data', …]`），
 * 产物靠 window 上的全局取依赖，不走 ES import。而本应用是 vite 打的 ESM、**默认不暴露这些全局**，
 * 于是那些插件即使加载进浏览器，也会因为 `window.Vue` 是 undefined 而在第一行炸掉。
 *
 * 这个模块就是补上那一层：在应用启动前，把「宿主只允许一份」的共享运行时挂到 window。
 * 挂的名字必须与各插件 vite.config.ts 里 `output.globals` 写的一致：
 *   Vue / MiniCanvasCore / MiniCanvasRender / MiniCanvasBase
 * 改名字要两边一起改（本文件 + 各插件 vite.config 的 globals），否则插件加载会报「找不到依赖」。
 *
 * 与 vite 配置里 `optimizeDeps.exclude` 那串源码包是同一批：它们在 dev 下由 vite 现编、
 * 在 build 下被打进产物；这里只是把**同一份实例**额外挂到 window，不会造出第二份。
 *
 * 安全性：UMD 插件本就是「往这个页面里注入代码」，暴露这些全局不额外增加信任面 ——
 * 能装哪些插件由清单（中转后台）决定，与「谁能改服务器」等价（同 cloud-server 的判据）。
 */
import * as Vue from 'vue'
import * as VueFlow from '@vue-flow/core'
import * as MiniCanvasKernel from '@mini-canvas/kernel'
import * as MiniCanvasCore from '@mini-canvas/canvas-data'
import * as MiniCanvasBase from '@mini-canvas/canvas-base'
import * as MiniCanvasRender from '@mini-canvas/canvas-render'
import * as ProseMirrorEditorBundle from 'prosemirror-editor-bundle'

/** 暴露出去的全局名 → 值（唯一事实源；测试据此核对名字没写岔） */
export const SHARED_GLOBAL_NAMES = [
  'Vue',
  'VueFlow',
  'MiniCanvasKernel',
  'MiniCanvasCore',
  'MiniCanvasBase',
  'MiniCanvasRender',
  'ProseMirrorEditorBundle',
] as const

/**
 * 挂全局（幂等）。在 createApp(...).mount() **之前**调一次。
 * 已有同名全局时**不覆盖**（万一宿主自己先挂了别的实现，不悄悄换掉它）。
 */
export function exposeSharedGlobals(
  target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): void {
  const bag: Record<string, unknown> = {
    Vue,
    VueFlow,
    MiniCanvasKernel,
    MiniCanvasCore,
    MiniCanvasBase,
    MiniCanvasRender,
    ProseMirrorEditorBundle,
  }
  for (const [name, value] of Object.entries(bag)) {
    if (target[name] === undefined) target[name] = value
  }
}
