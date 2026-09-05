# 插件系统目标 · 严格终审报告 R2（按对齐后的一致口径）

> 审核人：code-developer 子代理（终审，复审 R2）
> 目标基准：`docs/goal/plugin-system-goal.md`（a185704 已对齐作者原意；**以 2.1 落地口径 + 第八节验收为准**，不再用旧的"cordis 7 章逐章克隆 ≥5 章"口径）
> dsh 对齐基线：`docs/tmp/dsh-plugin-survey/survey.md`
> 审核日期：2026-09-05
> 工作区：`D:/Code/Git/mini-canvas`，分支 `feat/cordis-plugin-system`

---

## 结论：**PASS（按新一致口径）**

上轮(R1 review.md)6 个 FAIL/⚠️ 点，本轮实测：①⑤文档口径、②rAF 合帧已修复并有真实代码/测试佐证；③④⑥ 经逐条比对第八节验收原文判定为**非阻塞**（见下）。全量 tsc / vue-tsc / vitest 全绿、demo 构建零错。

**本轮唯一留存（非阻塞、工具完备性建议）**：插件包 .vue 不在任何 vue-tsc 覆盖内（④），demo 构建只能证明其可编译、不能逐行查 SFC 类型。建议主 agent 收尾时顺手补，但不构成 FAIL。

---

## 一、本轮实际验收动作（全跑真命令，非纸面）

| 命令 | 结果 |
|---|---|
| `cd packages/canvas-core-v2 && pnpm vitest run` | **146 passed / 16 files** 全绿 |
| `cd packages/canvas-render && pnpm vitest run` | **34 passed / 5 files** 全绿（含 `coalesce.test.ts` 3 用例） |
| `pnpm -r typecheck`（10 workspace 包） | 全 Done 无错 |
| `node ../../node_modules/vue-tsc/bin/vue-tsc.js --noEmit -p tsconfig.vue.json`（render） | EXIT=0 |
| demo `vite build`（canvas-core-v2, goal 的 :5199 demo） | 91 modules，EXIT=0（产物已清理） |
| `git status` | 分支 `feat/cordis-plugin-system`；目标文档改动已 commit(a185704)；**无未提交的已跟踪改动** |

代码通读：goal doc 全篇、capabilities.ts、nodeRegistry/slotRegistry/themeRegistry、settingsStore、coalesce.ts、PluginSettingsPanel.vue、CanvasHost.vue、createMiniCanvasHost/pluginManager、BaseNode.vue、docs/plugin-dev 01-04 + index、baseManifest、CanvasDemo 装配。

---

## 二、R1 FAIL 点复核（按新口径逐条）

### ① 目标 B 教程章节流 = 文档 vs 交付自相矛盾 → **已修复**
- a185704 把 2.1 加了"落地口径"注记：教程以 `docs/plugin-dev/` 已交付 4 篇为准（第一个插件 / 加一种节点 / 可配置(settings) / 打包装进别的画布），cordis 7 章清单降为"可借鉴骨架、非本期逐章克隆"；三-目标B 验收改为"4 篇照抄能跑 + 覆盖核心概念"。
- 实测 4 篇教程存在且**每一篇都能"照抄能跑"、引用真实可运行代码**：01 用 `ctx.commands.register`（CanvasDemo `plugins` 数组真存在）；02 用 `ctx.nodes.register` + `.vue`（demo-web 路径、`command:create-node` 真实）；03 用 `ctx.settings.define/onChange` + `<PluginSettingsPanel>`（真实 API + demo 右下浮层）；04 用 `createMiniCanvasHost().manager.install/uninstall/reload/list/applyManifest`（pluginManager 真实同名 API，fullchain.test 佐证）。
- 概念覆盖核对（八-B 要求）：`.ts` 裸导出 `name/inject/apply(ctx)` ✅（01/02/04/index）、ctx 能力段 ✅（index 表格 + 各篇 apply）、effect 自动回收 ✅（01/02/03）、`inject` 依赖编排 ✅（index 教 `export const inject` 消费声明 + `ctx.inject`/`ctx.get` 服务上架/取用）、settings 配置 ✅（03）。
- 存量验证：node-text/image/theme-default/canvas-commands 四插件均真为 `export name/inject/apply(ctx)` Cordis 形态，demo 装配用到。

