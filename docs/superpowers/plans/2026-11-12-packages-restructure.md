# packages 重构与契约包移除 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把仓库改成 `apps/` + `packages/engine/` + `packages/libs/` + `packages/plugins/` 四层结构，删除 `theme-contract` 与 `bar-contract`，并让所有库具备可打包发布的产物。

**Architecture:** 目录搬迁只改位置和包名，不改插件行为；两个契约包按“谁真的用”拆回插件或下沉到引擎；跨插件共享改走 `ctx.get('nodeBar')`、`ctx.provide`、`ctx.registryOf` 与 `declare module Services`。

**Tech Stack:** pnpm workspace、Vue 3、TypeScript、Vite、Vitest、VueFlow。

**Spec:** `docs/问题整理/27-packages目录分层与命名.md`

## Global Constraints

- 不碰 `backup/` 与根 `src/`（v1）。
- 不改插件名、节点类型名、服务名。
- 不改 `plugin-theme-canvas` 六个红线组件的 JSX/模板内容；只允许改 import 路径。
- 所有文件编辑优先用 `apply_patch`；目录搬迁用 `git mv`，批量 import 改名用一次性 codemod，随后人工复核。
- 每一步单独测试、单独提交。
- 不使用 worktree；在当前仓库直接创建 `codex/packages-restructure` 分支。

---

### Task 1: 建立新目录骨架并搬迁包

**Files:**
- Create: `apps/`, `packages/engine/`, `packages/libs/`
- Move: `packages/ui` → `apps/web`
- Move: `packages/cloud-server` → `apps/server`
- Move: `packages/docs` → `apps/docs`
- Move: `packages/kernel` → `packages/engine/kernel`
- Move: `packages/canvas-data` → `packages/engine/canvas-data`
- Move: `packages/canvas-render` → `packages/engine/canvas-render`
- Move: `packages/vue-render` → `packages/engine/vue-render`
- Move: `packages/canvas-base` → `packages/libs/plugin-sdk`
- Move: `packages/ui-kit-shadcn` → `packages/libs/ui-kit`
- Move: `packages/prosemirror-editor-bundle` → `packages/libs/editor`
- Modify: `pnpm-workspace.yaml`

- [ ] **Step 1:** `git mv` 上述目录，保留 `.git` 历史。
- [ ] **Step 2:** 把 `pnpm-workspace.yaml` 改成 `apps/*`、`packages/engine/*`、`packages/libs/*`、`packages/plugins/*`。
- [ ] **Step 3:** 改三个库的 `package.json` 包名：`@plume-canvas/plugin-sdk`、`@plume-canvas/ui-kit`、`@plume-canvas/editor`。
- [ ] **Step 4:** `pnpm install`，确认 workspace 识别全部包。

### Task 2: 全局改包名引用

**Files:** 所有 `.ts/.vue/.js/.mjs/.json/.md` 中出现的旧包名。

- [ ] **Step 1:** codemod 替换 `@plume-canvas/plugin-sdk` → `@plume-canvas/plugin-sdk`。
- [ ] **Step 2:** codemod 替换 `@plume-canvas/ui-kit` → `@plume-canvas/ui-kit`。
- [ ] **Step 3:** codemod 替换 `prosemirror-editor-bundle` → `@plume-canvas/editor`（保留 `@plume-canvas/editor/style.css` 等子路径）。
- [ ] **Step 4:** 更新 `packages/plugins/vite-plugin-lib.ts` 的 `HOST_GLOBALS` 键与 `apps/web/src/sharedGlobals.ts` 的 import；全局名 `PlumeBase` 不变。
- [ ] **Step 5:** 跑 `pnpm -C packages/engine/kernel test` 与 `pnpm -C apps/web typecheck`，先修最直接的解析错误。

### Task 3: 删除 bar-contract，底栏改走 nodeBar 服务

