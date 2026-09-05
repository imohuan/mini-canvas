# mini-canvas monorepo 包迁移工程约定实证报告

> 目的：梳理"新建一个 workspace 子包并把代码从现有包挪进去"要遵循的全部工程约定。
> 依据：逐项读取真实文件 + git 历史(尤其最近一次同类迁移 commit `283f5a5`：canvasCommands → @mini-canvas/plugin-canvas-commands)。
> 当前分支：`feat/cordis-plugin-system`；`core.autocrlf = input`。
> 标注 ✅=已实证，路径均相对仓库根 `D:/Code/Git/mini-canvas`。

---

## 一、workspace 与包组织

### 1. 根 pnpm-workspace.yaml 与根 package.json
**`pnpm-workspace.yaml`（全文）** — 只收两层，不含根项目自身：
```yaml
packages:
  - 'packages/*'
  - 'packages/plugins/*'
allowBuilds:
  vue-demi: false
```
✅ 结论：新建子包只能放 `packages/<pkg>`（内核/工具）或 `packages/plugins/<pkg>`（插件）。根项目 `mini-canvas` 不在 workspace 列表里，它只是容器 + 老版宿主(v1 `src/`)。

**根 `package.json` scripts（v1 宿主，红线区）：**
```json
"scripts": {
  "dev": "vite",
  "build": "vue-tsc -b && vite build",
  "preview": "vite preview",
  "test:performance": "node src/canvas/core/components/performance/__tests__/performanceMetrics.test.mjs"
}
```
✅ 根脚本只服务老版宿主 `src/`，**不 orchestrate 任何子包**（无 `dev-cordis`、无 `concurrently`、无 `pnpm -r run` 聚合）。子包 dev/build 各自独立跑。根依赖里已带 `@mini-canvas/canvas-core`(v1) workspace:*。

### 2. 各子包 package.json 字段惯例
✅ 全部子包（含 v2 内核与插件）统一骨架，字段完全一致：
```json
{
  "name": "@mini-canvas/<pkg>",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".":  { "types": "./src/index.ts", "default": "./src/index.ts" },
    "./*": "./src/*"
  },
  ...scripts / deps
}
```

**`"exports": { "./*": "./src/*" }`** 通配子路径，所有 v2 包统一用它暴露内部模块（供跨包深链 import，如 `plugin 内 import '@mini-canvas/canvas-core-v2/dist/...'` 或 `src/xxx`）。注意：老版 `packages/canvas-core`(v1) 用的是**显式子路径映射**（手写 `./components/Ui` 等），新包一律走通配符，勿照抄 v1。

三个典型例子：

**`packages/canvas-core-v2/package.json`（内核，放 packages/ 直下）**
- `dependencies`: `@vue-flow/core`、`pinia`、`vue` —— **vue/vue-flow 直接进 dependencies**（它是宿主级、被 plugins 依赖，允许唯一 vue 在此）。
- `devDependencies`: `@mini-canvas/plugin-canvas-commands`、`plugin-node-image`、`plugin-node-text`、`plugin-theme-default`（workspace:*）——**插件放 devDependencies**，仅供 demo-web/测试跟随解析，不构成内核→插件的运行时依赖（方向恒 插件→内核）。
- `scripts`: `{"test":"vitest run","typecheck":"tsc --noEmit","dev":"vite"}`

**`packages/plugins/plugin-theme-default/package.json`（渲染插件）**
- `peerDependencies`: `@vue-flow/core`、`vue`；`devDependencies`: 上面两项各重复一份 + `@mini-canvas/canvas-core-v2: workspace:*` + `vite-plugin-css-injected-by-js`。
- `scripts`: `{"typecheck":"tsc --noEmit","dev":"vite","build":"vite build"}`

**`packages/plugins/plugin-canvas-commands/package.json`（纯逻辑插件，无 vue UI）**
- `dependencies`: `@mini-canvas/canvas-core-v2: workspace:*`
- `devDependencies`: 仅 `typescript`
- `scripts`: `{"typecheck":"tsc --noEmit"}` —— **无 dev/build**（不产 UMD、不起 vite）。
- 这是 283f5a5 从内核抽出来的最小样板：一个纯逻辑包只需 package.json + tsconfig + env.d.ts + src，不需要 vite.config。

