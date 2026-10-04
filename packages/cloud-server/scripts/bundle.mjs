/**
 * bundle —— 用 esbuild 打包 cloud-server。
 *
 * 为什么需要它（见计划 §1.2/§八）：
 * cloud-server 原来用纯 `tsc -p tsconfig.build.json`——只做类型擦除、**不打包**。
 * 于是源码里 `import '@mini-canvas/kernel'` 会：
 *   1. 撞 TS6059（rootDir 约束，kernel 只发 src/ 且是 private 包）；
 *   2. 产物留运行时 import，用户 `npx` 时装不到那个 private 包。
 * 打一个包就全解决了：工作区依赖内联进产物，代码里照常写 import。
 *
 * external 策略（关键）：
 * - **npm 依赖**（hono / yaml / zod / MCP SDK / penguin-core）保持 external —— 它们在 package.json
 *   的 dependencies 里，`npx` 时会随包装好，不必塞进产物（也避免把它们打进来后版本难升级）。
 * - **工作区包**（@mini-canvas/*）**内联** —— 它们是 private、用户机器上没有。
 *
 * 实现上**直接从 package.json 的 dependencies 生成 external 列表**，不手抄：
 * 手抄清单会在「加了新依赖忘了同步」时静默打错（把 npm 包也内联 = 体积暴涨/行为难料）。
 * 白名单式的显式类型（@types/*）本就不在 dependencies 里，天然不会进列表。
 */
import { build } from 'esbuild'
import { readFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 该 external 的包名（npm 依赖）。**必须排除工作区包**：
 * @mini-canvas/kernel 也写在 dependencies 里（pnpm workspace 的写法），
 * 但它必须**内联** —— 它 private、用户机器上没有。放 external 会让产物在 npx 时炸。
 */
async function npmExternalNames() {
  const pkg = JSON.parse(await readFile(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'))
  return Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith('@mini-canvas/'))
}

const externals = await npmExternalNames()

// 先清 dist：esbuild 只写它认识的文件、**不会删旧产物**。
// 之前用 tsc 产出的 server.js / static.js / *.d.ts 会残留，与新打包产物混在一起（旧代码仍可被 import）。
await rm(path.join(PACKAGE_ROOT, 'dist'), { recursive: true, force: true })

await build({
  // 两个入口：CLI（npx 直接跑）与库入口（被别的代码 import）
  entryPoints: [
    path.join(PACKAGE_ROOT, 'src/cli.ts'),
    path.join(PACKAGE_ROOT, 'src/index.ts'),
  ],
  outdir: path.join(PACKAGE_ROOT, 'dist'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  // 工作区包（@mini-canvas/*）不在 dependencies 里 → 自动内联
  external: externals,

  logLevel: 'info',
})

console.log('[bundle] 完成：工作区内联，external=' + externals.join(', '))
