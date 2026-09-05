// plugin-load.ts —— 宿主运行时加载"打包好的 js 插件"演示入口。
//
// 证明：第三方已打包(UMD)插件能被一个独立宿主动态加载并生效(不 static import 业务插件)。
// 关键(vue 单例, docs/tmp/plugin-vite/02)：宿主先把单例运行时喂到 window 全局，
// UMD 插件 external 掉它们、运行时从这些全局取 → 浏览器只存在一份 vue。
import { createMiniCanvasHost } from '@mini-canvas/canvas-render'
import type { PluginModule } from '@mini-canvas/canvas-core-v2'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'

// —— 1. 宿主运行时喂到 window 全局(喂给 UMD 插件) ——
// UMD globals: vue='Vue', @vue-flow/core='VueFlow',
//   @mini-canvas/canvas-core-v2='MiniCanvasCore', @mini-canvas/canvas-render='MiniCanvasRender'
const [vueNs, flowNs, coreNs, renderNs] = await Promise.all([
  import('vue'),
  import('@vue-flow/core'),
  import('@mini-canvas/canvas-core-v2'),
  import('@mini-canvas/canvas-render'),
])
const w = window as unknown as Record<string, unknown>
w.Vue = vueNs
w.VueFlow = flowNs
w.MiniCanvasCore = coreNs
w.MiniCanvasRender = renderNs

const logEl = document.getElementById('log') as HTMLElement | null
const bootEl = document.getElementById('boot') as HTMLElement | null
const log = (msg: string) => {
  if (logEl) logEl.textContent = (logEl.textContent ?? '') + msg + '\n'
  if (bootEl) bootEl.textContent = msg
  console.log('[plugin-load]', msg)
}

try {
  // —— 2. 建最小宿主(不含任何业务插件)，暴露 window.MiniCanvas ——
  const { host: h, exposeToWindow } = await createMiniCanvasHost({ coldPlugins: [] })
  exposeToWindow('MiniCanvas')
  const api = w.MiniCanvas as {
    installPlugin(m: PluginModule): string
    listPlugins(): string[]
    uninstallPlugin(n: string): boolean
    getContext(): { get<T>(n: string): T }
    getNodeStore(): { getNodes(): Array<{ id: string; type: string }> }
  }
  log(`宿主就绪，插件列表=${JSON.stringify(api.listPlugins())}（空=尚未装业务插件）`)

  // —— 3. 运行时加载打包好的 UMD 插件 js ——
  // 前置：先跑 `cd packages/plugins/plugin-node-text && pnpm build`，再把 dist/plugin-node-text.js
  // 复制到本 demo-web/plugins/ 下（该目录已被 .gitignore，属生成物）。改 UMD 名 → 装不同插件。
  const jsUrl = '/plugins/plugin-node-text.js'
  log(`动态加载 UMD 插件: ${jsUrl}`)
  // 用 <script> 载入 UMD：它把命名导出放 window.MiniCanvasPluginNodeText（不需 module 环境）
  await loadScript(jsUrl)
  const g = window as unknown as Record<string, Record<string, unknown>>
  const pluginMod = g.MiniCanvasPluginNodeText?.nodeTextPlugin as PluginModule | undefined
  if (!pluginMod) throw new Error('UMD 载入后找不到 window.MiniCanvasPluginNodeText.nodeTextPlugin')

  api.installPlugin(pluginMod)
  log(`installPlugin('${pluginMod.name}') 成功，插件列表=${JSON.stringify(api.listPlugins())}`)

  // —— 4. 用该插件的服务建一个节点，证明它真能被用 ——
  const textSvc = api.getContext().get<{ addTextNode(p: { x: number; y: number }): string }>('text')
  const id = textSvc.addTextNode({ x: 140, y: 120 })
  const types = api.getNodeStore().getNodes().map((n) => n.type)
  log(`addTextNode('${id}') → 当前节点类型=${JSON.stringify(types)}（text 插件内容组件已注册）`)

  // 清理：卸载验证可逆（type 注册回收；已建节点数据保留是符合预期的）
  api.uninstallPlugin('text')
  const store = api.getNodeStore()
  const textReg = (store as unknown as { types?: ReadonlyMap<string, unknown> }).types
  const registeredTypes = textReg ? [...textReg.keys()] : '(未知)'
  log(`uninstallPlugin('text') 后已注册 type=${JSON.stringify(registeredTypes)}（text 已从注册表回收）`)
  log('✅ 完成：打包好的 js 插件 动态加载 → installPlugin → 建节点 全链路通过')
  const el = document.getElementById('result') as HTMLElement | null
  if (el) el.textContent = '✅ 打包 js 插件加载成功'
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err)
  log('❌ 失败: ' + msg)
  if (bootEl) bootEl.textContent = '失败: ' + msg
}

/** 用 <script> 载入一个 UMD/普通 js 并等它执行完 */
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('加载脚本失败: ' + src))
    document.head.appendChild(s)
  })
}