**依赖分类总则**（跨包交叉验证得出）：
- `@mini-canvas/canvas-core-v2`：内核放 **dependencies**（plugin-canvas-commands）或 devDependencies（theme 因为它同时也要 vue-flow peer）；对外插件内核依赖一般写 dependencies 或 devDependencies 视构建而定。
- vue / @vue-flow/core：插件走 **peerDependencies + 重复一份 devDependencies**（供打包/类型解析）；内核直接 dependencies。
- vite / typescript / @vitejs/plugin-vue：一律 devDependencies。

### 3. 子包间互相依赖写法：`"workspace:*"`
✅ 所有跨包依赖统一用 `"workspace:*"`，零版本号。典型：
- `plugin-canvas-commands` → `"@mini-canvas/canvas-core-v2": "workspace:*"`
- `canvas-core-v2` → 四个 plugin 全 `"workspace:*"`（devDeps）
- 根 → `"@mini-canvas/canvas-core": "workspace:*"`（v1）
根 `package.json` 里 `@dagrejs`、`vue` 等三方仍是 `^` 语义化版本，只有 monorepo 内包用 workspace:*。

### 4. 目录层级讲究
✅ **惯例明确：插件一律放 `packages/plugins/`；内核放 `packages/` 直下。** 依据：
- `packages/` 现有：`canvas-core`(v1)、`canvas-core-v2`(内核)、`mcp-server`、`prosemirror-editor-bundle`、`plugins/`
- `packages/plugins/` 现有：`plugin-canvas-commands`、`plugin-node-image`、`plugin-node-text`、`plugin-theme-default`
- 插件开发指南 `packages/plugins/README.md` 明写：**"插件 = 一个独立 workspace 包（放在 packages/plugins/）"**。
- STATUS.md 插件样板同样标注 plugins 在 `packages/plugins/plugin-node-*`。

判断规则：**跟渲染/节点能力/能力插件相关的 → packages/plugins/；纯内核引擎/工具 → packages/ 直下。**

---

## 二、vue 子包如何做 typecheck / 单测 / dev

### 1. tsconfig 双文件拆法（canvas-core-v2）
✅ canvas-core-v2 拆了 **`tsconfig.json` + `tsconfig.vue.json`** 两份，原因与用法见文件内注释（`tsconfig.vue.json` L8-10）：

**`packages/canvas-core-v2/tsconfig.json`** —— 主配置，**纯逻辑无 DOM、不碰 .vue**：
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "lib": ["ES2022"],                 // ← 无 DOM
    "strict": true, "noEmit": true, "skipLibCheck": true,
    "esModuleInterop": true, "isolatedModules": true,
    "forceConsistentCasingInFileNames": true, "types": []
  },
  "include": ["src"]
}
```
给内核纯逻辑 .ts 做类型检查 + Node 环境单测用（无 DOM、无 jsx）。

**`packages/canvas-core-v2/tsconfig.vue.json`** —— 专门 typecheck `.vue` 宿主渲染组件：
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "lib": ["ES2022","DOM","DOM.Iterable"], "jsx": "preserve", "noEmit": true },
  "include": ["src/host/*.vue", "src/**/*.d.ts", "src/env.d.ts"]
}
```
注释明写用法：`node ../../node_modules/vue-tsc/bin/vue-tsc.js --noEmit -p tsconfig.vue.json`。

**关键机制**：普通 `tsc` 不认识 `.vue`；`vue-tsc`(用 tsconfig.vue.json、带 DOM lib)才查 .vue 模板/脚本类型。canvas-core-v2 因内核 src 既有纯 .ts（要 Node 无 DOM 检查）又有 .vue 宿主组件（要 DOM + vue 模板解析），故拆两份。**插件包因内嵌 .vue 且要 DOM，把 DOM lib 直接放主 tsconfig（见下），不拆两份。**