**Files:**
- Move: `packages/bar-contract/src/types.ts` → `packages/engine/canvas-data/src/canvas/barTypes.ts`
- Move: `packages/bar-contract/src/registry.ts` → `packages/plugins/plugin-bottom-bar/src/bar/registry.ts`
- Move: `packages/bar-contract/src/toolActions.ts` → `packages/plugins/plugin-bottom-bar/src/bar/toolActions.ts`
- Move: `packages/bar-contract/src/apiBase.ts` → `packages/libs/plugin-sdk/src/apiBase.ts`
- Modify: `packages/engine/canvas-data/src/canvas/serviceTypes.ts`（登记 `nodeBar`）
- Modify: `packages/plugins/plugin-bottom-bar/src/nodeBarPlugin.ts`
- Modify: `packages/plugins/plugin-node-text/src/nodeTextPlugin.ts`
- Modify: `packages/plugins/plugin-node-video/src/nodeVideoPlugin.ts`
- Modify: `packages/plugins/plugin-showcase/src/apiBase.ts`
- Modify: `packages/plugins/plugin-style-library/src/data/api.ts`
- Modify: `packages/plugins/plugin-cloud-client/src/__tests__/apiBaseParity.test.ts`
- Delete: `packages/bar-contract/`

**Interfaces:**
- `NodeBarContract.register(scope, action): void`
- `NodeBarContract.registerApplier(scope, kind, fn): void`
- `NodeBarContract.publishTools(scope, opts): () => void`
- `ctx.get('nodeBar')` 返回 `NodeBarContract`。

- [ ] **Step 1:** 把 `BarAction/BarApplier/BarRunInput/BarRunContext` 放进 canvas-data，并在 `serviceTypes.ts` 的 `Services` 里加 `nodeBar: NodeBarContract`。
- [ ] **Step 2:** bottom-bar 实现 `NodeBarContract`，内部 registry/toolActions 改为本地文件。
- [ ] **Step 3:** 文字节点改成 `const bar = ctx.get('nodeBar'); bar.publishTools(...); bar.registerApplier(...)`。
- [ ] **Step 4:** 视频节点改成 `ctx.get('nodeBar').publishTools(...)`。
- [ ] **Step 5:** `apiBase` 移到 plugin-sdk 并从 canvas-base 出口导出；showcase/style-library/cloud-client 测试改引用。
- [ ] **Step 6:** 删除 `packages/bar-contract` 与所有 workspace 依赖、vite external 引用。
- [ ] **Step 7:** 跑 bottom-bar、node-text、node-video、cloud-client、showcase、style-library 的测试。

### Task 4: 删除 theme-contract，按用途拆回

**Files:**
- Move: `theme-contract/src/canvasConfig.ts` + `themeDefaults.ts`（去重后）→ `packages/plugins/plugin-theme-canvas/src/config/`
- Move: `theme-contract/src/multiRadio.ts` → `packages/plugins/plugin-theme-canvas/src/theme/multiRadio.ts`
- Move: `theme-contract/src/nodeLoadingTier.ts` → `packages/plugins/plugin-theme-canvas/src/theme/nodeLoadingTier.ts`
- Move: `theme-contract/src/appearanceConfig.ts` → `packages/plugins/plugin-theme-components/src/config/appearanceConfig.ts`
- Move: `theme-contract/src/themeBridge.ts` → `packages/plugins/plugin-theme-components/src/theme/themeBridge.ts`
- Move: `theme-contract/src/navIcon.ts` → `packages/plugins/plugin-theme-components/src/components/settings/navIconTable.ts`
- Move: `theme-contract/src/notifyService.ts` → `packages/plugins/plugin-theme-components/src/notifyService.ts`
- Move: `theme-contract/src/styles/node-theme.css` → `packages/engine/canvas-render/src/styles/node-theme.css`
- Move: `theme-contract/src/edgeGeometry.ts` → `packages/engine/canvas-render/src/edgeGeometry.ts`
- Create: `packages/engine/canvas-render/src/theme/defaults.ts`（启动默认值与设置键表）
- Modify: `apps/web/src/composables/ui/createUiState.ts`
- Modify: `apps/web/src/composables/ui/useUiLifecycle.ts`
- Modify: `apps/web/src/sharedGlobals.ts`
- Modify: `packages/plugins/plugin-theme-canvas/src/index.ts`
- Modify: `packages/plugins/plugin-theme-components/src/index.ts`
- Modify: `packages/plugins/plugin-theme-components/src/themePreview.ts`
- Delete: `packages/theme-contract/`

