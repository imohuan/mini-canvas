# 插件系统目标 · 严格终审报告（goal-mode P7 强制闸门）

> 审核人：code-developer 子代理（终审）
> 目标基准：`docs/goal/plugin-system-goal.md`（工作区当前内容）
> dsh 对齐基线：`docs/tmp/dsh-plugin-survey/survey.md`（deepseek-harness/docs 本机不存在，按该 survey 判定）
> 审核日期：2026-09-05
> 工作区：`D:/Code/Git/mini-canvas`，分支 `feat/cordis-plugin-system`

---

## 结论：**FAIL（条件性 / 未达成本文件的验收终态）**

**核心事实（全部实测，非纸面）**：
- 内核 vitest **146 passed / 16 files** 全绿；渲染 vitest **31 passed / 4 files** 全绿。
- `pnpm -r typecheck` 10 个 workspace 包全绿；`vue-tsc --noEmit -p tsconfig.vue.json`（render 包 .vue）EXIT=0。
- demo vite build 成功（90 modules，EXIT=0，产物已清理）。

真正缺的**不是基础机制**——目标 A / B2 内核 / D 的机制代码真实落地且有测试佐证，作者原意（基础能力 + 开发简单 + 不重复造轮子 + 不破坏内核/存量）大体守住。
FAIL 点集中在**"目标文档自相矛盾 + 未交付其自身明文要求的成品"**上：

1. **目标 B 的"教程章节流"与实际教程对不上**（最重要的 FAIL）。
2. 工作树有**未提交**的目标文档大改 + `pluginManager.ts` 改动；目标文档第八节所有勾选框仍是 `- [ ]`（未标完成态）——说明主 agent 尚未收尾。
3. B2"高频合帧(rAF)"是**注释级承诺**，代码里没有实现。
4. nodeRegistry 的**段级多 occupant 贡献只到单测，没接进可见渲染**（BaseNode 只渲染单值 content）。

详见"问题清单 + 修改清单"。

---

## 一、验收清单逐条核对表

> 判定标准：① 有真实文件/命令/测试佐证；② 教程/文档与实现一致能落地。证据列到文件 + 命令输出。

### 目标 A —— 开放插槽 + 渲染
| 验收项 | 证据（文件 + 命令/测试） | 达成? |
|---|---|---|
| nodeRegistry/themeRegistry 多 occupant + order + id 增量/替换/remove | `themeRegistry.ts`(基于 SlotRegistry)、`nodeRegistry.ts`(registerContribution)、`slotRegistry.ts`(add/remove/list/clearByPrefix)；测试 themeRegistry.test.ts 45/58/71 行、slotRegistry.test.ts、nodeRenderer.test.ts | ✅ |
| 插件可声明新槽（槽名不限枚举） | themeRegistry `(string & {})`、themeRegistry.test.ts L80"插件可声明新槽" | ✅ |
| 单测绿 | 内核 146 + 渲染 31 全绿（见上） | ✅ |
| 两插件同槽按序同屏渲染 | 通用 UI 槽 `overlay`：`overlayPlugins.ts` 两插件 order 0/1；CanvasHost.vue 读 `slots.list('overlay')` 按 order 渲染（L184-195/L420-428）；capabilities.test.ts L115"同槽两插件共存" | ✅（走 generic slot） |
| 默认主题走新槽可一键顶替/热卸回退 | themeRegistry.test.ts L58"顶替后热卸回退"、L112"卸载自动注销回退默认"；capabilities.test.ts L92"卸载自动回收" | ✅ |
| nodeRegistry 段级"多 occupant 同段叠加"真进可见渲染 | **❌ 只在单测**：`registerContribution`/`nodeSegmentStack` 除 nodeRenderer.test.ts 外无任何调用者；BaseNode.vue 只 `resolveSegment`（单值），不渲染段级贡献栈 | ⚠️ 部分（机制在、UI 未接） |