### 2. vitest 只在 canvas-core-v2
✅ **只有 canvas-core-v2 有单测与 vitest；四个 plugin 包均无 vitest、无 .test.ts、无 __tests__ 目录**（`find packages/plugins -name '*.test.ts'` 为空）。依据：
- vitest 二进制在 `packages/canvas-core-v2/node_modules/.bin/vitest` 本地。
- **`packages/canvas-core-v2/vitest.config.ts`：**
```ts
export default defineConfig({
  plugins: [vue()],
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
})
```
- 15 个测试文件全在 canvas-core-v2/src 下，**与被测文件同目录的 `__tests__/` 文件夹**里（如 `src/core/__tests__/context.test.ts`、`src/host/__tests__/fullchain.test.ts`）。
- `package.json`: `"test":"vitest run"`。
- **跑法（STATUS.md/AGENTS.md 规定，注意不直接敲 vitest，用本地 mjs）：**
```bash
cd packages/canvas-core-v2
node ./node_modules/vitest/vitest.mjs run
node ../../node_modules/typescript/bin/tsc --noEmit
pnpm dev
```
> 插件 UI/逻辑验证靠 canvas-core-v2 宿主 demo 目验 + 内核 host 测试网（如 fullchain.test.ts 已覆盖 plugins 行为），不在插件包内写单测。

### 3. 插件 vite.config.ts（lib build / external / global 名）
✅ 三个带 .vue 的插件（node-text/image/theme-default）vite 配置统一：lib 模式打包 UMD、external 三方 vue 与内核、css 内联、global 名。核心证据：

**`plugin-node-text/vite.config.ts`（纯 lib 样板，node-image 同款）：**
```ts
build: {
  lib: {
    entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
    name: 'MiniCanvasPluginNodeText',      // global 名（UMD）
    formats: ['umd'],
    fileName: () => 'plugin-node-text.js',
  },
  rollupOptions: {
    external: ['vue', '@mini-canvas/canvas-core-v2'],
    output: { globals: { vue: 'Vue', '@mini-canvas/canvas-core-v2': 'MiniCanvasCore' } },
  },
  cssCodeSplit: false, sourcemap: true,
}
```
- plugins: `[vue(), cssInjectedByJs()]` —— `vite-plugin-css-injected-by-js` 把 .vue 的 `<style>` 内联进单份 js。
- global 命名规则：插件自身 UMD 名 = **`MiniCanvasPlugin<CamelCaseType>`**（MiniCanvasPluginNodeText / NodeImage / ThemeDefault）；external 的 global = `Vue`、内核 = **`MiniCanvasCore`**。
- `@vue-flow/core` 是否 external 看该插件是否直接用 VueFlow（theme-default external 了它，node-text/image 不需要故未列出）。
- build 目标：**`formats: ['umd']`**（第三方 `<script>` 场景），单文件 `fileName` 固定、`cssCodeSplit: false`、`sourcemap: true`。

**`plugin-theme-default/vite.config.ts`（单配置双模式 `({command})` 样板）：**
- 用 `command === 'serve'`/`'build'` 分支合并 dev server 与 lib 打包于一个文件（**这是最新惯例**，取代旧的两文件拆分，见 commit 9940286 "合并 theme-default vite 为单文件 command 分支"）。
- dev 分支：`root:'demo-web'`, port 5310, `optimizeDeps.exclude` 掉 `plugin-node-text/image/canvas-core-v2`。
- build 分支：external `['vue','@vue-flow/core','@mini-canvas/canvas-core-v2']`，globals 含 `VueFlow`。

**`plugin-node-text/vite.dev.config.ts`（可选的 dev/HMR 双配置）**：node-text 因要"宿主跨端口热拉"额外保留独立的 dev 配置（port 5311，自写 `forcePluginEntryHotUpdate` vite 插件保证整树 HMR 冒泡到 index），经 `"dev:hmr": "vite --config vite.dev.config.ts"` 调用。**一般插件不需要它**（theme-default/node-image 无此文件，dev 就是 `vite`）。