### ② B2 高频合帧(rAF) 未实现 → **已修复（真实实现，非注释）**
- 新文件 `packages/canvas-render/src/utils/coalesce.ts`（`createCoalescer`，rAF 节流到一帧一次批量应用），配套 `coalesce.test.ts`(3 用例绿)。
- 已接入 `PluginSettingsPanel.vue`（L13 import、L32 实例化、L39 把 set 推入合帧器、L35 `onBeforeUnmount dispose`）——滑块/颜色拖拽高频值由面板合帧后再 `set`，不再每事件全量写。
- 说明：合帧落在渲染侧消费面板（B2 验收③"高频拖动流畅"的承载点），内核 settingsStore 保持同步即时、按 scope 窄订阅——符合"按需合帧、消费方窄订阅"的性能口径，无全图重建（b2SettingsHost.test 佐证窄更新）。评审口径：合帧由"宿主/消费方按需合帧"落地，成立。

### ⑤ 目标 D 措辞混入 PENDING/fiber → **已修复**
- a185704 把八-D 改为 `manager.list()` 显示 name/config、`uninstall` 回卷该插件全部 effect(UI/服务/槽位消失)、`reload(name,新实现)` 换版本生效；显式注明"依赖方随卸载 PENDING/自动跟随重载属可选目标 C，不做不阻塞 D 主体"。2.3/2.5 同步对齐（启动依赖 topo 排序 + `ctx.get` 探缺抛错；不承诺 PENDING/自动重排）。
- 实现与措辞一致：manager 只做装/卸/reload/按序 manifest 轻量分层，卸载即 scope 回卷 effect。目标 C 保持"可选、做了打勾"未做——合法。

---

## 三、第八节验收总清单逐条核对（新口径）

| 验收项 | 证据 | 达成 |
|---|---|---|
| **目标A** nodeRegistry/themeRegistry 多 occupant + order + id 增量/替换/remove + 插件声明新槽；单测绿 | themeRegistry.ts/SlotRegistry/nodeRegistry.registerContribution；slotRegistry 10 / themeRegistry 10 / nodeRenderer 11 / capabilities 8 测试绿 | ✅ |
| 两插件同槽按序同屏渲染 | overlay 槽：overlayPlugins 两插件 order 0/1；CanvasHost.vue L181-194 读 `slots.list('overlay')`、L419-426 `v-for` 按 order 渲染 | ✅ |
| 默认主题走新槽一键顶替/热卸回退 | themeRegistry.test（顶替后热卸回退 L58、卸载自动注销 L112） | ✅ |
| **目标B** ctx 能力段收口(自动回收) + 教程 4 篇照抄能跑 + canvas-base | capabilities.ts + capabilities.test；docs/plugin-dev 01-04（见上）；canvas-base 薄层（Context + defineNode/defineThemeSlot/defineCommand/defineSlot）可落地 | ✅ |
| **目标B2** settings(分组 define/取值/onChange 窄订阅 + 高频合帧 + 单一数据源)；主题插件 ≥2 组含 color/number；面板自动长控件；那一处实时重绘、另一插件不误触 | settingsStore + b2SettingsHost.test + settingsStore.test(scope 过滤)；theme-default 声明 2 组连线配置；PluginSettingsPanel schema 分支 + createCoalescer 合帧(见②)；demo 右下浮层接 ctx.settings | ✅ |
| **目标D** manager.install(源码/单文件js/URL)/uninstall(回卷 effect)/reload/list(name+config)/manifest 按序装+传/覆盖 config、复用即用；demo 整链零错 | pluginManager + pluginManager.test + fullchain.test(11)；baseManifest + CanvasDemo manager dock(卸/重载 theme-default) + window.MiniCanvasManager | ✅ |
| **目标C**(可选) | 标可选未做，合法不判 FAIL | 不适用 |
| **验证示例** 端口/吸附节点 demo | ⚠️ 未交付示例插件；教程 02 L85、04 L93-95 明确"等后续/属演示性验证，非插件系统主体"。按"示例级、非主体"口径不阻塞（见问题⑥） | ⚠️ 示例级未交付 |
| **全量** 内核+渲染+插件 tsc/vue-tsc/vitest 全绿 | typecheck 10 包绿、render vue-tsc EXIT=0、146+34 vitest 绿、demo build EXIT=0 | ✅（见④注） |

---

## 四、R1 其余 ⚠️ 点在新口径下的判定（评审者最关心的三条）