### 目标 B —— ctx 能力段收口 + 教程 + canvas-base
| 验收项 | 证据 | 达成? |
|---|---|---|
| 散装注册收口挂 ctx（nodes/theme/commands/slots），注册自动回收 | `capabilities.ts` buildCapabilities；capabilities.test.ts（register 后卸载自动回收、同槽共存）；scope.onDispose 回收 | ✅ |
| 教程教 Cordis 写法（.ts 裸导出 name/inject/apply） | docs/plugin-dev 01/02/03/04 正文均 `export name/inject/apply(ctx)` + `export xxxPlugin`；theme-default/node-text/image/commands 四插件真按此迁移 | ✅ |
| `@mini-canvas/canvas-base`（薄层：Context + define*）存在可落地 | `packages/canvas-base/`：index.ts 重导出 Context/PluginModule，define.ts 有 defineNode/defineThemeSlot/defineCommand/defineSlot；typecheck 绿；plugin 侧真从 canvas-base import | ✅（缺 defineService，教程未用，次要） |
| **教程按 2.1 的 cordis-tutorial 章节流（≥ 前 5 章：第一个插件 / 生命周期与 effect / 服务 / 事件 / 配置）在 docs/ 照抄能跑通** | docs/plugin-dev/ 只有 `index, 01-first-plugin, 02-add-a-node, 03-add-settings, 04-install-distribute`（4 篇，**旧 4 段式**）；**无** 生命周期与 effect / 服务 / 事件 独立章；无 06/07 | ❌ **不符** |

### 目标 B2 —— 分组化配置
| 验收项 | 证据 | 达成? |
|---|---|---|
| 内核 settings（分组 define/取值/onChange 订阅 + 高频合帧 + 单一数据源）在 | `settingsStore.ts`、capabilities.settings；b2SettingsHost.test / settingsStore.test | ✅（除合帧，见下） |
| 主题插件声明 ≥2 组含 color/number schema | theme-default `index.ts`：组"连线"(edgeColor color + edgeLineWidth number)、组"连线动效与箭头"；b2SettingsHost.test | ✅ |
| 设置面板按 schema 自动长控件 | `PluginSettingsPanel.vue`：color/number(range)/boolean/select/text 分支；demo 右下浮层接 ctx.settings | ✅ |
| 改一项那一处实时重绘、无全图重建、其它元素不受影响 | b2SettingsHost.test（改 edgeColor 只刷 edge、nodeShell occupant 原样）；demo `bindThemeSettings` 只窄更新 cfg.edge 对应字段；cfg.edge 是 Vue 响应式小对象 → 不整图重建 | ✅ |
| 高频拖动颜色/滑块流畅（**合帧生效 rAF**） | **❌ 无实现**：settingsStore.ts 只注释"宿主可选 rAF 节流"；全仓无 requestAnimationFrame/throttle 落在 settings 路径 | ❌ |
| 另一插件改配置不触发本插件 | b2SettingsHost.test L129、settingsStore.test L97、capabilities.test L129（scope 过滤） | ✅ |

### 目标 D —— 安装句柄 + manifest
| 验收项 | 证据 | 达成? |
|---|---|---|
| manager.install 装源码 import / 单文件 js / URL | `pluginManager.ts` install/resolveSource/loadPluginFromText/loadPluginFromUrl；pluginManager.test.ts（源码/文本/懒解析 source） | ✅ |
| manager.uninstall 卸后其 UI/服务/槽位消失 | pluginManager.test.ts（服务/type 回收）；capabilities/themeRegistry 卸载回收测试；CanvasHost 订阅 ctx:plugin-installed/uninstalled 重渲染 | ✅ |
| manager.reload(name,新实现) 换版本 | pluginManager.test.ts reload | ✅ |
| manager.list() 显示已装状态 | pluginManager.list() 实现 + test | ✅（只含 name/config，无 fiber 状态——见注） |
| manifest 按序装 + 传/覆盖 config，另一画布复用即用 | pluginManager.applyManifest + test；demo-web/baseManifest.ts 现成可复用清单；theme-default 真按 config key 覆写 settings | ✅ |
| demo 整链 装→卸→换版本 | CanvasDemo manager dock(卸/重载 theme-default)+ window.MiniCanvasManager；fullchain.test（命令/撤销/热重载） | ✅（未见浏览器 console，见注） |

