/**
 * vite-plugin-lib —— 插件包打 UMD（供外部加载）时**共享的那一半配置**。
 *
 * 为什么要有这个共享件：仓库里插件包的打包配置此前各写一遍，external / globals / 产物名
 * 三处极易漂移 —— 一处写岔，插件在浏览器里就"加载了却什么也没装上"（而且不报错）。
 * 抽成一处后，"哪些依赖要 external、对应哪个全局名"只有一个事实源。
 *
 * 本文件**只导出纯数据**（表 + 一段 build 配置生成），不 import vite / 插件包 —— 这样各插件
 * 的 vite.config.ts 只在此处取数据、在自己的包里 import vite 插件（在各自 node_modules 里解析），
 * 不会出现"从 packages/plugins 解析不到依赖"的问题。
 *
 * 三条规矩：
 * 1. 宿主只允许一份的东西必须 external（Vue / VueFlow / three / prosemirror-editor-bundle /
 *    所有 @mini-canvas/*）。打进插件会造成两份实例：Vue 两份 → 组件挂不上、警告刷屏；
 *    canvas-data 两份 → 画布状态各存各的。所以它们从宿主 window 上的全局取。
 * 2. 其余依赖一律内联（如 @dagrejs/dagre、html-to-image、@ckpack/vue-color）。
 *    它们要么是纯函数、要么状态不在模块级，内联没有副作用，也省得再要求宿主喂全局。
 * 3. CSS 内联进 js（cssInjectedByJs）—— 产物是单文件，宿主只引一个地址。
 */
import { fileURLToPath } from 'node:url'
import { basename, dirname } from 'node:path'

/**
 * 依赖 → 宿主 window 上的全局名（唯一事实源）。
 *
 * ui 侧必须按同一张表把这些挂到 window（见 packages/ui/src/sharedGlobals.ts）——
 * 名字两边写岔，插件加载时会以"找不到依赖"直接炸，而单测/类型检查都发现不了。
 * ui 的 externalPluginGlobals 测试会逐条核对这张表与 sharedGlobals 一致。
 */
export const HOST_GLOBALS: Record<string, string> = {
  vue: 'Vue',
  '@vue-flow/core': 'VueFlow',
  // 注：three 暂不在表里 —— 只有 plugin-node-3d-preview 用，而它是随应用自带的节点插件
  //（不是 installable）。真要让 3D 预览也可装卸时，这里加 three: 'THREE'，
  // 并同步给 ui 的 sharedGlobals 挂上（那条守卫测试会立刻要求两边一致）。
  'prosemirror-editor-bundle': 'ProseMirrorEditorBundle',
  '@mini-canvas/kernel': 'MiniCanvasKernel',
  '@mini-canvas/canvas-base': 'MiniCanvasBase',
  '@mini-canvas/canvas-data': 'MiniCanvasCore',
  '@mini-canvas/canvas-render': 'MiniCanvasRender',
}
/**
 * 生成 build 段（纯数据）。各插件的 vite.config.ts：

/** 一律 external 的依赖（键即模块名） */
export const HOST_EXTERNALS: string[] = Object.keys(HOST_GLOBALS)

export interface PluginLibOptions {
  /** UMD 的全局名（如 MiniCanvasPluginMiniMap）；加载器按它取插件对象 */
  name: string
  /** 产物文件名（默认 = 包目录名 + .js）。一般不用改 */
  fileName?: string
  /** 是否产 sourcemap（默认 true；发布到 NPM 的演示包可关掉减小体积） */
  sourcemap?: boolean
}
/**
 * 生成 build 段（纯数据）。各插件的 vite.config.ts：
 *   export default defineConfig({
 *     plugins: [vue(), cssInjectedByJs()],
 *     build: pluginLibBuild(import.meta.url, { name: 'MiniCanvasPluginMiniMap' }),
 *   })
 */
export function pluginLibBuild(importMetaUrl: string, opts: PluginLibOptions) {
  const pkgDir = basename(dirname(fileURLToPath(importMetaUrl)))
  return {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', importMetaUrl)),
      name: opts.name,
      formats: ['umd'] as const,
      fileName: () => opts.fileName ?? pkgDir + '.js',
    },
    rollupOptions: {
      external: HOST_EXTERNALS,
      output: { globals: HOST_GLOBALS },
    },
    cssCodeSplit: false,
    sourcemap: opts.sourcemap ?? true,
  }
}