- [ ] **Step 1:** 把启动默认值 `DEFAULT_THEME_*` 与 `*_SETTING_KEYS` 放进 canvas-render，合并 `DEFAULT_EDGE_VISUAL` 等已有默认值，保证只剩一份。
- [ ] **Step 2:** `apps/web` 改从 canvas-render 取默认值和设置键。
- [ ] **Step 3:** theme-canvas 的 Config、multiRadio、nodeLoadingTier 改为本地文件；默认值从 canvas-render 取。
- [ ] **Step 4:** theme-components 的 Config、themeBridge、navIcon、notifyService 改为本地文件；预览几何从 canvas-render 取。
- [ ] **Step 5:** `node-theme.css` 新地址同步给 theme-components、theme-canvas、plugin-node-ui、plugin-node-3d-preview、docs demo。
- [ ] **Step 6:** 删除 theme-contract 与 workspace 依赖、vite external、HOST_GLOBALS 的 `PlumeThemeContract`。
- [ ] **Step 7:** 跑 theme-canvas、theme-components、ui、canvas-render 的测试。

### Task 5: 让库可 npm 打包

**Files:** `packages/engine/{kernel,canvas-data,canvas-render,vue-render}`、`packages/libs/{plugin-sdk,ui-kit,editor}` 的 `package.json`、`vite.config.ts`、`tsconfig.build.json`。

- [ ] **Step 1:** 每个库补 `build` 脚本：Vite lib 模式 + `vue-tsc`/`tsc` 产出 `.d.ts`。
- [ ] **Step 2:** `package.json` 补 `main/module/types/exports/files/sideEffects`，`private` 设为 `false`（仅库包）。
- [ ] **Step 3:** 把 workspace 依赖改成 `peerDependencies` 或保留 `workspace:*`（打包时由 pnpm 替换）。
- [ ] **Step 4:** 逐个跑 `pnpm -C <pkg> build`，产物落在各自 `dist/`。
- [ ] **Step 5:** 用 `pnpm pack --dry-run` 检查每个库的 tarball 内容。

### Task 6: 全仓验证

- [ ] **Step 1:** `pnpm install`。
- [ ] **Step 2:** 跑 kernel、canvas-data、canvas-render、vue-render、plugin-sdk、ui-kit、editor 的 typecheck 与 test。
- [ ] **Step 3:** 跑 apps/web、apps/server 的 typecheck 与 test。
- [ ] **Step 4:** 跑全部插件的 test（至少 theme、bottom-bar、node-text、node-video、cloud-client、showcase、style-library）。
- [ ] **Step 5:** `pnpm start` 启动，Chrome 打开画布，确认：节点显示、设置面板可进、底栏动作存在、通知正常、主题切换正常。
- [ ] **Step 6:** 停掉服务，报告结果。

## Self-Review

- 覆盖：四层目录、两个契约包删除、上下文替代、npm 打包、测试与浏览器验证均有对应任务。
- 风险点：`theme-contract` 的启动默认值必须在插件装载前可用，因此下沉到 `canvas-render`，不从插件服务取。
- 风险点：`bar-contract` 的类型放 `canvas-data`，运行时仍由 `plugin-bottom-bar` 提供 `nodeBar` 服务。
- 风险点：目录搬迁会改相对路径，`build-assets-parallel.mjs`、`bundle-assets.mjs`、`bundle-dts.mjs`、`static.ts`、docs 数据加载器需要逐个核对。
