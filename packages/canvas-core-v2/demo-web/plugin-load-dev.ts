// plugin-load-dev.ts —— 宿主跨端口热拉"插件 dev server 源码模块"的控制器。
//
// 证明：插件在它自己的 vite dev server 上开发(不改文件不用打包)，宿主(5199)跨端口 import 其
// 源码模块，改文件靠【vite 原生 HMR】让画布实时更新(不刷新)。
//
// 热更链路(纯 vite 官方 API，见 vite.dev.config.ts forcePluginEntryHotUpdate)：
//   宿主 import 插件 dev 入口 index.ts → 自带 5311 的 /@vite/client(token 随模块注入) → 宿主页面
//   自动成为 5311 的 HMR 客户端。插件 src/index.ts 的 import.meta.hot.accept(自) 收原生 HMR →
//   reloadPlugin；dev 端 handleHotUpdate 强制入口进每次热更集合，改 .ts/.vue 都触发。
//
// 拓扑：plugin-node-text 独立 dev server :5311 (pnpm dev:hmr)；theme(nodeShell/edge/background)
//      走源码插件(宿主同 server)——本页聚焦 text 跨端口热更。
//
// vue 单例：宿主与插件都 resolve vue 到 pnpm 同一真实路径，.vue 的 import 'vue' 拿到同一份。
import { createMiniCanvasHost } from '@mini-canvas/canvas-render'
import { NodeRegistry } from '@mini-canvas/canvas-core-v2'
import type { PluginModule } from '@mini-canvas/canvas-core-v2'
import { createApp, ref } from 'vue'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'
import DevHmrCanvas from './plugin-load-dev-app.vue'

// —— 页面日志 ——
const logEl = document.getElementById('log') as HTMLElement | null
const bootEl = document.getElementById('boot') as HTMLElement | null
const resultEl = document.getElementById('result') as HTMLElement | null
export function log(msg: string) {
  if (logEl) logEl.textContent = (logEl.textContent ?? '') + msg + '\n'
  if (bootEl) bootEl.textContent = msg
  console.log('[dev-hmr]', msg)
}
export function setResult(msg: string, ok = true) {
  if (resultEl) {
    resultEl.textContent = msg
    resultEl.style.color = ok ? '#15803d' : '#b91c1c'
  }
}

const TEXT_DEV_ORIGIN = 'http://localhost:5311'
const textModuleUrl = `${TEXT_DEV_ORIGIN}/src/index.ts`

// —— 跨文件共享运行状态(控制器与 DevHmrCanvas 读写) ——
export type MiniCanvasApiLike = {
  installPlugin(m: unknown): string
  reloadPlugin(n: string, m?: unknown): void
  listPlugins(): string[]
  getRegistry(): { types(): string[] }
  getNodeStore(): {
    getNodes(): Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }>
    removeNode(id: string): void
  }
  getContext(): { get<T>(n: string): T }
}
export const state: {
  api: MiniCanvasApiLike
  host: {
    themeRegistry: { get(s: string): unknown }
    nodeRegistry: { get(t: string): { segments: Record<string, unknown> } | undefined }
    ctx: { get<T>(n: string): T }
  }
  /** 经 HOST_KEY provide 给 content 组件的宿主引用 */
  hostRef: { value: unknown }
  /** 每次"该重画了"(首装/热更后)自增 → DevHmrCanvas 据此重建节点并重挂。
   *  用 ref 包装以便 .vue 的 watch 能感知变更(state 本身是普通对象，非 reactive)。 */
  epoch: ReturnType<typeof ref<number>>
  reloadCount: number
} = {
  api: null as unknown as MiniCanvasApiLike,
  host: null as unknown as typeof state.host,
  hostRef: { value: null },
  epoch: ref(0),
  reloadCount: 0,
}

async function loadDevModule<T>(url: string): Promise<T> {
  return import(/* @vite-ignore */ `${url}?t=${Date.now()}`) as Promise<T>
}

async function main() {
  const registry = new NodeRegistry()
  const { host, exposeToWindow } = await createMiniCanvasHost({
    coldPlugins: [], // text 稍后跨端口首装；theme 源码同 server
    nodeRegistry: registry,
  })
  exposeToWindow('MiniCanvas')
  const api = window.MiniCanvas as unknown as MiniCanvasApiLike
  state.api = api
  state.host = host
  state.hostRef.value = host

  // 挂 theme(源码) → 提供 nodeShell/edge/background
  api.installPlugin(themeDefaultPlugin)
  log(`宿主就绪；已装 theme(${api.listPlugins().join(',')})，待跨端口装 text…`)

  // 首次跨端口拉 text dev 模块并装
  await installText()
  log(`✅ text 已从 ${TEXT_DEV_ORIGIN} dev 模块装上，类型=${JSON.stringify(api.getRegistry().types())}`)

  // 挂画布(渲染 text 节点)
  createApp(DevHmrCanvas).mount('#app')
  state.epoch.value++ // .vue 据此重建一个 text 节点并渲染
  setResult('✅ text 插件 dev 模块已装上并渲染。现在改 text 插件源码试试！')

  // —— 热更通道：插件 dev server 的原生 HMR ——
  // 关键(见 vite.dev.config.ts forcePluginEntryHotUpdate)：
  //   * 宿主跨端口 import 插件 dev 入口 index.ts 时，该模块带上 5311 的 /@vite/client(token 随模块注入)，
  //     宿主页面自动成为 5311 的 HMR 客户端。
  //   * 插件 src/index.ts 里 import.meta.hot.accept(自) 收原生 HMR 通知 → 调 window.MiniCanvas.reloadPlugin。
  //   * dev server 端 handleHotUpdate 把入口 index.ts 强制塞进每次热更集合 → 改 .ts 或 .vue 都必然
  //     冒泡触发 index 的 accept(纯 vite 官方 API，无手写 SSE 重拉)。
  //   * 这里把 reloadPlugin 包一层：计数 + epoch++ 让画布重建节点展示新实现。
  const rawReload = api.reloadPlugin.bind(api)
  api.reloadPlugin = ((name: string, mod?: unknown) => {
    const r = rawReload(name, mod)
    state.reloadCount++
    state.epoch.value++ // 触发 .vue 重建 text 节点 → 内容来自 reloadPlugin 后的新实现
    log(`🔥 热更 #${state.reloadCount}：reloadPlugin('${name}') 已执行`)
    setResult(`🔥 已热更 #${state.reloadCount}——插件新代码已生效，页面没刷新！`)
    return r
  }) as MiniCanvasApiLike['reloadPlugin']
  window.MiniCanvas = api

  log('🟢 改 plugin-node-text 的 .ts 或 .vue 试试，画布会实时更新')
}

async function installText() {
  const mod = await loadDevModule<{ nodeTextPlugin: PluginModule }>(textModuleUrl)
  state.api.installPlugin(mod.nodeTextPlugin)
}

void main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err)
  log('❌ 启动失败: ' + msg)
  setResult('❌ ' + msg, false)
})
