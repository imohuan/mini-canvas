# UI 出口包计划 —— 新建 `@mini-canvas/ui`，把成品 UI 面板从渲染抽象层搬出来

日期：2026-09-05 · 分支：feat/cordis-plugin-system · 状态：**待用户审核**
作者：code-developer · 类型：包结构重构

依据：用户连续三轮澄清后的方向确认 ——
- 原"内置进 SettingsHost"思路**放弃**（用户点破：canvas-render 渲染层**只做 UI 抽象，本就不该自带具体成品 UI**）。
- 方向 = 新建一个独立 packages 作为 **UI 主要输出包**，把散在渲染抽象层里的"成品 UI"（`PluginSettingsPanel`）搬过去。

---

## 〇、北极星目标（一句话）

新建 `packages/ui`（npm 名 `@mini-canvas/ui`），作为对外"成品 UI 面板"的主要输出包；
把当前"漏放"在渲染抽象层 `canvas-render` 里的 schema 驱动设置面板 `PluginSettingsPanel` **连同它自洽的依赖闭包**搬进去，
让 `canvas-render` 回归"纯抽象/宿主"定位、`@mini-canvas/ui` 承接成品面板，供 theme-default 注册 / demo 直接消费。

---

## 一、为什么搬（问题诊断）

1. **渲染层语义被成品 UI 污染**：`canvas-render` 定位是"渲染宿主/抽象层"（CanvasHost/SlotHost/槽机制/注入令牌），
   但 `PluginSettingsPanel.vue` 是一个**开箱即用的成品设置表单 UI**，不属于抽象层——它是"具体长什么样"的皮，
   语义上应归到"UI 成品输出"层。
2. **没有"UI 主要输出"的归属地**：用户希望对外提供一个面向"面板/成品 UI"的统一出口包，供上层(demo/宿主/别的插件)取成品面板，
   目前这类东西要么挤在 canvas-render、要么挤在各 plugin 包里，缺少一个主出口。

---

## 二、搬什么 —— PluginSettingsPanel 的依赖闭包（关键）

`PluginSettingsPanel.vue` 不是孤立单文件，搬过去要连同它依赖的一小撮共享件。逐文件核对（已 grep 全库确认无其它秘密引用）：

| 文件(现在在 canvas-render/src) | 它是什么 | 谁还用它 | 搬法 |
|---|---|---|---|
| `components/PluginSettingsPanel.vue` | **成品设置面板组件**（本轮主角） | 仅 theme-default/settings.ts 注册、index.ts 导出 | **→ ui** |
| `components/settingsPanelTypes.ts` | 纯类型：`SettingsPanelSource` 契约 + re-export 内核 SettingSchema/SettingEntry | 被 PluginSettingsPanel 与 **SettingsHost** 共用 | **契约归谁见决策①** |
| `components/settingsSource.ts` | 适配器 `settingsSourceFrom(ctx)`：内核 ctx → SettingsPanelSource 契约 | 被 **SettingsHost** 用、index.ts 导出、有单测 | **契约归谁见决策①** |
| `utils/coalesce.ts` | 合帧工具 `createCoalescer`（面板内部防抖用） | 被 PluginSettingsPanel 用、index.ts 导出、有单测 | **需共享 → 决策①** |
| `components/__tests__/settingsSource.test.ts` | 单测 | — | 跟着适配器走 |

> **关键矛盾**：`SettingsHost`（用户说"不用管、留在渲染抽象层"）依赖 `settingsPanelTypes`(类型) + `settingsSource`(适配器)。
> 所以这套"面板数据契约"要么留在 canvas-render 让 ui 反引（顺依赖），要么复制一份（违反 DRY）——
> 见决策①。

---

## 三、目标依赖方向

**`@mini-canvas/ui` → `canvas-render`（抽象）→ `canvas-core-v2`（内核）**。渲染抽象层仍是"面板数据契约/宿主"的共享归属地，
ui 是依赖它的更上层成品包。不产生环：canvas-render 不 import ui。

```
packages/
  canvas-core-v2/    # 内核（纯逻辑）
  canvas-render/     # 渲染抽象层：CanvasHost / SlotHost / SettingsHost / 面板契约+适配器 / 注入令牌
  ui/                # ★新建：成品 UI 面板输出包 → 先收编 PluginSettingsPanel
  plugins/…          # 具体皮插件（theme-default 等）
```