### 目标 C —— 可诊断句柄 + PENDING（可选）
| 验收项 | 证据 | 达成? |
|---|---|---|
| per-plugin 可查句柄(fiber) + PENDING 依赖编排单测 | **❌ 全仓无 PENDING/fiber 实现**：Context 用 topoSort 一次性启动，`ctx.get` 缺服务即抛（不等待）；无 per-plugin state/deps/config 句柄对象 | ⚠️ 文档里标"可选，做了打勾"——未做，本不应算 FAIL；但**目标 D/2.3 描述却把 PENDING/fiber 写进 D 的验收措辞**（"依赖它的随之 PENDING/卸载"、"list() 显示…fiber"）→ 文档与实现矛盾 |

### 验证示例 —— 自定义端口/吸附/快速连接（示例级）
- connection.ts + 全套 connection.test.ts（15 测试）存在；连接校验 `validateConnection` 接进 CanvasHost.isValidConnection。
- 但没有一个"自定义节点声明 2 输入 1 输出 + 限定只接 type + limit single"的**demo 示例插件**落地；教程 02 L85 自己写"等主题设置与安装系统就绪后一并补齐"——**没补**。⚠️（示例级，可算未交付示例）

### 全量
| 验收项 | 证据 | 达成? |
|---|---|---|
| 内核+渲染+全部插件 tsc / vue-tsc / vitest 全绿 | pnpm -r typecheck 10 包绿、vue-tsc(render) EXIT=0、146+31 测试绿 | ✅ |
| plugin 包的 .vue 也过 vue-tsc | plugin tsconfig include 只 `src`（不含 .vue）、typecheck=纯 tsc → **插件 .vue 未被 vue-tsc 覆盖**；仅 demo build 间接编译 | ⚠️ 覆盖缺口 |
| demo 浏览器端到端零 console 报错 | 无法起浏览器实测；demo vite build 成功 + fullchain.test（host 级真实 boot + 插件 + 命令）为间接证据 | ⚠️ 未浏览器实证 |

---

## 二、作者原意核对（守则逐条）

| 守则 | 判定 |
|---|---|
| 只要插件系统基础功能、能力大半已在内核 | ✅ 目标 A/B/D 大多复用 nodeStore/registry/inject/installPlugin 底座，只做收口/补开放，未重复造引擎 |
| 开发要简单（.ts 裸导出 name/inject/apply + ctx 能力段 + 自动回收） | ✅ 教程与四存量插件均是此形态，作者不手写 unregister |
| 插件可自定义任何内容（节点/主题/UI/服务/命令/配置） | ✅ ctx.nodes/theme/slots/commands/settings + inject 齐全 |
| 宿主不预设业务落点当承诺 | ✅ 主题槽/overlay 是通用机制；toolbar/dock 在 demo 侧只是示例。 |
| 没有为了丰富而过度设计 / 没把业务能力当验收主体 | ⚠️ **有局部偏离**：见下。 |

**偏离点（过度/文档自相矛盾）**：
- 目标文档（工作树、未提交）把教程从"作者原意那套够用的中文入门"膨胀成 **cordis-tutorial 7 章/≥5 章克隆**（生命周期与 effect / 服务 / 事件 / 组合 HMR / into-harness），并要求每章独立可运行示例。这与作者"要的只是插件系统基础功能、不是把系统做成 dsh"的原话相抵——按 survey H2"别把全套照抄"。**实现侧的 4 篇旧式教程反而更贴作者原意**。文档与交付互相打架。
- 目标 D 验收措辞塞进 `PENDING/fiber/随之卸载`，而目标 C 自标"可选"且实现没做——**同一份目标文档前后要求不一致**。

