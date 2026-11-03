# 交接文档：吸附带可视化 / 设置面板 / 拖线反馈（connection-drag-capability）

> 写给接手 agent。仓库 `D:/Code/Git/mini-canvas`，分支 `feat/cordis-plugin-system`（**不建分支、原地提交**）。
> 这是一份"现状 + 遗留问题"交接，不是完整重做。请先读本文件，再按"遗留问题清单"逐条继续。

---

## 0. 用户此刻最在意的事（三条抱怨，必须都解决才算完）

原任务名：让**吸附带配置**能通过**设置面板**调节 + 拖拽时真正暴露富 dragState 参数 + image/text 插件声明内容类型。
用户对照截图逐条追问，中间说过"你就是敷衍我"，说明他对照图要求"真的落地、可操作、视觉对得上"，不接受只做一半。

三个抱怨点（用图释推断，模型不支持看图）：
1. **设置面板里吸附带配置"一个都没有"** → 现已做（见 §2）。
2. **拖拽时"提供的参数传递"没真做** → hover 富化已做（见 §3），但需核对用户期望的"能拖出线、线真的吸上去"。
3. **image/text 插件节点代码是否真改了声明** → 已做（见 §4）。
4. 附加：**吸附带/端口可视位置与图不对齐** —— 用户截图里认为"红色圆弧/端口区域跑到了节点内部，它本该在节点两侧"，并指出"跑到内部是通过偏移处理的"。→ 这是本轮最需要认真核对的一条（见 §5）。

---

## 1. 已完成并提交（按提交顺序）

| commit | 内容 |
|---|---|
| `d9ddaf8` | 吸附带几何改 `SnapZoneConfig(heightRatio/width/offset/shape)` + 双侧/侧标记 |
| `0d05000` | core PortDef/节点类型扩展内容类型(contentType/acceptsTypes/capacity)+validateConnection 内容类型校验 |
| `22aab87` | PluginScope.nodes.register 类型补内容类型字段；text/image 插件声明内容类型 |
| `4fef6f1` | canvas-render 输入口容量满额挤出最老边(commitEdge 原子挤+加) |
| `3897953` | hover 富化为 dragState(nodeType/portSide/nodeData/nodeEl/willEvict) |
| `849f61e` | theme-default：输入口满额"将替换"willEvict 蓝标签 + 已有失败模糊气泡复用 hover 富化 |
| `cf2f1aa` | **设置面板新增"吸附带"配置组**（高度占比/宽度/偏移/形状 rect\|arc）+ 灌入 CanvasHost 吸附判定 |
| `c07a162` | theme-default：吸附调试叠加改**双侧吸附带渲染**(target/source 分色, shape rect\|arc → 矩形/半椭圆) |
| `1af1556` | fix: useNodeDebugOverlay 吸附带参数改 reactive 对象直读（修 `.value` 崩溃，与 renderContext 契约一致） |

相关规划文档（都在，别删）：
- `docs/plan/connection-drag-capability-plan.md`、`docs/plan/snap-zone-redesign-plan.md`
- `docs/plan/v2-theme-debug-and-diagnostics-plan.md`
- 根目录 `current-canvas.png`、`目标.png`（用户截图参考，图片当前模型看不了，交给能看图的多模态 agent 核对）

---

## 2. 设置面板"吸附带"配置组 —— 已完成，浏览器已确认

### 改动文件
- `packages/plugins/plugin-theme-default/src/index.ts`：
  - 新增 `DEFAULT_THEME_SNAP_ZONE`（**字段名 = canvas-render 的 `SnapZoneConfig`**：`heightRatio/width/offset/shape`，不能叫 snapHeightRatio 之类，否则 App 传 `:snap-zone-visual` 会 TS2741 报缺字段）。
  - 新增 `SNAP_ZONE_SETTING_KEYS`。
  - Config schema 加 4 字段（group 名 **"吸附带"**）。
- `packages/canvas-render/.../renderContext.ts`：`snapZone: SnapZoneConfig` 进上下文。
- `CanvasHost.vue`：`snapZoneVisual` prop、`snapZoneToProvide`(默认 reactive)、`:snap-zone` 传给 CanvasSurface。
- `CanvasSurface.vue`：provide `snapZone: props.snapZone`。
- `App.vue`(packages/ui)：cfg 加 snapZone、bindThemeSettings 分发到 `SNAP_ZONE_SETTING_KEYS`、`:snap-zone-visual="cfg.snapZone"`。