### 4. "typecheck" 命令定义
✅ 各子包统一 **`"typecheck": "tsc --noEmit"`**（不是 vue-tsc）：
- canvas-core-v2、plugin-canvas-commands、plugin-node-text、plugin-node-image、plugin-theme-default、mcp-server 全部一致。
- 用主 tsconfig（canvas-core-v2 用无 DOM 的 tsconfig.json；插件用带 DOM 的 tsconfig.json）。
- .vue 的类型检查：canvas-core-v2 走单独的 `vue-tsc -p tsconfig.vue.json`（`node ../../node_modules/vue-tsc/bin/vue-tsc.js`），但**未写进 package.json script**，靠主 agent 按 tsconfig 注释手动跑；插件用 env.d.ts 的 `*.vue` shim 让 plain tsc 把 .vue 当 any 跳过（不深查 .vue 内部）。
- 插件 tsconfig 与 canvas-core-v2 主 tsconfig 的差异：插件 `lib` 带 DOM、带 `jsx:preserve`；内核主 tsconfig 无 DOM 无 jsx（内核 .vue 用 tsconfig.vue.json 补 DOM）。**新建 vue 插件包请照插件 tsconfig 写法（含 DOM + jsx），照内核 tsconfig 会因无 DOM lib 报缺。**

插件 tsconfig 样板（theme-default/node-text/image/canvas-commands 四者一致）：
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "lib": ["ES2022","DOM"], "jsx": "preserve", "types": [],
    "strict": true, "noEmit": true, "skipLibCheck": true,
    "esModuleInterop": true, "isolatedModules": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"]
}
```

---

## 三、demo-web 怎么挂 dev

### 1. 各子包"自带 demo-web + 独立 vite dev"
✅ canvas-core-v2 与 plugin-theme-default 各带一个 `demo-web/`，各自独立起 vite：
- **canvas-core-v2**：`vite.config.ts` 设 `root: 'demo-web'`、port 5199（注释"避开老版前端 5173"）。demo 入口 `demo-web/index.html` + `main.ts`（mount CanvasDemo.vue），还带 `plugin-load.html/plugin-load-dev.html` 等宿主装配页。
- **plugin-theme-default**：`vite.config.ts` dev 分支 `root:'demo-web'`、port 5310、`open:true`。demo-web/App.vue 直接消费内核 `CanvasHost`（无双 vue 问题，demo 自己 mount 自己的 vue+VueFlow）。
- 插件 demo 通过 `dependencies/devDependencies` 里的 workspace 包 + `import` 源码 TS 直达（moduleResolution Bundler），vite `optimizeDeps.exclude` 处理 workspace 源码依赖。

### 2. 根 scripts 怎么起 dev —— 无聚合，逐包手动
✅ 根 package.json **没有任何 `dev-cordis` / 并行起多个 dev** 的脚本；也没有 pnpm-recursive run。各包 dev 是**手动进目录跑**：
```bash
cd packages/canvas-core-v2 && pnpm dev      # port 5199
cd packages/plugins/plugin-theme-default && pnpm dev   # port 5310
cd packages/plugins/plugin-node-text && pnpm dev:hmr   # port 5311 跨端口热拉（可选）
```
如需"根项目作为宿主同时挂多个插件 demo"，**现成机制是 canvas-core-v2/demo-web 的 plugin-load/plugin-load-dev 装配页**（`plugin-load-dev.html` 用 `import('http://localhost:5311/src/index.ts')` 跨端口热拉 node-text 开发态源码），以及内核 `createMiniCanvasHost`(window.MiniCanvas) 作为统一装配点支持热装/热卸插件。**没有单一"根脚本一键起所有 demo"的入口**——这是现状，需多个的话要么多终端各起一个，要么自己加聚合脚本（当前无）。

---

## 四、TS 工程引用与路径

### 1. 根 tsconfig 只引用根项目自身，不含子包
✅ 根 `tsconfig.json`：
```json
{ "files": [], "references": [
  { "path": "./tsconfig.app.json" },
  { "path": "./tsconfig.node.json" } ] }