---

## 四、实施步骤（每步 = 可独立验证的原子 commit）

### Step 1 —— 建 `packages/ui` 空骨架
- `pnpm-workspace.yaml` 已含 `packages/*`，新包在 packages/ui 下即自动收编，无需改 workspace 文件。
- 建 `package.json`（name `@mini-canvas/ui`，main/types 指向 src/index.ts，deps: canvas-core-v2 + canvas-render 为 workspace:*，peer: vue）、
  `tsconfig.json` + `tsconfig.vue.json` + `src/env.d.ts`（复刻 canvas-render 骨架）、`vitest.config.ts`、空 `src/index.ts`。
- 验收：`pnpm install` 认到新包；ui 下 `tsc --noEmit` + vue-tsc 干净。

### Step 2 —— 把 PluginSettingsPanel 及闭包搬进 ui，方向待决策①定案
- 按决策①落位文件，`src/components/PluginSettingsPanel.vue` 与共享件就位，改好 import 指向。
- ui `index.ts` 导出 PluginSettingsPanel（+ 依决策①附带导出的契约/适配器/工具）。
- 验收：ui 内 vue-tsc 干净。

### Step 3 —— canvas-render 摘掉成品面板导出
- 按决策①，canvas-render `index.ts` 移除已迁走的导出（PluginSettingsPanel；及决策①判定随迁的契约/工具）。
- 若契约留在 canvas-render：删 `components/PluginSettingsPanel.vue`（本体），settingsPanelTypes/settingsSource/coalesce 保留并继续导出。
- 验收：canvas-render `tsc -p tsconfig.vue.json` + vitest 干净（settingsSource.test/coalesce.test 仍在则绿）。

### Step 4 —— 改消费者引用
- `plugin-theme-default/src/settings.ts`：`import { PluginSettingsPanel } from '@mini-canvas/canvas-render'` → 改指 `@mini-canvas/ui`；
  该包 package.json 加 `@mini-canvas/ui: workspace:*` 依赖。canvas-render 的 peer/devDeps 相应挪位。
- 验收：theme-default `tsc --noEmit` 干净。

### Step 5 —— demo-web 收尾 + 全量回归
- CanvasDemo.vue 若仍 import 面板相关（SettingsHost 仍从 canvas-render import，不变；确认无直接 import PluginSettingsPanel 即可）。
- 回归：各包 vitest + tsc/vue-tsc + demo `vite build`。

---

## 五、决策点（需你拍板）