### 浏览器验证结果（page 30, http://localhost:5289）
- 设置面板 nav 含 **"吸附带"** 页签；点开有：吸附带高度占比(slider 0.2~1)、宽度(0~400, 0=用 handleRadius)、偏移(-200~200, <0 向内)、形状(矩形/半椭圆弧下拉)。
- 图形选择 value 默认"矩形"。

---

## 3. 拖拽富 dragState 参数 —— 已做，但需最终核验

- `HoverFeedback`(连接反馈) 已含：status/zone/reason/portSide + 富字段 `nodeType/portSide/nodeData/nodeEl/willEvict`。
- enrichHover 负责填充这些富字段。
- BaseNode 已消费：`connectionHover.status/reason/willEvict` 做 3D 倾斜 / 非法气泡 / 满额"将替换"蓝标签。
- BaseNode 里 `connectionHover` 目前主要靠 `reason` 气泡体现 canConnect（status 决定 valid/invalid）。
- **未做/待核对**：用户是否要 BaseNode 用这些富字段做更多自定义特效（如把 nodeType/nodeEl 用于专属样式）。需跟用户确认再动，别擅自扩大。

---

## 4. image/text 插件声明内容类型 —— 已完成

- `22aab87`：text 插件 **产 text 收 text**；image 插件 **收 text+image 产 image**（contentType/acceptsTypes 落地到 nodeStore 运行时节点上）。
- 建议 browser 里再扫一眼节点实例数据确认（前面轮次已确认 text/image 节点带 acceptsTypes/contentType）。

---

## 5. ★ 核心遗留问题（接手重点，用户图2 直接相关）

### 5.0 【待核对】设置面板"吸附调试"勾了却没在画布看到双侧带
- BaseNode `showSnapDebugOverlay` = `debug.connectionSnapDebugVisible && showTargetHandle && !lowDetail`（**开关打开就常显双侧带，不要求拖线/悬停**，见代码注释 L202-209）。
- 但浏览器里：设置面板"调试"页勾了"吸附调试"(checkbox checked)，**画布上没看到双侧吸附带**。
- 疑点：设置面板读写的 settings store 值，与 BaseNode 消费的 canvas-render `debug.connectionSnapDebugVisible`（经 App cfg.debug → :debug-visual 注入）**可能未联动**，或 `showTargetHandle`/lowDetail 条件没满足。**接手第一件事：把这条查通**，否则用户抱怨 1/2 的"可视化落地"不成立。

### 5.1 吸附带命中"方向只取一侧"，双侧可视化与拖拽判定不一致
- `geometry.ts` 的 `computeSnapZones` 拖拽判定**只按拖拽方向取一侧**：forward(从 source 拖)→ target 左缘带；reverse(从 target 拖)→ source 右缘带。
- `computeSnapZoneSides` / `useNodeDebugOverlay` / BaseNode 叠加画**双侧带**（调试常显 target+source 两侧）。
- 图2 用户画的是"节点**左右两侧各一条**吸附带"都参与吸附 —— 现判定一次只有方向侧那条，另一侧不吸附。
- **要确认预期**：拖线是单向（source→target 时只吸左边 target 口）本身就合理；用户是不是想看两侧都"能接"的示意？还是他期望"一条线上左右都亮"？若单向正确，叠加应只在"当次拖拽方向对应侧"画带，避免误导（现双侧带常显可能让用户以为两侧都能吸）。

### 5.2 吸附带 / 端口可视位置与图不对齐（图2 红弧"跑进节点内部"）
用户认为吸附带/端口应在**节点左右两侧**，但图上看到跑到内部去了；他点明"内部是通过偏移(offset)处理的"。
- 当前：target 锚点在**卡左缘中点**、source 在**卡右缘中点**；带 `offset<0` 才向节点内缩。
- handle 折叠(rest)态：MovingHandle 用 restOffset 把按钮/端口 debug 从锚点往节点内收到 `radius-restOffset` 附近 —— 这是"rest 折叠"设计，非 bug，但 debug 圆弧(handleDebug)若画在折叠位会被误认为"带在内部"。
- **接手要先跟用户对清楚**：他说的"红弧/带跑内部"是指 ①端口 handleDebug 的折叠圆弧，还是 ②吸附带本体？再决定是只调 offset 默认值、还是改几何/折叠逻辑。**不要自作主张改锚点**。

### 5.3 拖线"能否真的拖出来 + 吸上去"需端到端验证
前面只验证了"设置面板渲染 + 吸附带叠加常显 + 设置 store 有值 + 节点实例带内容类型"。**还没在浏览器里真拖一条 source→target 线验证**：起手能拖、hover 亮 valid/invalid、松手建边成功。接手第一步就做这个（见 §7 浏览器手把手指引）。