```
- **project references 只连 app/node 两份，不引用任何 workspace 子包。**
- `tsconfig.app.json` 继承 `@vue/tsconfig/tsconfig.dom.json`，`paths: { "@/*": ["./src/*"] }` 只映射根 src（v1），不映射 @mini-canvas/*。
- `tsconfig.node.json` 只 `include: ["vite.config.ts"]`。
- **根 `build: "vue-tsc -b && vite build"` 的 `vue-tsc -b` 只 build 根 tsconfig references（v1 宿主 src），不覆盖子包**。
- 子包间路径不靠根 paths，而是靠 pnpm workspace 在 `node_modules` 装 symlink + 各包自身 `exports`/`moduleResolution: Bundler` 解析。**给新包加名字后要 `pnpm install` 让 workspace 认到（见 plugins/README checklist 第5步）。**

### 2. vue-tsc 在根/子包的拼法
- **根**：`package.json` 里 `build: "vue-tsc -b && vite build"`（vue-tsc 二进制在根 `node_modules/.bin/vue-tsc`）。`prosemirror-editor-bundle` 用它产声明：`"build:types": "vue-tsc --declaration --emitDeclarationOnly --outDir dist"`。
- **子包 canvas-core-v2（.vue typecheck）**：不装 .bin 快捷（tsconfig.vue.json 注释给的直接拼节点路径）：
  `node ../../node_modules/vue-tsc/bin/vue-tsc.js --noEmit -p tsconfig.vue.json`
- **插件包**：typecheck 用普通 `tsc --noEmit`（不跑 vue-tsc），靠 env.d.ts 把 .vue shim 成 any。
- 手动 tsc（STATUS.md 验证命令）：`node ../../node_modules/typescript/bin/tsc --noEmit`。

### 3. `canvas-core-v2/src/env.d.ts`（.vue shim）
✅ 全文即一份 `*.vue` 模块声明：
```ts
// 本包 src 自身无 .ts→.vue 导入，但当它编译跟随依赖(如 plugin-* 外部包)时，
// 被跟随的 .ts 可能 import .vue，需本程序内有一份 *.vue 声明兜底。
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, any>
  export default component
}
```
✅ 四个插件各在 `src/env.d.ts` 放同一份 shim，且 plugin-node-text/image/theme-default 顶部加 `/// <reference types="vite/client" />`（canvas-commands 无 import.meta/客户端引用故只有 shim）。plugin-canvas-commands 的 env.d.ts 注释解释得最清：因编译跟随内核 index.ts（其 re-export CanvasHost.vue）tsc 会去解析 .vue，故每个包都得自备 shim。

---

## 五、git / 提交约定

### 1. commit message 前缀惯例（scope 风格）
✅ 最近 20 条 commit（`git log --oneline -20`）覆盖：
- `refactor(canvas-core-v2): remove obsolete src/demo ...`
- `docs: mark canvas-host plan done; ...`
- `refactor: extract canvasCommands into @mini-canvas/plugin-canvas-commands package ...`
- `fix(theme-default): 背景网格改 canvas 绘制 ...`
- `feat(canvas-core-v2): add CanvasHost render host component ...`
- `chore: 合并 plugin-theme-default 的 vite 配置为单文件 command 分支`

规律：`<type>(<scope>): <描述>`，type ∈ `feat / fix / refactor / docs / chore / test`（偶见裸 type 不带 scope，如 `docs:`、`refactor:`）；scope 常指包名 `canvas-core-v2` / `theme-default` / `demo` / `plan` / `canvas-preview`；描述中文或英文简洁说明改动。范围聚焦原子改动（一次一个主题，如"抽一个包/加一个组件/修一个bug"）。**无 husky/pre-commit 钩子**（.git/hooks 全是 .sample；package.json 无 husky 段），提交靠自觉按规范。移动文件用 `git mv`/git 自动 rename 识别（283f5a5 里被移文件被识别为 rename：`src/plugins/canvasCommands.ts` → `plugins/plugin-canvas-commands/src/canvasCommandsPlugin.ts`）。

