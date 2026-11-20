# NPM 发布与自动更新体系 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 plume-canvas 拆成小包发到 npm，`npx plume-canvas` 启动时自动装缺失的插件与 UI，定时检查更新（只提示），插件安装支持依赖解析与卸载拦截。

**Architecture:** 新建 `apps/server/src/updater/`（bootstrap + checker + dependency resolver），复用现有 npmClient 与 npmPlugins doInstall；server 包瘦身（files 去 assets）；发布脚本按清单逐包发。内置清单是 server 包内 JSON（builtin-manifest.json）。

**Tech Stack:** Node 22 内置 fetch（已有 npmClient）、vitest、esbuild（现有 bundle 管道）、npm CLI（发布）。

**Spec:** docs/superpowers/specs/2026-11-20-npm-publish-and-auto-update-design.md

## Global Constraints

- 修改文件只用 apply_patch（AGENTS.md 铁律）。
- 不碰 v1：根 src/ 与 backup/canvas-core。
- kernel 不依赖任何 @plume-canvas 包，不 import .vue。
- 更新策略：只提示不自动装（用户已确认）。
- scope 固定 @plume-canvas；本轮只发自带插件（BUILTIN_PLUGINS 24 个）+ ui + server。
- token 不写入任何文件，发布时环境变量 NPM_TOKEN 注入。
- 每完成一个任务就 commit。

---

### Task 1: builtin-manifest.json 生成与读取

**Files:**
- Create: `apps/server/scripts/gen-builtin-manifest.mjs`
- Create: `apps/server/src/updater/builtinManifest.ts`
- Modify: `apps/server/package.json`（scripts 加 gen:manifest）
- Test: `apps/server/src/__tests__/builtinManifest.test.ts`

**Interfaces:**
- Produces: `readBuiltinManifest(pkgRoot): Promise<{ plugins: Record<string, string> }>` —— plugins 键=插件目录名，值=版本或 "latest"。

- [ ] **Step 1: 写失败测试** —— 测试读一个临时 manifest JSON 断言 plugins 内容解析正确；manifest 文件缺失时返回空 plugins 不抛错。

- [ ] **Step 2: 跑测试确认失败**（模块不存在）

- [ ] **Step 3: 实现 builtinManifest.ts**

```ts
import { readFile } from "node:fs/promises"
import path from "node:path"

export interface BuiltinManifest {
  plugins: Record<string, string>
}

export async function readBuiltinManifest(pkgRoot: string): Promise<BuiltinManifest> {
  try {
    const raw = await readFile(path.join(pkgRoot, "builtin-manifest.json"), "utf8")
    const parsed = JSON.parse(raw) as Partial<BuiltinManifest>
    return { plugins: parsed.plugins ?? {} }
  } catch {
    return { plugins: {} }
  }
}
```

- [ ] **Step 4: 写 gen-builtin-manifest.mjs** —— 从 src/plugins/builtinPlugins.ts 读 BUILTIN_PLUGINS（直接 import 编译产物或正则解析），生成 `{ "plugins": { "<dir>": "latest", ... } }` 写入 `dist/builtin-manifest.json`。bundle.mjs 末尾追加调用（或 package.json build 链上挂）。

- [ ] **Step 5: 跑测试通过 + commit**（`git commit -m "feat(server): builtin manifest generation and reader"`）

### Task 2: 版本比对与更新检查器

**Files:**
- Create: `apps/server/src/updater/checker.ts`
- Test: `apps/server/src/__tests__/updateChecker.test.ts`

**Interfaces:**
- Produces: `compareVersions(a: string, b: string): number`（semver 比较，简单实现，不引依赖）
- Produces: `createUpdateChecker(opts): UpdateChecker`，opts 含 npmClient（注入假 registry）、installedRecordFile、serverPkgName、currentServerVersion、builtinManifest。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from "vitest"
import { compareVersions, createUpdateChecker } from "../updater/checker.js"

describe("compareVersions", () => {
  it("1.2.0 < 1.3.0", () => expect(compareVersions("1.2.0", "1.3.0")).toBe(-1))
  it("1.0.0 = 1.0.0", () => expect(compareVersions("1.0.0", "1.0.0")).toBe(0))
  it("2.0.0 > 1.9.9", () => expect(compareVersions("2.0.0", "1.9.9")).toBe(1))
})