| # | 问题 | 我的推荐 |
|---|---|---|
| ① | **面板数据契约归属**：`settingsPanelTypes`(类型) + `settingsSource`(适配器) 被**SettingsHost**(留在 render) 与 **PluginSettingsPanel**(搬去 ui) 共用。放哪？ | **留在 canvas-render**，ui 反向依赖 canvas-render 引类型 —— 保持"契约/宿主在抽象层、成品在 ui"的分层，不复制、无环。代价：ui 依赖 render |
| ② | 搬完 **canvas-render 是否彻底删 PluginSettingsPanel**？ | 是（本体归 ui），只留契约/适配器/宿主。若你后续还想让"抽象层自带一版可渲染默认面板"，再议 |
| ③ | `coalesce` 工具（面板防抖用）归谁 | 留在 canvas-render（它已是通用工具 + 有单测 + 渲染抽象层导出），ui 反向 import；**不复制** |
| ④ | 包名/位置 | `packages/ui`，npm `@mini-canvas/ui`（在 packages/* 非 plugins/*，因它是"上层成品 UI 输出"而非插件） |

---

## 六、风险与注意事项

- **依赖方向**：ui → render → core 单向；绝不 render → ui。靠 pnpm workspace + 代码 owner 守。
- **他人未提交**：`plugin-theme-default/src/index.ts` 有未提交改动，**不碰**；只改其 `src/settings.ts`（已是独立文件）。
- **单测**：`settingsSource.test.ts` / `coalesce.test.ts` 若判定留 render，保持绿；Do not change the tests。
- **红线**：不破坏 SlotHost/CanvasHost/theme 槽机制；用户说 SettingsHost "不用管"——除非决策①需要，否则不动 SettingsHost 行为。
- 每步独立 commit；文档进 docs/plan/（本文）；调查/中间物进 docs/tmp/ 待用户决定留删。

---

## 七、验证命令

```bash
pnpm install
# ui 包
cd packages/ui && node ../canvas-render/../.. 无 —— 用各包自身 node_modules/.bin
# 参考：canvas-render 用 .bin/vitest run、.bin/vue-tsc --noEmit -p tsconfig.vue.json
# theme-default 用 .bin/tsc --noEmit -p tsconfig.json
# demo 用 packages/canvas-core-v2 下 .bin/vite build（root=demo-web）
```

---

## 阶段 B（追加）—— ui 包自包含可运行：内部起一个 CanvasHost 完整演示

> 用户点破：上一版 ui 只是"成品组件库"，没装配 CanvasHost、`pnpm dev` 起不来、看不到最终效果。
> 需求修正：`@mini-canvas/ui` 要**自带一个可运行演示**，`pnpm dev` 即用 CanvasHost 渲染真实画布 + 设置面板。
> demo-web(旧 canvas-core-v2 下的演示) 已被用户删除废弃 → ui 包取代其"最终效果展示"地位。

### B 目标
在 ui 包内建 `dev/`(vite root) 自包含演示：CanvasHost + theme-default/node-text/node-image/canvas-commands + settingsPanelPlugin(注册 PluginSettingsPanel 到槽) + SettingsHost(#ui 槽渲染设置面板)。`pnpm dev` 打开浏览器即见最终效果。

### B 结构
```
packages/ui/
  package.json        # dev 脚本 + vite/vue/@vitejs/plugin-vue(devDep) + 各插件(workspace dep/peer)
  vite.config.ts      # root=dev, command=serve → dev server(避让现有端口)
  src/index.ts        # 库出口(不变: PluginSettingsPanel)
  dev/
    index.html        # #app + main.ts
    main.ts           # createApp + @vue-flow css
    CanvasApp.vue     # CanvasHost 完整装配演示(替代被删 CanvasDemo)
```

### B 决策
- 演示 import 全走 @mini-canvas/* 包名(不像被删 demo 用 canvas-core-v2 包内相对路径)。
- 设置实时生效：保留 bindThemeSettings 式窄更新(改设置→连线外观实时变)，体现最终效果。
- SettingsHost 经 theme-default/settings 的 settingsPanelPlugin 拿到默认皮 = ui 包的 PluginSettingsPanel，闭环。

### B 验证
`cd packages/ui && pnpm dev`(起 dev server) + 无头浏览器截图看画布+设置面板渲染 + `pnpm typecheck` + 各包回归。

---

## 阶段 C（最终定案，执行中）—— 架构收敛：成品应用 + 设置界面归 theme-default

> 多轮澄清后用户敲定的整体架构：
> - **@mini-canvas/ui = 整棵项目的"成品出口"**：一个已组装好的应用（index.html 在包根、代码在 src/），
>   pnpm dev 即用 CanvasHost 渲染画布，顶部"⚙ 设置"按钮弹出设置界面。
> - **设置界面(PluginSettingsPanel + settings 注册)归 plugin-theme-default**（画布默认皮插件，只渲染不带业务），
>   canvas-render 只留抽象宿主 SettingsHost + 数据契约。ui 装配 theme-default 即自带默认设置面板。

### C 落地
- theme-default：新增 src/components/PluginSettingsPanel.vue（自 canvas-render 迁移）+ src/settings.ts(settingsPanelPlugin
  注册默认皮 order:0) + index.ts 末尾 re-export settingsPanelPlugin/registerDefaultSettingsPanel（绕开 exports 子路径
  ./settings 在 TS 下的解析不稳，ui 从主入口取）。
- ui：index.html 移到包根、代码迁 src/(App.vue+main.ts)，去掉组件库出口(src/index.ts/defaultSettingsPlugin/PluginSettingsPanel)、
  dev/ 目录。App.vue = CanvasHost + 插件(theme+settings+text+image+commands) + 顶部"⚙ 设置"按钮切换右下设置 dock；
  dock 内 <SettingsHost/> 渲染 theme-default 默认设置皮，改动经 bindThemeSettings 窄更新到连线外观。
- 验证：ui pnpm dev 画布+顶部按钮+点开设置面板全链路 OK；theme-default 14 测试、canvas-render 49 测试、各包 tsc 绿。