---

## 三、破坏性检查

| 项目 | 判定 |
|---|---|
| 纯逻辑内核零 Vue | ✅ canvas-core-v2 无 .vue；registry/settings/ctx 纯 TS，Node 单测全跑通 |
| 不推翻 canvas-render 迁移/依赖方向 | ✅ 依赖仍 canvas-core-v2 ← render ← 插件；render 独立包、依赖方向无环 |
| 弄坏存量插件(theme-default/node-text/image/commands) | ✅ 四插件均在、已 Cordis 化、类型/测试绿、demo 装配用到 |
| 已绿测试语义 | ✅ 全量 177 测试通过，无回归 |

---

## 四、本轮实际验收动作记录（不只读代码，跑了真命令）

1. `git branch --show-current` → `feat/cordis-plugin-system`；`git log --oneline -30` 见 40 个相关 commit（slotRegistry→capabilities→canvas-base→settings→manager→manifest→overlay→教程 1/2/3/4→demo 接线）。
2. `git status`：**工作树未提交改动** = `M docs/goal/plugin-system-goal.md`（把教程重定向为 cordis-tutorial 7 章）+ `M packages/canvas-render/src/host/pluginManager.ts`（data: URL 改 percent-encoding）。`M` 说明主 agent 尚未 commit 收尾。
3. `cd canvas-core-v2 && pnpm vitest run` → **146 passed (16 files)**。
4. `cd canvas-render && pnpm vitest run` → **31 passed (4 files)**。
5. `pnpm -r typecheck` → 10 workspace 包 Done 无错。
6. `vue-tsc --noEmit -p tsconfig.vue.json`（render）→ EXIT=0。
7. demo `vite build --outDir .reviewcheck-dist` → 成功（90 modules, EXIT=0）；产物已用 node fs 清理（`rm` 被策略拦截，改用 `node -e fs.rmSync`）。
8. 通读：Context/capabilities/settingsStore/slotRegistry/themeRegistry/nodeRegistry/nodeRenderer/registerNodeType/types/pluginManager/createMiniCanvasHost/CanvasHost.vue/canvasHostCore + PluginSettingsPanel + 教程 01-04 + baseManifest + overlayPlugins + 四存量插件 index。
9. 搜证 PENDING/fiber（无）、rAF（仅注释）、registerContribution 真实调用者（无）。

**观察**：机制层质量高、测试扎实（B2 窄更新/作用域订阅、卸载回收、manifest 覆盖都有验收级单测，非摆设）；demo 装配完整（主题配置面板 + overlay 两插件 + manager dock + baseManifest）。主 agent 显然把"内核/宿主机制 + 测试"做透了，但**收尾文档/教程与目标文档没对齐、没提交、没勾选**。

---

## 五、问题清单 + 给主 agent 的修改清单（精确到文件）

### 问题 1（最要紧）· 目标 B 教程章节流 = 文档 vs 交付自相矛盾
- 现状：`docs/goal/plugin-system-goal.md`（工作树）2.1/八-B 要求 cordis-tutorial 7 章/≥5 章（含生命周期与 effect、服务、事件、配置、组合 HMR、into-harness），每章可运行示例；实际 `docs/plugin-dev/` 只有 4 篇旧式（first-plugin/add-a-node/add-settings/install-distribute）。
- 两难：按作者原意（"要基础功能、别做成 dsh、别照抄 cordis-tutorial 框架"），现 4 篇其实够用且更贴意；目标文档这段是被主 agent 后期重定向、**未同步教程也未提交**。
- 请主 agent 二选一并收尾：
  - **方案 A（推荐，贴作者原意）**：改 `docs/goal/plugin-system-goal.md` 2.1 与第八节 目标B 措辞，把"cordis-tutorial 章节流 ≥5 章"改回"4~5 篇照抄可跑的中文教程（第一个插件 / 加节点 / 可配置(settings) / 打包安装）"，与 `docs/plugin-dev/` 现状一致并 commit；不必为像 cordis 硬凑 02/03/04 生命周期·服务·事件章。
  - **方案 B（若坚持 cordis 流）**：在 `docs/plugin-dev/` 补 2 篇（02 生命周期与 effect、03 服务与事件…）并按 2.1 重命名/重排章节，让每章能照抄跑通；工作量大、且可能滑向"为像 dsh 过度设计"。