describe("createUpdateChecker", () => {
  it("installed 里有旧版插件 → 报告有更新", async () => {
    const fakeClient = { packument: async (name: string) => ({
      name, "dist-tags": { latest: "2.0.0" },
      versions: { "2.0.0": { version: "2.0.0", tarball: "x" } },
      time: {},
    }) }
    // installedRecordFile 指向临时 JSON: { "pkg-a": { version: "1.0.0", installedAt: "..." } }
    const checker = createUpdateChecker({
      npmClient: fakeClient,
      installedRecordFile: tempFile,
      serverPkgName: "@plume-canvas/server",
      currentServerVersion: "0.1.0",
      builtinManifest: { plugins: { "pkg-a": "latest" } },
    })
    const report = await checker.checkAll()
    expect(report.plugins).toContainEqual({ pkg: "pkg-a", local: "1.0.0", latest: "2.0.0", builtin: true })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现 checker.ts**（compareVersions 按 . 切数字逐段比；createUpdateChecker 读 installed JSON + packument 并发查，汇总报告；packument 查失败的单项跳过不致命）
- [ ] **Step 4: 测试通过 + commit**

### Task 3: 依赖解析器

**Files:**
- Create: `apps/server/src/updater/depsResolver.ts`
- Test: `apps/server/src/__tests__/depsResolver.test.ts`

**Interfaces:**
- Produces: `resolveDeps(targetPkgMeta, localInstalled, npmClient): Promise<DepPlan>`
  - DepPlan = { installOrder: Array<{ pkg: string; version?: string }>; missing: string[]; optionalMissing: string[]; cycle: boolean }

- [ ] **Step 1: 写失败测试**

```ts
it("缺依赖 → 计划先装提供者再装目标", async () => {
  // npmClient.packument("plugin-x") 返回 plume.provides=["svc-x"]
  // npmClient.packument("plugin-target") 返回 plume.dependencies=["svc-x"]
  // localInstalled: {}
  const plan = await resolveDeps("plugin-target", { deps: ["svc-x"] }, localInstalled, fakeClient)
  expect(plan.installOrder.map(p => p.pkg)).toEqual(["plugin-x", "plugin-target"])
})
it("依赖在 npm 上找不到提供者 → missing 报错", async () => {
  // npmClient.packument 搜不到含 svc-ghost 的包
  expect(plan.missing).toEqual(["svc-ghost"])
})
it("A 依赖 B、B 依赖 A → cycle=true 不死循环", async () => {
  expect(plan.cycle).toBe(true)
})
it("optionalDependencies 缺 → 只进 optionalMissing", async () => {
  expect(plan.optionalMissing).toContain("svc-opt")
})
```

- [ ] **Step 2: 确认失败 → Step 3: 实现（递归 DFS + visited 集合防环；候选池用 npmClient.search 按 provides 名找）→ Step 4: 通过 + commit**

### Task 4: npmPlugins 路由接依赖解析

**Files:**
- Modify: `apps/server/src/routes/npmPlugins.ts`（doInstall 前插依赖解析；uninstall 前插反向检查）
- Test: `apps/server/src/__tests__/npmPluginsDeps.test.ts`

**Interfaces:**
- Consumes: Task 3 的 resolveDeps、DepPlan。

- [ ] **Step 1: 写失败测试**：装一个带 dependencies 的包（假 registry + 临时 pluginsDir）→ 断言提供者目录先于目标目录落盘；卸载被依赖的提供者 → 返回 409 且 body 列出依赖者。
- [ ] **Step 2: 确认失败 → Step 3: 实现**：doInstall 里先 resolveDeps；installOrder 逐个走现有安装函数；missing 非空 → 400 带 missing 列表；uninstall 前 reverseLookup（扫 pluginsDir/*/package.json 的 plume.dependencies 引用了它的 provides）→ 有依赖者 409。
- [ ] **Step 4: 通过（含原 npmPlugins 测试回归）+ commit**

### Task 5: bootstrap 启动初始化

**Files:**
- Create: `apps/server/src/updater/bootstrap.ts`
- Modify: `apps/server/src/cli.ts`（serve 前调 bootstrap；--offline 参数）
- Modify: `apps/server/src/server.ts`（createCloudServer 挂 GET /api/updates）
- Test: `apps/server/src/__tests__/bootstrap.test.ts`

**Interfaces:**
- Consumes: Task 1 readBuiltinManifest、Task 2 checker、Task 3/4 的安装路径。
- Produces: `runBootstrap(opts): Promise<BootstrapResult>`；opts = { dataDir, pkgRoot, offline }；BootstrapResult = { installed: string[]; skipped: string[]; failed: string[]; uiVersion?: string }。

- [ ] **Step 1: 写失败测试**：临时 dataDir + 假 registry + 临时 manifest → runBootstrap 断言 installed 包含清单插件名、.plume/ui/<v>/ 目录存在、version.json 写入正确。
- [ ] **Step 2: 确认失败 → Step 3: 实现**

ensurePlugins：读 manifest → 逐个检查 `<dataDir>/plugins/<dir>` 存在且 package.json 有 plume 段 → 不存在则走 npmPlugins 的安装 service（把 doInstall 抽成可 import 的函数；不经过 HTTP）。

ensureUi：读 `<dataDir>/ui/version.json`（不存在/版本旧）→ npmClient.packument("@plume-canvas/ui") 拿 latest tarball → downloadTarball 到临时文件 → extractTarball 到 `<dataDir>/ui/<version>/` → 写 version.json。

失败策略：每个插件独立 try/catch，失败进 failed 数组继续下一个；全部 warn 不抛。

server.ts：新增 `/api/updates` GET（返回最近一次 checkAll 报告 + `{ refresh: true }` 触发重新检查）。

cli.ts：serve 子命令启动前（端口释放后）调 runBootstrap（--offline 跳过；默认异步执行不 await，日志打印进度）。

- [ ] **Step 4: 测试通过 + commit**

### Task 6: server 瘦身 + UI 解析路径

**Files:**
- Modify: `apps/server/package.json`（files 去 assets，加 builtin-manifest.json；prepack 去 bundle-assets）
- Modify: `apps/server/src/static.ts`（resolveUiDist 候选加 `<dataDir>/ui/<version>`，需把 dataDir 传进来）
- Modify: `apps/server/src/plugins/pluginRoots.ts`（packaged 不存在时已返回 undefined，确认无需改；补注释）

- [ ] **Step 1: 改 package.json files 与 prepack**
- [ ] **Step 2: resolveUiDist 加 dataDir 参数**（默认 undefined 保持旧行为；server.ts 调用时传 dataDir）
- [ ] **Step 3: 跑 apps/server 全量测试回归 + typecheck + commit**

### Task 7: 发布准备（package.json 批量改 + 发布脚本）

**Files:**
- Modify: `packages/plugins/<24 个自带>/package.json`（去 private、version 0.1.0、publishConfig、files）
- Modify: `apps/web/package.json`（同上，包名 @plume-canvas/ui）
- Modify: `apps/server/package.json`（version 0.1.0、去 private）
- Create: `scripts/publish-all.mjs`

- [ ] **Step 1: 写脚本批量改 24 个自带插件 package.json**（脚本一次性执行，改动落盘后 review diff）——字段：`private` 删、`version: "0.1.0"`、`publishConfig: { access: "public" }`、`files: ["dist", "package.json", "README.md"]`。非自带清单的插件不动。
- [ ] **Step 2: apps/web package.json 同样处理**（files: ["dist"]）
- [ ] **Step 3: 写 publish-all.mjs**

```js
// scripts/publish-all.mjs
// 顺序：内置插件（BUILTIN_PLUGINS 顺序）→ apps/web → apps/server
// 每包：npm publish --access public（--dry-run 时加 --dry-run）
// 失败即停，打印失败包名
```

- [ ] **Step 4: --dry-run 验证**：跑 `node scripts/publish-all.mjs --dry-run`，确认逐包打印且 npm 无报错（不真发）。
- [ ] **Step 5: commit**

### Task 8: 前端红点 + 手动更新接入

**Files:**
- Modify: `packages/plugins/plugin-manager/src/pluginManagerService.ts`（加 fetchUpdateReport()）
- Modify: `packages/plugins/plugin-manager/src/components/settings/PluginCard.vue`（有更新时红点标记）
- Test: 更新 `packages/plugins/plugin-manager/src/__tests__/pluginManagerService.test.ts`

**Interfaces:**
- Consumes: GET /api/updates（Task 5）。

- [ ] **Step 1: 写失败测试**（fetchUpdateReport 拉 API 转 rows 状态）
- [ ] **Step 2: 实现 fetchUpdateReport + 卡片红点（updateAvailable 布尔 → 小圆点样式）
- [ ] **Step 3: 插件包测试通过 + commit**

### Task 9: 收尾验证

- [ ] **Step 1: 全量测试**：`pnpm -C apps/server test`、`pnpm -C apps/web test`、`pnpm -C packages/plugins/plugin-manager test`
- [ ] **Step 2: typecheck**：`pnpm -C apps/server typecheck`、`pnpm -C apps/web typecheck`
- [ ] **Step 3: 本地端到端**：构建 server + ui → 临时数据目录跑 `node apps/server/dist/cli.js serve` → 观察日志装插件/装 UI → Chrome 打开页面看插件管理页红点与手动更新。
- [ ] **Step 4: 真实发布**（用户确认后）：设 NPM_TOKEN 环境变量 → `node scripts/publish-all.mjs`（不带 --dry-run）→ npmjs.com 验证包页面。
- [ ] **Step 5: 更新 docs/问题整理/ 记录本次架构变更。