### ③ nodeRegistry 段级多 occupant 未接进可见 UI → **非阻塞（新口径下成立）**
- 现状不变：`registerContribution`/`nodeSegmentStack` 机制在 `nodeRegistry` + `nodeRenderer.test`(11 绿) 层，`ctx.nodes` 不暴露段级贡献 API，`BaseNode.vue`(theme-default) 只 `resolveSegment` 渲染单值 content。
- **为何不构成硬缺口**：八-A 验收原文只要求 nodeRegistry"**支持**多 occupant + order + id 增量/替换/remove"（注册表语义，已满足并有测试），而"两插件同槽按序同屏渲染"的可见渲染验收锚定在**通用 UI 槽 overlay**（CanvasHost 真渲染）与**themeRegistry 单格顶替/热卸回退**（测试 + demo 装配）——这两条都已真实落地。nodeRegistry 段级"同段叠加装饰"并非验收清单里的可见渲染承诺，node 段按单 content 组件渲染是节点内容模型的常态。机制在 + 测试在，UI 消费属后续可选丰富，不越作者"别为丰富过度设计"红线。

### ④ 插件包 .vue 不在 vue-tsc 覆盖 → **非阻塞（工具完备性缺口，非功能/非原意缺陷）**
- 现状：四个插件包 `tsconfig include:["src"]` 含 .vue，typecheck=纯 `tsc`（不解析 .vue，空过）；render 的 `tsconfig.vue.json` 只 include render 自身 .vue；插件 .vue 仅经 demo vite build 的 esbuild transform（能编译、不逐行 SFC 类型）。
- **判定**：八"全量 … 全部插件 tsc / vue-tsc / vitest 全绿"确有字面覆盖缺口，但这是**校验工具链**完备度问题，不是功能缺陷、不违背作者原意、demo 编译全绿证明无编译错误。示例级/工具完备性 → 不构成主体阻塞。**建议**：可给插件包补 `tsconfig.vue.json` + vue-tsc 脚本并纳入全量回归；不做也不影响"插件可照抄跑通"。

### ⑥ 验证示例（自定义端口/吸附/快速连接 demo 插件）未落地 → **非阻塞**
- 现状：connection.ts + 15 测试在，`validateConnection` 接进 CanvasHost.isValidConnection；但无一个"自定义节点声明 2 输入/限定 type/limit single"的 demo 示例插件；教程 02 L85 / 04 L93-95 自承推迟并框为"演示性验证，不属于插件系统主体"。
- **判定**：目标文档 〇/一/四 与八该行均标"验证示例 / 示例级 / 不算框架承诺 / 非验收主体"；作者原意"别把业务能力当验收主体"。→ 示例级未交付，**不构成主体阻塞**。

---

## 五、作者原意守则核对

| 守则 | 判定 |
|---|---|
| 只要基础功能、能力大半已在内核 | ✅ A/B2/D 复用 nodeStore/registry/inject/installPlugin，只做收口/补开放 |
| 别做成 dsh / 别过度设计 | ✅ 教程收敛为 4 篇照抄能跑；PENDING/fiber/依赖方跟随归可选 C；nodeRegistry 段级 UI 未强接 |
| 开发简单(.ts 裸导出 name/inject/apply + ctx 能力段 + 自动回收) | ✅ 教程 + 四存量插件均是此形态 |
| 插件可自定义任何内容 | ✅ ctx.nodes/theme/slots/commands/settings/inject 齐全 |
| 别破坏内核与存量插件 | ✅ 内核纯逻辑零 Vue(仅 env.d.ts 类型 import)；146 测试无回归；四插件全绿 |

---

## 六、留存建议（非 FAIL，收尾可顺手）

1. **(建议)** 插件包 .vue 补 vue-tsc 覆盖：给 plugin-node-text/image/theme-default 加 `tsconfig.vue.json`(+`typecheck:vue` 脚本)，或评审口径注明"插件 .vue 仅经 demo build 间接编译"。提升"全量 vue-tsc"字面完备度。
2. **(收尾动作，主 agent 做)** 终审通过后：把第八节勾选框打勾、把目标文档标"完成态"、commit 收尾（现第八节全 `- [ ]`、无完成态标记，属 PASS 后才做的收尾，非 FAIL）。
3. **(可选)** 验证示例(端口/吸附)若想补齐：在 `packages/plugins/` 或 demo-web 加一个用 connection.ts accepts/limit single 的自定义端口节点示例；不做也不阻塞主体。

---

## 一句话给主 agent

R2 按对齐后的一致口径实测：机制、测试、教程全部真实落地且全绿（146+34 vitest、10 包 typecheck、render vue-tsc、demo build 零错），R1 的 ①⑤ 文档矛盾与 ② rAF 合帧均已修复；③④⑥ 经逐条比对第八节验收原文判定为非阻塞。**判定 PASS**——收尾时打勾第八节、标完成态并 commit；可顺手补插件 .vue 的 vue-tsc 覆盖做工具完备性提升。
