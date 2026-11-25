/**
 * sharedGlobals —— 把渲染运行时挂到 window，供**外部 UMD 插件**取用。
 *
 * 为什么需要这一步：仓库里多数插件打的是 UMD（`external: ['vue', '@plume-canvas/canvas-data', …]`），
 * 产物靠 window 上的全局取依赖，不走 ES import。而本应用是 vite 打的 ESM、**默认不暴露这些全局**，
 * 于是那些插件即使加载进浏览器，也会因为 `window.Vue` 是 undefined 而在第一行炸掉。
 *
 * 这个模块就是补上那一层：在应用启动前，把「宿主只允许一份」的共享运行时挂到 window。
 * SHARED_GLOBAL_NAMES 就是唯一清单：这里挂什么，外部插件就必须用什么名字取。
 * 各插件的 vite.config.ts 在各自的 `output.globals` 里写同样的名字；
 * externalPluginGlobals.test.ts 会拿真产物逐个核对，写岔了就是红。
 *
 * 与 vite 配置里 `optimizeDeps.exclude` 那串源码包是同一批：它们在 dev 下由 vite 现编、
 * 在 build 下被打进产物；这里只是把**同一份实例**额外挂到 window，不会造出第二份。
 *
 * 安全性：UMD 插件本就是「往这个页面里注入代码」，暴露这些全局不额外增加信任面 ——
 * 能装哪些插件由清单（中转后台）决定，与「谁能改服务器」等价（同 cloud-server 的判据）。
 */
import * as Vue from 'vue'
import * as VueFlow from '@vue-flow/core'
import * as PlumeKernel from '@plume-canvas/kernel'
import * as PlumeCore from '@plume-canvas/canvas-data'
import * as PlumeBase from '@plume-canvas/plugin-sdk'
import * as PlumeRender from '@plume-canvas/canvas-render'
import * as ProseMirrorEditorBundle from '@plume-canvas/editor'
import * as PlumeUiKit from '@plume-canvas/ui-kit'

/** 暴露出去的全局名 → 值（唯一事实源；测试据此核对名字没写岔） */
export const SHARED_GLOBAL_NAMES = [
  'Vue',
  'VueFlow',
  'PlumeKernel',
  'PlumeCore',
  'PlumeBase',
  'PlumeRender',
  'ProseMirrorEditorBundle',
  'PlumeUiKit',
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
    PlumeKernel,
    PlumeCore,
    PlumeBase,
    PlumeRender,
    ProseMirrorEditorBundle,
    PlumeUiKit,
  }
  for (const [name, value] of Object.entries(bag)) {
    if (target[name] === undefined) target[name] = value
  }
}