### 2. CRLF → LF 约定（有 .gitattributes，权威）
✅ **存在 `根/.gitattributes`**，硬性把全部文本转 LF：
```gitattributes
# 统一所有文本文件换行符为 LF
* text=auto eol=lf
# 源码与文档统一 LF
*.vue *.ts *.js *.mjs *.mts *.cts *.json *.md *.html *.css *.yaml *.yml *.txt *.svg  text eol=lf
# 配置文件统一 LF
.gitignore .gitattributes .npmrc .editorconfig  text eol=lf
# 二进制文件不转
*.png *.jpg *.jpeg *.gif *.webp *.ico *.db *.woff *.woff2 *.eot *.ttf *.otf  binary
```
✅ 且 `git config core.autocrlf = input`（提交时 CRLF→LF）。
✅ 结论：**新创建/改动的文本文件一律用 LF 行尾，禁止硬编码 `\r\n`**。凡覆盖到上面列出的扩展名/配置名都会自动归一 LF；新增文件照此约定用 LF 写即可，无需额外动作。

---

## 附：最近一次同类迁移的可复用清单（commit 283f5a5）

从内核抽 `canvasCommands` → `@mini-canvas/plugin-canvas-commands` 时的完整动作，可作为"挪代码进新包"模板：

1. 新建包目录 `packages/plugins/plugin-canvas-commands/`，含 4 个文件：
   - `package.json`（name/deps=内核 workspace:* + ts；scripts 仅 typecheck）
   - `tsconfig.json`（DOM + jsx + Bundler）
   - `src/env.d.ts`（*.vue shim）
   - `src/index.ts`（统一出口）
   - `src/canvasCommandsPlugin.ts`（把 `canvas-core-v2/src/plugins/canvasCommands.ts` rename 搬过来 + 适配插件形态）
2. 改消费方：
   - `packages/canvas-core-v2/package.json` 加 devDependency `@mini-canvas/plugin-canvas-commands: workspace:*`
   - `canvas-core-v2/src/index.ts` 去掉对内实现 import；demo 装配点改从插件 import
   - `plugin-theme-default/package.json` 也加对应 devDep（被 demo/typecheck 跟随）
3. 测试跟随：把被移代码的契约测试迁到内核 `host/__tests__/fullchain.test.ts`（用 `createMiniCanvasHost`），插件包自身不带测试。
4. `pnpm-lock.yaml` 随之更新（pnpm install 自动）。
5. 跑通验证：`pnpm install` → `pnpm -r run typecheck` → `cd packages/canvas-core-v2 && node ./node_modules/vitest/vitest.mjs run` → `pnpm dev` 目验。
6. commit 文案：`refactor: extract <X> into @mini-canvas/<pkg> package (align with text/image/theme plugins); remove from kernel src/plugins`（同型可复用）。

---

## 新建一个"vue 插件类子包"的最简清单（综合上述全部证据）

1. **放对目录**：能进 packages/plugins/（跟渲染/能力相关），勿放 packages/ 直下（那是内核层）。
2. **`package.json`**：`@mini-canvas/plugin-<type>`、`private:true`、`type:module`、`main`/`types`/`exports` 全指 `./src/index.ts` + `"./*":"./src/*"`；deps 里 `@mini-canvas/canvas-core-v2: workspace:*`；`vue` 进 peerDependencies + 重复 devDependencies；scripts: `typecheck`(tsc --noEmit)、按需 `build`(vite build)、`dev`(vite)。
3. **`tsconfig.json`**：Bundler + `lib:["ES2022","DOM"]` + `jsx:"preserve"` + `types:[]` + include src（照插件样板，勿照内核无 DOM 版）。
4. **`src/env.d.ts`**：`declare module '*.vue'` shim；需要 vite/client 类型则加 `/// <reference types="vite/client" />`。
5. **`vite.config.ts`**：需要产 UMD 就照 node-text/image（external vue + 内核，global `Vue`/`MiniCanvasCore`，UMD，css 内联）；需要"dev 也能自看"就照 theme-default 的 `({command})` 单配置双模式。
6. **UI + 逻辑同包**：content .vue 放本包 src，registerNodeType 一次注册，别放宿主 demo。
7. `pnpm install` 认到新包 → `pnpm -r run typecheck` 干净 → 内核 demo/测试全绿。
8. 依赖方向恒 插件→内核，禁止内核反向 import 插件。
9. 行尾一律 LF（.gitattributes 保证）。