---

## 6. 已修的关键坑（新 agent 别踩）

1. **renderContext 里 snapZone 是 reactive 对象、不是 Ref**。`useCanvasRender()` 解构出的 `snapZone` 直接用 `snapZone.heightRatio`，**别写 `.value`**。`useNodeDebugOverlay` 现参数签名已是 `snapZone: SnapZoneConfig`（对象）。之前误用 `Ref` 导致 `opts.snapZone.value.shape` 读 undefined → BaseNode 渲染崩溃（console 满屏错误），已修（commit `1af1556`）。
2. **vite "does not provide an export named DEFAULT_SNAP_ZONE_CONFIG"** 全是 HMR/缓存残留，`geometry.ts` 确实导出了。解法：**浏览器硬刷新 / 清 packages/ui/node_modules/.vite 后重启 dev**，别去改代码。
3. **Windows bash** 无 sleep/which/locale（profile 报错忽略）。**taskkill 命令被工具策略拦截**，不能直接杀 dev server 进程；要重启 vite 用别的方式（或让它自愈 + 硬刷新）。
4. dev server 跑在 `packages/ui` **port 5289**。浏览器里开两个 tab(page 30 / page 68)都指它。

---

## 7. 浏览器手把手指引（page 30, http://localhost:5289）

用 chrome-devtools MCP：
1. `take_snapshot` → 点 **⚙ 设置**(uid 会变，先 snapshot)。
2. nav 里点 **吸附带**(组配置四项已在)、**调试**(勾选 端口调试/吸附调试 —— **吸附调试 connectionSnapDebugVisible 打开时，节点在"拖线目标态"才显示吸附带叠加**；不拖线时不会常显双侧带？→ 需确认 BaseNode `showSnapDebugOverlay` 是否要求拖线/悬停，若不要求则应常显两侧带，据此判断 5.1 双带可视策略)。
3. 端到端拖线：从某 text 节点的 **source(右圆点)** 拖到另一节点的 **target(左圆点)**，确认线能拖出、hover 显示 valid、松手建边、undo/redo 正常。
4. 拖线途中 hover 到不合法目标(如反向类型不接受)，确认 reason 气泡文案对。
5. 调"吸附带/偏移 <0"看带是否缩进节点内 —— 与图2 对齐。

工具定义用 mcp-smart 的 get 加载：`list_pages/select_page/take_snapshot/click/evaluate_script/take_screenshot/list_console_messages/navigate_page`。
（**chrome-devtools 的 take_screenshot 存文件路径受其自身 workspace 限制，别折腾存文件，直接 inline 看图或用 evaluate_script 读 DOM 状态** —— 上个子代理在截图路径上卡死浪费时间。）

---

## 8. 建议下一步顺序

1. **端到端验证拖线**（§7 第 3、4 步）—— 先确认"能拖 + 能吸 + 气泡对"，这是用户抱怨 2 的落地证明。
2. 核对 **5.1 双带可视策略**：判定只取方向侧 vs 叠加画双侧，是否要统一；跟用户确认再改。
3. 核对 **5.2 端口/带位置**：先问清"红弧跑内部"指哪个，再改 offset/几何。
4. 设置面板吸附带**改 offset 到负值 / 改 shape / 改 heightRatio**，确认画布 debug 叠加实时变（rect↔arc）。
5. 每步 typecheck + 跑该包测试 + 每小步一个 commit（别 git add .，别建分支）。
6. 全部完成后若用户同意再清 `docs/tmp/`（本文件在 `docs/tmp/snapband-handoff/handoff.md`）。

## 9. 测试命令速查

- typecheck(某包目录内)：`../../../node_modules/.bin/tsc --noEmit`
- 测试：`node node_modules/.pnpm/vitest@3.2.7_@types+node@24_0892c4c500a9b474122185156562cd79/node_modules/vitest/vitest.mjs run --root <包路径>`
- 现状绿：canvas-render 88、canvas-core 222、theme-default 14（theme-default 里吸附带/useNodeDebugOverlay **没有单测**，edgeGeometry 相关有）。

## 建议技能（下一 agent 按需 Skill 调用）
- `software-engineering`：实现/验证核心规范
- `diagnosing-bugs`：若"拖线吸不上/位置不对"是难缠 bug
- `code-review`：落地后自查本批改动是否满足用户三条抱怨
- `wayfinder`：若要动吸附带几何大方向，先检索 codegraph