- **无论哪个，先 `git commit` 收尾目标文档与教程改动**；把第八节勾选框打勾并补"完成态"标记。

### 问题 2 · B2 高频合帧（rAF）未实现
- 文件：`packages/canvas-core-v2/src/core/settingsStore.ts`（仅注释"宿主可选 rAF"）、`packages/canvas-render/demo-web/CanvasDemo.vue` bindThemeSettings（逐事件写 cfg.edge）。
- 改法（任选）：
  - 二选一：在 SettingsStore 加可选 `setCoalesced(key,value)`（rAF 合并一帧一次 notify，Node 测试用可注入 scheduler）；或
  - 在 `PluginSettingsPanel.vue` / demo 的 set 调用处做 rAF 节流并加一条"拖动不每帧全算"的说明；
  - 然后同步删掉目标文档 B2 验收③里"合帧生效"或补一句"由宿主/消费方按需合帧"。**核心体验（窄更新无整图重建）已成立**，此项更多是验收措辞与实现对齐问题。

### 问题 3 · nodeRegistry 段级多 occupant 没接进可见渲染
- 文件：`packages/plugins/plugin-theme-default/src/BaseNode.vue`（只 `resolveSegment` 单值）。
- 改法：若要让"同段多 occupant 同屏"在 UI 可见，BaseNode 对可叠加段（如装饰层）改用 `nodeSegmentStack`/`activeSegments` 渲染基座+全部贡献，并补一个 demo 贡献示例；否则目标 A 验收行里那段"两插件同段叠加渲染"应改为以 overlay 槽为准，避免文档承诺没落地。

### 问题 4 · 插件包 .vue 不在 vue-tsc 覆盖里
- 文件：各插件 `tsconfig.json` `include:["src"]`（不含 .vue）。
- 改法：给 plugin-node-text/image/theme-default 加一个 `tsconfig.vue.json` + `typecheck:vue`（vue-tsc --noEmit）脚本，并让全量回归脚本/文档步骤调用它；或在评审口径上明确"插件 .vue 仅经 demo build 间接校验"。

### 问题 5 · 目标 D 措辞混入 PENDING/fiber，而实现/目标 C 均无
- 文件：`docs/goal/plugin-system-goal.md` 第八节 目标D 验收措辞（"依赖它的随之 PENDING/卸载"、"list() 显示…fiber"）。
- 改法：目标 C 既标"可选"且没做，就把目标 D 验收行里 PENDING/fiber 措辞改成与实现一致（manager 只做装/卸/reload/按序 manifest，卸载即回收依赖方在跑时的副作用，不承诺自动重排依赖重载），并把 `manager.list()` 描述改回"name + config"。若要真做 PENDING/fiber（较重的依赖重载编排，survey 已列为"不该全套照抄"），请单独评估再动内核。

### 问题 6 · 验证示例（自定义端口/吸附示例节点）未落地
- 教程 02 L85 自承"等…一并补齐"但没补。
- 改法：可在 `packages/plugins/` 或 demo-web 加一个自定义端口节点示例（用 connection.ts 的 accepts/limit single），或把该教程/目标措辞改为明确"示例级，本期不交付"，避免教程承诺悬空。

---

## 一句话给主 agent

机制与测试全绿、作者原意大体守住；**离达标只差"文档/教程与实现对齐并提交收尾"**——先定教程口径（贴作者原意的 4 篇 or 补 cordis 章），把 rAF 合帧与段级贡献渲染两处"只到注释/单测"的承诺补齐或改文档措辞，再 commit 目标文档并勾选完成态。
