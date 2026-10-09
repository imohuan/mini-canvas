# mini-canvas 项目指挥入口（每次开工先读这里）

> **我是项目的"当前该干什么"入口。** 读法：先看下面【一、现在该做什么】，再按需查【二、验证命令】
> 【三、契约锚点】。历史记录在【四】之后，**只供追溯，不代表现状**。

## 一、现在该做什么（2026-09-17）

### 追记（2026-10-09 九续，子代理 code review：目标队列系统 6 处严重/中档修复）

功能完成后派子代理对目标队列系统做了一轮深入审查。**发现 6 个严重 + 5 个中档问题，全部修完**。

**严重（会造成数据损坏/功能失效）**：
1. **纯图消息整条不进转录**（runtime.ts:515 落盘条件只看 `input.text`）→ 图丢失 + 队列纯图条目对账恒不成立 ⇒ **无限重发**。修：`text || images?.length`。
2. **队列对账指纹只看 text**（queueScheduler.ts:138）→ 纯图条目、带 goal 的条目（实际发出的是 objective）恒不成立 ⇒ 同样无限重发/目标反复重启。修：指纹 = 文本 + 图 + 实发文本。
3. **每次发消息重放整条通道缓冲**（agentSessions.ts since 恒 0）→ 探针实测第 2 条响应帧 11→21、正文重复（AAABBBBBB）。修：起点改 `hub.lastSeq()`。
4. **同一事件被投递两次**（send 响应流与常驻流双订阅、不看 seq）→ 助手正文与工具卡片写重。修：帧带 `id:<seq>`，客户端 `acceptSeq` 去重 + 水位推进；**换会话必须重置水位**（否则新会话 seq 更小被整段丢）。
5. **`agent.setGoalImages` 不存在** → 编辑目标的图静默不落盘（运行时报错）。修：服务开出口子。
6. **跑着的时候发目标**：写了一份没人用的 GOAL.json、objective 从没发出去却回 `{steered:true}`。修：与普通消息一致进队列（条目带 goal），轮到时调度器走 startGoal。

**中档**：失败冷却 30s 挡住用户操作（恢复队列加 forced）；编辑态（组件本地）换会话不归零；
editing 状态部分记在客户端、用户编辑中切走会话会永久卡队列（新增无 itemId 的 cancel-edit 兜底清全会话）；
goal-images 无上限（设 4 张/单张 6M 字符）；一行写死颜色让 ui 色净化测试本来就红（加白名单标记）。

**低档（只列未改）**：`isGoalPausedOnDisk` 死代码且与 goalPaused 双源；queueModel 的 tokenDisplay/TokenMode/
goalProgress/budgetText/usedText 无 UI 消费者；queueScheduler 的 hadPending/lastFailureAt 不清理；
testModel 端点无并发上限（本机绑定风险有限）；引导空闲时前端略沉默。

**测试缺口（建议补）**：goalRoundBroadcast（每轮 goal_round→goal_state 时序含中途停止）、goalEditVsStopAccounting、
goalCorruptFile 四条路径、goalPauseWhileIdleFlag、goalImagesRoute 的 .paused 态、sendGoalQueuedState、sseGapDetected。

**验证**：cloud-server **555**、plugin-agent **239**、ui **239** 全绿；三包 typecheck 干净；
cloud-server/ui 已重建；真服务探针 ALL PASS。已提交 e7380f2c。

### 追记（2026-10-09 十一续，Agent 面板「停靠/浮窗」按钮的图标随状态变）

用户口径（附截图，红框圈住右上角那颗按钮）：「这个按钮应该换一个，这个时候应该是打开成为
悬浮框的那个图标」—— 即面板已**停靠**时，那颗按钮该画「变浮窗」的图标。

**根因**：AgentPanel.vue 头部那颗切换按钮，aria-label 已经随状态变（停靠时写的是「切换为浮窗」），
但**图标恒为 PanelRight（右侧分栏 = 停靠）**。于是在停靠态，图标指的正是「我现在已经在的地方」，
而那颗按钮实际要做的是「变成浮窗」—— **图标与动作相反**。

**改法**（只动 AgentPanel.vue 一行导入 + 一个按钮）：
- 停靠态 → 动作是「变浮窗」→ 画悬浮框 PictureInPicture2（大框 + 右下角小窗）；
- 浮窗态 → 动作是「停靠到右缘」→ 仍画 PanelRight（右侧分栏）。
- 顺手补上 title（此前只有 aria-label，不满足 ui-style-guide §5.3「纯图标按钮必须同时有 title 和 aria-label」）。

**验证**：ui 包 **242 全绿**（agentPanelDrag.test.ts 加第 8 条：图标随状态变、与 aria-label 同向、
两个图标名都在 import 里、aria-label 与 title 成对）；`pnpm -C packages/ui build` 通过。
**真机（Playwright，真产物 :8865，1920×911）**：浮窗态按钮 = aria-label/title 为「停靠到右侧」且 SVG 是
rect(3,3,18,18)+M15 3v18（PanelRight）；点「停靠到右侧」后 = aria-label/title 为「切换为浮窗」且 SVG 是
M21 9V6…+rect(12,13,10,7)（PictureInPicture2）；再点切回浮窗，图标与提示都还原。截图放大确认 16px 下
一眼可辨；0 console 错误。

### 追记（2026-10-09 十续，右侧 Agent 面板：停靠态也能拖）

用户口径（两张截图 + 「右侧这个 Agent 面板要能拖拽」）：面板**停靠**在右缘时也要能拖。

**根因**：外壳（packages/ui 的 AgentPanel.vue）此前只有浮窗态能拖 —— `startDrag` 第一行就是
`if (ui.agent.docked) return`，头部在停靠时也不带 `draggable`（没有抓手光标）。停靠态唯一能拖的
是左缘那条 12px 改宽手柄，用户想挪面板只能先点「切换为浮窗」。

**改法**（只动 AgentPanel.vue）：
- 删掉 `startDrag` 里那句 docked 短路；头部 `:class="{ draggable: !docked }"` 改成常开 `draggable`。
- 停靠态拖头部 = **拖出来**：位移超过 `DRAG_THRESHOLD(4px)` 才 `docked = false`（防点一下头部/标题就掉出停靠），
  并按「抓取点」锚定 —— `base = { x: startX - grabDX, y: startY - grabDY }`，落点与鼠标严丝合缝、不跳位；
  同时把 `chatHeight` 写成当前真实高度（全高），拖出来不会突然缩成默认 640。坐标仍走 `clampPos` 夹进视口。
- 浮窗态拖头部、右下角缩放、停靠态左缘改宽三条**都没动**。

**验证**：ui 包（新增 `agentPanelDrag.test.ts` 7 条结构守卫：不再短路 docked / 头部常开 draggable /
脱离停靠 + 抓取点换算 / 阈值在脱离之前 / 高度沿用 / 拖拽期间禁选中并摘监听 / 两个旧手柄都在）
除 plugin-agent 的**预先失败**（`rgb(0 0 0/0.06)` 色净化，HEAD 里就有，非本次引入）外全绿；
`pnpm -C packages/ui build` 通过。**真机（Playwright 真鼠标，dev :5288 + 真产物 :8865，1920×911）**：
停靠 → 头部按下微动 2px → **仍停靠**（阈值生效）；拖 300px → 变浮窗且左缘跟手（x 1520→1220）；
左侧抽屉打开时同样可拖；浮窗内再拖照常；重新停靠后左缘改宽仍可用（400→600）；点「新建对话」面板不动；0 console 错误。

### 追记（2026-10-09 九续，设置界面重做：左侧两级树 + 右侧全量配置）

用户口径：参考主题皮的设置界面，在 **packages/ui** 里重做一个 —— ①左侧树形菜单、右侧显示全部配置；
②点左侧菜单右侧自动滚到对应位置；③左树是两层结构，折叠后第二层缩进、第二层也有折叠（没有第三层）；
④**不需要**主题皮那两个插槽（settingsNav / settingsTab）。

**改了什么**（全在 packages/ui/src）：
- 重写 `components/settings/AppSettingsPanel.vue`：左 = **两级树**（一级 = 分组名第一个 `/` 分段、二级缩进 14px，
  两级各带折叠箭头 toggleNav）；右 = **全部配置长列表**（一级标题 + 二级卡片叠排，无二级页签条、无分页）。
  点一级/二级 → scrollToEl 平滑滚到对应锚点；右侧滚动 → onBodyScroll 滚动侦察反向高亮左树那行
  （scrollIntoView block:nearest），滚动期间上“程序化滚动锁”防高亮闪动。
  字段控件仍复用默认皮 SettingsSchemaField（不另造第二套）；**只消费内容插槽 settingsGroup/<key>**
  （Agent / 插件 / 热重载等自绘页靠它，去掉它那些页就只剩占位项），**不再消费 settingsNav / settingsTab**。
- `settingsPanelPlugin.ts`：打开 `ctx.theme.register('settingsPanel', AppSettingsPanel, {order:-1})`
  （这行此前被注释掉，所以成品应用一直渲染的是主题默认皮，本次新面板根本没被用上）。

**用户第二轮微调（同日）**：左树内边距改紧凑（aside p-1.5 = 6px、一级行 30px / 二级 26px）；
**折叠箭头只在"真的有二级"的一级行上出现**（canFold 判据，没有二级的行用等宽 .asp-caret-spacer 占位对齐）；
右侧**去掉卡片包裹**（段容器不再圆角/描边/底色，只留二级小标题 + 细分隔线，字段直接铺在最外层）；
**去掉选中高亮**（不再铺底色、不再加粗；当前项只由右侧滚动位置体现）。

**用户第三轮（同日，缩进真实缺陷）**：用户报"折叠里的缩进无法缩进"。真机量到根因 ——
一级文字起点 = 箭头 16px + 一级标签 padding-left 4px = **20px**；而二级标签 padding-left 也是
**24px**，两者 glyphX 实测都是 24px（视觉上完全对齐）→ **层级根本看不出来，连带折叠"看不出效果"**。
修：箭头 18→16px、一级标签 padding-left 4→2px（一级文字落在 18px）；二级 padding-left 24→**38px**
（比一级文字多 20px）。实测一级 glyphX 18、二级 38（差 20px）；收起「节点」后其二级 display:none、
箭头转右，层级与折叠都一眼可辨。

**用户第四轮（同日，单子节点合并）**：用户口径"只有一个子节点的项目合并成一个大菜单，
因为二级只有一个，一级没必要做二级折叠"。加 isSolo 判据（一级下只有 1 个二级）：
左树 solo 的渲染成一条平级项（.asp-row--solo：无箭头、走 selectLeaf(唯一子 key)）；
右侧 solo 段只有一个小标题（= 一级名），不再是"一级标题 + 同名二级标题"两行；
多子节点的照旧走"一级 + 可折叠二级"。实测：热重载 / Agent / 插件 / 导出 / 光标 / 图片生成 /
文本生成 / 风格库 / 云端客户端 / 小地图 全部并为一条（文字与一级同起点 18px、无箭头、右侧单个小标题）；
节点 / 布局 / 边 / 常规 / web2api 仍带箭头 + 缩进二级（38px）。

**用户第五轮（同日，折叠按钮 + 左侧高亮）**：① 折叠箭头**去掉背景**（静态/hover 都透明），
hover 只把箭头颜色变深变亮；点击区域从 16×16 放大到 **24×24**；一级/二级/合并项文字起点同步
挪到 24 / 44 / 24px（层级差保持 20px）。② 左侧**加回当前项高亮**：一层灰色底
（走 --ui-chip 中性填充，亮暗自动翻转）、**不要边框**（border/outline 皆 0），一级/二级/合并项共用
同一条 .asp-row.is-current 规则；点二级时它的一级同时高亮。实测：箭头 24×24、背景 rgba(0,0,0,0)、
hover 图标 rgb(168,168,168)→rgb(247,247,247)；点「控制栏」后「布局」「控制栏」两行各有一层灰底、无边框。

**用户第六轮（同日，重要教训：看到的是过期构建产物）**：用户报"完全没高亮"。
排查结论 —— 源码一直是好的：dev（:5288，直读源码）亮/暗两套都量到 is-current 背景 + 主题色文字；
而 cloud-server（:8865）托管的是 packages/ui/dist 构建产物，那份 dist 是 19:49 打的包，
正好卡在"合并单节点 + 放大箭头"之后、"加回高亮"之前，所以里面根本没有 is-current 背景规则
（实测该页 CSS 里 asp-row.is-current 规则数 0、当前项背景 rgba(0,0,0,0)）。
处置：pnpm -C packages/ui build 重建 dist（新产物 scope id 67ab93b3、含
.asp-row.is-current，background 走 var(--ui-accent-soft)），8865 硬刷新后高亮正常。

**教训（写死进流程）**：改了 packages/ui 的界面后，dev :5288 与 cloud-server 托管的 :8865
是两份不同的东西 —— 前者直读源码、后者读 packages/ui/dist。只验 dev 会漏掉"用户看的是旧 dist"。
以后交付 UI 改动必须 pnpm -C packages/ui build 重建一次 dist；用户报"源码有样式、界面没效果"时，
先怀疑 dist 过期 / 浏览器缓存，不要反复改源码。

**用户第七轮（同日）**：用户口径"二级菜单亮的时候一级菜单就不要亮了"。改：一级行**不带**
is-current 绑定，高亮只落在"当前那一段"（有子节点的分组里当前段永远是某个二级）；
合并项（solo）仍亮它自己。实测点「自动布局间距」时只有该二级亮（一级 is-current 数 0）。

**验证**：ui 包（新增 settingsPanelTree.test.ts 10 条：注册顶替默认皮 + 两级树/折叠/缩进 +
点选滚动 + scroll-spy + 只消费 settingsGroup、不消费 nav/tab + 无卡片 + 无高亮）除 **plugin-agent 的预先失败**外全绿；
**真机（Chrome MCP + dev :5288）DOM 几何逐条量过**：左树 aside padding=6px、一级文字 18px / 二级文字 38px（差 20px）；
一级 7 行都有箭头、二级 20 行**零箭头**；段容器 border/radius=0、背景透明（卡片 0 个）；
点「控制栏」→ 内容滚到 scrollTop 3190 且该段顶边贴容器顶（offset 0）；鼠标移开后**没有任何行带底色**（无高亮）；
布局一级折叠 → 其二级 display:none；Agent / 插件 / 热重载自绘页正文照常渲染。

### 追记（2026-10-09 八续，三种编辑互斥 + 黄色统一）

用户口径（三张截图）：队列编辑顶部那句「正在编辑排队消息，改完发送队列继续」删掉；
对话消息 / 队列消息 / 目标三种编辑**互斥**（原来能同时出现三个）；编辑态**统一成黄色**（以消息编辑为准）。

**改法**（AgentConversation.vue）：
- `cancelAllEditsExcept(keep)`：进入任一编辑前，把另外两种退出（消息 → `agent.cancelEdit()`；
  队列 → 逐条 `cancel-edit`；目标 → 撤草稿标记）。
- **删掉**队列顶部那条提示文字与 `.ac-queue-blocked` 样式。
- 输入框上方的黄色「正在编辑」标记改为**三种共用**（`editingKind`: message/queue/goal），
  文案随是谁而变（「正在编辑」/「正在编辑排队消息」/「正在编辑目标」），✕ 按 kind 去取消，
  点标记滚到对应的元素。
- 目标行编辑时整行**变黄** + 右侧「正在编辑」徽标（与消息/队列同一套 `--ui-warn` 语义）。

**验证**：真机（Playwright + DOM 几何）—— 队列编辑时标记=「正在编辑排队消息」且提示文字已消失；
切到目标编辑后目标行 `is-editing` + 徽标「正在编辑」，**队列编辑自动退出**；标记随 kind 切换。
修了一个连带 bug：目标文案 `flex:1` 会把进度条挤成 6px，改成 `flex:0 1 auto; max-width:40%`
（文案可压缩但有占比上限，进度条恢复 33px）。plugin-agent **233** 全绿。

### 追记（2026-10-09 七续，目标行：编辑目标 + 轮次实时 + 中性配色）

用户口径（逐条）：① 目标行标题 hover 时左侧图标变「编辑」，点它进入编辑（与队列编辑一致：回填输入框、
挂草稿标记），发送 = **修改该目标内容**（不新建、不进队列）；② 轮次/已用**每轮都要刷新**（实测从第 3 轮直接跳到第 7 轮）；
③ 目标行不用主题色，换中性黑白灰。

**改法**：
- 编辑目标：目标行左侧图标改成一颗按钮，hover / 编辑中在「目标」与「铅笔」两枚图标间切换（CSS 叠图）；
  点击 → `beginEditGoal()`（`setGoalMark(原目标, 原预算)` + 回填输入框）；`submit()` 里新增 `editingGoal` 分支，
  走 `agent.updateGoal({ objective, budget })`（**只改这条目标**）。再点一次图标或点草稿标记 ✕ = 取消编辑。
- **轮次实时**（根因）：目标是在**一次 SDK `run()` 里连跑多轮**（stop hook 循环），而 goal_state 此前只在整轮 run
  结束才推一次 ⇒ 中间几轮全被跳过。修：translate 把 SDK 的 `hook`（goal stop）事件翻成 `goal_round` 信号，
  runtime 收到就调 `deps.onGoalRound`（server 接线：读一次 GOAL.json 推 `goal_state`）。
  实测：界面依次出现 **第 1→2→…→17 轮**，不再跳号。
- 中性配色：目标行/徽章/进度条/数字/草稿标记全换成 `--ui-chip / --ui-veil / --ui-ink-dim`，不再染青。
 顺带：`tokensUsed` 也接通了写入链路（goalState→goalRuntime→route→api→service），运行中「已用/总预算」左右都能点着改，
 进编辑自动全选、**只有回车生效**（失焦/Esc 还原）。

**验证**：plugin-agent **233**、cloud-server **546** 全绿；真机（Chrome/Playwright）：hover 图标切换 ✓、
点击进入编辑 ✓、发送后 `POST /goal` 200 且该会话 objective 变成新值 ✓、目标行中性配色 ✓。

### 追记（2026-10-09 六续，队列/目标 UI 收尾：圆角、暂停键、目标行不出现）

用户口径（截图指出）：① 聚合容器圆角差、内部行方角把圆角顶破；② 行内按钮挤出容器；③ 目标在跑但看不到目标 UI。

**改法**（plugin-agent AgentConversation.vue + cloud-server 路由）：
- 容器 `.ac-pending-box` 恢复 **overflow:hidden**（内部矩形的方角被外层圆角裁掉，外圆内方才成立）；
  宽度从 90% 对齐到 **100%**（与输入框、发送键左右齐）。
- 队列暂停键从「容器子元素」挪回「**输入框**子元素」（容器的兄弟）—— 容器 overflow:hidden 会裁掉它半个；
  用 `top:0; translate(-50%,-50%)` 压在输入框上边框（= 两块接缝），与参考 HTML 同款。
- 行内元素加 `min-width:0`，**按钮永不被挤走**；容器查询阈值放宽到 300/250px（原先 380/420 让进度条常隐）。
- **目标在跑却看不到目标行**：根因是「目标开始跑」时后端没广播 `goal_state`（此前只有改预算/暂停/恢复才推），
  本页刚发起的目标前端无从得知；切会话才显示（openSession 会拉 full.goal）。
  修：beginGoal 之后读一次 GOAL.json 推 `goal_state`。测试 `goalBeginBroadcast.test.ts`。

**验证**：plugin-agent **233** 全绿 + typecheck 干净；cloud-server 目标三件测试 18 条全绿。
真机（Playwright 截图 + DOM 几何）：容器四角圆润、行底色不再顶破；行内按钮距容器右缘 -7px（在内侧）；
容器与输入框左右对齐；发目标前 `hasGoalRow:false` → 发之后 `true`（当场出现，不用刷新/切会话）。

**流程教训（已固化）**：改 UI 后**必须截图自查**再下结论 —— 这几处都是没看画面才漏的。

### 追记（2026-10-09 五续，Agent 输入区 UI 按 RULES 落地）

用户口径：照着 `docs/tmp/queue-ui-demo/debug.html` + `docs/tmp/queue-ui-demo/RULES.md` 改真代码。

**改了什么（plugin-agent，全在 AgentConversation.vue + queueModel.ts）**：
- **聚合容器**：目标行 + 队列行合并进**一个容器**（`.ac-pending`），在输入框**外面**；
  宽 90% 居中、**与输入框零间隔**（底部去圆角 + 边框重叠 1px）；**只有外层有圆角，内部行方角**。
- **回到底部**：从 composer 挪进**消息区内部、底部居中**（新增 `.ac-scroll-wrap` 做定位参照）。
- **队列暂停键**：从右侧一列改成**骑在队列与输入框分界线上、水平居中**的胶囊（图标 + 「队列暂停/恢复」+ 条数）。
- **引导**：本来就是纯图标按钮（无文字），保留。
- **目标两阶段**：
  · 未发送 → **输入框内侧顶部**，标签只写「目标」二字（目标正文 = 输入框内容，不重复）；
  · 已发送 → 聚合容器里的一行（强调色底 + 进度条 + 「第 N 轮」+ 口径值 + 开关 + 暂停/结束）。
- **预算（token 数字）**：
  · 单位换算：`formatToken / budgetTokenText`（国际 k/M/B/T ⇄ 中文 万/亿/万亿，可在行内开关切换）；
  · 解析：`parseTokenText`（`50k`/`1M`/`5万`/`1亿`，空 = 不限）；
  · **行内编辑**（contenteditable）+ **真 CSS 下划线**（text-decoration，非 border）；宽度自适应。
- **口径开关**：**只有两态** —— 「已用预算 ⇄ 剩余预算」（`tokenDisplay`），未发送/已发送**两处都有**，
  按钮在关闭键左侧、样式一致，点击换图标（实心/空心漏斗）；口径与单位存 localStorage。
- **删掉**：旧的「目标编辑弹框」（`.ac-dialog-*`、`openGoalEditor/saveGoalEditor/goalBudgetMode` 全删）。

**验证**：plugin-agent **233** 全绿（新增 `queueModel.token.test.ts` 15 条）+ typecheck 干净；
ui 色净化测试通过（两处白字按项目惯例加 `主题色白名单` 行注释）；ui 构建成功。
真机（8865，Chrome MCP）：聚合容器宽约 90%、与输入框重叠 1px、圆角只在顶部、暂停胶囊骑线居中且显示
「队列恢复 3」；点 + →「目标」在输入框内侧加标签（不弹框）、只写「目标」、预算下划线是 text-decoration
（border 0）、口径开关从「剩余预算」切到「已用预算」、旧弹框已消失。

**参考文档**：`docs/tmp/queue-ui-demo/RULES.md`（逐条「错 → 对」）与可调试页 `debug.html`。

### 追记（2026-10-09 四续，test 模型的节奏指令）

用户口径：「你这个测试模型，它的响应速度太快了，我一点反应都没有，我想创建一个列表的时间都没有。
我希望你的后台能够解析我发送的文本，比如让你这个模型持续跑多久 —— 你给我定一个规则然后解析。
我发送这条消息之后，你就解析出这次的流需要多久才能完整返回。而且，我还可以自定义返回结果。」

**规则（写在消息里，后台解析）**：

```
::test 时长=8s 间隔=120ms 内容=我要的自定义回复::
```

- `时长`（`duration/dur/time`）：整条流跑多久。无单位=秒；支持 `ms`/`s`/`秒`/`分`/`m`。上限 2 分钟（防手滑）。
- `间隔`（`gap/interval`）：每片之间等多久（默认 120ms）。给了`时长`就按时长反推间隔，间隔让位。
- `内容`（`text/content/reply`）：自定义返回正文，放最后可含空格。
- 简写：`::test 8s::`（只给时长）、`::test::`（全默认）；指令会从回显正文里剥掉。

**实现**：`packages/cloud-server/src/agent/testModel.ts` 加 `parseTimeToken / analyzeTestRequest /
`buildReply / planStream`，端点改成**逐片 + 逐片等待**输出（第一帧立刻发，让前端马上知道流开始了）。
真机实测：`::test 时长=6s 内容=…::` → 整条流 6.23s，回复正是指定内容。

**验证**：cloud-server **544** 全绿（新增 `testModelDirective` 14 条、`agentTestModel` 加 1 条）；
typecheck 干净；产物已重建、服务已重启（8865）。

### 追记（2026-10-09 三续，test 模型 + 目标条的两个问题）

用户口径：
① 「我希望你在这里提供一个自定义的测试模型，这样测试效率就会很快，不能每次都访问后台，访问太慢了。
   在模型列表中额外添加一个模型，命名为 test模型；当我请求这个 test模型 时，不需要真正请求后台，
   而是随便伪造一些数据返回过来。」
② 「我这边新建一个对话，你的目标那一栏还在，这是什么情况？按理说它是针对一条对话的，
   但是你这边是不是搞成全局的了？而且这边还没有删除按钮。」

**test 模型（已做）**：
- 方案：SDK（penguin-core）**不开放注入自定义 LLM**，它只按配置里的
  `provider / model_id / base_url / client_type` 去请求一个 OpenAI 兼容端点。所以做法是
  **在本进程内挂一个假端点**（`POST /api/test-model/v1/chat/completions`，吐标准 Chat Completions
  SSE 分片 + usage + `[DONE]`），启动时自动登记一个指向它的模型（provider=`test`、modelId=`test模型`、
  client_type=`openai-chat`）。因为唯一被伪造的是「模型那一次 HTTP」，SDK 的其它链路（转录、
  目标 stop hook、队列调度、token 记账）**全部照常**，正好用来快速测这些功能。
- 代码：`packages/cloud-server/src/agent/testModel.ts`（假端点 + 伪造回复的纯函数）、
  `AgentConfigService.ensureTestModel`（幂等登记）、`server.ts` 挂载（在 ui 静态兜底之前）。
- 真机实测：一轮对话 **161ms** 完成（真实模型要几十秒）；用 test 模型跑「目标」2 秒内连播到第 4 轮
  （`budget_limited/ended`）；跑「队列」1 秒内把 3 条消息全发完并落转录。
- 配置写在 `.mini-canvas/`（已 gitignore），不进版本库。

**目标条的两个问题（已做）**：
- **①新建对话后目标条残留**：`newSession()` 只清了 `model / sessionId / title`，没清
  `goal / goalPaused / goalMark / queue / running`，也没断开旧会话的常驻流（那条流还会把旧会话的
  `goal_state` 推回来）。修：切新会话时把这些会话级状态一起归零 + `detachStream()`。
  测试 `agentNewSession.test.ts`。真机实测：新建对话后目标条消失。
- **②目标条没有删除按钮**：原来那条只有「暂停/启动」。新增「结束目标」✕ —— 与「暂停」不同，
  结束是**真删掉**（live 与 `.paused` 两份状态文件都删、清暂停标记、广播 `goal_state: null`），
  不可恢复。链路：`goalState.endGoalFile` → `GoalFiles.end` → `GoalRuntime.endGoal` →
  `goalOp` 的 `op:'end'` → 前端 `agent.endGoal()` + 状态条上的 ✕ 按钮。
  测试 `goalEnd.test.ts`（3 条）+ `goalEndRoute.test.ts`（1 条）。真机实测：点 ✕ 后目标条消失、
  后端 `goal` 变 null、状态文件被删。

**验证**：cloud-server **529**、plugin-agent **218**、ui **220** 全绿；三包 typecheck 干净；
cloud-server 与 ui 产物均已重建，服务已重启（8865）。

### 追记（2026-10-09 续，Agent 目标/队列真机失效的根因修复）

承接 2026-10-08 的「Agent 队列 / 引导 / 后台对话 / 目标模式」。用户最后一次真机测试的结论是
「队列发出去有气泡但没触发对话、发送键没有运行态、队列跑完不接下一轮、目标也不生效」。
本次在真机上逐条复现，定位到 **四个互不相干的真 bug**（都有磁盘/接口证据），全部按
「先写失败测试 → 修根因 → 全量回归」的流程修掉：

1. **目标循环永远卡在第 1 轮（根因：协议文本缺 sender:harness 戳）**
   - 现象：新会话的目标能正常连播；但**有历史 abort 的会话**，目标第 1 轮跑完就被判 aborted 收场。
   - 根因：beginGoal 把官方 start.mjs 的协议文本**拼进了用户消息正文**，而 SDK 的 goal stop.mjs
     靠 sender:harness 划「轮次边界」（lib.mjs 的 isRoundInput）。拼进正文就没有戳 ⇒
     记账退化成「整份 trace = 一轮」⇒ 扫到历史上任意一次 abort 就判 aborted。
   - 修法：目标协议文本改走**独立的 harness 消息**（SDK 的 userText(text, harness)）——
     StartRunInput.harnessText + deps.makeHarnessMessage；resume 的踢一脚同口径（正文空、只有 harness 段）。
   - 真机结果：**跑到了第 5 轮**（修前恒停第 1 轮）。

2. **界面永远看不到目标状态（根因：读 GOAL.json 少一层 agent/）**
   - 现象：目标在跑，刷新后界面没有目标状态条。
   - 根因：写用 sessionScratchpadPath(agentRoot(dataDir), sid)（对），读用
     sessionScratchpadPath(config.dataDir, sid)（少一层 agent/）⇒ 读的目录里永远没有文件。
   - 修法：读侧改成 agentRoot(config.dataDir)，与写侧同口径（agentPaths.ts 早有这类双源漂移的教训）。
   - 真机结果：前端目标状态条正常渲染（目标第 2 轮 · 2.3k / 400k）。

3. **目标协议文本泄漏进转录与界面（根因：翻译层没挡非人类用户文本）**
   - 现象：对话流里冒出「This message was sent automatically by goal mode…」。
   - 根因：SDK 把轮次 2+ 的 harness 文本回吐给宿主时，translate 层把它当**助手文本**翻了出去。
   - 修法：translate.ts 的 text 分支加一道闸 —— role 为 user 且 sender 存在时直接不产出事件。

4. **服务重启后发目标拿不到协议文本（根因：hook 前没装载会话）**
   - 现象：日志里一直是「goal: hook 未产出协议文本，宿主写初始 GOAL.json 兜底」，官方循环起不来。
   - 根因：runtime.runUserPromptHook 只在**内存 live 表里**找会话；会话没装载（重启后 / 本次进程首次用到）
     就直接返回 null。
   - 修法：找不到就先 ensureSession 把它装载起来再跑 hook（装载失败仍返回 null，调用方走兜底）。

**顺带修掉一个显示 bug**：目标状态条的「已用」复用了 budgetText，导致 tokensUsed=0 显示成「不限」
（目标第 1 轮 · 不限 / 400k 看着像预算没设置）。新增 usedText（已用专用，0 就是 0）并接进状态条。

**验证**：cloud-server **520** 全绿（新增 agentGoalRead 3、agentTranslate 2、agentRuntimeGoal 4）、
plugin-agent **217** 全绿（新增 usedText 2）、ui **212** 全绿；三包 typecheck 干净，UI 产物已重建。
真机（Chrome MCP，8865）：目标连播到第 5 轮、暂停把文件挪成 .paused 且状态可读、启动放回并踢一脚、
暂停时队列列表**不消失**（仍显示 2 行 + 右侧暂停按钮）、目标状态条文案正确、队列自动逐条发送并落转录。

**遗留（未做，供下一轮）**：后台自动跑的轮（队列/目标）撞上**需要审批的工具**时会一直挂起等界面点选。
页面有常驻订阅时会收到审批卡片（可点）；但纯后台场景（页面关着 / 该轮由队列自动发起）没人点就永久卡住，
队列也不再推进。是否要给后台自动发起的轮设一条更宽松的审批策略（或超时自动放行）需要先与用户确认口径。
旧代码留下的孤儿目录 agent/agent/...（双 agent 层）已无代码再写它，本轮测试会话里残留的那份
会让模型读到过期 GOAL.json，可择机清理。

### 追记（2026-10-09，修复制粘贴：带 parent 的节点定位错 / 父子关系像丢了）

用户口径（附截图）：「复制带有 parent 的节点时，没有计算出它们正确的位置…… 下面就是粘贴的效果，
定位完全错误，而且可能已经丢失了父子级关系」。

**根因（父子坐标系混用）**：组内子节点的 `position` 是**相对父组的局部坐标**（见
`packages/plugins/plugin-group/src/groupEngine.ts` 顶部坐标约定、`nodeLayout.absolutePosition` 累加父链），
而 `plugin-clipboard` 把快照里所有节点的 `position` 都当**flow 绝对坐标**用：
① `computePasteOffset` 用原始 `position` 算包围盒 → 相对值与绝对值混算，中心错 → 偏移错；
② `remapSnapshot` 给每个节点（含子节点）都加同一个偏移 → 子节点在组内被平移出去、四散。

**修法（绝对坐标才是刚性平移的基准）**：
- 快照节点新增 `absPosition`（复制时刻的 flow 绝对坐标）。`toClipboardNodes` 沿**批内父链**累加；
  父未被选中（批外）时改问注入的 `ClipboardAbsProvider`（插件侧走 `nodeLayout.absolutePosition`，
  用整张画布的父链，能算到任意深），并把 `parentId` 收敛为「父也在快照里」——父在批外则把 position
  重定基到绝对坐标后落顶层，防悬挂。
- `computePasteOffset` 只按**根节点**（无父）算包围盒：子节点在几何上位于根容器内，根矩形已覆盖
  整块内容；把无尺寸子节点按 256 兜底算进去反而会把中心撑偏。
- `remapSnapshot`：有父的节点**相对坐标原样保留**（父整体平移即带着子树走）；无父节点加 offset。
- `clipboardPlugin` 的 copy/cut 改为直接 `makeSnapshot(nodes, edges, now, absProvider)`，
  不再先 `toClipboardNodes` 再交给 makeSnapshot（那样会二次处理）。

**验证**：
- plugin-clipboard **28**（引擎 18 + 插件 10；新增 6 条针对本缺陷：父子同批复制 / 只复制子节点 / 
  整块粘贴相对坐标不变 / 包围盒只按根算 / 端到端父+子粘贴保父引用 / 只复制子落顶层不悬挂）全绿，
  `tsc --noEmit` 干净。**守卫有效性自查**：把「有父则相对坐标不变」改回「所有节点加 offset」再跑 →
  当场红（子节点 30,40 变成 130,90，正是用户症状），已还原。
- 受影响面：ui **212** 全绿（ui 只注释引用 clipboard，无别的调用方；全仓 `toClipboardNodes` 仅
  index.ts 再导出 + 引擎自用）。
- **真机（Chrome MCP，8865 真产物，插件 dist 重建后）**：造分组 G(400,300,400x300) + 两子
  (相对 40,50 / 200,150)，选中整块复制粘贴 → 新分组 **(450,350)**（父 + 级联 50），两子相对坐标
  **(40,50)/(200,150)** 一格没动、`parentId` 指向新分组、绝对坐标 = 新父 + 相对。验证痕迹已撤销清理
  （33 → 27，0 残留、0 悬挂父引用）。

### 追记（2026-10-09 五续，「删除画布」对**任何**画布都可用（含内置与当前选中））

用户口径（附截图）：「你这个东西为什么很多时候无法点击删除啊？搞得我很难受啊。不管是哪个画布都支持删除啊，
即使是当前选中的也支持删除啊。只不过你删除之后，跳转到第一个画布就行了呀」。

**根因**（上一轮我只解决了一半）：`DELETE /api/canvases/:id` 对内置 `default` 画布直接返回 400
（「默认画布不可删除」），前端为保护就把「删除画布」**灰掉**（更早是隐藏）。用户要的是**没有例外**。

**改法（前后端一起去掉豁免）**：
1. 后端 `routes/projects.ts`：删掉 `if (id === 'default') ... 400` —— 任何画布都可删。
   `default` 只是在「调用方没给画布 id」时当兜底 id 用（`CanvasDocument` / `docForCanvas` 的默认参数），
   删掉它之后那些路径会**惰性建回一张空画布**，不炸（已有测试覆盖）；
2. 前端 `ui.ts` 的 `deleteCanvas`：去掉「只剩一张不给删」的护栏，改成——
   删的若是当前这张，先落盘、删、再跳**剩下清单里的第一张**；**一张不剩就现建一张再跳**（没地方跳就白屏）；
3. 前端 `ProjectCluster.vue`：删除项去掉一切条件（不再 `v-if`、不再 `:disabled`），
   `ui.canvasOptions` 里那个 `deletable` 概念（「谁不许删」）一并退役。

**验证**：cloud-server **544**（那条「默认画布不可删」改成「默认画布**可**删：删完目录不在了、
各接口仍自洽」）+ ui **222**（`canvasChipMenu` 15：新增「删除项没有任何条件（不隐藏不置灰、`canDelete` 整个消失）」
与「删除后跳第一张 + 删空了补建一张」两条守卫）+ `vue-tsc` 干净 + `vite build` 通过；
ui dist 与 cloud-server dist 都重建、8865 重启。
**真机（Chrome MCP，8865 真产物）**：把四行逐个点开 —— **每一行（含内置 default、含当前选中）
「删除画布」都 `disabled=false`、`opacity=1`**；
点它删**当前**画布 → URL 自动跳到剩下清单里的第一张（`#/canvas/430c8f1f…`）；
另用一次性项目造「只有一张画布」的极端情况 → 删掉唯一的画布后**自动补建一张并跳过去**（无白屏）。
验证数据已清（临时画布、临时项目、以及验证时误开的标签页），
用户自己的两张画布（`我的111123123` / `画布 12131231`）未动，服务停在 8865。

### 追记（2026-10-09 四续，「删除画布」常显+置灰（修「二级菜单没显示完整」））

用户口径（附截图）：「你的这个二级菜单怎么变成这个样子了？没显示完整」。

**先复现、再动手**（用 Status 里的 Chrome MCP 连真机 8865）：逐行点开四行的「⋯」对比条目，
发现**只有「当前画布」那一行少一条**——其余三行都是 4 项，当前行只有 3 项（缺「删除画布」）。
不是浮层被截断：量过菜单 `clientHeight === scrollHeight`（没触发滚动）、祖先链里没有
`transform/filter/backdrop-filter` 的包含块、`bottom` 也远在视口内。

**根因**：当前画布是**内置 `default` 画布**，后端 `DELETE /api/canvases/:id` 对它返回 400
（`default` 不可删）。前端为了保护，用 `v-if="canDelete"` 把「删除画布」**整项隐藏** ——
于是这一行的菜单比别的行少一条，看着像「菜单没画全 / 坏了」。

**改法**：条目**一律显示**，不能删时**灰掉**而不是隐藏 ——
菜单长度固定，用户读得出「这条现在不可用」，不会怀疑菜单坏。改动三处：
1. `AxMenuItem` 新增 `disabled`：真 `<button disabled>` + `aria-disabled="true"` + `is-disabled` 类，
   并且 click 里再挡一道（防键盘/程序触发）；
2. `AxMenu` 的 `.ax-menu-item.is-disabled { cursor:not-allowed; opacity:.38 }`
   （沿用 ui-style-guide §3.2「禁用：opacity .38」，没自造数值），hover 不给底；
3. `ProjectCluster`：`v-if="canDelete"` → `:disabled="!canDelete"`（`canDelete` 只管能不能点）。

**验证**：ui **221**（`canvasChipMenu` 14，那条守卫从「不显示删除」改成
「**常显 + 不能删时灰掉**，不许再有 `v-if`」）+ `vue-tsc` 干净 + `vite build` 通过。
**真机（Chrome MCP，8865 真产物）**：四行逐个点开「⋯」→ **四行都是完整 4 项**；
只有当前行（内置 default）的「删除画布」是灰的：`opacity 0.38` / `aria-disabled=true` /
`button.disabled=true`；其余行的删除项正常可点。
（验证时误开的一个画布标签页、以及探针数据都已清掉；用户自己的「副本」画布未动。）

### 追记（2026-10-09 三续，行尾按钮 hover 只换图标颜色、底色改由整行给）

用户口径（两句，须合起来理解）：①「你这个按钮不要给 hover 的背景颜色，就直接给这个图标颜色就行」；
②「你这边 hover 的时候为什么只有左侧有背景啊？…这边 hover 的是整块的一个背景」。
即：行尾「⋯」按钮自己**不要** hover 底色；**整行** hover 才给一块底。

**改法**：底色从「行里的主按钮」挪到「**行**」上 ——
`.canvas-row:hover { background: var(--ui-hover) }`（整行一块底），
`canvas-row-main` 不再有 hover 底色、`canvas-row-more:hover` 只留 `color: var(--ui-ink)`。
（教训：底色打在行里的按钮上只会染那半块，行尾「⋯」与中间留白成了缺口 —— 那正是用户看到的
「只有左侧有背景」。底色属于**行**这一级，不属于行里的控件。）

**验证**：ui **221**（`canvasChipMenu` 14，两条守卫：「行 hover 有整行底、且旧形状
`.canvas-row:not(.is-active) .canvas-row-main:hover` 必须消失」「行尾按钮 hover 无 background、
自身透明、只变色」）+ `vue-tsc` 干净 + `vite build` 通过；
真机量样式：行 hover 时行底 `rgba(0,0,0,.06)`、行内两个按钮均 `rgba(0,0,0,0)`（透明），
行宽 200px 全程有底。**守卫有效性自查**：把 `background` 加回行尾按钮规则 / 把底加回主按钮 → 守卫当场红（已试过并还原）。

### 追记（2026-10-09 二续，画布列表与操作菜单**并存**（子浮层 nestedIn））

用户口径（原话）：「这边你触发这个菜单的时候，你的画布的这个菜单消失了，有没有办法」。
即点行尾「⋯」时**画布列表要留着**，两个菜单并排（效果图就是并排两份）。

**根因**：`AxDropdown` 有一条全局规则「**同屏只留一个浮层**」（`claimDropdownExclusive`）——
打开操作菜单时，它会先把还开着的浮层全关掉，画布列表正是其中一个。
上一轮我为了躲开这条，先主动把列表置 false 再 `nextTick` 开菜单 —— 那是「顺着规则绕」，
绕出来的结果就是用户看到的现象。

**改法（给下拉加「子浮层」能力，而不是在调用方绕）**：`AxDropdown` 新增 `nestedIn` 开关 ——
传一个 getter 拿到父浮层的 `{ chain, open }`，行为随之分三处（都不传 = 普通下拉，行为完全不变）：
1. **打开时不 claim 排他**（claim 会把父菜单当场关掉，而它正是要留着的那个）；
2. **面板组链写成「父链 + 自己」** —— 父浮层的「点外关闭」借它认出「这点在我的子面板里」，不关父；
3. **自己的点外判定只认自己的 id** —— 点在父面板（列表）上时只关子菜单。
   第 3 条若漏了（拿组链去判），点父列表会被当成「还在我这一组里」→ 菜单赖着不关（本仓踩过的老坑）。
另加两条收尾：父浮层关掉时子浮层跟着关（不留孤儿菜单）；`openAtPoint` 在**已经开着**时
也 `updatePosition()` 一次（锚点坐标变了但元素没动，`autoUpdate` 不会触发 → 换行点「⋯」菜单会留在原处）。

**调用侧**（`ProjectCluster.vue`）：操作菜单加 `:nested-in="actionParent"`，锚点取按钮**右缘**
（菜单从列表右边展开＝效果图的摆法）；不再 `emit('update:menuOpen', false)`（那是让列表消失的那一步）。

**验证**：ui **219**（`canvasChipMenu` 12 + `uiDropdownRegistration` 12，新增：操作菜单声明 nested-in /
宿主不再关列表 / 不 claim 排他 / 面板组链=父链+自己 / 自己判点外只认自己 id / 父关子随 / 暴露 isOpen+chainId）
+ `vue-tsc` 干净 + `vite build` 通过；cloud-server **520** 全绿（本次未改后台）。
**真机（Chrome MCP，8865 真产物，`canvas-chip-menu-check.mjs` 16/16）**：③-b 点「⋯」后
**列表仍在**（浮层 2 个、列表行都在）；③-b2 连点另一行的「⋯」→ 菜单跟着挪到那一行旁边
（按钮 y=127 → 菜单 y=163，x 在按钮右侧）；③-c 点父面板 → **只关操作菜单、列表留着**（浮层 2→1）；
四个动作照旧全过；截图确认「列表 + 操作菜单并排」与用户效果图一致。
**守卫有效性自查**：把 `if (v && !isNested.value)` 改回 `if (v)` → 守卫当场红（已试过并还原）。
验证痕迹已清（副本与实验画布都删干净）。

### 追记（2026-10-09，画布下拉的行尾菜单：勾 ⇄ 三个点 + 四项操作）

用户口径（附效果图）：「图一是我想要做的一个效果图。我要做的是画布下拉时的以下功能：
1. 选中时：后面显示一个勾的图标。2. Hover 上去时：图标会变成现在的三个点。
3. 点击之后：弹出一个菜单，菜单的选项就是图 1 的选项。」
（图 1 的选项：在新窗口打开 / 重命名画布 / 复制画布 / 删除画布）

**位置**：在 `packages/ui` —— 左上角「块 A」的**画布 chip 下拉**（`components/ProjectCluster.vue`，
它在左上角悬浮栏与左抽屉头部各渲染一次）。**不是**顶部状态栏，也不是左侧侧边栏的树。

**改法**：
- 下拉里的每一行从「一个 `<AxMenuItem>` + 一个 `aria-hidden` 的 span 当按钮」改成
  **两个真按钮**：`canvas-row-main`（切画布）+ `canvas-row-more`（开操作菜单）。
  一个按钮里套一个可点的 span 会撞读屏（ui-style-guide §5 第 2 条），也是一个动作两种语义。
- 行尾那一格同时放 `Check`（勾）与 `MoreHorizontal`（三个点），靠 CSS 与行 hover 换显：
  选中行常显勾 → hover 该行时勾 `opacity:0`、三个点 `opacity:1`；未选中的行平时不显三个点，
  hover 行（或键盘聚焦按钮）才现。动效只动 `opacity`（§2.7 硬性）且带 reduced-motion 降级。
- 点三个点 → **画布操作菜单**。它走 `AxDropdown` 的「鼠标点锚点」（`openAtPoint`，与行右键菜单
  同一套机制）弹出，锚点挂 body 下、不依赖行 DOM；并且它是列表的**子浮层**（`nestedIn`）——
  **列表留着不消失**，两个菜单并排（详见上面 2026-10-09 二续那条）。

**四个动作都是真实现**（此前点行尾三个点只弹一句「… 更多操作」的 toast，而 toast 早已停用 = 点了没反应）：
- **在新窗口打开** → 先 `flushCanvasSave()` 把当前画布写完，再 `window.open('#/canvas/<id>')`
  （不先落盘的话，新标签读到的是旧数据）。
- **重命名画布** → `window.prompt` 取名字（与项目页新建/改名同一口径）→ `PATCH /api/canvases/:id/meta`。
- **复制画布** → 新口 `POST /api/canvases/:id/duplicate`（cloud-server `CanvasStore.copyInto`）：
  拷节点 + 边 + 资源字节 + 生成历史，并**把资源地址里的画布 id 换成新的**（不换的话副本里的图
  全指回原画布，原画布一删全裂）；**视口不带走**（复制内容不复制「我当时看到哪儿」，设计文档已定）；
  名字默认「原名字 副本」，重名递增。
- **删除画布** → `DELETE /api/canvases/:id`。两条护栏：只有一张时不给删；删的正是当前这张时，
  先落盘、删完**跳到剩下清单里的第一张**（否则停在已不存在的 hash 上白屏）。

**顺带修掉的隐患**：下拉的行数据从「只传名字数组」改成「传 `{id,label,deletable}`」——
原来宿主用 `canvasOptions.find(c => c.label === $event)` **按名字反查 id**，两张画布重名时
会切错（而且行尾动作拿到的也只是名字，没法按 id 操作）。`deletable` 由宿主算（内置 `default` 画布
后端不许删，菜单里就不给「删除画布」）。

**验证**：cloud-server **511**（新增 2 条：复制画布（新 id/名字/_节点边拷过去/资源地址换新画布 id_/
视口不带走/重名递增）+ 复制不存在的画布 404）；ui **212**（新增 `canvasChipMenu.test.ts` 11 条结构守卫：
两个真按钮 / 勾与三个点都在 / 常显勾 + hover 换点 + 未选中行 hover 才显 + reduced-motion /
动效只动 opacity / 四项条目 + 删除是危险项 / 走鼠标点锚点 + 先收列表 / 两宿主都换成 id+名字 /
两宿主都接真动作（无 `@more-canvas` 占位）/ 四个动作在 ui.ts 有真实现 / 只有一张不给删）
+ `vue-tsc` 干净 + `vite build` 通过；产物重建（ui dist + cloud-server dist，8865 重启）。
**真机（Chrome MCP，8865 真产物，`packages/ui/e2e/canvas-chip-menu-check.mjs` 12/12 通过）**：
① 选中行勾 `opacity=1`、三点 `0`；② hover 该行 → 勾 `0`、三点 `1`；③ 点三点弹出四项菜单；
④ 复制 → 画布 4→5 且副本节点数与原图一致、`view=null`（视口没带走）；重命名 → 后端名字真变了；
新窗口打开 → 真开新标签页且地址就是该画布；删除 → 5→4 且 hash 自动跳到剩下那张。
**守卫有效性自查**：把「hover 时勾让位」那条 CSS 删掉再跑 → 守卫当场红（已试过并还原）。
验证痕迹已清（副本与实验画布都删干净）。

### 追记（2026-10-09，修分组行右键菜单定位偏移（AxDropdown 锚点的包含块 bug））

用户口径（附截图）：「分组右键菜单的定位错了，普通的资源右键菜单都是正确的」——
右键「分组 2」，菜单却飘到抽屉右侧与画布交界处；宫格里的普通资源右键是贴着鼠标的。

**量化取证（真机，右键后量鼠标点 vs 菜单左上角）**：
- 宫格卡片：鼠标 (76,293) → 菜单 (76,293)，delta (0,0) ✓
- 分组行：鼠标 (28,168) → 菜单 **(282,324)**（x 偏了 +254）✗
- 列表行：鼠标 (28,256) → 菜单 **(282,500)** ✗

**根因（CSS 包含块规则，通用缺陷）**：右键锚点用 `position: fixed; left/top = 鼠标视口坐标`
表达落点，但它**挂在 `.axd-root` 里**（浮层组件的行内容器）。CSS 规定：
**任何非 none 的 transform / translate / filter 等，都会给后代创建「包含块」，
后代 fixed 元素改以那个祖先为定位基准**。画布树的分组行 / 列表行，操作条容器正是用
`-translate-y-1/2` 做垂直居中（Tailwind 编译成 CSS `translate: 0px -50%`，
不是 `transform`，所以第一轮查 `transform` 全是 none 差点漏掉）——锚点被关进这个基准里，
`left: 28px` 就成了「相对操作条左边 28px」，整块菜单被推到 x=282。
宫格卡片的操作条**没有** translate，锚点的基准还是视口，所以落点精确。
这正是用户看到的「分组错了、普通资源都对」。

**为什么修在 AxDropdown 而不是挪那两个容器**：这是组件层的**通用缺陷** —— 任何调用方
只要行容器带 translate/transform（资产树的行也带，只是恰好在抽屉里的偏移小到没被注意），
右键锚点就会被顶偏。把「挪操作条」当修法等于要求每个调用方记住这条隐含约束；
把锚点送回视口坐标系才是根治。

**修法（一行搬家 + 注释写明为什么）**：`AxDropdown.vue` 里把右键坐标锚点
（`<span ref="contextAnchor">`）从 `.axd-root` 里**移进 `<Teleport>` 内**，与菜单面板一样
挂在 body 下 —— body 没有带 transform 的祖先，`left/top` 恢复成真正的视口坐标，
锚点与菜单面板（同样 teleport 到 body）回到同一坐标系，floating-ui 的数学重新自洽。
锚点的渲染条件、`openAtPoint` 的调用方式、互斥/点外关闭全部不变。

**验证**：真机实测四类行 —— 宫格卡片 / 分组行 ×2 / 列表行，右键菜单 delta 全部 **(0,0)**
（修前分组行偏 254px）；截图确认「分组 2」右键菜单贴着鼠标弹出。
ui **201**（新增 2 条结构守卫：① 锚点必须在 `<Teleport>` 内、触发器在 Teleport 外；
② 锚点样式必须是 `position: 'fixed'` —— 这条改成 absolute 时上面的包含块论证就不成立）
+ vue-tsc 干净；产物重建（ui dist，8865 直接生效）。
**守卫有效性自查**：把锚点移回 `.axd-root` 再跑 → 守卫当场红（已试过并还原）。

插曲：验证时发现 8865 服务已被停掉（`.serve.log` 是旧进程残留），用 `pnpm serve` 重启后继续。

### 追记（2026-10-08 九续，画布树右键菜单 + 行菜单外壳与资产树共用）

用户口径（两条）：①「当前在左侧边栏的资产面板中，这些文件夹和资源都支持右键菜单。现在希望画布
这边也支持右键菜单 —— 因为当前这里只有在 hover 点击后面的按钮时，显示的那个按钮才可以触发」；
②「你的画布和资产里的树结构可以使用同一套组件，只不过画布支持两种展示模式（宫格和列表）。
我希望你可以把这部分抽象成一个组件……你先进行分析，看有没有必要抽象，看当前是个什么结构」。

**分析结论（先查结构再动手）**：两边的**行 UI 同源**（图标/缩略图 + 名字 + hover 操作条 +
内联改名 + 缩进），但**内容不同源** —— 资产行背后是后端文件夹/资产实体（路径 / 标签 / 图标 /
移动），画布行是画布节点（分组父子 / 缩略图 / 双模式）。硬塞成一个组件要靠大量 if 分支，反而更难维护。
真正**重复且画布侧缺失**的是三件机制：① 行尾「⋯」+ 下拉；② **行右键打开同一份菜单**；
③ 那个「按行 id 登记 openAt、右键转交鼠标点锚点」的接线。资产侧这套此前**写死在 AssetTree.vue 里**，
画布要再抄一遍就会长成第二份实现（本项目历史上缩略图/预览/菜单动作都各漂移过）。

**改法（抽象边界：外壳共用、条目各写）**：
1. 新增 `components/RowMenuShell.vue` —— **共用外壳**：AxDropdown 浮层 +「⋯」触发器 +
   `openAt(x,y)`（转交 AxDropdown 的「鼠标点锚点」，翻转/防溢出/互斥/点外关闭全照旧）。
   职责边界写进文件头：**本组件管机制，菜单条目由调用方给默认插槽**；
2. 新增 `components/CanvasRowMenu.vue` —— 画布行的菜单内容（外层用 RowMenuShell），
   分组行：定位 / 重命名 / **解散分组** / 删除；节点行：定位 / 重命名 / **复制一份** /
   **添加到 Agent** / 删除。**只 emit、不做动作**（动作要读画布数据，属宿主活；与 AssetRowMenu 同一分工）；
3. `LeftDrawer` 的画布树三类行（**列表行 / 宫格卡片 / 分组行**）都挂 `@contextmenu`，
   走 `canvasMenuRefs` 登记表 → `openCanvasMenu` 按行 id 取实例、在鼠标点打开 —— 与资产树同一套接线。

**顺带把画布菜单做成真功能（此前大半是占位）**：旧代码的「删除 / 复制」是
`ui.showToast('已删除 ' + name)` 这种**假动作**（而且 toast 早已停用，等于点了没反应）。
现在 ui.ts 新增四条真实现，全部走既有唯一入口、不重复实现逻辑：
- `removeNode(id)` → `doc.removeNodes`（级联清边 / 清子父引用 / 清选中 + 进历史 + 落盘）；
- `duplicateNode(id)` → 先 `selection.set([id])` 再执行 `clipboard:duplicate`（复制语义就是「复制选中集」，
  命令不带节点参数，见 plugin-clipboard 的 duplicate()）；
- `referenceNodeToAgent(id)` → 执行 agent 插件既有的 `agent:reference-node` 命令（节点右键菜单同款）；
- `ungroupNode(id)` → `group` 服务 `ungroup`（它自己包历史 + 还原子节点绝对坐标），插件没装时给明确提示。

**验证**：真机实测（真 Chromium）：
- 列表模式右键节点行 → 菜单「定位到节点 / 重命名 / 复制一份 / 添加到 Agent / 删除」；
- 列表模式右键**分组行** → 「定位到节点 / 重命名 / **解散分组** / 删除」（条目按行类型分流）；
- **宫格模式**右键卡片 → 同节点行菜单（双模式都接上了）；
- 真功能抽验：点「重命名」→ 出现**行内输入框**（`input[data-canvas-rename]`，预填当前名、已聚焦，
  不是浏览器弹框）；点「复制一份」→ 画布节点数 **23 → 24**（复制真生效，验完已删回 23）。
- 测试：ui **199**（新增 6 条结构守卫：三类行都挂右键 / 画布行用 CanvasRowMenu 且登记进 openAt 表 /
  外壳只声明一处浮层并暴露 openAt / 菜单只 emit 不 import 服务 / 分组与节点条目分流 / 动作是真实现而非占位 toast）
  + vue-tsc 干净；产物重建（ui dist，8865 直接生效）。
**守卫有效性自查**：把三类行的 `@contextmenu` 全删掉再跑 → 守卫当场红（已试过并还原）。

**清场**：验证中复制出来的那个节点已删除，画布回到 23 节点 0 悬挂、无测试残留。

### 追记（2026-10-08 十续，多选上控制栏注册「引用到 Agent」按钮）

用户口径（原话）：「向主节点的顶部控制栏注册一个按钮，该按钮的功能就是'添加到 Agent 效果'，
以及右键菜单中的'引用 Agent'效果是一样的」；并指定参考两处现有实现：
① 顶部状态栏的「加入资产库」怎么注册；② 右键菜单「引用到 Agent」怎么执行。

**两条参考（都已核对）**：
- 「加入资产库」= **注册式接缝**：`packages/ui/src/assetUploadPlugin.ts` 用
  `ctx.selectionRegion.attach({ region:'out:top', component, needs })` 往多选框顶栏挂一条，
  多选插件一行不改。节点卡片顶栏有同形的 `ctx.nodes.attach(type|'*', { region:'out:top' })`。
- 「引用到 Agent」= agentPlugin 注册的命令 `agent:reference-node`（`areas:['node']`）：
  `service.requestNodeRef(nodeId)` + `service.show()`，输入框组件消费后插成节点标签。

**做了什么**（`packages/plugins/plugin-agent`，**挂在多选框上控制栏**，与「加入资产库」同一条接缝）：
- 新 `components/AgentRefToolbar.vue`：与「加入资产库」（`SelectionSaveAssetsToolbar`）同形 ——
  只放按钮本身、不自套 `.ntp-root`（整排一块背景由宿主 `.selection-frame-slot` 给）；
  `useCapability('selection')` 读选中集（needs 由 attach 声明），目录缺 button 件回退原生按钮。
- 点它 = 把**整批选中节点**一起引用：执行与右键菜单**同一条命令** `agent:reference-node`
  （payload `{ nodeIds }`；右键那条传 `{ nodeId }`，命令内部归一成一批），一次插 N 个节点标签。
- 新 `agentCommands.ts`：命令 id 常量单独一份（注册处与按钮处共用，避免 ESM 环里读未求值常量）。
- `agentPlugin.apply` 里 `ctx.selectionRegion.attach({ region:'out:top', id:'agent-refer-selection',
  order:30, needs:['selection'] })`（多选插件零改动）。
- 服务 `pendingNodeRef` 改 `pendingNodeRefs: string[]`（`requestNodeRefs` / `clearNodeRefs`）：
  右键（1 个）与多选栏（N 个）共用同一份状态、同一条消费链；`AgentConversation` 消费改逐个插。
- `canvas-render` 导出 `CAPABILITY_BAG_KEY / CAPABILITY_SCOPE_KEY`（测试模拟区域宿主要同一对象身份）。

**验证**：plugin-agent **215**（新增 `agentRefToolbar.test.ts` 13 条：真内核查 `selection/region`
的 out:top 落点 + needs、命令注册；现场编译 SFC + 内存渲染器真点击（整批 payload `{nodeIds}`）；
禁用 / 缺 command / 缺 button 三种降级；源码守卫 3 条）+ tsc 干净；ui **201** + vue-tsc 干净；
canvas-render **418**、group **57**、multi-select **153** 全绿；ui dist 重建。
**真机（Chrome MCP，8865 真产物）**：选「图片 6」「图片 7」→ 多选框顶栏出现「引用到 Agent」
（与 打组 / 加入资产库 同排、同一块 `rgb(33,33,33)` 面板、按钮本体透明）；
点它 → Agent 面板打开、输入框**同时**出现「图片 6」「图片 7」两个标签；
验证痕迹已清（画布 22 节点不变、面板关、选中空）。

### 追记（2026-10-08 九续，修「等验证码时 cloud-server 提前判失败」—— 中间态被当终态）

用户口径（原话）：「我在节点中操作发送请求…当我在浏览器中操作验证码时，它这边就已经操作完成了。
在浏览器画布中，任务直接显示完成，并返回了报错信息。然而这个任务并没有真实完成，它还有第二次重试…
你在第一个任务中断之后，就直接把任务给结束掉了。也就是说，你的后台判断逻辑有问题」
（并给了 web2api 日志链接，任务 `c2632f08`）

**日志证据（真实轨迹）**：
```
18:54:20  pending → processing（attempt #1）
18:54:42  验证码 2007 → paused          ← 非终态：在等用户手动过验证码
18:54:43  cloud-server 轮询看到 paused → 立刻判失败收工   ← BUG
18:55:11  验证码消失 → captcha-watcher 自动恢复 → attempt #2
18:56:35  completed 100%                 ← 真实成功，但 cloud-server 早就撒手了
```

**根因**：`cloud-server` 的 `toPollResult`（providers/web2api/index.ts）把 web2api 的 **中间态当成了终态** ——
`paused` 与 `interrupted` 一律返回 `status:'error'`。而按 web2api 的状态机（`types/task.ts`），
**只有 completed / failed / cancelled 是真终态**；`paused`（等验证码/风控，captcha-watcher 会自动恢复）、
`retrying`（退避等待重试）、`polling_failed`（可手动恢复）、`pending`（换号后重排）都还在自己往前走。
（用户猜测的「换号时把状态调成 100%」经核对不成立：web2api 里 progress=100 只出现在 `completed` 那条 SQL；
真凶就是 cloud-server 把 paused 判死了。前端插件 `plugin-web2api-tools` 的 `isTaskStalled` 有同一份错判，一并修。）

**修法**：
- `toPollResult`：只有 completed/failed/cancelled 收敛；其余状态统统 `running`（继续轮询）。
- 新增 `ProviderPollResult.waiting` 标记「等外部条件」的中间态（paused / retrying / pending）；
  `taskManager.run` 把这些拍的耗时从 `pollTimeoutMs` 预算里**扣掉** —— 人过验证码要多久不由程序决定，
  拿它顶超时预算就会把人还在操作的任务判超时（普通生成中的等待不在此列，仍正常计时）。
- `plugin-web2api-tools`：`isTaskStalled` 只剩 `polling_failed`；`paused` 落进 running 分支
  （界面继续转 + 显示暂停原因），不再收工。

**验证**：cloud-server **506**（新增 `providerPollMidStates.test.ts` 8 条 + taskManager 等待不占预算 1 条）、
plugin-web2api-tools **61**（paused 用例翻转为「继续 running」）、plugin-agent **214**、cloud-client **133** 全绿；
四包 typecheck 干净；cloud-server dist 与插件 dist 重建、8865 重启。
真机：用真实 web2api 任务复核 —— 日志里的 `c2632f08`（曾 paused、最终成功）现在判 `done` + 1 个产物；
真失败任务判 `error`（「无可用账号」）、真取消判 `error`。另用注入的假响应逐态验证：
paused/retrying/pending → `running`+waiting、polling_failed/processing → `running`、completed → done、failed → error。

**配套修复：超时误杀长任务（用户追问「生成视频可能超过 10-20 分钟，5 分钟超时怎么办」）**：

排查：后台默认超时 5 分钟（`DEFAULT_TIMEOUT`），而 **web2api 的全部动作都没有声明 `pollTimeoutMs`**，
全部落默认 —— 实测一次成功生图 136s，视频更长（网页自动化 + 可能等验证码/换号退避），5 分钟必误杀。
（用户问的「超时怎么算」已随上一条修复澄清：**等验证码/换号退避的 `waiting` 态不占预算**；
这里补的是普通生成中那段的上限。）

**修法**：`presets.ts` 给全部 11 个动作按类型显式声明轮询节奏与超时 ——
图片（网页自动化）**10 分钟**、视频（网页自动化）**30 分钟**、视频（接口式）**45 分钟**、音频 **10 分钟**；
视频取 30/45 分钟的依据：web2api 那条直连链路的插件本来就用 30 分钟（设置项 `web2apiTimeoutMs` 默认值），
且 web2api 自己的任务超时是 20 分钟、轮询超时默认 24h —— 上游没死我们就不该先放弃。
新增守卫测试：全部动作必须显式声明节奏与超时，且视频 ≥ 30 分钟（防止再有人加动作时漏配）。

验证：cloud-server **507** 全绿 + typecheck 干净；产物重建、8865 重启（health ok）。


### 追记（2026-10-08 八续，彻底移除 `res:` —— 用户口径「不做兼容，请修复」）

用户口径（原话）：「不做兼容 请修复」。即在七续「统一写 URL」的基础上，把**读取侧对 `res:` 的兼容分支一并删掉**，
让 `res:` 从项目里彻底消失（不留 @deprecated 的兼容路径）。

**删除清单**：
- cloud-server：`RESOURCE_REF_PREFIX` / `toResourceRef` / `isResourceRef` / `parseResourceRef` 全删（连同 index.ts 导出）；
  `resourceResolver` 去掉 `res:` 分支（现在只认画布资源 URL 与资产 URL）；`SavedResource.ref` 改名 `url`；
  `saveResource` 返回体去掉 `ref`（只留 `url`）；HTTP 上传路由返回也从 `{ref}` 改成 `{url}`；相关注释全清。
- plugin-cloud-client：`resourceRef.ts` 只剩 `pendingUploadFields`（data:/blob: 判定）；`expandNodes`/`shrinkNodes`/`resolveRef`/`toRef`
  /`isResourceRef`/`parseResourceRef`/`RESOURCE_REF_PREFIX` 全删；`canvasDiffAdapter` 去掉 `expandAll`；
  `cloudResourceAdapter.resolveResource` 只做「URL 原样、其它 undefined」；`api.uploadResource` 返回 `{hashName, url}`。
- plugin-agent `toolViews.ts`：`resName` 不再剥前缀、`toDisplayUrl` 去掉 `res:` 分支。
- ui `canvasTree.ts`：缩略图/视频地址不再过滤 `res:`。
- 测试同步：删掉所有 `res:` 兼容用例（resourceRef / canvasDiffAdapter / cloudResourceAdapter / resourceResolver /
  routes / canvasDoc / toolViews / canvasTree 等），保留并改写为 URL 契约。

**迁移与真机**：脚本 `migrate-res-to-url.mjs` 再跑一次（旧标签页曾把 `res:` 写回磁盘 12 处 —— 旧页面跑的是旧插件代码；
**关掉那些旧标签页后重跑即净**）。真机（Chrome MCP，430 画布）：23 节点 / **14 张图全部加载、0 裂图**；
`canvas_get` 与 `resource_list` 返回的媒体字段全是 `/api/canvases/<id>/resources/<hash>`；磁盘 `canvas.json` 里 `res:` 计数 **0**。

**验证**：六个包全绿 —— cloud-server **491**、plugin-cloud-client **133**、plugin-web2api-tools **61**、
plugin-agent **196**、ui **193**、canvas-data **372**（各包 typecheck 干净）。产物重建：cloud-server dist、ui dist、
以及两个**外部插件** dist（plugin-cloud-client / plugin-web2api-tools —— 它们各自有 dist，必须单独构建，
否则浏览器里跑的还是旧代码）；8865 已重启。

**注意（运维）**：升级后要**刷新/关闭旧标签页** —— 旧页面内存里是旧插件代码，会把 `res:` 写回磁盘
（本次实测被写回 12 处）。刷新后即按新契约运行。

### 追记（2026-10-08 七续，全项目统一 URL：去掉 `res:` + 修 web2api 插件直连漏网路径）

用户口径（原话）：「短引用 这个是在什么地方引用的呀？能不能统一改成画部门牌或者资产门牌的那种形式，
统一使用这个 URL？然后统一转为本地路径 二进制直接发送接口？我记得之前还让你做了一个上传接口，
可以先上传他这里的图片然后通过 id 进行创建任务？D:\Code\Git\web2api 最近 commit 不是写了吗？
怎么又绕回原点了，请重新检查整个项目 我的项目中统一使用url， 不使用你说的这个res:xxxx」

**排查结论（先讲清为什么之前会「绕回原点」）**：`res:` 只有两个写入点，都在存盘侧：
① 前端保存画布时压缩（`canvasDiffAdapter` 的 `shrinkAll`）；② MCP 的 `canvas_add_image` 直写。
读取时立刻展开成 `/api/canvases/<id>/resources/<hash>` 再交给渲染，所以界面一直在用 URL。
用户报的「图片不存在」此前修的是**服务端那条链路**（底栏 `/api/jobs`）；而 16:22 那条裸地址
（日志 `referenceImages:["/api/assets/files/ec96...jpeg"]`）是**浏览器里直连 8033 的
`plugin-web2api-tools`** 发的 —— 它绕过服务端、把节点里的相对地址原样塞进 `referenceImages`，
web2api 当自己 uploads 下的相对文件找 → 4002。这是漏网的第二条路，本次一并修掉。

**改动（三路并行 + 集成）**：
- **写入侧统一 URL（cloud-server）**：新增 `toResourceUrl(canvasId, hashName)`；`saveResource` 返回的
  `ref` 改成 URL（与 `url` 同值）；`canvas_add_image` 写 `imageUrl: stored.url`；`resource_upload` 描述
  与 `resource_list` 兜底同步。`parseResourceRef` 等读取兼容函数保留并标 `@deprecated`（只为读老数据）。
- **写入侧统一 URL（前端）**：`cloudResourceAdapter.putResource` 回 URL；`canvasDiffAdapter.set` 删掉
  `shrinkAll`（存盘不再压缩）；`resolveResource` 改成幂等（`res:` 展开、URL 原样）；`shrinkNodes` 删除；
  `migrateLocalResources` 的「已上传」判断扩成「`res:` 或本画布 URL」，避免首次上云重复上传。
- **web2api 插件直连路径（漏网修复）**：新增 `mcpClient.uploadResource`（调 `system/upload-resource` 拿
  `referenceUrl`）与 `referencePrep.prepareReferenceImages`（下单前把 data:/blob:/本站相对地址取字节 →
  上传 → 换成 web2api 的 `/<hash>.ext`；外链原样；失败只丢那一项并告警）；`presetRun` 在拼参数前先整理。
- **数据迁移**：新增 `packages/cloud-server/scripts/migrate-res-to-url.mjs`（`--dry-run` / `--dir`，
  写盘前另存 `canvas.json.bak-<时间戳>`，写后自动复查）。已对真实数据跑过：两次共转 43 个字段，
  复查 0 残留；备份 3 份留在画布目录。

**验证**：cloud-server **493**、plugin-cloud-client **143**、plugin-web2api-tools **61**、
canvas-data **372** 全绿（四个包 typecheck 干净）；ui 产物与 cloud-server dist 重建、8865 重启。
真机（Chrome MCP，430 画布）：23 节点 / 14 张图**全部加载、0 裂图**；磁盘 `canvas.json` 里 `res:` 计数 **0**、
媒体字段全是 `/api/canvases/<id>/resources/<hash>`。
**决定性验收**：在真机上用「图片 21」（资产地址形态的节点）建一个测试节点连上它、下单 ——
web2api 日志里 `referenceImages:["/ec96ba44...png"]`（**它自己的上传地址**），任务失败原因只是
「无可用账号（Cookie 已失效）」，**不再出现「图片不存在」**。测试节点已删、画布还原。

**注**：迁移前打开的旧标签页内存里是旧数据，会把 `res:` 写回磁盘（实测被写回 12 个）——
重跑一次迁移即清干净；刷新页面后不会再发生。web2api 那边的账号 Cookie 过期与本项目无关，
参考图这一环已彻底打通。

### 追记（2026-10-08 八续，左侧画布树：分组统一排在普通资源前面）

用户口径（附截图）：「在左侧画布中，我希望你的这个分组可以显示在最上面，下面再显示一些普通资源。
这种分组类似于文件夹，统一显示在最上面」。

**改前实况**：树的顺序 = 画布节点的原始顺序（按创建/落盘次序），分组夹在图片中间
（真机取证：顶层 15 个根节点里，分组 1 在第 6 位、分组 3 / 分组 6 垫底）。

**改法**（`canvasTree.buildCanvasTree`）：分层稳定排序 —— **分组在前、普通节点在后**。
选在数据层而非渲染层，是因为树的**每一层**都要这个效果：顶层分组提前，分组里的子分组同样提前
（否则「分组 2 排在图片 3 下面」还是刺眼）。`toTree` 对孩子递归调用同一个 groupsFirst，
一次覆盖所有层。

判据用 `isGroupLike`（type === 'group' 或 data.nodeType === 'group'，与会话里图标映射/分组能力
同一套认法），**刻意不**用「有没有 children」判 —— 那会把「只挂了一个孩子的普通节点」也算成分组。

**两条刻意保住的性质**：
1. **组内相对顺序 / 普通节点之间的相对顺序原样**（Array.sort 稳定）—— 画布顺序才是用户
   能感知、能靠拖拽调整的那个顺序，不引入第二套排序键；
2. 全是分组 / 全是普通节点时直接返回原数组（省一次拷贝，顺序本来就无关）。

**验证**：ui **194**（新增 5 条：顶层分组提前 / 组内子分组也提前 / 相对顺序不变（稳定排序）/
已排好时不折腾 / 渲染层包成 custom 时靠 data.nodeType 仍然认）+ vue-tsc 干净；产物重建。
真机实测（真 Chromium，该画布 3 个顶层分组 + 1 个嵌套分组）：左侧树读作
「分组 1 → 分组 2（缩进 24px）→ 其资源 → 分组 1 的直属资源 → 分组 3 → … → 分组 6 → … →
所有普通资源（缩进 0）」—— 分组全部置顶，普通资源统一在下面，嵌套层级与缩进不受影响。

### 追记（2026-10-08 七续，分组「背景颜色」触发器塌成一个点）

用户口径（附截图）：「这个调色卡片应该修复一下，它变成了一个点，怎么可能会是一个点呢？你看下面
展开的这个下拉菜单里面都是很正常的。优化这里的 UI —— 这个背景颜色，你可以写一个背景，
左侧可以设置一个与圆块稍微小一点的小圆块就行了」。

**根因（真 bug，量出来的）**：触发器里的色点是 `<span>`，而 **inline 元素会忽略 width/height** ——
样式里写了 `width: 16px; height: 16px` 却没写 `display`，于是真机量到色点 **0×0**，
屏幕上只剩 `box-shadow` 那圈 1px 描边，看着就是「一个点」。
真机取证：按钮 24×32、色点 `getBoundingClientRect()` = 0×0（计算样式却写着 16px）。
（色板本身正常：展开后的圆块是 `<button>`，button 是 inline-block，尺寸生效 —— 这正是用户说的
「下面的下拉菜单里都是很正常的」。）

**改法（按用户口径：小圆点 + 文字）**：
1. 色点补 `display: block`（**这一行是修 bug 的关键**，不是装饰；注释里写明了原因，免得后人再删）；
2. 尺寸 16 → **18px**：「比你那个圆块稍微小一点」（色板圆块是 26px）；
3. 触发器从「纯图标」改成「圆点 + 文字」的文本按钮：左侧小圆点当当前底色的预览，右侧写「背景颜色」
（与 `aria-label` 同名，读屏念得出；可见标签 + 无障碍名一致）。

**验证**：真机实测（真 Chromium）：按钮 **72×32**、色点 **18×18**（`display: block`、底色跟随节点），
文字「背景颜色」正常渲染；截图确认工具条读作「● 背景颜色 · 解散分组」。
plugin-group **57**（新增 1 条：触发器必须是「圆点+文字」且色点有成对的 `display`+尺寸、
尺寸小于色板的 26px）+ tsc 干净；ui **189** 全绿；产物重建（plugin-group UMD + ui dist，8865 生效）。
**守卫有效性自查**：把 `display: block` 删掉再跑 → 新用例当场红（已试过并还原）。

### 追记（2026-10-08 七续，Agent 队列 / 引导插队 / 后台对话 / 目标模式）

用户口径（设计文档 `docs/superpowers/specs/2026-10-08-agent-queue-and-goal-design.md`，
实施计划 `docs/superpowers/plans/2026-10-08-agent-queue-and-goal.md`）：
① 跑着的时候再发消息不该被丢弃 ⇒ 进队列；② 输入框上方要有队列列表（贴框、宽 80%、行内引导/删除/⋯）；
③ 队列里编辑过的消息**保持原位置**；④「引导」= 表面上像直接发送、实际插队到下一次请求；
⑤ 刷新不打断正在跑的那一轮（设置里「后台对话」开关，默认开）；⑥ 目标模式（+ 菜单 → 目标 → 标签 →
点标签改预算）；⑦ 目标可暂停/启动；⑧ 通知接通（每轮一条 + 队列跑完一条）；⑨ 不许一条消息发两遍。

**做了什么（一句话一条）**：

- **后台对话**：新 `SessionHub`（每会话常驻事件通道，带 seq 与"已落转录"水位）——
  一轮在后台跑到底，HTTP 只订阅；刷新断开只是少一个订阅者。新增
  `GET .../stream?since=N` 重连端点。旧行为保留（没注入 hub 时照旧跑在响应里）。
- **队列**：队列存进**会话文件**（`sessions/<id>.json` 的 `queue` 字段，随会话/画布走）；
  `QueueScheduler` 是唯一裁判（单裁判 + 原子认领 + 失败对账三条纪律，"不发两遍"的地基）。
  API：`POST .../queue`（add/update/remove/close/cancel-edit/edit/pause/resume）、
  `POST .../queue/:itemId/steer`（引导）。
- **引导修洞**：旧版 steer 分支不写转录（刷新后消息消失）；现在补写（带 `steered` 标记），
  且"轮刚好结束"时条目**退回队列**（不丢、不重复）。
- **目标**：装 `@penguinharness/goal` 的 hook 包（manifest 原样，只补 `trigger:"host"` 保险）；
  预算改 GOAL.json（下一轮生效）；**暂停 = 把 GOAL.json 改名挪走**（官方循环到边界自然停住，
  不打断当前轮、不重写任何轮次逻辑）；启动 = 放回 + 踢一脚；暂停态守住"文件复活"。
- **前端**：队列列表（贴输入框上缘、宽 80%、右列上下两个按钮：回到底部 + 暂停/启动）、
  发送键三态（有内容⇒发送 / 空+跑着⇒终止 / 空+空闲⇒禁用）、`+` 菜单两项（目标 / 上传文件）、
  目标标签与编辑框、通知（round_done / queue_idle）。
- **设置**：全局设置弹窗（协作模式那一组）新增「后台对话」开关（默认开）+「目标设置」（默认预算）；
  死掉的两个通知开关接真（存 KV）。

**验证**：cloud-server **484** 全绿 + tsc 干净；plugin-agent **197** 全绿 + tsc 干净；
ui **189** 全绿 + vue-tsc 干净。端到端探针 `packages/cloud-server/e2e/queue-goal-probe.mjs`
（真服务 + 真磁盘）**ALL PASS**；真机（Chrome MCP）验过 + 菜单两项、点目标不弹框、
点标签才弹编辑框、发送键初始态、回到底部搬位。

**留下的**：队列事件缓冲上限的具体数值（暂定 2000 条 / 500KB）；通知点击行为（暂定聚焦会话）。

### 追记（2026-10-08 六续，分组上控制栏两修：解散分组点不动 / 色板宽度不够）

用户口径（两条）：①「解散分组点击有时候没有生效」；②「分组颜色的卡片不太对，宽度不够」。

**① 解散分组点不动（真 bug，根因是取服务的写法）**：
组件里写的是 `ctx.group?.ungroup(id)`。`useCanvasRender()` 递进组件的 `ctx` 是**根 Context**，
而 `ctx.<服务名>` 这种直访是靠「每个插件自己 scope 上的 Proxy」实现的
（kernel `Context.ts` 的 `new Proxy`：属性读命中已上架服务名才转发）—— 根 Context 没有那层代理，
`ctx.group` **恒为 undefined**；可选链 `?.` 再把它吞成静默 no-op：按钮点得动、什么也不发生。
真机取证：`ctx.group` → undefined，`ctx.get('group')` → 对象，合成 click 后节点父子关系原样。
改法：把「从服务表取分组服务」抽成纯函数 `groupServiceOf(ctx)`（只认 `tryGet`/`get`，形状不对给
undefined 不抛），组件一行调用它；同仓其它节点工具栏组件本来就走 get/tryGet，这里对齐。
真机实测（真鼠标点）：临时建的两节点组 **组节点消失、两个孩子回到顶层且父子引用清空**。

**② 色板宽度不够（真 bug，量出来的）**：老实现 `menu-width="112px"`，而网格实际需要
4 列 × 22 + 3 间隙 × 6 + 两侧内边距 8×2 = **122px** —— 网格比面板内宽还大，
被 `overflow-x: hidden` 把边缘裁掉；加上 7 个色块 4+3 的排布贴着左缘，右下角看着就是缺一块。
改法：面板最小宽 112 → **152px**，色块 22 → **26px**（也不到「交互目标 ≥24px」的舒适档时偏小），
网格 `justify-content: center` 居中 —— 第二行 3 个落在中段，与第一行 4 个形成对称。
真机实测：面板 152×88、网格 138×74、左右各留 7px **对称且无横向裁切**（scrollWidth == clientWidth），
点绿色仍正常写入 `data.backgroundColor`。

**验证**：plugin-group **56**（新增 3 条：`groupServiceOf` 纯函数 6 断言 / 组件不再用 `ctx.group`
直属性的源码守卫（先剥注释再查，避免解释这条约束的注释自己踩中）/ 色板宽度与居中的结构断言）
+ tsc 干净；ui **172** + vue-tsc 干净；两处产物重建（plugin-group UMD + ui dist，8865 直接生效）。
**守卫有效性自查**：把组件改回 `ctx.group?.ungroup(...)` 跑测试 → 源码守卫当场红（已试过再还原）。
分工说明：本包 vitest 是 node 环境（无 jsdom），.vue 挂不到真 DOM 上（同仓 plugin-agent 为此要现场
编译 SFC），所以「点下去真的调到服务」这条用「纯函数 + 源码守卫」两层盯，行为面由上面的真机实测兜底。

**清场**：验证用的临时分组与节点已全部删除，画布回到 22 节点 0 悬挂；验证时改过的分组底色已还原。

### 追记（2026-10-08 六续，Agent 工具卡紧凑化定稿：B 卡片 + C 资源列表 + 底部详情块）

用户口径（先出 demo 挑选，定稿后原话）：「我选择 B，但是你的这个资源列表我选择 C」；
「卡片下面都有一个详情的折叠按钮 … 你这个工具默认工具执行的时候，hover 的时候它没有这个背景条」；
随后纠正两处：「不是给你说了不要这个背景吗？你 hover 的时候是没有任何效果的」
「我让你添加的详情不是这样的，是在下面添加一个详情的折叠块 … 折叠里面需要显示工具名称、输入、输出，
不要有任何省略，即使输入没有也不做省略」。

**过程**：先做 demo 页（`docs/tmp/tool-card-demo.html` → `-v2` → `-v3`），四套方案对照
（A 单行极简 / B 紧凑两行 / C 媒体条 / D 当前线上），数值按真机复刻（400px 面板 / #212121 底 /
28px 圆角 / 344px 卡片 / veil 底 / #363636 线）；用户选定 **B 卡片 + C 的资源列表**，
并要求悬停**不加任何背景**（只让折叠箭头变亮）、详情是**卡片下方的折叠块**（工具名称/输入/输出，不省略）。

**实现**（`plugin-agent/src/toolViews.ts` 数据层 + `components/ToolViewBody.vue` 渲染层 +
`components/AgentConversation.vue` 宿主壳）：
- 卡片 = **紧凑两行**：头行 = 图标 + 人话标题 + 标记（靠右）；内容行 = 一行
  （缩略图条 / 媒体行 / 胶囊 / 进度条 / 提示）。**删掉**大数字瓦片（`stats` 块类型取消，
  概览/批量改成计数胶囊「4 新增」）；媒体类改 `media` 单行（40px 缩略图 + 标题 + 副标题）。
- 缩略图 **88px 网格 → 40px 条**：最多 3 张 + 「+N」；失败占位同步收成 40px。
- 资源列表按 C：图片铺进缩略图条，**音频/视频不再逐个成行**，折成一句类型统计
  （「27 图 · 12 音频 · 2 视频」）跟在条右侧；一张图都没有时该统计进胶囊行。
- 清单类（画布列表等）**最多 3 条** + 「还有 N 条…」。
- 「详情」：卡片**下方**的折叠块，展开 = 工具名称 / 输入 / 输出 三块；输入为空写「（无输入）」，
  输出不截断、不加省略号。
- 悬停：默认工具行**不加底色**（删掉早先的 hover 背景），只让左侧折叠箭头由灰变亮；
  「详情」按钮同理，只改文字色。
- 卡片壳收紧：padding 10px 12px / 圆角 12px → 6px 8px / 10px；跑完的卡片不再叠一行摘要
  （卡片自己的头行就是头部），只有运行中才显示转圈行。

**验证**：plugin-agent **138** 全绿（新增 1 条紧凑化守卫：40px 尺寸 / STRIP_MAX=3 /
详情块在内容之后 / 三块标签 / 悬停不写 background）+ tsc 干净；ui 产物重建、8865 在跑。
真机（Chrome MCP，`?v=9` 页 + 历史会话「图片内容介绍请求」）：卡片高 97-120px（原先同类卡 250+），
「节点详情」标记=「图片 21 · #50」、「文件预览」给 3.3 MB 徽章 + 40px 缩略图；
「资源列表」卡点开详情 → 标签正是 工具名称/输入/输出 三块、输入原文完整；
默认工具行悬停 background=rgba(0,0,0,0)、箭头 #919191、详情按钮背景透明。
真 MCP 复核：resource_list 41 项 = 27 图 / 12 音频 / 2 视频，前三张图 URL 直取字节成功（2048/2336/738）。

**图像资源地址最终复核（2026-10-08，用户追问「图片资源地址解决没有」）**：
用**运行中的 dist 产物**（8865 在跑）起隔离服务 + 假 provider 记录它实际收到的参考图值，
覆盖四种来源形态 —— 节点 50 的 `imageUrl`（资产地址 `/api/assets/files/<hash>.jpeg`，正是报错那一个）、
`res:<hash>` 引用、`/api/canvases/<id>/resources/<hash>` 画布资源地址、带 origin 的资产地址：
四条全部转成 `data:image/jpeg;base64,…`（4.5 MB 内嵌），**provider 侧拿不到裸地址**（探针断言 `rawAssetLeaked=false`）。
把同一份 data URL 交给**真实的 web2api**（8033，走 provider 的 `system/upload-resource` 手法）：
返回 `referenceUrl=/ec96ba…png`、回读 200 + image/png + 3477488 字节 —— 「参考图先上传拿地址」链路可用。
web2api 日志核对：`图片不存在` 共 16 条，**全部在 10:04 之前**（修复前的历史）；重启后无新增。

### 追记（2026-10-08 五续，画布分组三修：行内改名 / 任意层嵌套 / 组内 Ctrl+G + 命名）

用户口径（三条，附两张截图）：
①「画布 tab 下面的分组重命名，还是浏览器系统那种弹出框，我要的是资产里面的那种重命名效果」；
②「你的 UI 部分有一个嵌套分组的效果，但是好像存在问题，请进行修复 —— 你没有实现第二层」；
③「分组快捷键失效：我已经在一个分组内，选中两个节点按 Ctrl+G 没有分组，只有把节点拖到分组外才生效」；
④「分组标题重复：创建节点时有索引累加，希望分组参考它的做法」。

**① 分组/节点重命名改行内输入框**（`LeftDrawer.vue` + `ui.ts`）：
老实现是 `window.prompt('重命名节点', …)`，而且只改左侧树那份**副本**、根本没写进画布数据
（改完刷新就没了 —— 比弹框本身更严重）。现在与资产树同一套：行内受控输入框、聚焦全选、
回车/失焦提交、Esc 只退改名（`@keydown.esc.stop`，不连关抽屉）。提交走唯一写口
`ui.renameNode` → `doc.setNodeLabel`（写节点自己的 data.label），画布标题条 / @ 菜单 / 左侧树
读的是同一份。真机实测：菜单「重命名」→ 输入框预填全选 → 回车 → 节点 label 与左侧名字同步更新；
Esc → 值不变、输入框消失、抽屉还在。

**② 嵌套分组第二层**（`canvasTree.canvasTreeBlocks`，新纯函数）：
老模板是**写死两层**（根分组 + 它的一层孩子）：孩子自己还是分组时，整棵子树直接被丢掉 ——
用户看到的「第二层没实现」就是这个。抽成纯函数拍平（前序：分组头 → 子块递归），
模板一个循环画完，层数不设限；分组头与节点段各带 depth（缩进 = depth × 24px），
宫格模式每层各自成一个三列网格（不会混进同一行）。删掉整块旧的写死模板，改渲染 block 序列。
真机实测（该画布有 分组1 ⊃ 分组2，以及组内嵌套组）：分组头缩进 0 / 24 / 24 px、
三层节点段缩进 24 / 48 / 48 px 全部正确分层，`分组 2` 及其子节点都画得出来。

**③ 组内 Ctrl+G 打组**（`plugin-group`）：
根因两处：命令层 `run()` 里 `filter(id => !node.parentId)` 把**已在组内的节点全滤掉**
（剩 0~1 个 → 命令静默什么都不做），`createGroup` 里同样一刀切 `if (node.parentId) return false`。
现在：命令层只滤「不存在的节点」，能不能一起装进新组由服务判；`createGroup` 支持**组内打组**
（新组挂进共同父、仍是同一层容器），并显式拒绝跨组混选（父不同 → null，语义模糊不硬猜）。
坐标这一路必须按**绝对矩形**算（组内节点的 store position 是相对原父的），新组的 position
也按共同父转相对 —— 老实现只在顶层节点上恰好成立。配套修 `ungroup`：解散**内层组**时
子节点升为外层组成员（老实现一律 `parentId: undefined`，等于把内容扔出外层组）。
嵌套上限仍是 1（**不是**放宽的那条路）：渲染层给容器只留了两档垫底 z（顶层组 -3 / 其余 -2），
实测深度 2 的组 computed z = 0，**与连线同层**、视觉分层失效 —— 要更深得先改渲染层档位。
真机实测：组 43 内选两个节点执行 `group:create` → 新建「分组 4」parent=43、depth=1、
两个子节点相对坐标正确（绝对位置不变）。

**④ 分组标题不重复**（`nextTypeName` + 存量补名）：
线上跑的是旧 bundle：老 `createGroup` 在 data 里写了 `label: ''`，把数据层的默认名
（"分组 1"）顶掉了 —— 于是标题条/左侧树回落到类型名，看起来全叫「分组」。源码里
「不显式给 label」的修法已在，只是**已存档的那批**没人补。现在：数据层新增
`nodeStore.nextTypeName` / `doc.nextTypeName`（与建节点自动补名走同一份按类型计数），
插件 `apply` 里补名（`label === ''` 才补，用户清空过标题的 `undefined` 不动），
并订 `doc.subscribe` 的 `replace`（冷启动 restore 在插件 apply 之后，热装时点则由立即那一次覆盖）。
真机实测：用户的三个空标题分组自动补成「分组 1/2/3」，之后新建接着数「分组 4」（不撞号）。

**顺带修一个真 bug（挡住分组持久化）**：`plugin-cloud-client` 的 `diffGraph` 只发变化的节点、
且**原样**发本地那份 —— 解除父子后的本地节点里 `parentId` **键不存在**（不是 null），
而服务端把「没有这个 key」读成「这次没提这个字段」，只有显式 `null` 才执行删除。
结果：**把节点拖出分组 / 解散分组写上去等于没写** —— 刷新后节点又回到组里，
组被删掉还会留下指向已删组的悬挂 parentId（用户那张画布上就存着两条）。
修法：`diffGraph` 对「本地已无 parentId、基准里还有」的节点补 `parentId: null`（其余字段不动）。
真机实测：设置/解除 parentId 两步都能落盘，画布上遗留的两条悬挂引用已清干净。

**验证**：canvas-data **372** 全绿 + tsc 干净；plugin-group **53**（新增 6 条：组内打组 / 跨组拒绝 /
嵌套上限 / 编号默认名 / 存量补名 / 解散内层组）+ tsc 干净；plugin-cloud-client **132**（新增 3 条
出组持久化）+ tsc 干净；ui **172**（新增 canvasTreeBlocks 6 条）+ vue-tsc 干净；
canvas-render **418** / canvas-base **6** 全绿（未受影响，跑了回归）；三处产物重建
（ui dist + plugin-group / plugin-cloud-client 的 UMD，8865 直接生效）。

**清场**：验收过程中在用户画布上造的节点已全部删除，画布回到 22 节点 0 悬挂；
两个被误挂进组的老节点位置已还原到测试前的原始坐标。

### 追记（2026-10-08 四续，资产引用标签点击预览 + 资产管理弹窗引导）

用户口径：
①「从这个资产里面引入的资源，可以点击进行预览，因为它这里本身就提供了路径」；
②「如果是文件夹，那么就打开资产管理的这个页面（对应文件夹提供一个提示 tooltip）……
   希望你进这个页面的时候：1. 先把所有的文件夹折叠起来，然后只展开选中的文件夹；
   2. 在这个文件夹上提供一个提示信息，点击操作之后，或者 3 秒之后，提示信息就会自然消失」；
③「如果是视频、音频、图片的话，就使用我的通用预览效果。可以参考『生成历史』里面点击的全屏预览，它是一个通用组件」。

**判据**：有 `ext` = 文件 → 全屏预览；只有 `folderId` = 目录 → 打开资产管理并展开到那一层。

改动（跨 4 个包；**三方解耦**：输入框只管抛点击，Agent 插件转成系统事件，应用层监听）：
- `prosemirror-editor-bundle`：asset 引用新增 `ext` / `folderId` 字段（`formatReferenceMarkup` 第 4 参）；
  resource 节点新增 `refExt` / `refFolderId` 属性 —— 解析（回填）与导出（getPlainText / 复制）都要原样写回；
  四类引用的内联 SVG 图标收敛成唯一一份 `REF_ICONS`（此前 useEditor 与 agentResources 各存一份，会漂移）。
- `plugin-agent`：解析从 SFC 抽成纯函数 `userSegments.ts`（带 path/ext/folderId，可单测）；
  标签点击不再找任何服务，而是广播**系统事件** `agent:ref-click`（名字与载荷定义在 `refClickEvents.ts`，
  已 registerEventName 登记）。气泡标签与输入框 chip 走同一条事件。
- `packages/ui`：监听该事件并落实 —— `composables/useAssetRefOpen.ts` 按载荷分流
  （`ext` = 文件 → 全屏预览；无 `ext` + `folderId` = 目录 → 资产管理并展开到那一层）；
  监听与浮层收进 `components/AssetUiSlot.vue`（挂 CanvasHost `#ui` 槽 —— `ctx.on` 与主题注册件
  `mediaViewer` 都只有渲染子树内取得到，左侧抽屉在 CanvasShell 兄弟位、够不到）。
  资产管理弹窗新增 `initialFolderId` / `focusToken` / `fromRef`，进入时**先全折、只展开选中那条链**，
  并给目标行一条 3 秒自动消失的引导提示。
- `cloud-server`：解析 `folderId`；系统提示词补上「资产分文件/文件夹两种，没有 ext 就是目录」。

关键边界（都有单测钉住）：
- 文件夹名带点号（「素材 v1.2」）**不会**被当成文件 —— 有 `folderId` 就不再从 path 推扩展名；
- 老转录（只有 path、没有 ext）仍从 path 末尾补 ext，图片不会被当成文件夹；
- 同一个文件夹连点两次会重新折叠 + 重新提示（`focusToken` 每次 +1，宿主按它给弹窗换 key）；
- 「折叠 + 提示」只属于**从引用标签跳进来**这条路径；从侧边栏点「资产管理」进来**保持原来的全展开**。

**为什么用事件而不是服务**（用户口径 2026-10-08）：服务通道用**一个服务名**把两边绑死，
还隐含「服务必须先于消费方注入」的次序要求；事件是广播 —— 发的人不知道谁在听，听的人不 import 发的人，
少一边也不报错。判断「文件 / 文件夹」的唯一依据仍写在载荷自己身上（有没有 `ext`），不做二次翻译。

**验证**：ui **172** / plugin-agent **138** / prosemirror-editor-bundle **25** / cloud-server **439** 全绿，
四个包 typecheck 干净；产物重建 + 8865 重启（health `{"ok":true}`）。
真机（Chrome MCP，8865）：
- 对话里点资产文件标签 → 通用 `MediaViewer` 打开、图真加载（`naturalWidth>0`），src = `/api/assets/files/<hash>.png`；
- 点文件夹标签 → 资产管理打开：展开到父层 12 行 / 展开到子层 33 行（对照全展开 66 行），引导提示出现、
  3 秒后自动消失、点一下也立刻消失；
- 同一文件夹连点两次仍会重新折叠 + 重新提示；从侧边栏按钮进 = 33 行、无提示。

code review（Standards + Spec 两个子代理并行）：修掉了它们报的三个真问题 ——
文件夹被误判成文件、侧边栏入口被误改成全折叠、我自己留下的死代码（`assetFolderResource` /
`formatRefAssetFolder` / `__assetKindOfExt`）与图标表重复；其余（既有代码的风格问题、前几轮累积的范围）不动。

### 追记（2026-10-08 三续，Agent 工具卡三件：分组灰底 / 工具卡图片失效 / 参考图「图片不存在」）

用户口径（三条，附截图，在 `430c8f1f00bd4aba` 画布 `?v=5` 页真机调试）：
①「图 1 那个 exec_command 折叠的部分也被灰色背景包住了，图 2 就没有 —— 只有折叠以下的内容才被包住；
而且上下 padding 很大」；
②「很多工具调用显示的图片经常失效，且没有图片失效的 UI 状态；要调查为什么很多图片无法访问：
是图片被删了吗？」；
③「通过图片创建任务时又报错提示『图片不存在』，我之前不是修好过吗？」

**① 分组里的折叠行被灰底包住**（`plugin-agent/AgentConversation.vue`）：单工具行本来只有**展开后的**
`.ac-tf-body` 包灰底；但分组 CSS `.ac-tg-body .ac-tool-fold, .ac-tg-body .ac-tool-card { …灰底 + 8px 内边距… }`
把**收起状态的折叠行**也包了 —— 这就是图 1 与图 2 的差异。修法：该规则只留 `.ac-tg-body .ac-tool-card`；
分组项的 class 分流改为 `(tool.card || hasCardView(tool)) ? 'ac-tool-card' : 'ac-tool-fold'`（画布 MCP 卡片
在组里也走卡片壳）。真机实测（复用历史会话「图片内容介绍请求」）：组内折叠行
`bg=rgba(0,0,0,0) / padding=0 / border=0`、高 26px；卡片仍 `veil + 1px 边框 + 8px 10px`；
展开的输入/输出块仍包灰底。

**② 工具卡图片裂图（两类假失效，图片没被删）**（`plugin-agent/toolViews.ts` + `ToolViewBody.vue`）：
- **根因 A：地址被双拼**。`canvas_get` 卡片的 `resUrl` 无视 name 已是完整地址，把节点 50 的
  `imageUrl=/api/assets/files/ec96ba4464cbf531.jpeg`（资产地址）拼成
  `/api/canvases/<id>/resources//api/assets/files/…` → 404 裂图（真机复现）。
  修法：新增 `toDisplayUrl`（完整地址原样 / `res:` 剥前缀 / 裸名才拼画布资源路由），`resUrl` 改为 delegate。
- **根因 B：非图片也当图片渲染**。`resource_list` 的 41 个资源里有 12 个 OggS 音频（无扩展名）、
  全被塞进 `<img>` → 必裂。修法（与 cloud-server 侧配套）：服务端 `resource_list` 返回
  `[{name,mime,kind,url}]`（kind 由扩展名 + **头部字节嗅探**判定）；前端兼容两种形态 ——
  kind=image 进缩略图网格、其余按类型进行（icon audio/video/file）。
- **兜底 UI**：`ToolViewBody` 的图片加 `@error` → 原位换成 `.tvc-img-broken` 占位
  （`ImageOff` 图标 +「加载失败」，虚线框 88px 同尺寸，带 role/aria-label）。
- 顺带：`canvas_get` 单节点只从 `imageUrl`（退 `panoUrl`）取图，不再把 videoUrl/audioUrl 塞 `<img>`；
  `generation_status` 的产物 url 也走 `toDisplayUrl`。
- 真机实测：工具卡 9 张图全部 `naturalWidth>0`（2048/1536/738…）、内嵌页 0 张裂图；
  `resource_list` 卡「41 个资源」= 4 图缩略 + 4 音频行（音频不再进 `<img>`）。

**③ 参考图「图片不存在」**（真 bug，`cloud-server`：`tasks/resourceResolver.ts` 新增 + server.ts 接线）：
节点 50 的 `imageUrl` 是**资产地址** `/api/assets/files/<hash>`（一次上传素材入画布的形态），
而 `resolveResourceUrl` 只认 `res:` 与 `/api/canvases/…/resources/…` 两种形态 → 资产地址**原样**发给 web2api，
它当自己 uploads 目录下的相对文件找 → 报「图片不存在（已尝试 `…\web2api\uploads\api\assets\files\…`）」。
（此前修的是前两种形态 —— 这是同一族的第三种，之前没覆盖。）
修法：`makeResolveResourceUrl` 三种形态都读成 **data URL**（`parseAssetNameFromUrl` 新增于 assetStore）；
mime 先按扩展名、无扩展名时对字节头部嗅探（`sniffMimeFromHead`：PNG/JPEG/GIF/WEBP/BMP/AVIF/MP4/OggS/ID3/WAV/MP3）。
配套 `resource_list` 富形态（`canvasDoc.listResourceInfos` + `readHead` 只读头 16 字节，不整读大图）。

**验证**：cloud-server **422** 全绿 + tsc 干净（新增 resourceResolver 13 条 + resourceInfos 12 条，含真起服务经
`/mcp` 调 `resource_list` 验形状）；plugin-agent **129** 全绿（新增 8 条：地址口径 6 + 失败占位 1 + 分组 CSS 守卫 1）
+ tsc 干净；ui **165** 全绿。产物重建 + **8865 已重启**（health `{"ok":true}`）。
真机（Chrome MCP，`?v=5`）：① 折叠行无壳/卡片有壳/展开块有壳（几何逐项量过）；
② 工具卡 9 图全载、4 个失败占位（旧会话 ogg 记录，明示而非裂图）；③ 真数据探针：四种形态
（`res:` / 画布资源地址 / 资产地址 / 带 origin 资产地址）全部转成 `data:image/jpeg;base64,…`；
`listResourceInfos` = 27 图 + 12 音频 + 2 视频；端到端（临时服务 + 假 provider recorder + 真 HTTP/MCP）：
`generation_create`（入边收集参考图）与 `/api/jobs`（底栏路）两条下单路径，provider 收到的参考图
**都是 data URL**，不再出现资产地址。

### 追记（2026-10-08 二续，四件小修：视频卡缩略图 / Agent 图片预览 / 弹窗折叠 / 新建下拉）

用户口径（四条，附截图）：
①「视频没有缩略图，也没有标识。你可以添加它的首帧作为预览，并且在卡片中添加一个播放图标按钮」；
②「Agent 里面读取文件的地方，点击时没有进行预览。希望使用预览插件（可参考生成历史弹出框的预览 api）」；
③「资产管理弹窗里点文件夹行没有折叠效果，为什么左侧边栏折叠就有效果？它们不是同一个组件吗？」；
④「资产管理右上角'新建'按钮不要直接建文件夹，要和左侧边栏加号一样，点一下弹下拉（新建文件夹 / 上传资产）」。

**① 视频节点缩略图（真 bug）**：`canvasTree.nodeThumbUrl` 对视频节点的候选字段含 `videoUrl` ——
mp4 地址塞进 `<img>` 必然裂图（用户截图里的破图就是这个）。修法：thumb 只认图（posterUrl / thumbUrl），
新增 `nodeVideoUrl` + `TreeNode.video`，抽屉里用 `<video preload="metadata" muted>` 显示首帧，
叠加播放角标（生成历史卡同款语义），没有视频地址则回落视频图标。列表/宫格/顶级叶子三处都接上。
真机实测：`video.readyState=4`（1280×720 真实解码）、播放角标存在、无裂图。

**② Agent 工具卡片图片点击预览**（`plugin-agent` 包，子代理实现 + root 复核）：
`ToolViewBody.vue` 的 images 块图片此前无点击处理。改为 `emit('preview', src)`（role=button +
tabindex + Enter/Space 键盘可达），`AgentConversation.vue` 4 处 `<ToolViewBody>` 全部接上
`@preview="previewImage = $event"`，复用宿主已有的那只 MediaViewer（与生成历史同款），未新增第二只。
真机实测：点 read_file 卡片里的图 → MediaViewer 打开、1280px 图正常加载；Esc 关闭正常。
新增 `toolViewImagePreview.test.ts`（6 条，真编译组件 + 内存渲染器派发事件，不是源码字面量守卫）。

**③ 弹窗点文件夹行不折叠**：`AssetManageDialog` 给共用树传的 `folder-click="open"` 分支
只改面包屑/新建落点、不改列表 —— 用户看到的就是"点了没反应"。改成默认 expand（与左侧栏一致）。
下钻入口改用行尾显式「进入」按钮（`showEnter`，仅弹窗开启；"双击行"实测不可靠 —— 第一下折叠会
换行，dblclick 落到别的行上，已否决并在注释里记了原因）。真机实测：点文件夹行 33 行 → 2 行 → 33 行。
附带统一：行菜单「新建子文件夹」落点改为该行（原为当前层，与抽屉漂移）。

**④ 「新建」改下拉**：`AssetManageDialog` 右上角文字按钮 → 加号下拉（AxDropdown + AxMenu：
新建文件夹 / 上传资产），照左侧抽屉加号。上传走真 `AssetUploadDialog`（同组件、同保存口径
`ui.uploadAssetsTo`，保存位置默认预选当前层）；`AssetUploadDialog` 新增可选 `initialFolderId`。
Esc 分层：上传弹窗开着时资产管理让位 + `stopPropagation`（一次 Esc 只关一层，抽屉不被连关）。
真机实测：下拉两项、上传弹窗打开且预选位置正确、两次 Esc 逐层关闭。

**验证**：ui **158** 全绿（含新增 9 条：canvasTree 4 + assetTreeStructure 5）、ui typecheck 干净、
ui 构建通过（产物刷新到 packages/ui/dist）；plugin-agent **105** 全绿 + tsc 干净；
既有契约 e2e `asset-tree-shared-check.mjs` **8/8 PASS**（真 Chromium）。

### 追记（2026-10-08，资产树对齐 + 取消双击重命名）

用户口径（附截图）：「女孩资源图片和新建文件夹是同级，对齐有问题——图片要对齐文件夹的图标，左对齐」；
「文件夹取消双击重命名功能」。

**① 同级对齐**：AssetTree 资产行此前直接渲染缩略图，而文件夹行在缩略图前还有一个
20px 的折叠按钮——同 depth 下资产行的图标比文件夹图标靠左 20px，视觉错位。
修法：资产行在缩略图前补一个等宽（size-5）的空占位（aria-hidden），缩略图与文件夹
图标落到同一 x。真机实测：根级「女孩」缩略图 x=40 = 文件夹图标 x=40，delta=0 ✅
（弹窗 variant 的 px-2 不受影响，同 depth 下同样对齐）。

**② 取消双击重命名**：文件夹行名字按钮的 @dblclick="emit('startRename'…)" 移除。
重命名入口保留：行菜单「重命名」（右侧「⋯」/ 右键菜单）。真机实测：双击文件夹名、
双击资产名均不再进入改名态 ✅。

验证：ui typecheck 干净、**149** 全绿、产物重建（8865 刷新生效）。

### 最近完成（2026-10-07 五续：Code Review 修复收口）

用户要求「请修复完整」——把 review 报告里剩余的问题修完。

**Spec 缺口（弹窗侧文件夹功能没接上）**：
- AssetManageDialog 的「添加到 Agent / 添加到画布」改走与抽屉同一条服务
  （`ui.addFolderToAgent` / `ui.addFolderAssetsToCanvas`）；确认弹窗状态机照搬抽屉
  （含审查发现的"旧 Promise 挂起"修复：开新确认前先 cancel 旧的）。
- 真机验证：弹窗右键「打发打发」(23 项 >10) → 确认框出现且文案带数量 → 取消路径不改数据；
  「添加到 Agent」标签出现。注意：本机 23 项含 21 张图 + 2 视频，确认后建节点需数秒分帧。

**拖拽误移根目录**：AssetTree 容器级 drop 原来会派发「移到根目录」→ 改为**原地取消**。
语义收紧：只有显式落在文件夹行上才移动；「移回根目录」走行菜单的「移动到 →（根目录）」。
真机回归：拖「你好」到空白 → folderId 不变 ✅。

**Standards 硬违规**：
- `--ui-brand`（未定义变量，hover 掉蓝兜底）→ ModalsArea.vue 历史卡 hover 改 `--ui-accent` ✅
- 资产两弹窗 z-[95] 且无 Esc → 统一 z-[100000]（确认层 z-[100001]），挂 document keydown Esc 关闭 ✅
- canvas-data 引 Vue（shallowReactive）—— **保留不动**：那是「默认尺寸实时生效」功能的实现
  （TYPE 表 shallowReactive + updateTypeSize），审查基线与功能取舍判给功能。
- 测试探针 traceFork.probe.ts 编进 dist —— **保留**：诊断用途（命名即探针），删除影响排障。
- mcp/server.ts 头注释旧名 —— 保留（历史命名记录，非契约）。
- cloud-server 提示词种子不自愈 —— **已知设计**（STATUS.md:525 记过），需要迁移属新任务。

**Standards 判断题（清理）**：
- 文件夹图标映射三份 → 收口 `composables/folderIcons.ts`（ICON_NAMES/ICON_MAP/folderIconComponent），
  AssetRowMenu / AssetManageDialog / LeftDrawer 三处改 import ✅
- Agent 面板字号/尺寸合规：消息操作钮 22→32、编辑徽标 ✕ 16→32、分页箭头 26→32、
  图标 10/11→12、tvc 系列 10px→11px、大数字 18→15（全部对齐 ui-style-guide 表）✅
- `<img role=button>` 补 tabindex + Enter/Space 键盘可达 ✅
- 两处"首句截断"公式 → 收口 `immediateTitleOf()`（runtime.ts，落盘与判定恰等）✅
- Duplicated Code 其余项（中文→kind 级联、平铺 walk、sessions 映射等）—— 判断题级别，
  影响面大（跨文件签名改动），留待下次专门重构，不在本次修复范围。

**Spec 轴误报澄清**：useMasonry.ts 并非无引用（ModalsArea.vue:13/42 使用中）。

验证：ui typecheck 干净、**149** 全绿；plugin-agent tsc 干净、**99** 全绿；
cloud-server tsc 干净、**399** 全绿；ui 产物重建。
真机（Chrome MCP）：上传弹窗 z=100000、Esc 关闭 ✅；资产管理弹窗 Esc 关闭 ✅；
拖拽误移根目录回归（fid 不变）✅。

### 最近完成（2026-10-07 六续：批量勾选框改到行尾右侧 + 修白屏（canvas-render 缺两个导出））

### A. 勾选框放右侧（用户参考图口径）

用户口径（原话）：「参考这张图，把勾选的这个控件放在右侧」（图为 LibTV 风格：勾选框在每行右端）。

**修后**（`packages/ui/src/components/AssetTree.vue`，抽屉与弹窗共用）：
- 勾选框从 `absolute left-2` 改 `absolute right-2`（行尾右侧，距右缘 8px）；
- 批量模式下行为右侧多留 32px（`pr-8`），避免文件夹的计数角标（如「23」）与勾选框压在一起。

**验证（Chrome MCP 真机 5288）**：勾选框右缘距行右缘 8px、左缘 278；计数右缘 270 < 278（不再重叠）✅；
点选后 `aria-checked=true` 正常 ✅。

### B. 白屏修复（真 bug，非本任务引入但挡住验证）

现象：页面 body 只有 101 字节（Vue 没挂载），console 报
`canvas-render/src/index.ts does not provide an export named 'uiComponentOutside'`（随后还有 `setUiCatalogHost`）。

根因：`MediaViewer.vue`（plugin-theme-default，今日新引入）与 `packages/ui/src/composables/ui.ts`
都从 `@mini-canvas/canvas-render` 导入这两个名字，而 `canvas-render/src/index.ts` 只导出了
`useUiComponent / uiComponent / uiNames / UI_NAMES` —— 三个真实缺口。

修法：`packages/canvas-render/src/index.ts:240` 补齐 `uiComponentOutside` 与 `setUiCatalogHost` 导出
（两者在 `contracts/uiCatalog.ts` 里本来就已实现，只是没从包入口转出）。

验证：canvas-render 418 测试全绿 + tsc 干净；页面正常挂载（body 79878 字节、38 个按钮、0 console error）。

### 最近完成（2026-10-07 五续：资产树左侧空白列收掉，折叠箭头与搜索框对齐）

用户口径（原话）：「这边左侧边栏为什么需要留这么大一片空间呢……把左边空余的空间给我挪到左侧，
至少实现你这个文件夹左侧的折叠按钮，与上面的搜索框左侧对齐」。

**根因**（Chrome MCP 真机测量，5288）：AssetTree 每行以 `size-4`（16px + gap 8px = 24px）的批量
勾选框**常驻占位**（普通态 opacity-0 但仍占布局位），把折叠箭头从行首挤出——折叠箭头图标左缘
43.5px vs 搜索图标左缘 16px，中间那 27.5px 就是用户框出的空白竖条。

**修法**（`packages/ui/src/components/AssetTree.vue`，抽屉与资产管理弹窗共用同一份）：
1. 批量勾选框改成 `v-if=\"batchOn\"` **只在批量模式渲染**——普通态不再占任何布局位；
2. 行缩进起点 8px → 4px：折叠箭头（13px 图标居中于 size-5）视觉左缘 ≈ 15.5px，
   与搜索图标左缘 16px 对齐（测量 15.5 vs 16，肉眼已齐）；
3. 资产行的 `size-5` 空占位（对齐文件夹图标的列）删除，缩略图直接顶到行首。

**验证（Chrome MCP 真机 5288）**：
- 普通态：搜索图标 16 / 折叠箭头 15.5，对齐 ✅；批量勾选框不存在（不渲染）✅
- 批量模式：点「批量操作」→ 每行左缘出现勾选框（25 个），可点选 ✅
- ui 单测 149 全绿；typecheck 仅报 plugin-agent 未提交改动的一处（与本任务无关）。

### 最近完成（2026-10-07 四续：文件夹「添加到 Agent / 画布」真实现）

用户口径（原话）：「文件夹的菜单里，添加到 Agent 和添加到画布没有效果」。
1. 添加到 Agent = 「直接把文件夹的地址发过去就行」；
2. 添加到画布 = 「将文件夹中的所有内容全部添加到画布中。如果数量超过 10 个，需要弹出对话框确认，
   不然一下添加太多会卡死」。

**修前实况**：文件夹菜单的两项只有 toast 占位（`folderAddToAgent` 只 showToast；弹窗侧同样），
点了没有任何实际动作。

**实现**（`packages/ui/src/composables/ui.ts` 新增两条服务，抽屉与弹窗两个宿主都接上）：

1. `addFolderToAgent(folder)` —— 文件夹是**一条引用**（不是把里面的资产一张张贴）：
   标签显示文件夹名，载荷是文件夹的"地址" —— 后端文件夹只是登记表记录（无真实目录），
   取**第一条有 path 的资产所在目录**当公共路径（Agent 侧自己 ls / 按需读）。
   走 agent 插件已有的 `referenceAsset` 通道（与单资产同一套：pendingAsset → 输入框插标签）。

2. `addFolderAssetsToCanvas(folderId, { confirm })` —— 文件夹里的**全部内容**按类型建到画布：
   image 走 create-node 命令、video/audio 走各自插件服务（同一套口径），other 跳过并计数。
   **数量 > 10 先弹确认**（确认 UI 由宿主给：抽屉里加了 AxDialog「把「xx」添加到画布？共 N 项」，
   取消/确认按钮都 resolve Promise；服务层只问"允不允许"，不关心弹窗长相）；用户不确认就一个不建。
   数量大时分帧建（每 5 个让一帧），避免同帧全建卡 UI。

**验证（Chrome MCP 真机 8865）**：
- Agent：右键文件夹 → 添加到 Agent → 面板打开、输入框出现标签「新建文件夹」，
  标记载荷 `data-ref-value = D:\…\.mini-canvas\assets\files`（文件夹公共路径，非空）✅
- 画布（2 项 ≤ 10）：右键 → 添加到画布 → 不弹确认、直接建出 2 个节点（16→18）✅
- **批量选中（追加口径）**：「菜单添加的节点请进行选中，多选（添加之后自动选中）」——
  批量建完**一次性 set 全部新 id**（此前建一个选一个，选区只剩最后一个）。
  真机：建 2 个节点 → selection 正是这两个新 id（56/57）✅
- 确认弹窗路径：数量阈值常量 10，分支逻辑被服务层单参数 `confirm` 回调覆盖；
  弹窗 DOM 已接（AxDialog + folderConfirm 状态机），数据侧无法低成本造 12 项资产，
  以「2 项不弹 + 弹窗组件/状态机就位 + 服务层只认 confirm 回调」三层组合验证。
- 收尾：测试建的节点已删、资产归属已还原。

验证：ui typecheck 干净、**149** 单测全绿、构建通过、产物重建（8865 重启脚本已跑）。

### 最近完成（2026-10-07 三续：右键无箭头 / Agent 图片路径 / 聚焦动画 / 拖拽不动视口 / 收起图标修复）

用户报五条（原话摘要）：
1. 右键菜单的定位箭头该藏掉（只有点「⋯」按钮才显示）；
2. Agent 面板读取图片文件加载错误（路径不匹配）；
3. ① 聚焦动画太快没观感；② 拖拽添加节点时不要动画布视口；
4. 左下角「收起侧栏」按钮 SVG 没生效（图标名写错/没导入）。

修法与验证（全部 **Chrome MCP 真机**，8865）：

**1. 右键菜单藏箭头**：`AxDropdown` 的箭头条件加 `!contextPoint`（右键唤出 = 鼠标点锚点 → 不画箭头）。
真机：右键开菜单 `arrow:false`、点「⋯」开菜单 `arrow:true`（菜单锚在按钮上，箭头仍有意义）。

**2. Agent 图片路径**（真 bug）：`read_file` 卡片早先拼了 `/api/agent/file?path=…` ——
服务端**从没存在**这个路由，静态兜底把 index.html 返回给 <img>（HTML 当图片 = 必然裂图）。
改成 `fileUrlFromPath()`：本机绝对路径映射到**服务端真实存在的两条资源路由**
（`/api/assets/files/<hash>` / `/api/canvases/<id>/resources/<hash>`，与 assetStore 的
localPathFromUrl 同一口径）；映射不到（磁盘别处的图）就退化成文件名行，不给必然裂图的 <img>。
真机：`fetch('/api/assets/files/faaca433dafb2b75.jpeg')` → 200 + image/jpeg。
补 4 条单测（toolViews.test.ts）锁住这三条口径 + 「永不回到 agent/file」。

**3.① 聚焦动画**：根因是 auto-layout 的聚焦走 `setViewport`（即时路径 —— 它服务小地图拖拽
这类"跟手"场景，加动画会每帧重启补间卡顿，不能动）。新增 `animateViewport(v, durationMs)`
（契约可选 + 渲染后端实现 + 服务退级），auto-layout 聚焦改走它。
真机采样视口：起点(0,0,1) → 中间帧(316,-522,0.97)/(300,-2149,1.69) → 终点(243,-2602,1.94) ——
明显补间而不是瞬移。3 条单测锁住「聚焦走动画/退级不退化/跟手仍即时」。

**3.② 拖拽不动视口**：`createAssetNode` 拆成两条路 —— 拖拽落点（atFlow 有值）**只选中不取景**
（落点就在用户眼前，再挪视口等于"画布自己乱动"）；菜单「添加到画布」仍取景（节点可能落在视口外）。
真机（Chrome MCP drag 真拖拽）：拖前视口 (500,300,0.8) → 拖后**完全不变**，新节点照常 +1。

**4. 收起按钮图标**：模板用了 `<ArrowLeftToLineIcon>` 但**没 import**（Vue 把它当自定义元素渲染），
lucide 里这个图标存在（导出 `ArrowLeftToLine`/`ArrowLeftToLineIcon`）。补 import 即可。
真机：按钮 innerHTML 从 `<arrowlefttolineicon>` 变成真 `<svg>`。

顺手修：cloud-server 构建被三个既有文件的 TS 严格模式报错挡住（`agentTraceFork.test.ts`
两处 possibly-undefined、`plugin-watch-e2e.ts` 两处 implicit any / null）——与本次无关但挡构建，
已按最小修法补类型。

验证：ui **149** / canvas-render **418**（含新增 animateViewport 3 条）/ plugin-agent **99**
（含新增 4 条）全绿；ui typecheck 干净；cloud-server 产物重建（8865 重启前先构建，重启后生效）。


### 最近完成（2026-10-07 续，拖拽只有背景 / 重命名预填修正 / 资源拖到画布建节点）

用户在上一轮基础上又提了三条（原话）：

1. 「拖拽上去有那种灰色的背景…我感觉你好像设置了什么阴影，把这个阴影给去掉」；
2. 「点击重命名没有反应」；
3. 「我希望你这个资源里的图片、音频和视频等，可以直接拖拽到画布上，拖拽上去就是直接添加一个新的节点」。

**① 拖拽悬停 = 只有背景**（推翻上一轮"背景 + 灰阴影"）：`.asset-tree .asset-tree-row.is-drop-over`
 现在只留 `background: var(--ui-hover-strong)`，并显式 `transition: none`（原生 drag 期间
 浏览器的 CSS transition 会冻结在起始帧 —— 不写这句背景色读出来仍是透明）。guard 测试同步改成
 「有背景、必须没有 box-shadow」：改样式就得改口径，反之亦然。

**② 重命名**：实测「⋯ → 重命名」与右键 → 重命名**都能用**，但查出两个真问题并修掉：
- **输入框预填了上一次的名字**（点资产的重命名，里面是上一个文件夹的名字）。根因是 AssetTree 里
  留了一份 renameDraft 草稿且优先于宿主值。改成**受控**：值只读宿主的 renameValue，输入即上报。
  加结构守卫禁止再长出组件内草稿。
- **改名中按 Escape 会连整个抽屉/弹窗一起关**：输入框的 `keydown.esc` 冒泡到了 App 的全局 Esc
  （那条会把 `s.drawer = null`）。改成 `@keydown.esc.stop` —— Esc 只取消改名。

**③ 资源拖到画布 = 在落点建节点**（新能力）：
- ui 层新增 `createAssetNode(asset, atFlow?)` / `dropAssetToCanvas(asset, client)`，按类型走**各插件自己的服务**：
  image → command:create-node（extra.imageUrl）；video → ctx.get('video').addVideoNode；audio →
  ctx.get('audio').addAudioNode。落点由 `viewport.screenToFlow` 换算，建完自动选中并聚焦（同"按 F"）。
- AssetTree 的资产行 dragstart 写 `application/x-mini-canvas-asset`（JSON { id }）；
  宿主（LeftDrawer）在 **document 捕获阶段**接 dragover/drop，落点落在画布上就建节点。
- 三个实测坑（都写进代码注释）：必须在捕获阶段监听（VueFlow 会拦掉冒泡的 dragover →
  不 preventDefault 浏览器就禁止 drop）；dragstart 之后读不出自定义 MIME（用会话变量记 id）；
  dataTransfer 里是 JSON 不是裸 id。

**验证（Chrome MCP 真机，按项目规则只走这条通道）**：8865 上真拖拽 → 画布节点 14→15，
新增节点 `{ type: 'image', data.imageUrl 有值, position 落在拖拽点 }`；拖拽会话 → 目标行高亮 →
drop 落库（资产真的挪进目标文件夹，测试后已还原）；改名输入框预填正确、Esc 只退出改名不关抽屉；
悬停样式实测 `background: rgba(0,0,0,0.1)` + `box-shadow: none` + 无边框。
ui typecheck 干净、**146** 单测全绿、构建通过、产物已重建（8865 直接见效）。


### 最近完成（2026-10-07，左侧资产树抽成共用组件 + 拖拽 + 右键菜单 + 修「嵌套菜单点不动」）

用户口径（四条）：「左侧边栏资产 tab 的文件夹列表/资源列表 与 资产管理弹窗里的资源树**抽成一个通用组件**，
并支持拖拽（文件夹和文件都能拖进目录）；拖到其他目录时不要边框，只给一个 over 的背景 + 灰色阴影；
面板右侧那个 hover 才显示的按钮，同时提供**右键菜单**；再优化「嵌套菜单无法点击」的问题」。

**关键修复（真 bug，先复现再修）**：二级菜单（移动到 / 更改图标）能展开、鼠标也在，但点下去毫无反应。
- 取证：Playwright 真鼠标 + MutationObserver + 调用栈 —— mouseup 与 click 之间，父下拉面板被卸载；
  click 派发时目标已脱离文档，Vue 的 click 回调不再执行。
- 根因：二级菜单面板 teleport 到 body，DOM 上**不在**父面板里；父级下拉的 `onClickOutside`（vueuse，
  window capture 阶段）只认「触发器 + 自己的面板」→ 点在二级菜单项上被判「点了外面」→ 父菜单先关。
- 修法：新增 `components/hooks/floatingGroup.ts`（纯函数，10 条单测）：浮层根写
  `data-floating-chain = 父链 + 自己 id`；点外判定改成「命中元素的链里有没有我的 id」——
  组内不算外面，三级嵌套天然成立，无需注册表/生命周期同步。`AxDropdown` 与 `AxSubMenu` 各接一行。

**共用组件** `components/AssetTree.vue`（抽屉与弹窗共用一份行结构/菜单/改名/勾选/拖拽）：
- 契约（e2e 依赖）：根 `.asset-tree[data-variant=drawer|dialog]`；行 `[data-asset-row]` +
  `data-row-kind` + `data-row-id`；拖拽悬停加 `.is-drop-over`；`folder-click='expand'|'open'` 区分
  「抽屉点名字=展开」「弹窗点名字=进文件夹」。
- 拖拽：文件夹 → 文件夹 / 资产 → 文件夹 = 后台 PATCH（`moveAssetFolder` / `moveAssets`）；
  拖到列表空白 = 回根；拖到自己当前父级或自己的子孙**不提示也不发请求**（后台会拒成环）。
- 悬停视觉按用户口径：**背景 + 灰阴影、无边框**（`is-drop-over` 里显式 `transition: none` ——
  原生 drag 期间浏览器的 CSS transition 会冻结在起始帧，不写这句背景色看不出来）。

**右键 = 同一份菜单**：`AxDropdown` 新增「鼠标点锚点」（0×0 真实 DOM，右键时临时参与定位，翻转/
防溢出/箭头/互斥照旧），`AssetRowMenu` 暴露 `openAt()`，行 `@contextmenu` 调它 —— 不为右键另绘浮层。

**验证**：ui typecheck 干净；ui **144** 单测全绿（含 floatingGroup 10 + assetTreeStructure 6 条结构守卫）；
`pnpm -C packages/ui build` 通过；真机 8865 与 dev 5291 各跑：
`node packages/ui/e2e/asset-tree-shared-check.mjs` **8/8 PASS**、`asset-submenu-repro.mjs` PASS
（右键菜单、二级菜单点击、拖拽高亮/落库、弹窗与抽屉同构全部实测）。

### 追记（2026-10-06，AI 起名改为纯后台运行，不再占对话流）

用户口径：「AI 起名不要显示加载状态 —— 用后台服务的形式，起名时前端 UI 不该跟着变化」。

**原状**：`maybeAutoTitle` 在响应流**结束前** await `generateTitle`（模型调用几秒），
于是「生成完成」到「流真正关闭」之间多了几秒 —— 前端的生成加载态被拉长。

**改法（`agent/runtime.ts`）**：拆成两步 ——
1. `maybeAutoTitle`（流内，即时）：落「剥标记的首句截断」名字 —— 列表任何时候都可读，不空、不带机器串；
2. `spawnBackgroundTitle`（流外，后台）：AI 起名丢进后台跑（`void`，不 await），跑完直接 rename 落盘。
   防覆盖两道：起名前、落盘前都检查「当前名还是即时名」（用户手动改过名 / 已开新一轮就不覆盖）；
   失败静默保留即时名，异常兜住不留悬挂 Promise。

效果：对话完成 = 流关闭 = 前端加载态结束；后台起名在几秒后悄悄改名，前端下次拉会话列表自然看到。

**验证**：cloud-server **371** 全绿 + tsc 干净 + 产物重建 + 8865 重启。

### 最近完成（2026-10-06，会话标题改为 AI 生成 + 标题模型可配置）

用户口径：「标题没有总结对话内容，按理说应该是 AI 生成的；在配置页面里配置这个生成标题的模型」。

**实现**：
- **后端**（`agent/config.ts`）：`titleModel()` / `setTitleModel()`（住 KV `agent-title-model`，
  与提示词清单同一作用域；写了就先 `resolveModel` 自证凭据可用，坏配置存不进去）+
  `generateSessionTitle(text)` —— 直接打上游 `chat/completions`（非流式、max_tokens 32、20s 超时），
  提示词要求「不超过 12 字中文标题、只输出标题」；返回前清引号/前缀。凭据解析不出 / 超时 / 上游错
  → 返回 null（**起名失败不报错**，对话照常）。
- **runtime**：`AgentRuntimeDeps.generateTitle?`（宿主注入）→ `maybeAutoTitle` 首选 AI 起名，
  null 才回落「剥标记的首句截断」（上一轮修的可读性兜底保留）。
- **路由 + 前端**：`GET/PUT /api/agent/title-model`；`TitleModelPage.vue`（设置 → Agent →
  「会话标题模型」页签：Provider / 模型两个下拉 + 保存；都留空 = 用会话默认模型）。

**验证（Chrome MCP）**：设置 → Agent →「会话标题模型」页签出现，Provider 下拉列出 `local`、
模型下拉自动跟随渠道（deepseek-auto 等 5+ 个）；选 `local/deepseek-auto` 保存 → `已保存`、
`GET /api/agent/title-model` 返回 `{provider:"local",modelId:"deepseek-auto"}`。
cloud-server **371** 全绿 + tsc 干净 + 产物重建 + 8865 重启；plugin-agent 60 / ui 105 全绿。

**未验证**：真跑一轮新会话看 AI 生成的标题（要真调用模型）——逻辑与 UI 都已验证，回落链有测试兜底。

### 追记（2026-10-06，对话内节点标签可聚焦 + 历史列表标签显示修复）

用户报：① 对话里出现的节点标签不能点击（只有输入框里的能聚焦）；② 历史对话列表的标题/摘要
显示成一片机器码（`@[node:图片 4](430c8f1f00b…`）。

**① 对话内节点标签可聚焦**（`AgentConversation.vue`）：`userSegments` 还原标签时给节点类标签
带上 `nodeId`（按名字在当前节点清单里查）；模板给这类标签加 `role=button` / 键盘可达，点击调
既有的 `focusNode(nodeId)` —— **节点存在才可点**（不在清单 = 已删，渲染成普通标签）；
hover / focus-visible 态齐。

**② 历史列表机器码**，两层根因：
- **新数据**：runtime 的 `maybeAutoTitle` 直接截 `input.text` 原文 24 字符 —— 而那正是带标记的原文
（`@[node:图片 4](430c8f1f00b…#12)`），正好把机器串截进标题。改成先 `stripMarkupToPlain` 再截。

### 最近完成（2026-10-06，二三批：MCP 工具专用渲染 + 消息操作条 + 编辑分支）

接上一批（合并修复/工具折叠/hover 操作条），本批完成剩余两批。

**第二批：内置画布 MCP 工具专用渲染**
- 新纯函数 `plugin-agent/src/toolViews.ts`：按工具名分族（canvas / resource / generation / file /
  fallback），从工具的 JSON 输出提炼「键值行 / 文本行 / 缩略图行」。单测 9 条（用例取自真机转录：
  `canvas_get` 单节点与全量、`resource_list`、`generation_status`、`read_file` 图片、失败输出、fallback）。
- 新组件 `ToolViewBody.vue`：canvas 族显示「节点名 / 规模 / 相邻节点」键值行，resource 族显示
  **缩略图网格**（走画布资源路由），generation 族显示任务状态 + 产物缩略图，file 族图片直出预览；
  fallback 保留输入/输出原文（各带 320px 滚动）。任何族默认收起一个「原始 JSON」排障入口。

**第三批：编辑回填 + 正在编辑 + 分支（fork）**
- **正在编辑**（用户澄清：语义是「正在编辑」不是「已编辑」）：`sessionModel.beginEdit/cancelEdit`
  （单选、内存态），消息琥珀描边高亮 + 「正在编辑」徽标（可 ✕ 取消）；底部输入框联动标记，
  点标记滚回那条消息。单测 2 条。
- **分支**：编辑旧消息后点发送 = 后端 `POST /sessions/:id/fork` ——
  `AgentSessionStore.forkFrom` 把那条消息**之前**的回合拷成**新会话**（标题带「· 分支:原文」），
  `branchStore`（`branches.json`，按 `<parent>|<point>` 登记）记下兄弟会话；前端拿到新 id 后
  走正常 sendMessage（SDK resume 语义按转录继续 —— 即「以这条消息上面的内容为历史」）。
  fork 失败降级为普通发送，不阻塞。单测 4 条。
- **消息 hover 操作条**补时间（`ts` 从转录透传，`10月6日 14:20` 格式，跨年带年份）+ 复制打勾。

**验证（2026-10-06）**：cloud-server **375** 全绿（JSON reporter 确认 0 失败）+ tsc 干净 + 产物重建；
plugin-agent **73** 全绿 + tsc 干净；ui vue-tsc 干净 + 构建通过 + 主题色卫生检查通过。**8865 已重启**：
真机复验 `canvas` MCP `builtin=True` 且删除被拒（404）。
注：`npmRealE2E`（真 npm registry）对网络波动敏感（30s 超时 ×1，重跑全过）—— 网络慢时它可能
假红，重跑即可，与本次改动无关。

**插曲**：8865 数据目录的 `system_config.yaml` / `AGENTS.md` 被截断成 0 字节（并发写入事故，
时间戳与本会话工作重合），导致 Agent 配置面 503。已重建最小合法 YAML，服务重启后 SDK 正常接管、
内置画布 MCP 自动补回（自愈逻辑生效）。**遗留**：用户提示词/模型清单在 KV 里未受损；
`AGENTS.md` 0 字节 = 系统提示词为空，需要用户在设置里重存一次自定义系统提示词（如有）。
- **存量**：sessions.json 里已躺着剥了一半的标题（`@图片 4(430c8f1f00b` —— 截断处连括号都没闭合，
  完整标记的正则匹配不上）。已跑迁移清干净（16 条）；前端 `AgentPanel.historyText` 也加了同一套
  剥标记 + 清残留截断括号段的兜底（新数据不会再产生，老数据即使漏网也显示成 `@名字`）。

**验证（Chrome MCP）**：历史下拉标题现在是 `介绍一下这个 图片` / `@图片 4` / `@canvas`，**机器串 0 条**；
cloud-server / plugin-agent / ui 全绿 + 类型检查干净 + 产物重建 + 8865 重启。

### 追记（2026-10-06，注册式媒体预览 MediaViewer + 资产面板按钮修复）

用户报三件事：把媒体预览做成注册组件（中间是插槽、内置 文本/图片/视频/音频 四类预览，新资源类型用插槽自实现），供底栏插件与成品 UI 复用；左侧「资产」面板的搜索 / 筛选 / 添加按钮全是占位没效果；底栏素材卡预览浮层没有删除按钮，音频素材也收不进来。

改法：
- 注册组件：plugin-theme-default/src/components/ui/MediaViewer.vue 新增 —— 全屏预览（Esc / 点遮罩 / 右上角关闭；遮罩与前景走 token）。中间舞台按 item.kind 内置渲染文本/图片/视频/音频，其它种类留给 #stage 插槽。登记进 registryOf('ui') 的 mediaViewer 名下，其它插件 useUiComponent('mediaViewer') 按名取用；@mini-canvas/plugin-theme-default 同时具名导出 MediaViewer。
- 成品 UI 接入：生成历史（ModalsArea.vue）与资产面板（LeftDrawer.vue）的预览都换成这只 MediaViewer（历史不可删 → 不传 onDelete，删除按钮不出现）。
- 资产面板按钮：搜索 → 展开式输入框（按名字过滤）；筛选 → 类型下拉（全部/图片/视频/音频/其他，再点一次取消）；「创建」→ 文件选择器多选直传 POST /api/assets（uploadAssets）；资产卡悬停新增删除按钮 + 预览浮层删除（都调 DELETE /api/assets/:id）。projectsApi 新增 uploadAsset / deleteAsset；ui.ts 新增 filteredAssets / uploadAssets / deleteAssetById。
- 底栏素材：panelSource.collectUpstreamMaterials 补收音频节点（data.audioUrl）；预览浮层（MediaPreviewOverlay.vue）悬停标题栏露删除按钮 = 断开「素材节点 → 发起节点」这条连线（mediaPreview 会话新增 nodeId / owner 记录）。

验证：plugin-bottom-bar 96（含新增 mediaPreview.test）/ theme-default 248 / ui 105 全绿；theme-default tsc、ui vue-tsc 干净；三个包构建通过。

### 追记（2026-10-06，MediaViewer 按参考 AxImageViewer 重做交互）

用户看了首版预览（只有一个关闭按钮、图片不可操作）不满意，点名照
ax-ui-kit 的 AxImageViewer / AxImage 重做。已拉取其源码逐项复刻：

- **图片变换四件套**：滚轮缩放（25%–500%）、按住拖拽平移、旋转（每次 90°）、水平翻转、一键重置；
- **底部浮动控制条**：页码（多图时）· 缩小/百分比/放大 · 旋转/翻转/重置 · 下载（fetch 转 blob，跨域失败退开新窗口）；
- **左右切换**：宿主传 list（+ index）时出上一张/下一张，Esc/←→/+-/0/R/F 全套键盘快捷键；
- **AxImage 的观感**：右上角悬浮圆角关闭钮、图片 contain 展示、拖拽时 grabbing 光标；
- 本项目差异保留：非图片（文本/视频/音频）仍按 kind 内置渲染、#stage 插槽可扩展、
  悬停删除按钮（宿主给 onDelete 才出现）照旧 —— 变换工具只对图片生效。

接入方（底栏 MediaPreviewOverlay / 生成历史 / 资产面板）props 未变，无需改动。
验证：theme-default 248 / ui 105 / bottom-bar 96 全绿；tsc、vue-tsc 干净；构建通过。

### 追记（2026-10-06，底栏预览换 MediaViewer + 修 z-index 被历史弹窗压住）

用户实测：① 底栏素材卡预览还是旧壳（只改了部分地方）；② 生成历史里点开预览被历史弹窗盖住（MediaViewer z-index 90 < AxDialog 200）。

改法：
- 底栏接入：MediaPreviewOverlay.vue 原来的自绘壳全删，视觉与交互整只交给主题注册的 MediaViewer；本组件只剩「把 mediaPreview 会话状态翻译成 item prop」和「删除 = 断开素材连线」两条业务语义。取件走 useUiComponent("mediaViewer")（不 import 默认主题，避开 T08 依赖方向守卫）。SSR 测试锚点随之更新（mv-root / mv-corner-btn / mv-remove）。
- z-index：MediaViewer 提到 100200 —— 盖过 AxDialog（200）与设置面板（SettingsShell 100000/100001），任何弹窗里打开预览都在最上层。

验证：bottom-bar 96 / theme-default 248 / ui 105 全绿；tsc、vue-tsc 干净；构建通过。

### 追记（2026-10-06，Agent 输入框图片也走 MediaViewer + 修生成历史预览空白）

两个用户实测问题：

1. **生成历史预览空白**：历史卡片的 kind 是中文标签（图片/视频/音频），MediaViewer 只认英文 kind，
全部分支未命中 → 落进空的 #stage 插槽。修法：MediaViewer 里做 kind 归一化（图片→image 等四条别名），
各接入方传中英文都认；同时历史预览地址改走 thumbOf 的同源转换（原始 urls 可能跨端打不开）。
2. **Agent 输入框的图片没有全屏预览**：待发送缩略图与已发送消息图片换成主题注册的 MediaViewer
（原先自己画了个简单遮罩，只能看原始尺寸）。取件走 useUiComponent("mediaViewer")，
待发送缩略图点图本体即预览（× 仍是移除）；自绘的 ac-lightbox 样式删除。

验证：plugin-agent 60 / ui 105 全绿；plugin-agent tsc、ui vue-tsc 干净。

### 追记（2026-10-06，生成历史改 masonry 瀑布流 + 修预览空白）

用户报：① 生成历史预览点开是空的；② 参照 web2api 的 TaskResultGalleryView 把生成历史
改成瀑布流（参考实现方式重绘）。

**修预览空白**：历史卡片传的 kind 是中文（图片/视频/音频），MediaViewer 内置渲染只认英文
→ 落进空 #stage。MediaViewer 里加 KIND_ALIASES 归一化；openHistoryItem 的预览地址改走
thumbOf 同源转换（原 urls 可能跨端打不开）。

**masonry 瀑布流**（照 TaskResultGalleryView 搬入）：
- 新增 packages/ui/src/composables/useMasonry.ts（masonry-layout + imagesloaded 封装；
  **惰性动态 import** —— 这俩库顶层就摸 window，静态 import 会让 SSR/vitest 炸）；
- ModalsArea 生成历史网格改为 masonry 容器：卡片按图片**原始宽高比**展示（onload 后
  写回 aspect-ratio 并触发布局），列数随容器宽度自适应（histZoom 滑杆映射最小卡片宽
  340→120px），首屏 24 张、IntersectionObserver 触底追加下一批（1s 节流）；
  卡片带骨架屏、底部渐变信息栏（尺寸 + 类型·时间）、裂图/无产物退图标卡；innerHTML
  拼接前过 esc() 防注入。
- 依赖：ui devDeps + masonry-layout 4.2.2 / imagesloaded 5 / @types 两个。

**验证**：ui typecheck 干净、105 全绿、构建通过。

### 追记（2026-10-06，三类媒体预览注册件 + 历史卡片优化）

用户要求：音频/视频/文本各抽一个**纯预览组件**、按组件注册方式登记（插件系统支持 ui 目录注册），
历史瀑布流卡片复用；卡片文字缩小、无产物显示为异常、音频/视频卡片要有内容。

**三个预览注册件**（各自插件 apply() 里 registryOf('ui').add）：
- audioPreview：plugin-node-audio/src/AudioPreview.vue —— 从 AudioContent 抽出的纯展示件：
  轮播波形（单层竖条 + is-played 染色）+ 播放头拖拽 + 整条进度条 + 时间；按需算峰值
  （openAudioSource.peaks）与 AudioContent 同一套数学，没有上传/刷新按钮、不读写节点 data。
- videoPreview：plugin-node-video/src/VideoPreview.vue —— video 元素 + hover 显形控件
  （播放/进度/时间，与 VideoContent 同口径），没有裁剪/截图/全屏。
- textPreview：plugin-node-text/src/TextPreview.vue —— 只读文本排版。

**MediaViewer 接入**：全屏预览的 audio/video/text 渲染改为**优先按名取注册件**
（useUiComponent，树外 try/catch 回落 undefined → 原生标签兜底），预览观感跟着插件实现走。

**历史卡片**（ModalsArea buildMediaCard/createMasonryElement）：
- 音频卡：渐变底 + 波形竖条装饰 + 播放圆钮（thumbOf 不再对音频返回 null）；
- 视频卡：封面帧 + 播放圆钮；裂图/无产物 → **异常卡**（警示圆圈「!」+「生成异常 · 无产物」）；
- 卡片文字整体小一档（信息栏 10px、图标卡标题 12px）。

**验证**：ui / plugin-node-audio / plugin-node-video / plugin-node-text typecheck 全部干净；
ui 105 / audio 94 / video 105 / text 31 全绿；ui 构建通过（plugin-node-video 无 vite.config，
其 build 脚本本就不可用，与本次无关）。

### 追记（2026-10-06，节点默认尺寸进设置面板 + 实时生效）

用户问「默认尺寸写在哪、能不能进 config 可视化配置」，并拍板：**实时生效**、作用于**已有 + 新建**、
只针对**没被 resize 过**的节点（有自己尺寸的不动）。

**原状**：默认尺寸是各节点插件注册时的字面量（`ctx.nodes.register({ size: {320,240} })`），
进类型表（`nodeStore.types[type].defaultSize`）后**不可变**；尺寸回落链是「实测 > node.size > 类型默认」，
所以「没被 resize 过」本来就走默认值。

**改法（三层）**：
- **数据层**（`canvas-data/nodeStore.ts`）：类型注册进表时包 `shallowReactive`（**浅**响应：
  只让顶层可追踪、`updateTypeSize` 整体替换 `defaultSize`；不深包装，否则 icon/segments 句柄会变代理、
  破坏引用相等 —— 实测踩过）；新增 `updateTypeSize(type, size)`（原地替换 + notify），
  `NodeStoreService` / `DocService` 各透出这一个方法。
- **作者层**（`canvas-base/bindTypeDefaultSize.ts` 新增助手）：apply 里调一次 —— 首次按设置值写类型表，
  并订阅 `settings.onChange`（改动即重写；随插件 scope 回收）。四个节点插件（image/video/audio/text）
  各加一对 Config（`xxxDefaultWidth/Height`，分组沿用既有「布局/xx节点尺寸」「节点/音频节点」，
  text 新立「布局/文本节点尺寸」），设置面板自动渲染、无需动 UI。
- **渲染层**（`useNodeCardSize`）：watch 类型默认尺寸 —— 只有 `data.cardWidth` **缺失**（没 resize 过）
  的节点才跟随，有自己尺寸的不动；resize 拖拽中不覆盖。

**验证（Chrome MCP）**：改 `imageDefaultWidth/Height` → 400×300 → 320×240，4 张**未 resize** 的图片节点
（7/31/37/39）**实时跟随**（不用刷新）；有显式尺寸的（6/23/26/30…）纹丝不动 —— 正是「只影响没 resize」。
设置面板确认出现「默认宽/默认高」。canvas-data **372** / theme-default **248** / image **111** / video **105** /
text **31** / audio **94** 全绿；canvas-data / canvas-base / canvas-render / 各插件 tsc 干净；ui 已重建、8865 重启。

### 追记（2026-10-06，生成完成后节点尺寸没跟上 9:16）

用户报：AI 生成的 9:16 竖图，节点却显示成 16:9 横的；视频节点同样。Chrome MCP 实测确认：节点 30
的卡片 419×196（≈16:9），而图是 1152×2048（9:16）。

**根因**：节点缺**尺寸字段**。前端图片节点靠 `imageWidth/Height`（视频靠 `videoWidth/Height`）
算卡片比例；AI 用 MCP 建的节点没记这两对（`imageWidth/imageHeight` 全空），于是卡片停在类型默认的
4:3/16:9 —— 竖图被塞成横的。前端本来靠 `<img>` 的 naturalWidth 量，但「尺寸字段」缺失时算不出比例。

**改法（前后端两道）**：
- **后端**（`tasks/mediaSize.ts` 新增 + `taskManager` 收产物时）：读了**已存画布资源**的字节，
  PNG/JPEG/GIF/WEBP → 图片宽高、MP4/MOV（`tkhd`）→ 视频宽高，写进节点的 `imageWidth/Height` /
  `videoWidth/Height`。纯函数带单测（7 条，认不出返回 null 不猜）。
- **前端兜底**（`plugin-node-image` / `plugin-node-video` 的 `onImgLoad` / `onLoadedMetadata`）：
  图片/视频**加载出来时**若卡片尺寸缺失，就用 `<img>.naturalWidth` / `<video>.videoWidth`
  量一次、**连同宽高一起写回**（宽高与 `size` 必须同一次写，否则按比例算卡片那步仍无从下手）。
  这样上传 / MCP / 后台加的图与视频都能自愈，不必依赖后台一定量得出来。

**验证（Chrome MCP + 数据）**：节点 30 现在是 **169×300（比例 0.563 = 9:16）**、图片元素也 169×300；
`canvas.json` 里已落库 `size:{w:169,h:300}` + `imageWidth:1152/imageHeight:2048`。
cloud-server **368** / plugin-node-image **111** / plugin-node-video **105** / ui **94** 全绿；
各处 tsc / vue-tsc 干净 + 产物重建 + 8865 重启。

### 追记（2026-10-06，生成历史缩略图太小 + 点击无预览）

用户报：缩略图高度太小「根本看不出来」，点击也没有预览效果（Chrome MCP 实测：缩略图框只有 **92px**
高、9:16 的竖图被 `object-fit: cover` 裁成一条；点卡片只弹了个 toast）。

**改法（`packages/ui/src/components/areas/ModalsArea.vue`）**：
- 缩略图高度改成**跟「卡片密度」滑杆联动**（`thumbHeight`：滑杆 1→140px … 5→420px，默认 260px），
  并把 `object-fit` 由 `cover` 改成 **`contain`**（竖图整张看得见，不裁切）。
- 点卡片**打开预览浮层**：图片放大显示（`max-height 80vh`）、视频/音频用原生播放器；右上角可下载；
  点空白处或 **Esc** 关闭。没有产物的老记录给一句提示（不弹空窗）。悬停时右下角露「点击放大」提示。

**验证（Chrome MCP）**：缩略图高度随滑杆 134↔403px 变化（默认 260）；点第一张有图的卡 → 预览浮层打开、
显示 1152×2048 的大图；Esc 关闭成功。ui **94** 全绿 + vue-tsc 干净 + 构建通过。

### 追记（2026-10-06，修「生成历史缩略图裂图」）

用户报：历史记录依然加载不出来（截图里前几行是**裂图**）。用 Chrome MCP 进页面实测：卡片渲染了，
但 `<img>` 的地址是 `/api/canvases/<画布>/resources/chat-auto-982345f0.jpeg` —— 带 `-`，被资源接口的
`isSafeResourceName`（只认 `^[0-9a-f]{16}(\.[a-z0-9]+)?$`）判为**非法路径 → 400**，所以全是裂图。

**根因**：历史里存的是 **provider 的原始地址**（`http://localhost:8033/.../chat-auto-982345f0.jpeg`），
前端 `thumbOf` 只是把文件名拼到同源地址上 —— 而资源是**按内容哈希**存的，文件名对不上。

**改法**：`TaskManager.finish` 里 `writeMediaFields` 现在返回**同源地址**，并**回填进 `result.urls`** ——
于是**历史、runState、节点媒体字段三处都存同源地址**（前端缩略图直接用它，不再靠猜文件名）。

**存量数据已迁移**：跑了一次迁移，把历史里 19 条 + 节点 6 个的 provider 原始地址抓回存进画布资源目录、
换成同源哈希地址（default 画布 3 条 + 2 个节点）。另外 11 条更早的历史（6 个节点已删 / 5 个无可用产物）
本来就取不回产物，卡片回落成类型图标（不再是裂图）。

**验证（Chrome MCP）**：历史 20 张卡、6 张真实缩略图**全部 200 且加载成功**，`bad: []`（无 400），
画布上「图片已失效」文案消失；计数「图片 22 / 音频 16」。cloud-server **360** 全绿 + tsc 干净 + 产物重建 + 8865 重启。

### 追记（2026-10-06，修「生成后图片已失效」+「提示词没写进节点」）

用户报：① 任务完成后节点显示「**图片已失效**」；② 底栏看不到提示词 —— 希望生成时把**提示词与参数**
一起写进节点，点开节点就能看。

**根因 A：上一轮的「同源地址」是凭空拼的**。`TaskManager` 把产物地址改成
`/api/canvases/<画布>/resources/<原文件名>` 写进节点，但**文件名是从 provider 的地址猜的**
（`chat-auto-982345f0.jpeg`），而产物**从没真的落进画布资源目录** —— `onArtifact` 只把 url 登记进
资产目录（`assets/index.json`），没抓字节。于是节点指向一个不存在的文件 → 404 → 图片节点显示「已失效」。
改法：`writeMediaFields` 改成**先 `saveResource` 抓字节落盘**（按内容哈希命名），再把 `saveResource`
返回的**确实存在**的同源地址写进节点（`imageUrl`/`audioUrl`/`videoUrl`）。加了 `fetchArtifact` 注入点
（测试不去连真地址）+ 30s 超时（取不到也不能让终态一直等）。

**根因 B：`generation_create` 没把提示词/参数写进节点**。节点只有 `runState` 与 `barValues`，没有提示词。
改法：下单前把 `data.barValues = {...values, actionId}`、`data.barPrompt = prompt` 写进目标节点 ——
与底栏同一套字段，用户点开节点（底栏重挂载）就从这两个字段恢复，看到的就是 AI 这次用的内容。

**已把用户那张坏节点修好**：节点 30 的产物还在 web2api（3.85MB），已抓回存进画布资源目录并把 `imageUrl`
指向新哈希地址。Chrome MCP 实测：节点 30 的图正常显示（1152×2048）、整页无「图片已失效」。

**验证**：cloud-server **360** 全绿 + tsc 干净 + 产物重建 + 8865 重启；plugin-agent 60 / ui 94 全绿。
新增用例：产物真的落盘（`fs.access` 断言文件存在）、`generation_create` 写回 `barPrompt`/`barValues`。

### 最近完成（2026-10-06，生成历史看不到内容 + Agent 没在画布上建节点）

用户报两条（附浏览器截图 + 一份 Agent 请求日志 `11.txt`）。

**一、生成历史「看不到对应内容」**（Chrome MCP 实测确认并修好）
- **计数全是 0**：徽章的标签是中文（图片/视频/音频），而后台 `byKind` 的键是英文
  （image/video/audio）→ `byKind['图片']` 恒为 undefined。加一道中英转换（`histCount`/`assetCount`）。
- **卡片只有通用图标、没有缩略图**：`ModalsArea` 只画了 `kindIcon`，根本没渲染 `item.urls`。
  改成有产物就画缩略图（同源地址 `/api/canvases/<画布>/resources/<文件名>`），没有才退回图标。
- **「本画布」写死 `default`**：切到别的画布后筛的是 default 的历史。改用 `currentCanvasId`。
- **筛选条件不重拉**：改了范围/类型/评级/排序后列表纹丝不动。加 watch（仅弹窗开着时重拉、回第 1 页）。

**二、Agent 在画布上看不到节点**（日志 + 数据三方对齐，找到根因）
- **根因 A：MCP 写死 `default` 画布**。所有画布 MCP 工具都绑在启动时那个默认画布的 `CanvasDocument` 上 ——
  AI 就算把用户的 `canvasId`（`430…`）传进来也没用，节点全落进 `default`，用户在 `430…` 上什么都看不到。
  改法：给所有读写工具加 `canvasId` 参数 + 按画布取文档（`resolveDoc`，**先确认画布存在**，
  否则报「画布不存在」而不是静默写 default）+ 新增 `canvas_list_canvases` 让 AI 发现该写哪张。
- **根因 B：产物没落到节点**。AI 用 `resource_upload` 把图传上来了（**确实上传了**），但没设 `data.imageUrl`，
  节点只有 `runState.urls` —— 图片节点没 `imageUrl` 就不显示。前端那条路是底栏 applier 写这个字段；
  MCP 下的单没有底栏。改法：`TaskManager` 在终态按节点类型写媒体字段（imageUrl/audioUrl/videoUrl，
  **同源地址**），并把「产物先收进画布资源目录」提到「写媒体字段」之前（顺序反了会显示空白）。
- **根因 C：参考图根本没传**。provider 的参考图只认 `input.resources`（上游素材），而 MCP 下单没传 ——
  AI 猜路径、读不到、绕了好几轮。改法：`generation_create` 从目标节点的**入边**自动收集参考图
  （与底栏「连进来就算素材」同一套语义），纯函数 `collectReferenceResources` 带单测。
- **系统提示词重写**（两条内置）：写清「先定画布 id，之后每次读写都带同一个 canvasId」「生成=建节点」
  「有参考图先 canvas_add_image 建参考节点」「产物由后台写回，别自己下载/上传/搬运」「别空转 Start-Sleep」。
  引用引导块也补了一句「用 canvasId+nodeId 查，别用本地文件猜路径」。
  **注意**：提示词存在后台 KV，已存在的老库存不会自动升级 —— 本次已用接口把两条内置提示词换成新版；
  新装的库直接落新版 DEFAULT_PROMPTS。

**验证**：cloud-server **359** 全绿 + tsc 干净 + 产物重建；plugin-agent **60** / ui **94** 全绿 + 类型检查干净。
8865 已重启。Chrome MCP 实测：生成历史计数 **图片 21 / 音频 16**（不再 0）、卡片画出真实缩略图（20 张卡 5 张有图）；
`tools/list` 11 个工具、`canvas_list_canvases` 列出「我的111=430…」、带 canvasId 读写命中对应画布、
不存在的画布明确报错。

**未做**：Agent 端到端「建节点→连线→生成→图落到节点」没有在真模型里跑一遍（要真下单/烧额度）。

### 最近完成（2026-10-06，修「自带画布 MCP 检测出 0 个工具」）

用户报：Agent 的 MCP 检测里 `canvas` 显示「**0 个工具**」。

**根因**：内置画布 MCP 的工具名带 `.`（`canvas.get` / `resource.upload` / `generation.create` …）。
Agent 用的 SDK 会把服务名拼成前缀（`mcp__canvas__` + 工具名）来当 LLM 工具名，而它只接受
**字母 / 数字 / 下划线 / 短横线** —— 于是 `mcp__canvas__canvas.get` 非法，**十条全被跳过**。
`/api/agent/mcp/probe` 返回 `servers[canvas].tools = 0` + 10 条 `skipped: the prefixed name is
not usable as an LLM tool name` 警告，正是这个原因。

**改法**：工具名 `.` → `_`（`canvas_get` / `canvas_overview` / `canvas_add_image` / `canvas_batch_nodes` /
`canvas_batch_edges` / `resource_upload` / `resource_list` / `generation_actions` / `generation_create` /
`generation_status`）。同批改掉调用方：`src/__tests__/{mcpServer,events,routes,agentApproval}.test.ts`、
`e2e/{mcp-e2e,realtime-e2e}.ts`、注释里的旧名。新加一条**回归测试**：TOOL_LIST 里每个名字必须匹配
`^[A-Za-z0-9_-]+$`，且 `mcp__canvas__<名>` 不超 128 字符 —— 带点的名字会被它当场拦下。

**验证（2026-10-06）**：cloud-server **350** 全绿 + tsc 干净 + 产物重建；8865 重启后
`/api/agent/mcp/probe` 里 `canvas` = **10 个工具、0 警告**；再走真 MCP 协议 `tools/list` 拿到那 10 个、
`tools/call canvas_overview` 返回真实画布（nodeCount 6）。

**遗留**：`packages/mcp-server` 是另一套独立后端，它的工具名仍是 `canvas.get` 那种带点写法。
它**不是** Agent 挂载的内置画布 MCP（Agent 挂的是 cloud-server 的 `/mcp`），所以不影响本次问题；
若那个服务将来也接给 SDK 用，同样要改名。

### 追记（2026-10-06，第一批：合并修复 + 工具折叠 + 消息 hover 操作条）

用户确认三分支方案后开工第一批。

1. **修「三个工具没合并」**：根因如前述 —— UI 把整轮思考并进顶部折叠块统一展示，
   中间不渲染；但 `groupTurnBlocks` 把思考当**分界线**，于是工具在数据层被思考拆成三组。
   **修法**：思考不再是分界线（只有正文文字是），思考统一并成一块且**始终排在最前**
   （与顶部「思考过程」折叠块对齐）。新增 2 条测试（思考夹中间不拆组 / 文字仍是分界线）。
2. **工具可折叠展开**：单工具（含组内每个工具）改可折叠行 —— 收起 = 图标 + 名字 + 结果摘要；
   展开 = 「输入」「输出」两块，展开块 `max-height:320px` + 内部滚动（用户要的最大范围+滚动条）。
   要审批的工具卡保持始终展开（审批参数必须直接可见）。
3. **消息 hover 操作条**（照参考图 2）：用户消息右下角 hover 浮出「时间 · 复制 · 编辑」。
   时间来自转录的 `ts`（`10月6日 14:20` 格式，跨年带年份；`sessionModel.load` 透传）；
   复制成功短暂打勾；**编辑** = 把那条消息的提示词 + 图片回填到底部输入框（图片回附件区），
   即「恢复那次发送」—— 分支（fork）的回填半步，分支切换在第三批接上。

**注**：历史会话标题改动（并发会话做的「标题模型起名 + 剥标记」）与本批不冲突：
标题只影响会话列表显示，转录回合结构与 `ts` 透传都未变。

**验证**：plugin-agent **62** 全绿（新增 2 条）；`vue-tsc` 干净；主题色卫生检查通过；ui 构建通过。

### 追记（2026-10-06，@ 引用标签加深底色）

用户报：@ 出来的标签（用户消息里的引用 chip 与输入框里的那颗）**底色太淡、不好区分**，
亮暗两套主题都要改。**根因**：两颗 chip 都用 `--ui-hover-soft`（亮 `rgb(0 0 0/0.035)`、
暗 `rgb(255 255 255/0.05)`）—— 那几乎看不见；更糟的是**用户气泡自己的底色也正是它**，
于是标签与气泡同色、彻底糊在一起。**改法**：两颗一起换成 `--ui-hover-strong`
（亮 `0.10`、暗 `0.15`），亮暗各一档、自动跟随主题。已重建 ui 产物。

### 追记（2026-10-06，恢复「正在思考」加载态）

用户报：上面那次「顺序 + 合并」改动，把 AI 回复里的「正在思考」加载状态弄没了。
**根因**：显示条件被我收紧成 `!t.steps?.length && !t.text` —— 而模型常常**先吐「思考」**，
那会先往 `steps` 里塞一块，于是加载行在正文出现前就被自己藏掉。
**改法（用户澄清后）**：它就是个**加载指示**，只认「这轮还没结束」（`t.streaming`）——
整个回复期间一直显示，不管在打字还是调工具。已重建 ui 产物。

### 最近完成（2026-10-06，Agent 对话「顺序 + 合并」+ 自带画布 MCP 锁）

用户报两条：① 对话里工具与文本**没有先后顺序**（所有工具被堆在最开头）；② 自带画布 MCP
**能被删掉**，且要求「检测到没有就自动加回来，保证每次工作都有它」。

**顺序 + 合并（前端）**
- 根因：`sessionModel.ts` 里助手一轮只有 `text / thinking / tools` 三个**累加槽**，一收到工具
  就把到达顺序抹平了；`AgentConversation.vue` 又固定按「工具 → 正文」渲染。
- 改法：加 `steps: TurnStep[]`（真正记顺序：每块文字/思考/工具各占一步）；`text` / `thinking`
  改由步骤**现算**（唯一真相，不再两处漂移）。`final` 落块语义保留（delta 已写就整块替换，
  不显示两遍），`done` 时清「开着的块」，避免下一轮 final 误替换上一轮尾块。
- 新纯函数 `turnBlocks.ts` 的 `groupTurnBlocks`（照 `codex-base-ui` 的 `useGroups`）：文字是
  分界线，**中间没有文字的多个工具合并成一组**，连续思考并成一块。组件按行渲染，单工具照旧
  （卡片/一行），多工具折成「N 个工具调用」可展开。回放（`load`）也把转录的先后顺序还原成 steps。

**自带画布 MCP：删不掉 + 缺了自动补（前后端）**
- 后端 `AgentConfigService`：记下 `builtinCanvasUrl`；**读清单时自愈**（`healBuiltinCanvasMcp`，
  缺了就补、地址不对就纠正、并写回磁盘）；`mcpServers()` 给那条打 `builtin: true`；
  `removeMcpServer('canvas')` 直接拒绝（界面是提示，接口才是真拦截）。
- 前端 `McpPage.vue`：`builtin` 那行**不画删除按钮**，显示「自带 · 不可删除」。
- 顺带修**真 bug**：内置 MCP 地址原来在 listen 之前用**请求的**端口写死 —— `port: 0` / CLI 换端口
  兜底时落成 `http://127.0.0.1:0/mcp`（连不上的地址）。现在 listen 回调里用**真实端口**再纠正一次。

**验证（2026-10-06）**：cloud-server **349** 全绿 + tsc 干净（新增 `builtinCanvasMcpLock.test.ts` 4 条：
删不掉 / builtin 标记 / 磁盘删除后自动补回 / port:0 用真实端口）；plugin-agent **60** 全绿 + tsc 干净
（新增 `turnBlocks.test.ts` 8 条 + sessionModel 顺序用例）；ui **94** 全绿 + vue-tsc 干净 + 构建通过。
**8865 已用新产物重启**：`/api/agent/config` 里 `canvas` 自愈成 `http://127.0.0.1:8865/mcp` 且 `builtin=true`；
`DELETE /api/agent/mcp {name:'canvas'}` → **404「自带画布 MCP，不能删除」**，canvas 仍在。

**未验证**：画布内 UI 的真实观感（顺序/折叠组/删除按钮）没在浏览器里看过 —— 本会话没有可用的
浏览器工具；已用构建产物内联（`dist` 含新代码）与纯函数单测覆盖。

### 追记（2026-10-05，修「UI 发参考图仍带坏地址」）

用户给的 web2api 输入参数截图：`referenceImages: ["/api/canvases/430c8f1f00bd4aba/resources/xxx.png"]`，
web2api 报「图片不存在（已尝试 ...\uploads\api\canvases\...）」。**真凶**：

- 前端（渲染层）会把节点里的 `res:<hash>` **展开成** `/api/canvases/<画布id>/resources/<hash>` 再交给后台；
- 但 `TaskManager.resolveInput` 只对 **`res:` 开头**做转换 → 路径形态被**原样**发给 web2api。

改法：`parseResourceNameFromUrl`（认 `/api/canvases/<id>/resources/<hash>`，画布 id 必须匹配防串）
+ `resolveInput` 对**任何给了 url** 的参考图都走一遍解析（以前只认 `res:`）。

**验证（按用户要求走真实 UI）**：画布 `430…` 上选中节点「图片 6」（上游连着一张图片）→ 点底栏「发送」
→ web2api 收到 `referenceImages: ["/c4d6295512…png"]`（上传后的 SHA256 地址）、任务跑到 40%
（`正在发送并等待豆包回复...`），不再「图片不存在」。新增 `resourceNameFromUrl.test.ts` 5 条。
cloud-server **345** 全绿 + typecheck 干净 + 产物重建、8865 已重启（web2api 用 tsx 非 watch，也已重启）。

### 最近完成（2026-10-05，参考图改为「先上传拿地址」）

用户澄清架构：**cloud-server 与 web2api 是两个独立后台服务**（可能不在同一台机器），cloud-server 只是
web2api 的一个客户端。要求：web2api 提供**独立上传接口**（MCP + HTTP），客户端先上传拿到地址、
再用地址生成任务；生成任务也支持 data URL。

**web2api 侧（由子代理完成，`D:/Code/Git/web2api`）**
- 新增 HTTP `POST /api/resources/upload`（multipart，字段 `file`）与 MCP `system/upload-resource`
  （base64 / data URL）；两者共用 `utils/upload-resource.ts`（SHA256 去重落盘），返回 `url` / `relPath` 等。
- 任务提交前统一归一参考图：`/api/resources/uploads/<x>` 视为本机文件、data URL 落盘、相对路径原样。
- 测试：`npx vitest run` 全量 **1191 通过**（新增 upload-resource 16 条）。

**cloud-server 侧**
- `TaskManager.resolveResourceUrl` 由「拼 URL」改为**读画布资源字节 → data URL**（数据层，通用、跨服务器安全）。
- web2api provider 新增：`data URL / cloud-server 地址 / 外部 URL` → 先经 MCP `system/upload-resource`
  上传成 web2api 本机文件，用返回的 `referenceUrl`（`/<hash>.png`）下单；已是 web2api 资源地址 / 相对路径的原样用。

**真机端到端（8865 + web2api 8033）**：带参考图下单 → web2api 日志里 `referenceImages` 是
`/c4d6295512...png`（上传后地址）、`图片不存在` **0 条**、任务 `done 100%`、节点拿到 `imageUrl`。
cloud-server **340** 全绿 + typecheck 干净 + 产物重建；**8865 与 web2api 都已重启**。

### 追记（2026-10-05，参考图问题：端到端确认修好）

用户给的 web2api 执行日志坐实了根因：
`doubao/chat-auto` 报 **errorCode 4002「图片不存在（已尝试 C:\...\web2api\uploads\api\canvases\...\resources\x.png）」** ——
即参考图被当**本地文件**去 uploads 找。web2api 的 `utils/reference-images.ts` 对参考图分三类：
`http(s)://` / `/api/resources/` 会**下载**；`data:` 会**落盘**；其它按「相对 uploadsDir」拼路径。
我此前的相对地址 `/api/canvases/...` 落进了第三类 → 报错。

**改成绝对地址后实测（8865 真机 + web2api 日志）**：`referenceImages` 现在是
`http://127.0.0.1:8865/api/canvases/<id>/resources/<hash>.png`，web2api 走「下载」分支，
任务**顺利完成**（`status: completed`）、节点拿到 `imageUrl`，日志里**真实错误 0 条**。

**注意**：`resolveResourceUrl` 里的 origin 取的是 **cloud-server 自己的监听地址**（`http://127.0.0.1:8865`）。
若 web2api 与 cloud-server 不在同一台机器，这个回环地址它下载不到 —— 跨机要把它配成对 web2api 可达的地址。

### 最近完成（2026-10-05，参考图地址 / 重复下单 / 音频进度复核）

用户报三条（并怀疑代码被别的 Agent 覆盖）。先核对：`docForCanvas`（上次修的「进度卡 0」）**仍在**。

1. **参考图地址拼错**（`.../web2api/uploads/api/canvases/<id>/resources/x.png`）：
   `server.ts` 的 `resolveResourceUrl` 返回的是**相对路径** `/api/canvases/...`，
   而 web2api 会把相对路径当**它的本地文件路径**去读 → 拼出那个错地址。
   改成**绝对地址**（带服务 origin）；origin 在 `start()` 拿到真实端口后再刷新一次（端口可能是 0）。
   新增 `resourceUrl.test.ts`（3 条）锁住。
2. **连点「发送」创建多个任务**：加**两道闸门** ——
   服务端：`createJob` 里同一（canvasId, nodeId）已有 running 任务就**直接拒绝**（返回 409
   「该节点已有任务在进行中」），`/api/jobs/active` 供前端查询；
   前端：`NodeBottomBar` 的发送按钮提交后同步置 `submitted` 并 `disabled`（挡掉"点击到 runState 落盘"
   那几百毫秒的连点），`onRun` 里也有同步守卫。新增 taskManager 用例 1 条（重复下单被拒、别的节点不误伤）。
   注意 `/api/jobs/active` 必须注册在 `/api/jobs/:jobId` **之前**（Hono 先注册者优先，否则被 :jobId 吃掉）。
3. **音频进度**：实测当前 8865 上音频任务进度**写进节点正常**（下单一 → 进度推进 → done 100%），
   产物 `audioUrl` 也落到节点上（applier 正常）。此前「卡 0」就是上一次修掉的 `docForCanvas`。

**验证**：cloud-server **341**、plugin-cloud-client **129**、plugin-bottom-bar **87**、ui **94** 全绿
+ 各包 typecheck 干净 + 全部重建；**8865 已用新产物重启**。真机：参考图地址绝对化；
重复下单 → 409；`/api/jobs/active` 查到在跑任务。

### 最近完成（2026-10-05，修「生成进度一直卡 0%」）

用户报：图片生成进度一直卡 0%，刷新页面还是 0。

**根因（与「切画布丢改动」同源，只是换了个写入口）**：`TaskManager.writeRunState` 固定用
`this.deps.doc`（**默认画布**的 `CanvasDocument`）写节点进度。而任务是在**它所属的那张画布**上下的
（用户这张画布 id 是 `430c8f1f00bd4aba`）—— 于是进度被写进 `default`（那里根本没有那个节点 id），
`batchNodes` 的 update 找不到目标节点 → 静默返回（不报错），`writeRunState` 也不告警。
表现就是节点永远停在 0%（提交帧可能压根没写成功、或用户看到的是上一次的残留）。
任务本身在 web2api 侧是**成功**的（实测 get-task 100% + 有产物），所以「后台没问题、前端卡 0」很有迷惑性。

**修法**：`TaskDeps` 加 `docForCanvas?(canvasId)`；`writeRunState` 按 `job.canvasId` 取对应文档
（`deps.docForCanvas?.(job.canvasId) ?? deps.doc`）；`server.ts` 注入
`(canvasId) => canvasId === DEFAULT_CANVAS_ID ? doc : new CanvasDocument(canvasStore, canvasResources, canvasId)`。
和 canvasOps 路由用的是同一套「按画布 id 现建文档」。

**验证**：cloud-server **335** 全绿（taskManager 新增 1 条：任务写进 `other` 画布、`default` 上同名节点不被写）
+ tsc 干净。真机（8880 源码服务 + 真实数据）：对 `430c8f1f00bd4aba` 的画布下单 → 节点进度
**0 → 30 → done 100%**（带 `urls`），不再卡 0。`cloud-server` 产物已重建，**8865 服务已用新产物重启**。

**注**：测试用的节点 10 的 `runState` 已清空（回到空闲），其 `imageUrl` 仍为空 —— 是缺少 image applier
把产物落到节点的独立问题（见下条待办），不影响本次「进度卡 0」的修复。

### 追加（2026-10-05，音频地址一变就重算波形）

用户口径：**只要播放地址（audioUrl）变化，就自动刷新波形**。
场景：先上传本地音频（节点上已有波形+时长），再用底栏动作生成新音频 —— 新地址写进来了，
但节点上还留着**上一段**的波形，而 `ensureAudioMeta` 见「波形+时长都在」会跳过 → 画的是旧音频的波形，
得点右下角「刷新」才对。

改法（`plugin-node-audio/AudioContent.vue`）：`audioUrl` 变化的 watch 里，地址非空时调
`reanalyzeAudio`（**无条件**按当前地址重新解码并覆盖波形/时长），不再用 `ensureAudioMeta`
（它会因为旧波形还在而跳过）。

**验证**：plugin-node-audio **94**（新增 1 条：地址换成新音频后重算的是新地址、时长同步更新）
+ ui **94** 全绿 + tsc/vue-tsc 干净 + 构建通过。Chrome 实测：把音频节点的地址换成真实音频后，
波形**自动**变成新音频的形状（DOM 竖条 196 根、有真实起伏），无需点刷新。

### 最近完成（2026-10-05，侧栏命名/过滤 + 音频波形时序）

用户报的四条：

1. **侧栏名字与画布不一致**：`nodeDisplayName` 兜底给类型名加了「节点」后缀、且会把节点文本当名字。
   改成与画布节点标题对齐 —— 优先 `data.label`（用户改名 → 画布/侧栏同时变），其次节点自带名
   （`imageName`/`audioName`/`videoName`/`title`），都没有才回**类型名**（分组 / 文本 / 图片 / 音频 / 视频），
   **不加后缀、不拿文本当名字**（用户口径）。
2. **搜索右侧「过滤」下拉不生效** → 抽出纯函数 `canvasTree.filterTree`：类型过滤（全部/图片/视频/
   音频/文本/分组）真正生效，分组保留并自动展开；补 `filterTree` 单测 6 条 + `音频` 不再被当成图片
   （`iconOf` 补 audio，TreeNode.icon 联合类型加 'audio'，抽屉图标与过滤项都加「音频」）。
3. **隐藏「所有评级」下拉**：侧边栏画布 tab 里的那个已移除（历史弹窗里那个保留）。
4. **音频波形初次不显示、点刷新才出来**：根因是**时序** —— 音频是「节点先建、音频后写入」，
   挂载那一刻 `audioUrl` 还是空的，`ensureAudioMeta` 直接 return，之后再没人补。改成 `audioUrl` 变化时
   再补一次（已齐时零开销早返回）。

**验证**：ui **94**、plugin-node-audio **93** 全绿 + `vue-tsc` / `tsc` 干净 + `vite build` 通过；
Chrome 端到端（8879 源码服务 + 真实数据）：侧栏名字为「分组 / 文本 / 图片 1 / 音频 1 / 音频 2」（无「节点」后缀）、
「所有评级」已不在、选「图片」过滤后音频/文本被过滤掉、音频波形**初次就渲染**出竖条。

**注**：音频节点「生成完成后变成图片节点」——后台生成结果由 action 声明的节点类型决定，不在本次改动范围。

### 最近完成（2026-10-05，节点默认名统一：注册时模板 → 建节点时生成 → 处处同源）

**用户报的问题**：画布节点标题显示的是英文 type（`text`/`image`）；Agent @ 菜单显示的
是文本内容首行 / 图片文件名；左侧画布树又各显示一套 —— 同一个节点三处三个名字。
根因是**谁都没为新节点写过名字**（`addNode` 建出来 data 是空的），标题条只能回落 props.type，
@ 菜单与左侧树各自按字段猜。

**改法**：名字只有一个来源 `data.label`。
- 注册时声明模板：`ctx.nodes.register({ ..., nameTemplate: '图片 {{ID}}' })`
  （`{{ID}}` = 该类型自己的递增序号，**按类型独立计数**；`{{NAME}}` = 类型 label；不写则 `label {{ID}}`）。
- 建节点时由数据层统一生成（`nodeStore.addNode/addNodes` → `nextDefaultName`）；
  `replaceAll` 回填时重建每类型序号，不与被恢复的旧名字撞号。
- 三处读取统一为 `data.label`（读不到才回落类型中文名）：
  `BaseNode` 标题条（`useNodeCapability` 新增 `label` 兜底）、Agent @ 菜单、左侧 `canvasTree`。

**验证**：canvas-data 370、canvas-render 415、ui 86、theme-default 248、group 47、
五个节点插件全绿；编辑器 16 / agent 51 / cloud 330；各包 typecheck 干净。
浏览器探针 `packages/ui/e2e/node-name-probe.mjs`：新建节点标题条与 @ 菜单都显示「文本 1」。

### 最近完成（2026-10-05，左上角名字=当前画布名）

用户澄清口径：左上角那个可编辑名字应该是**当前画布的名字**（双击即改这张画布），
下拉菜单里列出的也是这些名字；右侧小胶囊只作位置提示（「画布 + 索引」）。

- `ProjectCluster.vue`：可编辑输入框绑定 **canvas（当前画布名）**，事件由 `rename-project` 改为
  `rename-canvas`（改的就是当前画布）；下拉项仍列出画布名清单。
- `ui.renameCanvas(name)`：写回 `/api/canvases/:id/meta`（后端同时更新索引与 canvas.json 的 name），
  本地即时更新 + `refreshCanvasList()` 拉回真值；两处调用点（TopLeftArea / LeftDrawer）同步改。
- 工作区/项目名（`state.projectName` + `renameProject`）保留但不再绑在这个输入框上（项目名另有归属，
  见项目页 `ProjectsPage`）。

**验证**：ui **85** 全绿 + `vue-tsc` 干净 + `vite build` 通过；Chrome 端到端：名字框显示当前画布名（「我的111」）、
改名 → 索引与输入框同步、下拉列出「画布 1 / 我的111」、切换画布后名字框与胶囊都跟着变。

### 最近完成（2026-10-05，修「切画布丢改动」根因 + 侧栏缩略图/命名）

用户报：「下拉切换画布后发现之前的修改都没保存」「侧栏图片节点不显示」「顶部下拉没跟随左侧名」
「工作区名变成只读的『我的项目』」。

**保存丢数据的根因（真凶，跨三层）**：
- 增量保存接口 `POST /api/canvas/nodes` **不带画布 id**，服务端 `CanvasDocument` 绑死在 `default`
  （`mcp/canvasDoc.ts` 的构造参数）。于是**任何非默认画布**的改动都被写进了 `default`（= 丢失）。
  实测：新建画布 X 里加节点、切走 → X 文件仍是空的，写请求全打到 default。
- 修法（从头到尾贯通画布 id）：`/api/canvases/:id/nodes|edges` 新增（`routes/canvasOps.ts`，按 `:id`
  现建 `CanvasDocument`）；`plugin-cloud-client` 的 `api.patchNodes/patchEdges` 带画布 id、
  `CanvasDiffAdapter` 每次操作**现读**当前画布（`cid()`，不再构造时定死 —— 那时 hash 路由还没落地会回落 default）。
- 附带两处加固：`SaveService.flush` 串行化（并发 flush 会「立刻返回」而没等真正写完，守卫以为存完了）；
  路由守卫 `beforeEach` 在**离开画布前先 await 落盘**（`composables/pendingSave.ts`），覆盖下拉切换/
  浏览器返回/改 hash 所有路径。

**界面三条**：
- 侧栏图片/视频节点显示**缩略图**（`canvasTree.nodeThumbUrl` 取 imageUrl/posterUrl…，抽屉里 <img> 渲染）。
- 画布下拉：默认画布显示「画布 1」（`canvasOptions` 把没真名字的显示成「画布 N」，不露 `default`）；
  工作区名读后端项目名（`loadProjectName`），改造后**仍可编辑**（`renameProject` 写回 `/api/projects/:id`）。

**验证**：cloud-server **330**、cloud-client **127**、ui **85** 全绿 + 三个包 typecheck 干净；
Chrome 端到端：新画布加节点 → 切走 → 文件里在（保存修复）；侧栏缩略图真加载（naturalWidth 320）；
工作区名「我的项目」可编辑、显示真名、下拉「画布 1/画布 2」。`cloud-server` 与 `plugin-cloud-client` 产物已重建。

**注**：用户报的 `imageName` 出现 `undefined_...` 是**生成上游**给的文件名（不是显示 bug）。

### 最近完成（2026-10-05，修用户报的 UI 一串问题）

用户对上一轮「项目/画布/资产」提的 7 条，逐条修：

1. **分组节点被丢 + 名字不跟随**（最要紧）：`plugin-cloud-client/restore.ts` 恢复时按 `knownType`
   过滤节点，而 `group` 是**云清单运行期热装**（注册晚于恢复）→ 分组节点被过滤掉、子节点变孤儿平铺。
   用户实测现象正是「分组没了 / 名字不跟随」。改：恢复**一律保留**节点（丢节点=用户数据消失，
   orphan 由渲染层兜底）；`restore.test.ts` 那条断言从「过滤掉」改成「保留」。
2. **分组名读错字段**：分组名在 `data.label`（外壳标题条双击改的就是它），`canvasTree.ts` 原来没读 → 补上；
   同时类型优先 `data.nodeType`（渲染层可能包成 custom），图片/视频名走 `imageName`/`videoName`。
3. **下拉显示 `default`**：`ui.canvasOptions` 给「没有真名字」的画布显示「画布 N」（按清单顺序），
   有自定义名就用自定义名 —— 用户口径「要么画布1、要么我的命名，不露内部 id」。
4. **工作区改名不生效**：原来只改本地 `state.projectName`（没写后端）。改：`ui.renameProject()` 写回
   `/api/projects/:id` 项目名（工作区命名 = 项目文件夹名），进入时 `loadProjectName()` 读回。
5. **项目页左栏切不了**：`ProjectsPage` 的 首页/项目/资产 做成真页签（切主区内容，资产页拉 `/api/assets`）。
6. **项目页不支持主题**：读 KV `config/themeMode` + 右上主题切换按钮（写回同一键，与画布工作台同一套 token）。
7. **点侧栏节点居中「效果极差」**：`locateNode` 原来只 `setCenter(x,y)`（节点左上角）且无缩放。改成
   **选中节点 + 用 nodeLayout 实测矩形算中心 + 保留缩放**（退路 `fitView(opts.nodes)`）——与「F 聚焦同一套取景」。

**验证**：cloud-server **327** 全绿；cloud-client **126** 全绿；ui **85** 全绿（canvasTree 补 2 条）+ `vue-tsc` 干净 + `vite build` 通过；
`plugin-cloud-client` 与 `cloud-server` 产物已重建。Chrome 端到端（8878 源码服务 + 真实数据目录）：
分组「发的发大」+ 两个子节点都在（共 3 节点）、画布下拉显示「画布 1 / 画布 2」不再有 default、
工作区名显示「我的项目」、项目页页签与主题切换可用。

**注**：用户报的「左侧 table 无法切换」我按「项目页左栏页签」理解并做成可切换。

### 最近完成（2026-10-05，Agent 引用改成「只给钥匙不给内容」+ 模式提示词）

**用户报的问题**：技能引用 = 把 SKILL.md 全文贴进每条消息 → 引用几次上下文就爆、内容完全重复；
「全能创作 / 剧本创编」那个下拉是个死开关（选了不影响任何行为）；节点不能被 @。

**改法（设计见 `docs/design/agent-reference-and-modes.md`）**：
- **引用标记**：输入框里存的是**一段纯文本**，引用 = 文本里的标记 —— `@[skill:名](说明书路径)`、
  `@[mcp:名]`、`@[node:名](画布id#节点id)`。删掉标记即引用失效。
- **后台只给钥匙**：技能**不贴正文**，只写一句「说明书在 <路径>，需要时自己 read_file」（懒读）；
  节点**不贴内容**，只给画布 id + 节点 id，引导模型用**内置画布 MCP** 自己去查；
  MCP 靠标记决定这次连哪几个服务。发送时不再带 `skills`/`mcpServers` 特殊属性。
- **内置画布 MCP**：cloud-server 启动时把自己的 `/mcp` 端点写进 Agent 的 MCP 清单
  （默认携带、用户零配置；`builtinCanvasMcp` 可关，测试用）。
- **模式 = 两套系统提示词**：清单住后台 KV（`config/agent-prompts`，用现成 storeAdapter）；
  设置 → Agent → 提示词 里可增删改，内置两条**不可删**。模式是**会话级**的（SDK 把系统提示词
  钉在建会话那一次），切模式会开一条新会话才真正生效。
- **@ 节点 + 点标签聚焦**：@ 菜单新增「节点」分组（订阅 doc 实时更新），搜索词过滤 + 前 5 项；
  点节点标签让画布 `viewport.setCenter` 聚焦到该节点。

**验证**：prosemirror-editor-bundle 16/16、plugin-agent 46/46、cloud-server 327/327、ui 83/83；
浏览器探针 `packages/ui/e2e/reference-probe.mjs` 通过；真服务里 `system_config.yaml` 自动多出
`canvas` 服务、`GET /api/agent/prompts` 返回两条内置。

**留的接口**：节点读取没有新增工具（用户后台在更新）—— 引导语只说「用画布 MCP 查」，不绑具体工具名，
等后台出「按 id 取单节点」的工具时引导语不用改。

### 最近完成（2026-10-05，项目/画布/资产三层 + 项目页路由）

**用户要求「完整修改」**：项目 → 多张画布（后台文件夹套文件夹）+ 独立资产目录（生成产物 + 自己上传）
+ 复刻 LibTV `/project` 的项目页 + `vue-router` 切换。设计见 `docs/design/project-canvas-assets.md`。

**后端（cloud-server，全部带单测先红后绿）**：
- `store/projectStore.ts`：项目注册表（`projects.json`）+ 画布索引（`canvases/index.json`，带 projectId）。
  画布**文件夹路径不变**（仍在 `canvases/<id>/`），「属于哪个项目」记索引 —— 理由：改物理路径要动
  CanvasStore/Resources/History/Doc/TaskManager/agent 一整条链 + 迁移已有数据，风险远大于收益。
  有 `default` 项目兜底（老画布不丢），画布目录存在但索引缺失时归 default。
- `store/assetStore.ts`：资产目录（`assets/index.json` + `assets/files/`）。生成产物**按引用登记**
  （不复制字节），上传的字节落 `assets/files/<hash>`；同 url / 同内容幂等。
- `routes/projects.ts`（项目/画布 CRUD）+ `routes/assets.ts`（列表/上传/取字节/删），注册为内置插件
  `projects` / `assets`（内置插件从 13 → 15，`builtinBehavior` 断言同步更新）。
- `TaskManager` 加 `onArtifact` 钩子：任务成功有产物 → 登记进资产目录；`CanvasStore.remove` 删画布文件夹。

**前端（packages/ui）**：
- 引入 `vue-router`（hash 模式）：`#/` 项目页、`#/canvas/:id` 画布工作台；`Root.vue` 按 `fullPath` 做 key，
  切画布时**重新挂载**工作台（插件在 apply 时读画布 id，不重挂会拿旧数据）。
- `components/ProjectsPage.vue`：复刻 LibTV 项目页，**去掉用户红框**（右上积分/会员/头像；左栏
  Agent/3D-BOX/插件与扩展/社区/版本更新记录）。数据来自 `/api/projects`，点项目→打开其画布（没有就先建）。
- 画布「画布」下拉改绑**当前项目的真实画布**（`/api/projects/:id/canvases`）：可切换（换 hash 重挂）、
  可新建（`POST /api/projects/:id/canvases`）。
- 左侧「资产」页改读 `/api/assets`（生成 + 上传统一），图片当缩略图、可下载。
- `plugin-cloud-client` 支持多画布：当前画布 id 从 URL（`?canvas=` / `#/canvas/`）现算，不再写死 `default`。

**验证**：cloud-server **312** 全绿（新增 projectAssetStore 9 条 + projectsAssetsRoute 6 条）；
cloud-client **125** 全绿；ui **83** 全绿（新增 canvasTree 4 + assetModel 3）+ `vue-tsc` 干净 + `vite build` 通过。
Chrome 端到端（8899 源码服务 + 干净数据目录）：项目页 → 点进 → 画布工作台；下拉列出「分镜A/分镜B」并切换成功；
上传资产后资产页显示。**注意**：线上跑的 `cloud-server` 是 `dist/` 产物，要重启/重编译才生效。

### 最近完成（2026-10-05，UI 完善：音频任务解析 + 侧边栏抽屉三件 + 真实画布树 + 资产页）

**用户报的一串问题，本轮做掉 5 件（都在 packages/ui + cloud-server，未碰核心节点件）：**

1. **音频任务「执行失败 Cannot read properties of undefined (reading 'urls')」** —— 根因两条：
   豆包 tts 是**同步完成**（`tools/call` 只回 `content[].resource.uri`，没有 `structuredContent`），
   而 `cloud-server/src/providers/web2api/index.ts` 的 submit 分支无脑 `extractUrls(result.structuredContent)`
   → 传 `undefined` 进去就抛；且 `client.ts` 的 `extractUrls` 不认任务详情里真正的字段 `resources[].downloadUrl`、
   也不认同步返回的 `content[].resource.uri`。**修**：`extractUrls` 防御化（undefined→[]）+ 认
   `uri/downloadUrl/resource`，submit 同时扫 `structuredContent` 与 `content`，两处地址都用新增的
   `absolutizeUrl` 绝对化到 web2api origin（相对 `/api/resources/...` 不补 origin 前端会 404）。
   真机探针（8033）确认：任务在 web2api 侧成功、产物在 `resources[].downloadUrl`。
   单测 `web2apiSubmit.test.ts` 4 条（先红后绿）；cloud-server 297 全绿 + typecheck 干净。

2. **左抽屉展开后画布下拉点不动** —— 根因：抽屉打开时**同时挂载了两个 ProjectCluster**
   （左上角 `v-show` 隐藏但仍挂载 + 抽屉里那个），二者共享 `s.canvasMenuOpen`，AxDropdown 的
   「同屏只开一个」排他逻辑互相关闭 → 永远打不开。**修**：左上角那份 `v-show` 改 `v-if`（只挂载一个）。
   浏览器实测：展开抽屉后点画布 chip，`aria-expanded=true`、菜单正常列出「画布 1/2/3」。

3. **下拉命名的重复** —— 按用户提案：画布下拉**触发器**改为显示「画布 + 索引」
   （不再显示画布名，避免与列表里重复）；工作区名拆成独立可编辑的 `s.projectName`，画布列表另算。

4. **左侧「画布」树改为跟着真实画布数据实时画** —— 新增纯函数 `ui/src/composables/canvasTree.ts`
   （`buildCanvasTree` / `nodeDisplayName`）：按 `parentId` 组织分组树、名字全部来自节点自身
   （imageName/audioName/text…）、孤儿节点升为根不丢。`ui.ts` 由 `doc.subscribe` 驱动重画
   （`bindCanvasTree`/`unbindCanvasTree`）；点节点（或定位按钮）调 `locateNode` → viewport `setCenter` 居中。
   单测 `canvasTree.test.ts` 4 条。浏览器实测：抽屉列出真实 8 个节点（文件名即节点名）、点击视口居中。

5. **「资产」页显示真实生成资源** —— 资产 = **有产物地址的历史记录**（复用 `gen-history` 全量账本，
   不另起一套资产库）；`ui.assetItems` 过滤 `urls` 非空，图片直接当缩略图（视频/音频用类型图标）、
   可下载、文件名取自产物地址。空态给一句人话 + 入口（不是假的「创建分类」按钮）。
   实测：当前历史只剩失败记录（urls 为空）→ 正确显示空态。

**其它**：调试期仓库里 `PluginManagerPage.vue` 的 WIP 模板尾部有残留（`Invalid end tag`）会让整包构建失败，
该文件已被并发的插件管理提交（`34a7ec38`）修好；本轮的 UI 改动已在其之上重新构建，产物刷新到 `packages/ui/dist`。
**验证**：ui 80 全绿 + vue-tsc 干净；cloud-client 125 全绿；cloud-server 297 全绿 + tsc 干净。

### 最近完成（2026-10-04，全仓扫描：同一类「启动/恢复先后顺序」bug 清查）

前面三个 bug（设置刷新回退、插件刷新掉、小地图宽高回退）是**同一类根因**：数据是先按本地后端恢复、
云端插件随后才把后端切过去，而"切过去之后没人重读"或"重读时被默认值盖掉"。按这条线索做了系统清查。

**已修（本轮）**：
- 小地图宽高：见下一条（capabilityLayer 用默认值盖掉已恢复的用户值）——**已修 + 验证**。

**扫描发现并已修**：
1. **快捷键重映射刷新不生效**（同 settingsPersist 一类）。plugin-shortcut-manager 的
   shortcutRemapEngine.restore() 只跑一次（插件装配时，读的是本地 shortcut 后端）；
   plugin-cloud-client 之后才把 shortcut 域切到云端，切完**没人重读** → 云端存的重映射键位进不来。
   **已修**：引擎新增 subscribe()（订阅 save.onAdapterChange('shortcut') 后重读并 re-apply），
   插件 apply 里经 ctx.effect 挂上（随卸载回收）。新增单测 1 条（先确认无修复时红）；
   plugin-shortcut-manager 30 全绿 + tsc 干净。（注：成品 UI 当前不装该插件，属"直连 cloud-server
   且装了它"的宿主才暴露；但根因同类，一并修掉。）

**扫描发现、尚未修（属别的会话在写的新插件，非本次主线）**：
2. **新插件 plugin-cursor-effect 让主题色守卫变红**（与本次主线无关，是别的会话正在加的新插件）。
   packages/ui 的 themeColorHygiene 扫到它写死的颜色（catalog.ts 的 color 字段、colorAssets.ts 的
   SVG 素材、CursorEffectOverlay.vue 的 canvas 绘制色）共 54 处。这些多是"用户可选的数据色 / 画进 canvas
   的像素色"，按规范加精确到行的 `主题色白名单: 原因` 豁免即可；但**该插件还在开发中**，
   豁免标记应由它的作者补（我避免替半成品定调）。

### 最近完成（2026-10-04，修「小地图宽高改了刷新就回退」）

**用户报的问题**：改小地图（plugin-mini-map）宽高，改完刷新，改动没生效（回退到默认 240×160）。

**根因**：运行期热装插件的 Config 声明会用 schema 默认值盖掉刚恢复的用户值。
启动顺序是「宿主先按本地后端恢复设置（快照里已有用户改过的 miniMapWidth）→ 再热装插件」；
而 mini-map 是云端清单**运行期热装**的，内核调 declareConfig 把它声明进 settings 时，
settings.define 本来已经命中快照取到了用户值，紧接着那行 settings.set(key, config[key])
（config 是 schema 校验后的默认值）又把它写了回去 —— 用户值当场丢失。
内联 config 时代（插件冷启动先声明、恢复在后）没这问题，改成运行期热装后才暴露。

**修法**：capabilityLayer.declareConfig 里，若该项在**保存快照**里已有值，就不要再 set config[key]
（define 已经取到用户值）；只有快照里没有的项才用装配 config 补齐初值。

**验证**：canvas-data 新增 declareConfigSavedValue.test.ts 2 条（先确认无修复时红：expected 240 to be 320）；
真机端到端（云服务 8877）：改宽高 320×220 → 刷新 → 仍是 320×220、小地图 DOM style 同步；
把修复关掉重跑则回退 240×160（决定性对照）。canvas-data 364 全绿 + typecheck 干净。

### 最近完成（2026-10-04，音频节点：拖动播放头改为「手停就停」的节流出声）

**用户报的问题**：拖波纹上那条播放头时，希望"拖动才出声"；实测按住不放、指针停住后
音频还在播，播放头/时间轴自己往前走，跟手指脱节。用户给的方案：
每次移动重置一个 **60ms 定时器**，到点就把播放暂停 —— 相当于对出声做节流。

**改法**（`plugin-node-audio/src/AudioContent.vue`）：
- 拖动（播放头 + 波纹下那条整体进度条，两者同一手势）期间，`onPointerMove` 每次调用
  `noteScrubActivity()`：若停手时被暂停过就先 `play()` 恢复出声，再重置 `SCRUB_IDLE_MS = 60ms`
  定时器 `armScrubIdleTimer()`；到点没再动 → `pauseScrub()` 暂停并把 `scrubPaused = true`。
- 连续拖动时 rAF/指针事件每帧都来，定时器不断被打断 → 一直出声；手一停约 60ms 静音。
  声音、播放头、时间轴同时停住，按住不放也不会自己往前溜。
- 松手仍按"拖之前是播是停"恢复（原有口径不变）；松手 / 卸载都 `cancelScrubIdle()` 清定时器。

**验证**：先写红（`audioSeekAndProgress` 补 3 条：节流常量与定时器、移动重置 + 恢复出声、
松手/卸载清理），再实现转绿；本包 **93/93**、typecheck 干净。
（`packages/ui` 里 `canvasToggles`(maxZoom)、`themeColorHygiene`(plugin-cursor-effect 写死颜色)
两条红是用户既有 WIP，输出与本包无关。）

### 最近完成（2026-10-04，修「装好的插件刷新后消失、配置跟着丢」）

**用户报的问题**："很多插件是后续安装的……刷新之后，这些已安装的插件甚至没有被加载，每次刷新都要重新安装，
关于这些插件的配置也就全部消失了。总结：配置不管用，刷新就无。"

**复现（决定性）**：把插件管理要读的「已装名单」在本地设成空、云端设成全量，再人为拖慢云插件脚本
（模拟真实网络），刷新后**一个外部插件都没装**（期望 16）。

**根因**：与「设置刷新回退」同源 —— 配置后端在运行期被换，读写两本账错位。
插件管理的**读**发生在启动早期（那时 config 域还指向浏览器本地），而**写**（用户点安装时）
发生在云插件把 config 域切到云端之后。于是"读本地旧名单、写云端新名单"对不上；
插件没装上，它们声明的配置项也就从未 define，设置面板里自然全没了。

**修法**：plugin-manager 服务订阅 save.onAdapterChange，config 域换后端后把安装名单与**新后端**对齐
（语义与配置持久化桥一致）：新后端有名单 → 以它为准（多的卸掉、少的补装）；新后端是空的（首次上云）→
把当前意图搬过去，别让云端的空把已装插件抹掉。

**验证**：同一个 6 秒延迟复现 —— 修前 **0 个插件**（bug 重现）、修后 **16 个插件**；
真机端到端（云服务 8877）：卸载多选 → 刷新 → 它仍「未装」、其余 15 个插件都在、改的 themeMode 也保住；
新增单测 1 条（先确认无修复时红）；plugin-cloud-client 117 全绿 + typecheck 干净。
注意：调试期发现本机另一个程序（loadout-desktop.exe）也占着 8865/8866，早先几次读数是打到它上面导致的假象 —— 换端口 8877 后一切自洽。

### 最近完成（2026-10-04，整页不可选中文本 + 右键菜单去掉透明度）

**用户报的问题**：
1. Package UI 整个页面要 select-none，界面文本不能被选中（截图里画布节点标题「image」能被拖蓝）；
2. 右键菜单插件有透明度，要删掉（截图：菜单卡片半透明，背后节点内容透进来）。

**根因与修法**：
- 问题 1：v2 成品壳丢了 v1 主机在 body 上 user-select: none 的兜底，全站没有整页禁选。
  在 packages/ui/src/app.css 重加 body { user-select: none }，并给输入面
  （textarea / input / [contenteditable="true"] / .ProseMirror）override 成 user-select: text，
  否则节点文本编辑、标题编辑、Agent/底栏输入框连字都选不了。
- 问题 2：plugin-context-menu 的 .ctx-menu 与 .conn-menu 用 var(--ui-glass)（约 0.86 不透明）
  + backdrop-filter: blur(20px)，菜单压节点上时内容直接透出。改成**不透光档**
  var(--ui-overlay-solid)（与节点控制栏同一档），并删掉 backdrop-filter（规范 §2.6：纯色底上写 blur 无效）。

**验证**：pnpm -C packages/ui test 新增 pageSelectNone.test.ts 2 条（先写红）、
pnpm -C packages/plugins/plugin-context-menu test 新增 menuOpaque.test.ts 4 条（先写红）；
插件已重新 build（UMD 含 ui-overlay-solid）；浏览器实测：body/节点标题 user-select=none、
textarea 为 text，右键菜单与连线菜单均为不透明底（暗色 rgb(33,33,33)）、backdrop-filter=none。
（packages/ui 里 canvasToggles 的 maxZoom 那条红是用户既有 WIP，与本次无关。）

### 最近完成（2026-10-04，修「设置保存后刷新被还原」+ 主题模式进 render 配置）
### 最近完成（2026-10-04，新增「光标特效」插件 plugin-cursor-effect）
### 追加（2026-10-04，光标特效：全页面生效 + 指针零延迟）
### 追加（2026-10-04，光标特效：下载真实素材 + 修「图标渲染成方块」）
### 追加（2026-10-04，光标特效：修「动画不播」+ 支持自定义上传/帧序列）
### 追加（2026-10-04，光标特效：自定义上传稳健化——大图缩放 + 失败不静默）
### 追加（2026-10-04，光标特效：修「选中自定义光标后完全空白」—— 根因是 localStorage 被禁用）
### 追加（2026-10-04，光标特效：修「自定义光标选中后画布上什么都不显示」—— 图片宽度被算成 0）
### 追加（2026-10-04，光标特效：帧序列可设帧率）

- **用户要求**：上传多帧时，希望能设置它的帧率。
- **做法**：帧率从「全局一个」改成「**每条帧序列各自一个**」——
  - CustomCursor.fps 已存在；渲染层改用 cust.fps 优先（不再被全局值覆盖）；
  - 设置页在选中某条**多帧**素材时，显示一个「帧率（这条 N 帧序列）」滑杆（2–30 帧/秒）；
    改它 → updateCustomCursor(id,{fps}) → 写回并广播 → 渲染层重读、**立即变速**；
  - 参数区里原来那个「帧序列帧率」改名为「**新上传帧率默认值**」，只决定新上传时的初值，避免两个「帧率」混淆。
- **验证**：单测 **33/33**（新增 customCursors.test.ts 6 条：内存兜底、改帧率只动该条且 id 不可被覆盖、删除、事件名稳定）；
  tsc/vue-tsc 干净；UMD 重打包 ~153KB；真机（用户实例 5289）——上传 3 张不同颜色小图成「f1（3 帧）」，
  选中后设置页出现「帧率（这条 3 帧序列）12 帧/秒」滑杆（AX 可见、值 12）。
- **注意（非本插件）**：验证时页面被一个无关的编译错误浮层挡住 ——
  packages/plugins/plugin-cloud-client/src/manager/components/settings/PluginManagerPage.vue:45 的模板字符串少了起始反引号，
  导致该文件解析失败。**不是本次改动**，未擅自修改。


- **根因（真机在用户实例 5289 上抓到）**：自定义光标用的是跟随层里的一个 `<img class="ce-frame">`。
  我在设置尺寸时的顺序是「先量/先设样式、后 display」，而那时 `<img>` 还是 `display:none`、
  处在 flex 居中容器里 —— 量出来宽度是 **0**；成品表现就是「图片在 DOM 里、`naturalWidth` 正常、
  但 `getBoundingClientRect().width === 0`，画布上什么都不显示」（探针实测 `w:0, h:30`）。
- **修法**：在 `paintFollower` 里改成**先写死尺寸、再显示** ——
  同时写 `img.width/height` 属性与 `style.width/height`（外加 `max-width:none`），然后才 `display:block`；
  帧序列切换只换 `src`，不再碰尺寸。实测 `w=30, h=30`、`naturalWidth=97`，你的上传图**已作为光标正常显示**。
- **验证（用户实例 5289，真机目视）**：设置→光标→自定义里选中已上传的图 → 关设置 → 移动鼠标，
  画布上出现该图作为光标（截图确认）；内置指针/动画/拖尾/点击特效不受影响。
- 顺带说明：`localStorage` 在这些内置浏览器标签里读不到（探针返回 undefined），但页面主环境可用 ——
  之前加的**内存兜底**保证了「即便读不到 localStorage，上传→选中→显示」整条链仍然通。
- 单测 27/27；`tsc`/`vue-tsc` 干净；UMD 重打包 ~152KB。


- **用户反馈**（附截图）：上传的图片**选中后光标完全空白**。
- **端到端复现**（这次跑了整链：上传 → 选中 → 看画布上的光标），查明**两个真 bug**：
  1. **本环境 localStorage 是 undefined（被禁用/沙箱化）** —— 自定义光标存在 localStorage，
     loadCustomCursors() 读到空、saveCustomCursors() 抛错被吞 → 上传看似成功、选中却没有任何素材 → **光标空白**。
  2. **选中自定义但没有素材时不回落** —— 渲染层把跟随层清空后留了个**空白**，既不是自定义光标、也不是默认箭头。
- **修法**：
  - customCursors.ts：加**内存兜底**（模块级缓存）+ 安全的 ls()（探测不可用返回 null，绝不抛）。
    写的时候**总是先写内存**，localStorage 只是持久化增强；不可用/配额满都照常能用，只带回一条 warning
    （「素材只在本次会话有效，刷新后会丢」）。设置页把 warning 显示成**提示**（不再是红错），环境不支持时提前告知。
  - CursorEffectOverlay：选中自定义但**一条素材都没有**时 → **回落默认箭头**，**绝不空白**。
    原先的 find(...) ?? customCursors[0] 在空数组时返回 undefined，就是空白源。
- **验证（真机、localStorage 被禁的 IAB 环境）**：
  上传点状 PNG → 列表出现条目（内存兜底生效、无报错）；选中它 → ce-frame 显示、naturalWidth=128、跟随层跟手；
  删光全部素材后仍选中自定义 → 跟随层**显示箭头**（isArrow=true、innerSvgLen=397），不再空白。
  单测 27/27；tsc/vue-tsc 干净；UMD 重打包 ~152KB。
- **我的疏漏**：前几轮只测了「上传成功」与「帧序列循环」，**没测「选中它当光标用」这一步**，所以漏了这个空白 bug。


**用户反馈**：上传的光标缩略图是**破图**（浏览器占位图标）。

**根因（两类）**：
1. **大图爆 localStorage 配额**：把原图（手机照片动辄几 MB）原样转 data URL 塞进 localStorage，
   超过 ~5MB 配额时 `setItem` 抛错，而当时**静默吞掉**了 —— 素材没存进去，界面却像"成功了"，重载后就成了破图。
2. **不可被 <img> 渲染的编码**：极少数格式浏览器画不出来，也表现为破图。

**修法**：
- `customCursors.ts` 新增 `normalizeUpload(file, maxEdge=160)`：**位图**先画进 canvas 缩放到 ≤160px 再重编码成 PNG（必然可渲染、且只剩几 KB）；
  **SVG 保留矢量原样**（不栅格化，保持清晰）；任何一步失败都回落原 data URL，绝不丢用户的东西。
- `saveCustomCursors` 改成**返回 { ok, error }**，配额满时给出「素材太大，浏览器存储放不下」的提示；
  `addCustomCursor` 写失败就**回滚**（不把存不下的素材留在内存里假装成功）。设置页把 error 显示成红字。
- 缩略图与跟随帧都加 `onerror` → 失败时**隐藏**（不显示浏览器破图图标）。

**验证**：单测 27/27；`tsc`/`vue-tsc` 干净；UMD 重打包 ~151KB。
真机：上传 1MB 的 1600×1200 PNG → 列表出现「big-photo」且缩略图**正常渲染**（归一化后仅几 KB）；
普通 SVG 单张/多帧上传也正常（前一轮已验证帧序列循环 3 帧）。



**用户反馈**：① 动态效果完全没反应、依然是静态；② 希望能**自己上传图片或 SVG**，并支持**帧序列**动画。

**问题①根因**：pulse / spin 的 idle 动画与「热点偏移」的内联 `transform` 写在**同一个元素**上——
内联 transform 把 CSS 动画的 transform 覆盖了，所以永远不动（脉冲点永远不动、旋转环永远不转）。
**修**：拆成两层各自管一个 transform ——
  外层 `ce-offset` 只写热点偏移（`translate(-hx*size, -hy*size)`），内层 `ce-inner` 留给 pulse/spin 动画；
  两者互不覆盖。实测：选「靶心」后 `ce-inner` 带 `pulse` 类、`animationName=ce-pulse-…`、且它的内联 style 为空。

**问题②新增能力**：
- `src/customCursors.ts`：自定义光标存**本机 localStorage**（`mc-cursor-effect:custom-cursors`）。
  为什么不用内核 settings：上传的 data URL 可达几百 KB，而 settings 会随 settingsPersist 同步到云端 KV，
  塞进去会把「配置」撑爆。settings 只存"当前用哪一个"这个**小 id**（`cursorFxCustomId`）+ 帧率（`cursorFxCustomFps`）。
- 渲染层 `CursorEffectOverlay`：自定义时用透明光标藏原生指针，绘图交给一个 `<img>`；
  `frames.length>1` 就按帧率 `setInterval` 循环换 `src`（**帧序列动画**）。监听 `mc-cursor-effect:custom-changed` 立即生效。
- 设置页新增「自定义」页签：上传**一张**图片/SVG = 静态光标；**多选几张** = 帧序列；可删除、可切换；显示「N帧」角标。
- Config 新增两项：`cursorFxCustomId`、`cursorFxCustomFps`；`cursorFxCursor` 的 select 增加「自定义上传」选项。

**验证**：单测 27/27；`tsc`/`vue-tsc` 干净；UMD 重打包 ~150KB；
真机——① 选「靶心」动画真的在动（animationName 有值、内联 transform 已清空）；② 上传 3 张 SVG → 面板出现「star（3 帧）」；
采样 1.2s 帧的 src 出现 **3 个不同值**（帧序列在循环播放）。



**用户反馈**：很多特效"没有真实效果"——落叶是小方块、选「帮助」光标显示成方块、粒子是代码画的不好看；
要求**去网上把真实素材下载进项目**。

**根因（方块）**：重写目录后 `catalog.ts` 引用了新素材键（`pointer-arrow` / `hand-point` / `text-i` …），
但 `icons.ts` 还是旧键名 → `svgIcon` 查不到返回空串 → 渲染成空/方块。修：用脚本从 Iconify 重新生成 `icons.ts`（50 个键）。

**真实素材（已下载进仓库，运行时不联网）**：
- `assets/icons/*.svg`（50 个，脚本同步进 `src/icons.ts`）：Lucide / Solar / Phosphor / MingCute / Tabler —— 单色线框，指针形状。
- `src/assets/color/*.svg`（31 个，同步进 `src/colorAssets.ts`）：**Noto Emoji（Apache-2.0）真彩色** —— 落叶/枫叶/樱花/向日葵/星星/闪光/爱心/雪花/彩纸/礼花/月亮/彩虹/音符/彗星/星球/蝴蝶/猫爪/猫脸/宝石/泡泡/气球/糖果/火焰/眩晕。
- `src/engine.ts` 的 `svgIcon(name,size,color)`：有彩色素材且未指定颜色 → 返回彩色原件；否则查单色表并把 currentColor 换成给定色。

**效果全部换成真实素材**：
- 指针分四类页签：**指针**（单色真鼠标形状，白填充+深色描边，任何底色都看得清）/ **彩色**（真实彩色素材当光标）/ **系统** / **图片**。
- 跟随拖尾：彩虹 / 仙女尘 / 星光 / 落叶（真叶子+枫叶+樱花）/ 爱心 / 雪花 / 音符 / 蝴蝶 / 气泡 / 月光 / 幽灵 / **猫爪队列**（真实猫爪素材串成队列）。
- 点击特效：烟花 / 星芒 / 彩纸 / 爱心 / **花瓣** / 雪爆 / 音符 / 涟漪 / 冲击波。
- canvas 精灵对彩色素材**不做染色**（保留自带颜色），对单色才用 `col` 着色。

**验证**：单测 27/27（含"每个清单项引用的素材键都真实存在"的防方块护栏 + 彩色素材完整性）；`tsc` 干净；
UMD 重打包 143KB（含全部素材）；真机复验——指针不再是方块（白箭头带描边）、拖尾与点击特效都是真实彩色星星，
设置页四个页签的缩略图全部为真实的矢量图标。



**用户反馈两条**：① 光标只在画布里生效，一开下拉/浮层就被盖住或裁掉；② 光标跟随有延迟（"拖尾才有动画，光标必须实时跟手"）。

**改法**：
1. **整块 Teleport 到 `document.body`**：覆盖层原来住在画布容器里（`.csurface-overlay` 带 overflow:hidden、z-index:20），
   搬到 body + `position:fixed; inset:0; z-index:2147483000`（顶层，压过设置面板/下拉的 100000）→ 光标覆盖整个页面、永远是鼠标本身。
   坐标随之改用 `clientX/clientY`（不再算容器矩形）；canvas 尺寸用 `window.innerWidth/Height` + resize 事件。
2. **原生光标藏在整个 document**：透明光标那条 CSS 从画布根挪到 `<html>`（`html.mc-cursor-hidden`）→ 画布/设置/下拉/弹窗里都换成自绘指针。
   拆成**三层各自管一个 transform**（外层位置 / hover 放大 / 点按回弹 / 内层热点偏移+idle 动画），互不覆盖。
3. **指针零延迟**：删掉原先的平滑插值，`pointermove` 里**直接**把跟随层 `transform` 设到鼠标坐标（事件驱动、即时跟手）；
   RAF 只负责推进拖尾与点击粒子的动画。实测跟随层 transform 精确等于鼠标坐标（300,300 / 800,600 逐点核过）。

**验证**：单测 26/26 保持全绿；`tsc` 干净、`vue-tsc` 无本插件报错；UMD 重打包 48KB；
真机——设置弹窗开着时光标与拖尾仍画在弹窗**之上**、跟随层 z-index=2147483000 且挂在 body 下、`html` 已加隐藏类。



**用户要求**：把画布鼠标从默认手掌换掉，加样式库 + 点击特效；先做可玩的 Demo，再做成带**自绘设置页**的插件装进 cloud client 插件系统。

**产物**：`packages/plugins/plugin-cursor-effect`（`installable: true`，清单会收录、默认装好）。

- **光标指针**（`catalog.ts` 的 CURSORS）：图标款会动（透明原生指针 + 跟随元素）/ 系统款（`cursor:pointer` 等）/ 图片款（`cursor:url(图片)`，静态）。
- **跟随特效** FOLLOWS：彩虹拖尾 / 仙女尘 / 星星 / 雪花 / 表情 / 气泡 / 幽灵 / 落叶 / 月光 / 蚂蚁队列 / 跟随圆点；**这才是"会动的光标"**。
- **点击特效** EFFECTS：烟花 / 星芒 / 涟漪 / 彩纸 / 爱心 / 冲击波 / 雪爆。
- **配置**：模块级 `Config`（10 项，全部 `group: '光标'` 的扁平分组）→ 设置面板独占一个一级页「光标」；页面自绘（`settingsNav` + `settingsGroup/光标` `mode:'replace'`），照 plugin-manager / plugin-agent 的做法。
- **分层**：纯逻辑在 `engine.ts`（粒子配方/帧推进/图标→SVG），渲染在 `CursorEffectOverlay.vue`（注册 `overlay` 槽），图标来自 Iconify 聚合的真实图标集（Lucide/Solar/Phosphor/MingCute/Remix）。

**踩到的三个真坑（都在真浏览器里实测定位）**：
1. **canvas 像素缓冲一直是 300×150**（容器 1280×720）——挂载那一刻量不到真实尺寸，粒子画在缓冲之外、完全看不见；跟随元素是 DOM 定位不看 canvas，所以它照常工作、把问题掩盖了。改由 **ResizeObserver 驱动尺寸**。
2. VueFlow 会在 pane 的 pointerdown 上 `stopPropagation` → 冒泡阶段收不到点击（**跟随正常但点击特效不出来**）。改成**捕获阶段**监听。
3. 卡顿三因：每粒子 `shadowBlur` 光晕、拖尾每帧全画布涂抹、连点粒子无上限。改：光晕换成**预渲染精灵** blit、粒子加**硬上限**、无内容跳过绘制。

**验证**：单测 26/26（engine 16 + catalog 10）全绿；`tsc` 干净、`vue-tsc` 只剩 canvas-render 既有 3 条（其它插件同样）；UMD 打包 48KB（只 external Vue + MiniCanvasRender）；真机跑通——插件管理默认装好、设置页 32 个选择块渲染、画布上指针跟随 + 彩虹拖尾 + 连续点击烟花都正常。

**Demo（并行产出，供挑样式）**：`C:/Users/Administrator/.codex/visualizations/2026/10/04/01a105c3-.../cursor-effects-demo.html`。



**用户报的问题**：
1. 把主题（亮/暗）也收进 config，作为 render 库的一项配置；
2. 改完设置 clouds-server 的 .mini-canvas/settings.json 确实在变，但**刷新页面又回到旧值**。

**根因（问题 2）**：启动时序错位。宿主的顺序是「先按**本地**存档 restore 画布与配置，再装外部插件」；
settingsPersist 桥的 restore() 跑在插件装载**之前**，读的是本地后端。而 plugin-cloud-client
是在 apply() 里才把 config 域切到云端的 —— 切完之后**没有任何人重读**，于是云端已保存的设置永远进不来，
页面显示的一直是本地那份（本地没存过 → 全部回落 schema.default）。

**修法**：
- SaveService 新增 onAdapterChange(cb)：useAdapter / useAdapterForAll 换后端时广播「哪个 type 换了」；
- settingsPersist 桥在 restore() 里订阅 onAdapterChange，只在 type === 'config' 时**重读新后端**：
  新后端有存档 → 以它为准注入 store；新后端还是空的（首次上云）→ 把当前值整份推上去，别把云端当空覆盖本地。
  这样「本地先恢复、云端后接管」这条启动路径闭环。

**问题 1 的做法**：新增 canvas-render/src/contracts/themeModeSettings.ts（与色板同一套语义）——
把「主题模式 light/dark」作为**渲染层配置**收进 settings 单一数据源（key=themeMode，分组「常规/外观」，
默认暗色），由 createMiniCanvasHost 声明 + installThemeMode 把值落到 html 的 dark class；
成品应用 ui.ts 的 state.theme 改成它的镜像（bindThemeMode 订阅），右上角调色板 toggleTheme() 改**写设置**，
于是切换既即时生效、又随 settingsPersist 一起持久化（刷新不再回退到暗色）。
注：这不违反「不要给单个插件发明 theme 配置项」（那是禁止按插件各切各的主题）；这是**全应用唯一**的开关，
见 docs/代码开发/主题与配色.md §3.3 的允许情形。

**验证**：canvas-data 362/362（新增 2 条：换后端重读 / 首次上云推本地，先写测试确认无修复时红）；
canvas-render 新增 themeModeSettings.test.ts 7 条 + createMiniCanvasHostPersist 补 1 条（跨 boot 恢复），
host 包 typecheck 干净（余下 2 条红是用户 WIP）；ui 新增 1 条（调色板写 settings），
余 1 条红是用户 WIP（maxZoom 默认改 3、测试仍期望 2）；kernel / plugin-cloud-client 全绿。

### 最近完成（2026-10-04，导出插件修三个问题：多选标记照进图 + 选中导出缺标题 + 标题发白）

**用户报的问题**（`plugin-canvas-export`，Ctrl+Shift+E 导出选中节点）：
1. 导出图左上角的圆形多选标记没被剔除；
2. 右上角图片没有标题 —— 标题条画在卡片上缘之外，被裁掉了。

**根因一（多选标记）**：导出用的 html-to-image `filter` 只认 `data-id` 成员判定和一份写死的调试类名；
`BaseNode` 的 `.v2-multi-radio`（以及端口球 `.moving-handle-anchor`、resize 拖柄 `.resize-handle`）
没有任何「别截我」的标记，于是被照进图。

**根因二（缺标题）**：`NodeLayoutService` 的节点矩形**只覆盖卡片本体**，不含标题；
标题条画在卡片上缘外 `titleOffset + 标题高` 处。`planExport` 的 selected 分支把范围算成
「选中节点包围盒 + padding」，上方没留任何空间 → 标题整条被裁。

**改法**：
- 新增通用剔除类 `mc-export-ignore`（`exportGeometry.EXPORT_IGNORE_CLASS`）：任何元素（含子树）
  挂上它，导出时整棵跳过。导出插件的 filter 认它；主题侧给多选圆点 / 端口锚点（MovingHandle 根）/
  resize 拖柄挂上。插件作者给自己的浮层加这一个类即可，导出插件不必知道主题内部类名。
- `planExport` 新增 `topPadding`：只在**上边**外扩一段「标题带」（`EXPORT_TITLE_BAND(20)` +
  主题 `titleOffset`），full / selected 两种模式都生效；缺省 0 = 与旧行为逐字一致。

**验证**：plugin-canvas-export 70/70（新增 8 条：expandRectTop、topPadding、ignore 类语义）、
plugin-theme-default 248/248（更新 resize 精确类断言 + 新增 4 条标记契约）、plugin-multi-select 152/152
全绿；export / theme 两包 typecheck 干净；`pnpm -C packages/plugins/plugin-canvas-export build` 通过
（UMD 产物已含 `mc-export-ignore` 与 `topPadding`）。
（注：ui 包的 `themeColorHygiene`（`packages/ui/_mm.ts`）与 `canvasToggles`（maxZoom）2 条红是
用户既有 WIP，与本次无关。）

**追加（同日，第三个问题：导出图标题发白看不清）**：用户报「这边你的文字颜色也需要进行一个修改」。
根因（截图取色实测）：节点标题色来自主题 token `--canvas-node-text-muted`，**跟应用主题走**；
应用在**暗色主题**时它是 `#919191`（浅灰），而导出插件**永远**按自己的设置画亮色底（默认 `#f8fafc`）
—— 浅灰标题落在亮底上几乎看不见。

改法（最小改动，不动主题默认）：导出是亮底，导出期间临时把标题色 token
（`--canvas-node-text-muted` / `--canvas-node-text-strong`）盖成深色（注入一条 `<style>`，
导出结束 finally 移除；画布期间被遮罩盖住，用户看不到换色）。
**验证**：plugin-canvas-export 70/70；typecheck 干净；UMD 重新构建（含 `canvas-export-text-style`）。

### 最近完成（2026-10-03晚，多选插件：概念统一 + 主题配色 + 修「多选后还能拖出连线」）

**用户报的问题**：
1. 多选后，框内节点的连接线依然能拖出来（已把 moving handle 隐藏了仍不行）。
2. 概念统一：拖拽时画出来的叫「绘制框」；选中后出现的（两条线）叫「多选框」。绘制框可设线型/线宽/填充；
   多选框两条线各自可设线型/线宽/圆角/填充；颜色都希望能「删掉 → 回落主题色」，且统一放到
   「常规/主题配色」与「常规/暗色主题配色」（原来多选框的外框颜色在「布局/多选」里，要挪走）。

**问题 2 的根因（浏览器实测）**：多选时端口按钮确实隐藏了（opacity:0，符合预期），
但端口的吸附接收区 .port-follow-zone 仍然 pointer-events:all、尺寸 87×176 ——
鼠标按住那块透明区域照样起手拖线（实测建出 1 条边）。根因是 shouldShowHandles 只控制按钮 opacity，
接收区从不吃这些压制条件。

**修法**：BaseNode 把几条硬压制（多选 / 抓手 / 低细节 / 拖节点中 / 拖线中 / 本节点是拖线源）抽成
handleBlocked，传给 MovingHandle 的 :blocked；MovingHandle 加 is-blocked 样式把
anchor / 接收区 / 按钮一起 pointer-events: none !important。实测多选下 zone PE=none、拖拽建边 0 条。

**问题 1 的做法**：
- 概念统一：配置键与文档改用「绘制框 boxSelect / 多选框外框 outer / 多选框内框 inner」三个词。
- 绘制框新增三项配置（线型 / 线宽 / 填充%；颜色走主题）。
- 颜色统一收进主题配色：themePalette 新增三个 token —— 绘制框颜色 / 多选框-外框颜色 /
  多选框-内框颜色（两格制：常规/主题配色 + 常规/暗色主题配色），并标 optional: true。
- 颜色支持删除：ColorField 加 clearable（选色器里多一个「清除（改用主题色）」按钮，值可写空串）；
  kernel 的 color 校验支持 optional（空串合法）；resolveThemeColorOverrides 见到空串登记为「清除」，
  installThemePalette 清掉内联变量 → 回落 CSS 默认（即主题色）。
- 多选插件自己的两个颜色配置项移出设置面板（键保留用于存自定义色，页面上不再出取色器 ——
  颜色统一在主题配色里调）；frameStrokeCss 颜色缺省时走传入的主题变量。

**验证**：真机实测 —— 多选拖拽建边 0 条、三个新 token 已登记在两个主题配色分组、
改色跟随 + 清除后内联变量被清掉回落主题默认。单测：multi-select 152、canvas-render 406、
kernel 212、theme-default 244 全绿；theme-default / multi-select typecheck 干净。
（注：canvasInteractionSettings 2 条红仍是用户 WIP —— selectNodesOnDrag / maxZoom 改值未同步测试。）

### 最近完成（2026-10-03，plugin-web2api-tools 改成可装卸）

**用户要求**：把 packages/plugins/plugin-web2api-tools 做成能安装/卸载的插件。

**做了什么**：
- 加 vite.config.ts（走共享表 ../vite-plugin-lib）+ build 脚本 → 打出 dist/plugin-web2api-tools.js（25.8 KB）。
- miniCanvas 标记 builtin: true → installable: true。
- 从 ui 的 APP_PLUGINS 冷启动清单移出（改由插件管理安装，默认已装）；清单 12 → 11。

**为什么它好装**：运行时依赖全是 import type（打包时擦除），零 Vue —— 干活靠 ctx.tryGet('nodeBar') 与 ctx.get('tools')。

**顺带回答用户的疑问（为什么不写进 inject）**：
- tools 是内核自带（Context.builtinService 里 if (name === 'tools') return this.builtinTools），依赖检查天然通过；
  写进 inject 只是表达意图（tool-image-generation 就写了），功能上等价。
- nodeBar 是插件服务（plugin-bottom-bar 提供）。刻意不写 inject：写了就会「底栏没到 → 整个插件卡 PENDING」。
  它改用 tryGet 探测 + 监听 ctx:plugin-installed 自愈（底栏晚到就补注册），所以谁先谁后都能用。
  这在改成异步逐个安装之后尤其关键 —— 装载顺序不由我们控制。

**验证（真机）**：装上且 state=active、不再是 builtin；底栏动作齐（图片 7 / 视频 9 / 音频 2 条）；
卸载后动作归零 7→0、重装后回来 0→7；零报错。清单：自带 8 + 可装卸 16 = 24。
单测：plugin-web2api-tools 51、ui 73（entrypoint / web2apiAssembly 均通过）；typecheck 干净。


### 最近完成（2026-10-03下午，插件管理页列出**全部**插件：自带只读、可装卸带按钮）

**用户要求**：`packages/plugins` 里还有一批插件没分离（图片/音频等节点、web2api 等）；
**即使自带的插件也要显示出来，但不显示安装/卸载按钮**。

**做了“显示”这一半**（拆包那一半待定，见下）：
- 插件 `package.json` 加 `miniCanvas.builtin: true` 标记自带件（theme-default / bottom-bar /
  node-text / node-image / node-video / node-audio / node-3d-preview / web2api-tools / agent）。
- `cloud-server` 的 `buildPluginCatalog` 收录两类：`installable`（可装卸）与 `builtin`（自带）。
  **自带件只需 package.json，不要求有 UMD 产物**（它由应用冷启动装配、不经清单加载）。
- 插件管理页分两段展示：「自带（随应用启动，不可装卸）」只读列表 + 「可装卸」带 安装/卸载/重装。
- 自带件在服务层也硬兜底：`install/uninstall/reinstall` 对 builtin 行直接 return（不给按钮之外再加一道）。

**结果**（真机实测）：清单 3 → **24** 条 = 自带 9 + 可装卸 15；
自带段 9 行 **0 个按钮**（徽章「自带」），可装卸段 15 行 **15 个都有按钮**（徽章「已安装」）。

**验证**：cloud-server 217、plugin-cloud-client 116、canvas-render 404、ui 73 全绿；两个包 typecheck 通过。
（注：`canvasInteractionSettings` / `themeColorHygiene` 的 2 条红是用户既有 WIP —— selectNodesOnDrag/maxZoom 改值
与 `packages/ui/_mm.ts` 的写死颜色，与本次无关，已核实。）

**待定（已问用户）**：是否继续把节点类（图片/文本/视频/音频/3D）与 web2api 也拆成可装卸。
风险点：冷启动会把默认画布的两个示例节点（text+image）直接种进 store，而节点类型由插件注册；
改成运行期安装后种子会早于类型注册 —— 需要一并改 seed 时序。


### 最近完成（2026-10-03，修 bug：外部安装插件后 Shift 框选失效）

**用户报告**：多选插件的 Shift 框选功能，在以「插件管理」方式安装后失效了。

**根因**（浏览器实测定位，非猜测）：`CanvasSurface` 的 VueFlow 挂在 `:key="nodeEpoch"` 上，
而**插件每装/卸一个就 bump nodeEpoch → 整棵 VueFlow 子树销毁重建 → pane 是个新 DOM 元素**。
但 `flow.pane` 只在 `onMounted` 捕获一次、之后再不更新 → 插件（多选的 BoxSelectLayer）把
pointerdown 监听绑在了**已脱离文档的旧 pane** 上 → Shift 框选永远收不到事件。
冷启动时插件在 VueFlow 挂载**之前**就注册好（只重挂一次），所以那条路看着正常 ——
一旦改成运行期逐个安装插件（每个触发一次重挂），问题才暴露。

**修法**：`CanvasSurface` 新增 `refreshFlowDom()`（重新捕获 pane/renderer/paneRect），
并 `watch(props.nodeEpoch)` 在重挂后（`flush: 'post'`）重新捕获 + 重新 `attachDom`，
把新 pane 灌进 `flow.pane`。

**佐证**：`multiselect-regression` 新增场景 H（Shift 拖框选本身 —— 此前所有断言都是先
`selection.set` 预置选中，这条真实手势路径从没被测过）。**把修复临时回退后 H1/H2/H3 精确变红**，
恢复后 38/38 全绿；canvas-render typecheck 干净。

**顺带**：此前 `packages/plugins` 里 12 个「布局 / 画布工具」插件（参考线 / 小地图 / 多选 / 分组…）
已改成可装卸（经插件管理从云服务清单安装），并各自补了 UMD 构建；共享打包配置收进
`packages/plugins/vite-plugin-lib.ts`（external/globals 唯一事实源）。清单从 3 → 15 个。


### 最近完成（2026-10-03，插件管理里的插件从 3 个扩到 15 个）

**用户反馈**：插件管理页里太少了 —— 插件目录里明明有很多（参考线、小地图这些布局类），
「除了一些必须自带的插件，其他都该做成这种（可装卸）方式」。

**做了什么**：把 12 个「布局 / 画布工具」类插件也改成可装卸（经插件管理从云服务清单安装，默认已装）：

| 插件 | 说明 |
| --- | --- |
| align-guide / align-arrange / auto-layout | 参考线 / 对齐排列 / 自动布局 |
| mini-map / node-find | 小地图 / 节点搜索 |
| edge-cutting / multi-select | 连线切割 / 多选 |
| group / context-menu / clipboard | 分组 / 右键菜单 / 复制粘贴 |
| canvas-export / file-drop | 导出图片 / 文件拖入 |

**怎么做的（三件）**：
1. **共享打包配置** `packages/plugins/vite-plugin-lib.ts`：external / globals / 产物名收成一处
   （此前几个打包过的插件各写一遍，极易漂移 → 插件「加载了却没装上」还不报错）。12 个插件补上
   `vite.config.ts` + `build` 脚本，打出 UMD。
2. **host 全局补齐**：ui 的 `sharedGlobals.ts` 补 `MiniCanvasKernel`（含 `VueFlow` /
   `ProseMirrorEditorBundle`），供 UMD 插件取依赖；守卫测试逐条核对两边一致。
3. **dev 期清单**：新增 `packages/ui/catalogPlugin.mjs`（vite 插件，仅 dev）——
   在 ui dev server 就地实现 `/plugin-catalog.json` + `/plugins/**`，判定口径与 cloud-server 一致。
   这样单开 `pnpm -C packages/ui dev` 也能用插件管理；生产形态仍由 cloud-server 提供同两条路由。

**结果**：清单 3 → **15**；冷启动装配 24 → 12（只剩画布骨架 + 节点类型 + Agent + 插件管理本身）。

**验证**：dev server 与真 cloud-server 两种形态都用真浏览器跑过 —— 15/15 默认装好、
`nodeBar/mini-map/group/multi-select/clipboard/file-drop` 服务全在、58 条命令、控制台零报错。
单测：ui 73、cloud-server 216、plugin-cloud-client 114、canvas-render 404、kernel 212、canvas-data 360 全绿。


## 一、现在该做什么（2026-09-17）

### 最近完成（2026-10-02，KV 收进单个 settings.json）

**用户要求**：别一个 type 一个目录、一个 key 一个文件。直接一个 settings.json，
里面按 type 分桶：`{ "config": {...}, "shortcut": {...} }`。

**改法（服务端 `cloud-server/src/store/kvStore.ts`）**：
- 落盘从 `kv/{type}/{key}.json` 改成**一个 `{dir}/settings.json`**，内容 `type → key → value`；
- 对外契约**没动**：HTTP 仍是 `/api/kv/:type/:key`、SSE 事件形状不变 ——
  客户端（含 CloudKvAdapter）一行没改，改的只是磁盘怎么放；
- **写必须整体串行**：以前一项一文件可以按 (type,key) 各排一条链；现在全落同一个文件，
  读-改-写必须串行，否则并发写会各读同一份旧内容、互相覆盖（丢配置）。新增并发写测试锁这条；
- 旧布局**自动迁移**（认两种历史形态：`kv/{type}/{key}.json` 与最早的 `kv/{type}%3A{key}.json`），
  只搬 config / shortcut（canvas / resource 早有各自目录），搬完把旧目录改名 `kv.migrated` 留作备份。

**顺带删掉的死代码**：`kvFileName` / `kvTypeDir`（只为"一项一文件"的文件名转义服务，已无用途）。

**实测（真服务）**：老数据自动迁移成功 ——
  `.mini-canvas/settings.json` = `{"config":{"plugin-manager:installed":[...],"settings":{"imageFitMaxWidth":321}}}`，
  旧 `kv/` 已改名 `kv.migrated`。
单测 cloud-server 190（新增并发写 2 条、迁移 5 条），其余包全绿；官方 e2e **30 PASS / 0 FAIL**。

### 最近完成（2026-10-02，磁盘落盘布局改成人肉可读 + 命名更诚实）

**用户指出的问题（两条都成立）**：

**① KV 文件名丑得认不出内容**：老实现把 type 与 key 拼成一条文件名再整串转义 ——
   `config%3Asettings.json`（`%3A` 就是冒号）。用户原话："它不支持冒号，你用横线或者下划线来替代呀。
   你不能用这个东西啊"。
   **修**：改成 **type 当目录、key 当文件名** —— `kv/config/settings.json`。
   目录名天然不含冒号（四个 type 都是合法文件名），于是只有 key 需要转义；
   而真正带冒号的 key 只剩命名空间式的（`plugin-manager:installed`），转义面小到几乎看不见。
   新增 `kvTypeDir(dir, type)`；`kvFileName(key)` 参数从 `(type,key)` 收成 `(key)`。
   **老文件兼容读 + 自动搬迁**：读不到新路径时回退旧路径，读到就 rename 到新位置 ——
   否则用户已有的设置会因为换布局而凭空消失（实测：老 `config%3Asettings.json` 读得到值，
   并在同一次读里被搬成 `config/settings.json`）。

**② `CanvasAdapter` 名字怪**：它干的是"只发差异"（不整包覆盖，专治 AI 与用户并发写互相盖掉），
   名字却没说这件事。**修**：改名 `CanvasDiffAdapter`（文件同步改名 `canvasDiffAdapter.ts`），
   旁边算差异的 `graphDiff.ts` 与之成对。

**验证**：新增 3 条旧布局兼容读测试（老文件读得到并自动搬迁 / 新布局优先 / 两边都没有 → undefined）；
单测 cloud-server 188、cloud-client 114、canvas-data 360、canvas-render 404、ui 67、node-image 111、
node-video 105、file-drop 42、clipboard 22 全绿；真机验证老文件自动迁移；官方 e2e **30 PASS / 0 FAIL**。

### 最近完成（2026-10-02，接口拆细 + 配置也上云）

**用户提出的两个问题（都成立，都已改）**：

**① 接口臃肿**：把「资源（二进制）」硬塞进 StorageAdapter（与文本的 get/set/remove 同一个 interface），
   导致两个资源适配器被迫实现三个只用来抛错的方法。用户原话："资源可以单独配置、单独实现一个 adapter，
   而不是每一个 adapter 里面都必须包含这些类 —— 这不就臃肿了吗"。
   **修**：拆成两个接口 —— StorageAdapter（key-value：配置/画布/快捷键）与
   ResourceAdapter（字节流：putResource / resolveResource / removeResource）。两者只共享 id / capability。
   两个资源适配器删掉抛错方法，各只剩自己那三个；ResourceStore 不再需要 as never 强转。
   save.adapters 用联合类型，useAdapterForAll 遇到资源适配器只铺 resource 那一格。

**② 配置没上云**：云插件原来只换 canvas / resource 两格，config / shortcut 留在浏览器 local ——
   换台机器设置与快捷键全丢。用户要求："云端的时候 config 和快捷键等配置也直接使用云端的设置"。
   **修**：新增 CloudKvAdapter（走 cloud-server 的 /api/kv/:type/:key，服务端本就支持这两类），
   装云插件时把 config / shortcut 两格也切过去。404 = 从未保存过 → undefined（与本地语义一致）。

**验证**：新增 5 条 CloudKvAdapter 测试（URL 正确 / 404→undefined / 删除幂等 / 两域互不干扰 / 5xx 抛错）；
单测 canvas-data 360、canvas-render 404、ui 67、cloud-server 185、cloud-client 89、node-image 111、
node-video 105、node-audio 90、file-drop 42、bottom-bar 85、kernel 212 全绿；
真机：云端改一个设置 → 服务器 kv 目录出现 config 文件且值正确；官方 e2e **30 PASS / 0 FAIL**。

### 最近完成（2026-10-02，插件管理插件 + 本地中转后台）

**用户诉求**：做一个能**安装 / 卸载 / 重装**第三方插件的「插件管理」插件，它自己带一个**自定义设置页**
（插槽实现，照 plugin-agent）；第三方插件经「请求 JSON 清单拿 js 地址 → 加载那个 js」装载（同 cloud-server 的
`/plugin-manifest.json`）；后台放哪还没定，先做一个**本地临时中转后台**；`packages/ui` 里注释掉一部分插件，
改由插件管理安装，**默认全部设为已安装**。

**加载方式（用户选 A）**：宿主暴露全局 + 加载 UMD —— `ui` 把 `Vue / MiniCanvasCore / MiniCanvasRender /
MiniCanvasBase / VueFlow` 挂 `window`（`src/sharedGlobals.ts`），中转站直接发已有的 UMD 产物，
插件管理用 `<script>` 装载。改动最小、复用现有打包。

**交付两件**（原独立的 `plugin-relay` 包已删，功能并入 cloud-server）：
- `packages/cloud-server`（加两样）：`GET /plugin-catalog.json` 给「插件管理」的清单（只收录**声明了
  `miniCanvas.installable` 的 UMD 插件**，避免与冷启动装配的基础件撞名）；`GET /plugins/**` 发插件资源
  （js/css/图片/字体，子目录也支持）。与既有的 `/plugin-manifest.json`（ESM，给应用冷启动用）分工并存。
  实现见 `src/plugins/catalog.ts` + `static.ts`。
- 插件管理：设置面板「插件」页（`settingsNav` + `settingsGroup/插件` 两个槽）+ 服务
  （清单/已装状态/装·卸·重装）。首次无存档 → 默认全装；之后照存档（卸过的不自动回来）。装/卸走宿主新注入的
  `pluginManager` 服务（`createMiniCanvasHost` 多一行 `ctx.inject('pluginManager', manager)`）。默认清单地址
  是同源 `/plugin-catalog.json`。**它已并入 `packages/plugins/plugin-cloud-client/src/manager/`**
  （原独立包 `plugin-manager` 已删；仍是可独立装卸的插件，导入路径 `.@mini-canvas/plugin-cloud-client/manager`）。
- `packages/ui`：`main.ts` 先 `exposeSharedGlobals()` 再挂载；`assembly.ts` 注释掉 `node-image-compare /
tool-image-generation / tool-text-generation`（改由插件管理装），加 `pluginManagerPlugin`；清单 25 → 23。

**验证（单测 + 真服务 + 真浏览器）**：cloud-server 185、plugin-cloud-client 114、kernel 212、canvas-data 360、
canvas-render 404、ui 67 全绿；三个插件默认装上、卸载「图片对比节点」后节点类型消失、重装后回来、
刷新照存档、控制台 0 报错。见 `docs/superpowers/plans/2026-10-02-plugin-manager-and-relay.md`。

### 最近完成（2026-10-02，资源存储改造的 code review 复查 + 同类问题清查）

按 code-review 技能起两个并行子代理（Standards / Spec 双轴）复查本次改动，两个代理**独立**报出了同一批问题。
逐条验证后修掉 3 个真缺陷：

1. **视频截图往节点里写 base64**（最严重，两轴都报）：captureFrameNode 直接写 imageUrl: frame.dataUrl（无 resourceId），
   而保存时的清洗只删「blob:」与「带 resourceId 的 data:」—— 这张图会原样落进云端 canvas.json。
   修：截图走资源库（persistImage → put/resolve），与图片上传同一条路。
2. **AI 生成出图落盘时 persistImage 根本没注入**（Standards 轴报出）：createImageOpsWriteDeps 漏了这项，
   而 ImageRunDeps.persistImage 与 ImageOpsContext.persistImage **同名不同签名**（url:string vs blob:Blob），
   于是生成工具回的 dataURL 永远不进资源库 → 云端画布出现 base64。修：补上注入，并给两处签名写清区别。
3. **首次上云静默丢图**（Spec 轴报出）：pushLocal 整包直推本地节点，但资源 adapter 在装载时**已经**换成云端，
   本地 IndexedDB 的字节够不着 → 节点上的本地引用与 blob: 地址在云端两头落空。
   修：换 adapter **之前先抓住本地那个**，上云时用 migrateLocalResources 逐个取字节传云端、换 res。<哈希>。

另外清掉三处**误导性/死代码**：
- ResourceStore.register() 已无生产调用者，且旧实现会「偷偷 put 一次」导致**返回的 id 与实际落库引用不一致**
  （拿着 id 查不到东西、还留孤儿字节）—— 改为诚实的「只登记显式 url」，注释写明刷新即失效。
- 删除上一轮遗留的 embeddedResources 引用与过期注释（canvasAdapter 那段已不再上传，只收回引用）。
- API 手册 docs/代码开发/canvas-data/存储SaveService与Adapter.md 补上「两种形式（文本 / 资源）」与 adapterOf。

**验证**：新增回归测试 7 条（截图不写 base64 1 条、首次上云迁移 5 条、register 语义调整改 1 条）；
单测 canvas-data 360、canvas-render 404、ui 65、cloud-server 171、cloud-client 83、node-image 111、
node-video 105、node-audio 90、file-drop 42、clipboard 22 全绿；真机：上传 826KB 图 → 磁盘落文件 →
刷新后渲染 600px 宽、画布无 base64、控制台 0 报错；官方 e2e **30 PASS / 0 FAIL**。

### 最近完成（2026-10-02，资源存储收进 StorageAdapter：一个开关管两种形式）

**用户的设计（也是本次落地）**：配置 StoreAdapter 的地方**统一决定数据存哪**，它管两种形式 ——
文本（JSON）与资源（二进制：图片/视频/音频）。本地装本地版、云端装云端版，一个开关。

**之前为什么不对**：文本那个开关做对了（`save.useAdapter('canvas', …)`），资源那个**写死在构造时**
（`new ResourceStore(urlBackend, createIndexedDbResourcePersistence())`），云端够不着它 → 资源永远进
浏览器 IndexedDB。于是本地落盘清掉 `blob:` 后，推给云端的节点里只剩一个**指向浏览器库的** `resourceId`，
服务器既没字节也没地址（复现实测：一次 `/resources` 上传请求都没发）。

**改法**：
- `StorageAdapter` 补上**资源形式的孔位**：`putResource(blob) → ref`（只回引用，**不回 URL**）、
  `resolveResource(ref) → url`（现算显示地址）、`removeResource(ref)`。
- `ResourceStore` 不再自己攥后端，改成**现取**：`new ResourceStore(() => save.adapterOf('resource'), …)`。
  于是 `save.useAdapter('resource', 云端资源适配器)` 一换，资源就跟画布走同一个开关。
- 本地版：新增 `IndexedDbResourceAdapter`（写入库、`resolve` 现建 **objectURL**）。
- 云端版：新增 `plugin-cloud-client` 的 `createCloudResourceAdapter`（POST 上传 → 回 `res:<哈希>`；
  `resolve` 拼服务器地址，不下载字节）。
- 上传/生成调用点（image / video / audio / file-drop / 生成面板）统一改成 `await resources.put(blob, {kind})`
  + `await resources.resolve(ref)`。
- **删除**上一轮那段「保存时扫描节点、按 resourceId 取字节重传」的补丁（`embeddedResources.ts`）——
  字节在上传那一下就已经存好了，保存路径不再做任何上传。

**两条不变量（用户强调）**：① 节点里**只存 ref（ID）**，绝不存 URL；② **URL 永远是现算的**
（本地每次刷新都是一个全新的临时 objectURL，旧的自然作废；云端由内容哈希拼出稳定地址）。

**验证（真服务 + 真浏览器）**：`pnpm build:assets` → `pnpm serve`（:8865）→ 点上传一张 1.65MB PNG：
| 检查点 | 结果 |
| --- | --- |
| 上传那一下 | `POST /api/canvases/default/resources?name=upload-test2.png` ✅ |
| 服务器磁盘 | 新增 `resources/f27d88fc2049cfb2.png`（1.65MB）✅ |
| 节点 | `imageUrl = res:f27d88fc2049cfb2.png`（只有引用）✅ |
| 画布 JSON | 无 base64 ✅ |
| 刷新后 | 图片渲染 800×600、控制台 0 报错 ✅ |
| 本地 IndexedDB | **未被写入**（云端模式不再碰本地库）✅ |

单测：canvas-data 360、canvas-render 404、ui 65、cloud-server 171、node-image 111、
cloud-client 78、node-video 105、node-audio 90、file-drop 42；云端 e2e **30 PASS / 0 FAIL**。

### 最近完成（2026-10-02，云端上传图片真的落盘了 + AI 建节点也用自增数字）

**用户报的问题**：云端环境下上传图片，刷新后图片不见了；本地 `canvases/default/resources/` 里没有对应文件。

**真根因（用真服务 + 浏览器自动化复现，拿到确凿证据）**：本地落盘时 `sanitizeTransientResourceUrls` 会清掉
`blob:` 地址（那是会话级地址），于是推给云端的那份节点里**只剩 `resourceId`** —— 而它指向浏览器的
IndexedDB，服务器读不到。上一轮的"保存时把 base64/blob 转文件"只覆盖了"字段里还有内嵌地址"，
**完全没覆盖"只剩 resourceId"这条真实路径**，所以一次上传请求都没发（实测 `资源相关请求：[]`）。

**改法（走资源自己的路径，不在字段层打补丁）**：保存前若节点带着 `resourceId` 而资源字段是空的，
就**按 id 从宿主资源库取出字节** → 上传成画布资源文件 → 换 `res:<hash>` 写回该节点类型对应的媒体字段
（image→imageUrl、video→videoUrl、audio→audioUrl…，按类型映射，不再一律塞 imageUrl）。
同一张图按 resourceId 缓存、只传一次。首次上云的整包推送走同一道处理。

**用户同时要求**：AI 建节点**不必自己指定 id** —— 交给服务端发号、在 `added` 里回传。
已改：cloud-server 的 `newNodeId` 从 `ai-随机` 改为**自增数字**（与网页端同一套规则，取现有最大 + 1、跳过已占用号）；
MCP 工具描述同步更正。

**验证（真服务 + 真浏览器，按用户给的启动方式）**：
`pnpm build:assets` → `pnpm serve`（:8865）→ Playwright 打开画布 → 选中图片节点 → 点上传 → 塞入 1.65MB 真 PNG：

| 检查点 | 结果 |
| --- | --- |
| 触发了资源上传 | `POST /api/canvases/default/resources?name=asset.png` ✅ |
| 磁盘落文件 | `canvases/default/resources/56f9baac44b0805e.png`（1.65MB）✅ |
| 磁盘 canvas.json | `"imageUrl":"res:56f9baac44b0805e.png"`，**无 base64** ✅ |
| 刷新后 | 地址展开为真 URL、`<img>` 渲染出 800×600 ✅ |
| 控制台 | 0 报错 ✅ |

新增失败测试 2 条（`canvasAdapter.test.ts` 的"只剩 resourceId 也要传上去""同一张图不重传"）先红后绿。
单测：cloud-server 171、cloud-server e2e 30 PASS / 0 FAIL、canvas-data 360、canvas-render 404、ui 65、
node-image 111、file-drop 42、clipboard 22、group 47 全绿。

### 最近完成（2026-10-01，节点与边的 id 统一成自增数字）

**用户诉求（原话）**：节点 id 用数字替代；每次添加节点 / 复制粘贴 / 拖资源进画布，新 id 自增；
连接线同理。插件各写各的 id 形态，画布里五花八门 —— 画布应提供「取当前最新 id」的方法，谁要 id 都向它要。

**根因**：内核**本来就有**自增数字（`NodeStore.createNodeId`），但只有「不指定 id 建节点」这条路会用到；
而插件偏偏都要**先拿到 id**（拿到才能连边、才能选中），于是各造各的：
`fd-时间戳-序号`（file-drop）、`原id-copy-时间戳-随机`（clipboard）、`group-时间戳-序号`（group）、
`temp-menu-时间戳`（context-menu）；边则是 `e-源-目标`（由端点派生）。

**改法**：把「取下一个可用 id」收进 `doc` 门面 —— `doc.nextNodeId()` / `doc.nextEdgeId()`，
**先拿号、再占号**（拿到就标记为已用，跳过已在存的号）。所有插件改向它要：

| 位置 | 原来 | 现在 |
| --- | --- | --- |
| file-drop 拖入/粘贴文件 | `fd-时间戳-序号` | `doc.nextNodeId()` |
| clipboard 复制粘贴 | `原id-copy-…` | `doc.nextNodeId()`（`remapSnapshot` 改为**必须**注入生成器，删掉会自造 id 的默认实现） |
| group 打组 | `group-时间戳-序号` | `doc.nextNodeId()`（删掉 `createGroupId`） |
| context-menu 临时菜单节点 | `temp-menu-时间戳` | `doc.nextNodeId()` |
| 边（内核 `EdgeStore`） | `e-源-目标`（端点派生） | 自增数字 + `nextId()` |
| 边（cloud-server MCP） | `e-{source}-{target}` | 自增数字（取现有最大 + 1） |

**连带的两处语义调整**（id 不再由端点派生，就必须显式做这两件事）：
1. **边去重改看「连接本身」**（端点 + 端口），不再靠「同端点算出同一个 id」—— 内核 `EdgeStore.addEdge`
   与 cloud-server `batchEdges` 都改成按端点键去重，否则同一条线连两次会画出两条重叠的边；
2. **回填后重建计数器**（`replaceAll` 后把计数器抬到存量最大值之后），刷新恢复的图里有 1/2/7 时，
   下一个必须是 8，不能撞已有节点。

**顺带清掉的死代码**（都是被取代后没人再用的）：`edgeStoreId`（canvas-data）、`edgeId`（canvas-render，
及其导出与两条测试）、`createGroupId`（group）、`defaultIdGenerator`（clipboard）。

**验证**：新增 `docService.test.ts` 的「统一 ID 分配」5 条（自增、跳过已占用号、节点与边各自独立计数、
replaceAll 后计数跟上、批量分配互不相同）+ `edgeStore` 的 `nextId` 与按端点去重用例。
单测：canvas-data 360、canvas-render 404、cloud-server 171、plugin-clipboard 22、plugin-group 47、
plugin-file-drop 42、plugin-context-menu 53、其他包全绿。**真浏览器实测**（`pnpm -C packages/ui dev`）：
常规建节点 → 复制粘贴得到 3/4/5/6 → 拖入文件 7 → 打组 8，边是 1/2，**全是自增数字**；云端 e2e 30 PASS / 0 FAIL。

### 最近完成（2026-10-01，图片资源改为「字节进库 + 引用」；云端不再存 base64）

**用户诉求（原话）**：本地保存图片改用 DB 数据库方式做资源缓存，不再转 base64；
远程也是 base64 不对，应以**文件**形式保存。

**根因（两处，方向一致）**：
1. **本地**：图片上传/裁剪/旋转/扩展把结果转成 dataURL 直接写进 `data.imageUrl`（base64 体积约 +33%，全塞 localStorage）；
2. **云端**：云服务端**本来就是**按内容哈希存文件（`canvases/<id>/resources/<hash>.ext` + `res:<hash>` 引用），
   但 `plugin-cloud-client` 保存前只把「服务器地址」收回 `res:`、**从不上传内嵌字节** —— 节点里的 base64 原样进了云端 `canvas.json`。

**改法**：
- **本地**：图片四条路径（上传 / 裁剪 / 旋转 / 扩展）+「加素材」统一改为
  `File/画布产物 → Blob → 资源库（浏览器为 IndexedDB）→ 节点只留 resourceId + 本会话地址`，与视频/音频同一条路。
  做法：`imageTransform` 的 `cropToDataUrl/rotateToDataUrl/paint` 换成 `cropToBlob/rotateToBlob/paintCanvasBlob`（`canvas.toBlob`）；
  `ImageOpsContext` 新增 `persistImage(blob) → { resourceId, url }`；落盘前的 `sanitizeTransientResourceUrls` 不再按大小删 dataURL（上一轮已改）。
- **云端**：`plugin-cloud-client` 新增 `embeddedResources.prepareNodesForSave` —— 保存前扫九个媒体字段，
  `data:`/`blob:` 取字节 → `POST /api/canvases/:id/resources` 传成资源文件 → 换 `res:<hash>`；同一张图按地址缓存、只传一次。
  **任一字段上传失败就整批不发**（绝不把 base64 落进云端）。「首次上云」的整包推送走同一道处理。
  删除死代码 `resourceUpload.ts`（还指着已废弃的 `/api/files`）。

**顺带修掉两个真 bug**（e2e 实测暴露，不是猜的）：
1. **换机器恢复时 `res:` 没展开** → 浏览器拿 `res:...` 当 URL 渲染，报 `ERR_UNKNOWN_URL_SCHEME`、图不显示。
   修：`CanvasAdapter.getRaw()`（恢复路径专用）读回时展开成当前画布的可请求地址（`get()` 一直有展开，恢复这条漏了）。
2. **云端偶发 500**：`/api/canvas/edges` 报 `EPERM: rename canvas.json` —— Windows 上两个写打同一个目标文件必然 EPERM
   （与 `kvStore` 记的是同一个坑）。修：`canvasStore` 补「同文件写串行」+ rename 对瞬时占用做退避重试，并加并发写回归测试。

**验证**：单测 `canvas-data` 354 / `plugin-node-image` 111 / `plugin-cloud-client` 81 / `cloud-server` 155 全绿；
真浏览器（本地）上传 2.1MB 图 → 节点存 `blob:` + `resourceId`、IndexedDB 有字节、存档无 base64、刷新后图片仍在，控制台 0 报错；
真服务端 + 真浏览器（`pnpm -C packages/cloud-server e2e`）**30 PASS / 0 FAIL**，含「云端画布 JSON 里没有 base64」
「节点存 `res:<hash>`」「resources/ 里是真文件」「换机器图仍能取回」「全程零报错 / 零 4xx」。

### 最近完成（2026-10-01，云端真身：存储改造 + 投递箱 + 任务历史 + 云端客户端插件）

**一句话**：把「生成」整条链从前端搬到 cloud-server —— 页面关了任务照跑，
不打开页面（只走 MCP）也能下单；前端只负责下单与看。**不做兼容，硬切。**

**后台（packages/cloud-server）**

- **存储改成「一个画布一个文件夹」**：`canvases/<id>/{canvas.json, view.json, history.json, resources/}`。
  `canvas.json` 装节点 + 边 + 画布信息；`view.json` 单独放（视图状态）。
  老 kv 的 `canvas:*` key 与 `/uploads/*` **直接下线**（不做兼容读）。
  资源引用改成画布内相对引用 `res:<hash>` —— 复制文件夹 = 复制画布，AI 也能直接读文件。
- **平台「投递箱」**：`providers/` 目录，丢一个 `.js` 就是一个平台（几秒内热重载，删掉即消失）。
  内置 web2api 用**同一套接口**写成第一个 provider。
  `GET /api/actions` 给前端清单（带 ifVersion）。
- **任务与历史**：`POST/GET /api/jobs`、`cancel`、`GET /api/history`（分页 + 汇总）。
  后台跑任务、把进度**写进节点**（走增量口，与网页端共用一把锁）、终态归档一笔历史。
- **MCP 生成三件套**：`generation.actions / create / status` —— 不开页面也能下单。

**插件（新包 packages/plugins/plugin-cloud-client，取代 plugin-cloud-save）**

一个包干四件事、共用一条 SSE：存档 + 实时跟随、拉后台清单**注册进底栏**、
下单/看进度/取消、读历史。**零 import 单文件产物**，经后台清单下发（就是"后台发插件"那条路）。

**前端（packages/ui）**：历史弹窗改读服务（不再写死假数据）；底栏加可选标记
`externalRunState`（云动作的进度由后台写，底栏不重复写）。

**验证**：cloud-server 154 / plugin-cloud-client 76 / plugin-bottom-bar 85 / ui 65 全绿；
真实服务端到端跑通（存储结构、provider 热重载 11→12、下单→节点 runState→历史、
MCP 全程下单、插件零引用产物动态装载）。计划见
`docs/superpowers/plans/2026-10-01-cloud-server-storage.md`，设计见
`docs/superpowers/specs/2026-10-01-cloud-client-design.md`。

### 最近完成（2026-10-01，修「上传图片后刷新就没了」）

**用户报的问题**：在画布上传图片，刷新后图片不见了。

**根因**：图片上传走的是「File → dataURL 写进 `data.imageUrl`」这条路
（`plugin-node-image/src/imageTransform.ts` 文件头写明：**dataURL 落盘、刷新照常显示，这是
「刷新不丢」的前提**；裁剪 / 旋转 / 扩展的产物同样是 dataURL）。而保存前的清洗函数
`sanitizeTransientResourceUrls`（`canvas-data/src/resourceService.ts`）把**超过 64KB 的
dataURL** 也当成临时地址删掉了 —— 上传链路并没有 `resourceId` 这类第二份拷贝可供恢复，
于是这张图**唯一的一份数据被永久销毁**，刷新自然就没了。裁剪/旋转/扩展的图一起丢。

**修法**：清洗只删「页面之外取不回来」的两种地址，且它们都有第二份拷贝兜底 ——
1. `blob:`（object URL 会话级失效，字节已按 `resourceId` 进持久化资源表）；
2. 带 `resourceId` 的 `data:`（字节同样已在资源表里，节点里这份是冗余副本）。
**不再按大小删内嵌 dataURL**：那是这张图唯一的一份。要瘦身请走「登记资源 → 写 resourceId」
那条路，把字节搬进持久化资源表，而不是在保存时销毁数据。

**验证**：新增失败测试（RED → GREEN）钉住这条 —— `canvasBasePlugin.test.ts` 走**真实落盘链路**
（提交回调 → save → 二次 boot 恢复），断言 200KB dataURL 落盘后仍在；`resourceService.test.ts`
补「带 resourceId 的 dataURL 才删 / 不带 resourceId 的必须留」。
真浏览器端到端复现（起 dev server，走 `image.upload` 命令 + `save.flush` + 真刷新）：
上传 2.1MB 随机噪点图（dataURL 2.89MB，远超 64KB）→ 刷新后 `data.imageUrl` 仍是 dataURL、
`<img>` 加载出 900×700、控制台 0 错误。
测试基线：canvas-data **354**、canvas-render 406、kernel 212、theme-default 241、
node-image 111、node-video 105、node-audio 90、file-drop 42、cloud-save 91、ui 65，全绿；
canvas-data / canvas-render / node-image typecheck 干净（ui 仍余 4 个既有报错文件，与本次无关）。

### 最近完成（2026-10-01，音频节点抽成独立插件 + 波形进度条）

**同日第二/三轮修正（用户截图反馈）**：

**同日第四轮修正（用户报 1 个警告 + 3 个 bug）**：

**同日第五轮修正（用户报"滑动失败 + 参考线只有中间一段"）**：

**同日第六轮修正（用户报"拖进度条又拉出来一条波纹"）**：

**同日第七轮修正（用户报"水波纹晃荡 + 后面全是平的"）**：

**同日第八轮（用户提三件事：拖拽静音 / 加整体进度条 / 拖到边缘波纹滚动）**：

**同日第九轮（用户两条修正）**：

**同日第十轮（用户纠正：边框是 hover 才出现，不是常驻）**：
- 第九轮做成了"平时有边框、hover 只换颜色"，理解反了。用户口径是
  **平时看不到边框，hover/拖动上去才出现**。
- 现在 `.aw-knob::after` 平时 `border: 1px solid transparent`（保留占位以免 hover 时线宽跳变，
  但视觉上**没有边框**），hover/拖动时才把 `border-color` 换成面板色（暗色下即白边）并把线体换主题色；
  全程没有 `box-shadow`。
- 实测：平时 `border: 1px solid rgba(0,0,0,0)`（不可见）→ hover `border: 1px solid rgb(38,38,38)`，
  两者 `boxShadow` 均为 `none`。测试 **89/89**、`ui` 65/65 全绿。
- **拖拽期间要出声，松手恢复"拖拽前"的状态**（第九轮推翻了第八轮的"拖拽静音"）：
  按下把手/进度条时**不暂停、不静音**（播放起来），靠不断改 `currentTime` 出声（"搓碟"手感）；
  松手时按**按下前的状态**恢复 —— 拖前在播就继续播，拖前暂停就回到暂停。
  实测：拖前 paused=true → 拖动中 paused=false 且 `playing` 按钮变"暂停" → 松手 paused=true；
  拖前在播 → 拖动中继续播 → 松手仍在播。
- **播放头线的 hover 高亮去掉阴影，改成边框**（用户要求）：`.aw-knob::after` 平时
  `border: 1px` 半透明前景色，hover/拖动时线体换主题色、边框换成面板色（白），全程无 `box-shadow`。
  实测 hover 时 `boxShadow: none`、`border: 1px rgb(38,38,38)`。
- 测试：本包 **89/89**、`ui` 65/65、bottom-bar 85/85、web2api 51/51 全绿；本包 typecheck 干净。
- **拖拽时不出声**（用户原话："拖拽的时候有声音的那种（站停的播放？）"）：按下把手或进度条时
  先 `pause()` + `muted = true`，并记下"原本是否在播"；松手时恢复静音开关，
  **只有原本在播**才继续播。实测：播放中 `muted=false` → 拖动中 `muted=true, paused=true` → 松手恢复播放。
- **波纹下面新增一条普通进度条**（`.aw-progress`：细轨 + 主题色填充 + 圆点把手，`role="slider"`）：
  它控制**整条音频**的进度，与波纹那条"窗口内位置"是两把不同的尺子。实测点 80% 处 → 定位到 1:12/1:30。
- **拖到一侧时波纹自动滚动**（用户要的"不然进度条只能控制部分区域"）：
  指针进入可视区左右 28px 边缘区时，用 rAF 逐帧把**窗口**往那一侧推
  （`EDGE_SCROLL_SECONDS_PER_FRAME = 0.12`），停了也继续滚；松手/卸载立刻取消。
  实测：按住把手停在右边缘 → 窗口位移 0 → -79px → -240px，整体进度 10% → 29%（到得了全片）。
- 顺带把"拖动中不补算峰值"的限制去掉（拖动中也要按需取新进入可视区的峰值，否则滚过去是空白）。
- 测试：本包 **87/87**（新增 `audioSeekAndProgress` 9 条）、`ui` 65/65、bottom-bar 85/85、web2api 51/51 全绿。
- **"像水波纹一样来回晃荡"**：竖条原本锚在**窗口左端**（`timeSec = start + i * perBar`），
  而 `start` 随播放连续变化 → 同一格每帧显示的采样点都在换，表现为波形原地抖动变形。
  改成**锚在绝对时间轴上**（`cell = firstCell + k`，`firstCell` 取整），
  格子不动、由 `translateX` 整体平移 —— 实测 t=20/22/24s 的平移量是 29.4px/2s 的**线性**关系，格子高度稳定不变。
- **"后面全是平的"（实时计算看着没生效）**：分块取峰值时对**每个小块各自做了一次归一化**，
  安静段被拉满、相对响度全丢。改成 `PeakCache` / `audioSource` 只返回**原始振幅（0..1）**，
  归一化留在最后一次性做。实测 45 秒音频的可见高度有 4 档不同值（90/75/15/10），跟随分段振幅。
- 顺带把两种数据源量纲统一：按需结果是 0..1、已存概览是 1..100 百分比 → 在组件里换算。
- 测试：本包 **78/78**、`ui` 65/65 全绿；`plugin-node-audio` 的 `tsc` 与 ui 的 `vue-tsc` 对本包均 0 报错
  （ui 仍余 4 个既有报错文件，与本次无关）。
- **根因**：波形被写成"两层叠放、上层按进度宽度裁切"，而上层是个**窄容器**，
  里面按百分比定位的竖条被横向压扁 → 看起来像第二条波纹。
- **改成用户口径**：**从头到尾只有一条波形**；进度只做一件事 ——
  把播放头**左边**那些竖条染成主题色（每根自己带 `is-played`，单层）。
- **滑动改成"轮播图模型"**：时间轴是一条长条，靠 `transform: translateX` 整体左移，
  可视区只是一扇窗（窗口不动、内容在动）。实测 t=15s 时 `translateX(-73.5px)`、t=35s 时 `-367.5px`。
- **每根竖条固定像素宽**（`--aw-bar-width`，默认 2px）：可视区能放多少根 = 容器宽度 ÷ 条距。
  实测 294px 容器 → 98 根、铺满 100%。
- **按需算峰值**（用户要点）：新增 `peakCache.ts`（按时间分块缓存 + 多分辨率聚合）与
  `audioSource.ts`（WAV 用 `Range` **只取可视区那几百毫秒字节**；压缩格式退回整段解码但峰值仍按区间算）。
  组件只请求"窗口那一段"的峰值，窗口平移时新进入的部分才算。
- **修掉一个真 bug**：节点常是"先建出来、音频随后写进去"，挂载那一刻波形子树还没渲染 →
  量不到宽度、也没挂上 `ResizeObserver` → 条数退化成保底值、波形只铺最左边一小撮。
  现在 `watch(waveRef)` 在元素出现时测量并挂观察器。
- 测试：本包 **78/78**、`ui` 65/65、bottom-bar 85/85、web2api 51/51 全绿；typecheck 干净。
- **根因是同类错误的两处**：整个滚动窗口的实现里，"波形宽度"与"位置"用了**两套坐标**。
  ① `pitch` 按**整条 100 桶**算宽度，可实际只画了视口内的 20 桶 → 波形只铺满左边 1/5（截图可见）；
  ② 已播色块宽度用"整条百分比"、播放头竖线用"视口内位置" → 两者不重合，且 SVG 里还留了一条
  固定高度的短线与把手叠加，才出现"只有中间一段高亮"。
- **修法：整个窗口换算收敛成一处**（新纯函数 `audioViewport`）——组件只问它要
  `{ start, visible, fraction }`，波形布局、已播宽度、竖线位置**三者共用这一个视口与这一个 fraction**，
  从结构上不可能再不一致。
- **波形改用 HTML 竖条**（原来是单条 SVG path）：宽度走百分比 `calc(100% / 视口桶数)`，
  与缩放/画布变换无关 —— SVG 在 `preserveAspectRatio="none"` 下要反算"视口=多少用户单位"，
  正是上面 ① 的温床。两层（灰底 + 已播）叠放，上层按 `width: fraction%` 裁切。
- **参考线改为贯穿整个波形高度**（原是 12px 的小圆球/短线）：hover/拖动时变主题色 + 柔光。
  实测：20 根竖条铺满整宽（末根右缘 = 容器右缘 845.8）、t=2s 分界/竖线都在左端、t=45.7s 同步移到 ~32%、
  拖时间文字移动节点（90,90 → 120,120）、拖参考线只 seek（节点不动，0 → 26.6s）、控制台 warn/error 仍为 0。
- **Vue 警告刷屏**（`Extraneous non-props attributes (class, data-slot-order, data-slot-id)`）：
  底栏三个浮层（NodeBottomBarOverlay / ReferenceSelectOverlay / MediaPreviewOverlay）的根节点是
  `Teleport`，插槽宿主 SlotHost 下发的 `class`/`data-slot-*` 没法被继承 → 每次渲染警告一次。
  三处各加 `defineOptions({ inheritAttrs: false })`（我们本来就不用那些属性）。实测控制台 warn/error **0 条**。
- **只有按钮与播放头拦画布手势**（用户原话："正常来说，只有这两个按钮，以及波纹上面的滑块在拖拽时才会
  拦截，其他元素都不会拦截节点的拖拽"）：`.aw-bar` 整条原本带 `nodrag nopan nowheel`，把时间/文件名
  一起拦了。现在把三个类**下移到每个 `<button>` 与播放头**上，控制条本体放行。实测拖"时间文字"
  节点位置 `120,120 → 161,147`。
- **滑动效果异常（回馈环）**：视口跟着播放位置走、而拖拽又是"指针 → 播放位置"，两者一起动就越拖越跑偏。
  新增"拖动中**冻结视口**"（`frozenWindow`）：按下把手时锁定当前视口，整段拖拽用同一把尺子，
  松手才重新居中。缩放窗口换算也改成按**实际视口**算（`seekRatio` / `headFraction`），
  而不是原来写死的"整条百分比 / 恒在中点 50%"（窗口被夹住时那是错的）。实测拖到 30% 就是 6/40 秒、
  拖到 70% 就是 14/40 秒，不再跑飞。
- **播放头从圆球改成竖线**（用户原话："中间有一个小圆球 我是希望你删掉他"）：`.aw-knob` 变成一条
  细竖线（11px 命中区 + 2px 视觉线），hover/拖动时换成主题色 + 一圈柔光。实测 hover 前
  `rgb(145,145,145)`、hover 后 `rgb(8,145,178)`。
- **hover 不再有灰底**（用户原话："会有一个灰色的背景，这是我不太喜欢的地方"）：删掉
  `.aw-wave:hover` 的 `background`，改成**只提亮波形本身** —— 未播的灰从 `--canvas-node-text-muted`
  提到 `--canvas-node-text`（不透明度 0.7→0.95），已播的主题色与 `--ui-panel` 混白提亮一档。
- **节点能拖了**（用户实测："拖拽节点变成了拖拽你的进度条"）：根因是波形整块带了 `nodrag`。
  现在**波形本体去掉 `nodrag`**（拖波形 = 拖节点），进度改由**播放头上的圆形把手**负责
  （把手自带 `nodrag nopan nowheel` + `role="slider"`，方向键可微调 1 秒）；点波形空白跳转仍可用
  （只拦 `click`，不拦 `pointerdown`）。
- **高度不再留空带**（用户实测："下面的区域是空白的"）：波形原本固定高度，卡片多出来的空间就空着。
  改为**弹性填满**（`flex: 1 1 auto`），SVG 跟着长高；配置项 `audioWaveHeight` 语义从"高度"改为
  **"最低高度"**（默认 46→28，下限 16），只在卡片被压得很矮时兜底。
- **长音频的滑动窗口**（用户要求："它是一个非常长的波纹…根据当前进度显示对应可视区域"）：
  新增纯函数 `audioWindow.ts`（`visibleBucketCount` / `windowStartBucket`，各带边界测试）+
  组件侧按窗口算 `viewBox` 与绘制区间。短音频整条显示；长音频只画可视那一段（最少 20 桶防"放大成粗条"），
  窗口把当前位置摆在正中，**播放时窗口平移 = 波纹在背景里滑动**（实测：40 秒音频 seek 到
  10/24/36 秒，可视区里的波形形状各不相同）。

**用户诉求**：web2api-tools 里顺带注册的 `audio` 节点抽成**独立节点插件**，UI 换成"音频纹波"
（波形当进度条：左侧主题色 = 已播、右侧灰 = 未播、可在波纹上拖拽 seek、播放时有动画）；
不显示字幕/歌词，只有一个音频；节点**不支持 resize**；波形数据在**第一次加载音频时算一次并存进节点**
（约 100 个数字），之后只读缓存。后续追加两点：右侧"更换音频"按钮改成**刷新**（重算波形与时长）；
**时长要随波形一起加载并存进节点**（实测时长没显示）。

**新包 `packages/plugins/plugin-node-audio`**（照 `plugin-node-video` 分层）：

| 文件 | 职责 |
|---|---|
| `waveform.ts` | 纯函数：桶化峰值（每桶取绝对最大值，负半周也算）、归一化到 1..100 整数（静音保底 1）、`isValidWaveform` 校验、`fallbackWaveform(seed)` 确定性回落（同名地址恒同形状，不用 Math.random） |
| `audioPlayback.ts` | 纯函数：`progressRatio` / `seekTime` / `ratioFromPointer` / `formatClock`（含 NaN 收敛） |
| `audioTransform.ts` | 浏览器端口：`fetch → decodeAudioData` 一次拿到**波形与时长**（多声道逐帧取最大；`finally` 里 `close()` 释放 AudioContext）、选文件、下载（node 下安全返回 null/false） |
| `audioOps.ts` | 载入一条路：`loadAudio`（换地址必重算）/ `uploadAudio` / `ensureAudioMeta`（**波形与时长缺哪个补哪个**，两者齐了零开销）/ `reanalyzeAudio`（刷新）/ `downloadAudioNode` |
| `nodeAudioPlugin.ts` | 注册 `audio` 类型（`size 320×120`、`resizable: false`、in: AudioContent）+ `AudioService` + 命令 `audio.upload` / `audio.download` / `audio.reanalyze` + Config（`audioWaveHeight` / `audioBarMinWidth`，组 `节点/音频节点`） |
| `AudioContent.vue` | 内容段：**单条 SVG path** 画 100 根竖条（一个元素 vs 一百个）→ `clipPath` 分两层上色（`--ui-accent` 已播 / `--canvas-node-text-muted` 未播）+ 播放头；指针按下/移动 = seek（`setPointerCapture`，`nodrag nopan nowheel`）；rAF 只在播放中跑；播放态 `.is-playing` 走 `aw-breathe` 呼吸动画（带 reduced-motion 降级）；空态给「上传音频」入口 |

**数据契约**（存进节点）：`data.audioUrl` / `audioName` / `audioDuration`（秒）/ `audioWaveform`（100 个 1..100 整数）。
波形是派生数据 → 走 `doc.updateNodeRuntime`（落盘、不进撤销栈）；地址/时长/文件名 → `doc.updateNode`（进历史）。

**web2api-tools 交还节点所有权**：删掉 `AudioContent.vue` 与 `AudioService` / `ctx.nodes.register`，
**只保留**音频生成动作与结果写入器（继续写 `data.audioUrl`）—— 于是没装 web2api 的宿主也能有音频节点。

**装配**：`packages/ui/src/assembly.ts` 加 `nodeAudioPlugin`（清单 23 → **24**）；`packages/ui/package.json` 加依赖。

**验证（实测）**：`plugin-node-audio` **50/50**、`plugin-web2api-tools` 51/51、`ui` **65/65**、
kernel 212 / canvas-data 353 / canvas-render 406 / canvas-base 6 / node-video 105 / node-image 111 /
node-text 31 / bottom-bar 85 / theme-default 241 / file-drop 42 全绿；新包 / web2api / ui 三个 typecheck 干净
（ui 的 `vue-tsc` 仅剩 4 个**既存**文件报错：CanvasHost.vue / SelectionFrame.vue / ModalsArea.vue / useFloating.ts，与本次无关）。
**浏览器实测**（dev :5411，CDP 驱动）：写入 dataURL 音频后波形与时长自动落库（`audioWaveform` 100 个、
`audioDuration` 正确）；拖拽波形到 75% → `currentTime 0.749`、clip 749.43、播放头同步；
点播放 → `.is-playing` 挂上、`aw-breathe` 动画生效、进度随播放推进、播完停在末尾；
只写 `audioUrl` 的节点（模拟 web2api 写入器）挂载后**时长与波形一起补齐**（实测 2 秒音频显示 `0:00 / 0:02`）；
底栏同时出现 web2api 的音频动作（豆包·语音合成），两插件协同正常。

### 最近完成（2026-10-01，底栏「参考」选择态 + 全屏预览 + 右侧按钮接通）

**同日修正（用户第二轮截图反馈）**：

- **「参考」改成两态开关**（用户实测「点击之后就无法取消」）：点一下进入、再点一下退出；
  顶栏「返回节点」= 聚焦回节点 + 结束参考（与 ✕ / Esc 三条路都能收）。根因是按钮高亮态没
  跟住会话状态 —— 现在直接读会话状态，点一下必切换（`toggleReference` 有单测锁两态）。
- **「风格」pass 掉**（用户要求）：「我们的风格一般都会直接写在提示词中或标签（后期在输入框里做成
  一个 tag）」。于是：顶行不再有「风格」pill；底栏不再有风格卡；**web2api 四个图片预设删掉
  `kind:'style'` 参数**（豆包 32 档 / ChatGPT 10 档预设整块删除），描述文案改成「比例可选；风格写在
  提示词里」。`presets.test.ts` 改成断言「任何图片预设都不再有 kind:style」。
- **下拉菜单换皮 + hover 描述动效**（用户要求照右键菜单）：`Select.vue` 的选项行改成
  「名称 + hover 描述」结构（名称绝对居中，悬停/聚焦时上移到 top:3px、描述从下方 translateY(6px)
  淡入），数值与 `ContextMenu.vue` 逐条对齐（0.3s ease-out）；`SelectOption` 加可选 `description`；
  底栏的**模型下拉**带上动作的 `description`，所以悬停能看到每个模型的一句话说明。

**同日第八次修正（用户第九轮截图）** —— 全局设置入口按用户最终要求重做：
- **展开/收起的动画卡顿修掉**（用户反馈「展开和缩回的时候，动画一点也不流畅…一卡一卡的」）：
  根因是用了 `grid-template-rows: 0fr↔1fr` —— 查下来**这个属性在各浏览器对 fr 区间的过渡支持不一**，
  Chromium 里既可能逐帧 reflow 掉帧、也可能干脆**不补间直接跳变**（那正是"卡"的来源）。
  改成**测量高度过渡**：Transition 的 `@enter/@leave` 把 `height` 显式从 0 ↔ `scrollHeight`
  写好、配 `transition: height .26s`，到位后 `height` 归 `auto`（内容变化不被钉死）。
  **浏览器实测逐帧采样**：展开 282→292→306→322→333→337→340→342→343→344→345→346 共 12 个中间值
  平滑补间（不再是跳变），收起同样逐帧回落。
- **末尾那个"跳一下"也修了**（用户二次反馈：「高度缩减为零之后……最后一个过渡很难受」，猜是分割线被隐藏）：
  根因不是分割线，是**父容器 `.nb-root` 的 flex `gap: 8px`** —— gap 属于父元素、不在本元素高度里，
  自定义 height 过渡到 0 时那 8px 还在，等 `v-if` 摘掉元素的瞬间 gap 才消失 → 末尾"啪"跳 8px
  （实测：346→…→282 停住、然后 282→274）。给 `.nb-global` 一个 `margin-top:-8px` 抵消 gap，
  间距改由元素**内部**承担（`.nb-global-inner` 的 margin-top 补齐），于是留白跟着 height 一起裁剪、
  一起动画。**逐帧实测**：收起 346→334→319→301→289→284→280→278→277→276→275→275→274，全程平滑无跳变。
- **图标换回「滑块」样式**（用户要求：「你这边的图标给我改过来，你前面几个版本的那个设置图标还可以」）：
  把底栏那枚齿轮（⚙ cog）换成**三条横线 + 滑块**的设置图标（`ICON_SETTINGS`，即"偏好/调节"那款）。
- **点它不再弹窗，改为在底栏下面追加一块**（用户要求：「它是在底部状态栏的下面一部分进行展示，
  而不是打开我的弹出框设置界面……类似在底部增加一块区域，并且带有一个动画效果（比如底部状态栏
  慢慢增高）。这块区域要有一条分割线来进行分割，并在里面显示当前的全局设置。这部分你可以直接
  使用占位文本」）：新增 `.nb-global` 区域，**追加在底行之后**（底栏最后一块），
  `border-top` 一条分割线，里面是「全局设置 + 占位说明」文本；展开用 `grid-template-rows 0fr↔1fr`
  让底栏平滑增高（与上一版「设置区」同一手法，但那是参数、这次是全局设置）。按钮高亮随开合。
  **浏览器实测**：点图标后底栏子元素变为 `pills → cards → editor → bottom → global`、
  分割线 1px、占位文本就位、底栏高度 274 → 346（增高动画）。
- 顺带**回退**上一版为「齿轮打开应用设置面板」加的 `settings:ui-open` 事件通道（用户不要弹窗，
  该通道已无用）：`packages/ui/src/composables/ui.ts` 的订阅与 openSettings、theme-default 的
  registerEventName、以及那条单测一并撤掉。

**同日第七次修正（用户第八轮截图）**：
- **底栏齿轮真的能开全局设置**（用户实测：「右侧你的这个设置按钮也给我搞没了，点击也没反应」）：
  新增内核事件 **`settings:ui-open`**（与既有的 `settings:ui-close` 对称），装配层
  `useUi.bindSettingsClose` 一并订阅它 → 置 `settingsOpen = true`。底栏那枚齿轮在插件里、
  够不到装配层状态，现在 `ctx.emit('settings:ui-open')` 就能弹出**同一个**全局设置面板
  （实测验到 偏好/设置 面板：节点/布局/边/常规/web2api/导出）；不再是什么都不做的假占位。
  新增 1 条整装测试锁这条通道（`settingsCloseChannel.test.ts`）。
- **比例下拉按内容宽**（用户实测：「你这个比例的下拉，文字就那么长，你给我把按钮搞那么大」）：
  参数下拉原来写死 `min-width:148px` + `width:100%`，把「16:9」撑成一条长按钮。
  改为按内容自适应（`width:auto`、`min-width:0`、`max-width:240px`）。
  **浏览器实测**：参数触发器宽度 148 → **81px**（正好包住「16:9 ⌄」），模型下拉仍 154px。
- **顺带修**：`packages/ui/src/App.vue` 的「正在跟随」横幅颜色净化测试一直红 —— 白名单标记
  与颜色行之间隔了两行，而测试只在**相邻上一行**认标记。把横幅收成整行、标记紧贴颜色行后转绿
  （`ui` 单测 64 → 65，含新增的 `settings:ui-open` 那条）。

**同日第六次修正（用户第七轮截图）** —— 上一轮把参数放错地方了，这次纠正：
- **参数回到"底行上的一个下拉"**（用户要求：「右侧的比例选择也是通过下拉的方式」）：
  上一轮把比例等参数放进了「设置区」追加面板——**那是错的**（见下条）。现在底行左侧是
  「模型下拉 │ 参数下拉（比例 16:9 ⌄）」，用回 `ToolParamGroup`（自带图标 + 下拉）。
- **左右分区纠正**（用户要求：「我说过你的设置放在右边，你把它放到左边去了」）：
  **左侧 = 插件/动作提供的东西**（模型 + 它声明的参数，都在底行上）；**右侧 = 全局设置**位
  （那枚齿轮，仍是**占位**、点了只提示）。上一轮把参数塞进「设置」区，等于让"设置"里出现了
  动作参数 —— 与「设置是全局、跟插件/动作无关」的分工冲突，已回退。
  于是上一轮新增的 `.nb-settings` 追加区 / AutoLink 开关 / 参数摘要 / 滑块图标全部删除
  （那批是建立在错误理解上的）。
- **模型下拉再放宽**：`dropdown-min-width` 240 → **300**（用户要求「模型选择框的下拉宽度可以再大一些」）。
  **浏览器实测**：底栏子元素又回到 `nb-pills → nb-cards → nb-editor → nb-bottom`（无追加设置区）；
  底行左 = `模型(154px) │ 16:9 下拉`、右 = `翻译 | ✨ | 齿轮占位 | 计数 | 发送`；模型浮层宽 300。

**同日第五次修正（用户第六轮截图）**：
- **下拉菜单重做 + 图标 + 标题**（用户强烈要求，附 3 张参考图「参考一下它的 UI 图标，然后再加这个标题」）：
  `SelectOption` 加可选 `icon`（opaque 句柄，与节点类型 icon 同写法）；`Select` 选项行渲染
  28×28 图标托（照仓库右键菜单 / 主题菜单的 look，有图标时行高 44px）；底栏模型下拉每行给出
  该动作服务类型的图标（优先取 `nodeRegistry` 里节点类型注册的 icon，取不到按类型名回落内置 SVG），
  于是「豆包 Seedream 4.5」这类**标题**左侧带图标、悬停还有描述。
- **配置分区修正**（用户要求）：**左侧 = 插件/动作自己的配置**（模型下拉 + 参数摘要 + 动作配置开关，
  参数在下方追加区摊开）；**右侧 = 全局设置**（跟插件/动作无关），目前只放一个**占位齿轮**
  —— 用户明确说「这边暂时使用一个占位就行，不需要你实现」。原来那个「高级参数」滑块从右侧挪到左侧、
  跟动作配置合并（一个入口，不再左右各一个开关）。
  **浏览器实测**：下拉 9 行全部带图标托（行高 44）、标题 + 悬停描述齐；底行左侧
  `模型 | 摘要 | 配置开关`、右侧 `翻译 | ✨ | 齿轮占位 | 计数 | 发送`。
- **下拉「点得开、点不关」修复**（用户实测：「你这里的下拉还不能点击切换显示隐藏」）：
  根因在 `Dropdown.vue` 的默认 click 触发器只做 `open()` 不做 toggle —— 没在内部按钮写
  `@click.stop` 自管切换的消费方（ToolParamGroup 的参数下拉）就点不关。改成 `toggle`；
  Select / ColorField 自己 `@click.stop` 的路径不受影响（事件到不了外层）。
  **浏览器实测**：底栏模型下拉、设置面板下拉、添加节点菜单 —— 三者都是「开→再点→关」。
- **参数搬到外面 + 设置区改成「底部追加、向下外扩、有动画」**（用户要求：「有些配置你可以直接放在
  底部栏目中，而不是直接嵌套在这个下拉内部」+「设置是在底部追加一块区域…向下外扩，而且有动画」）：
  新增 `.nb-settings` 设置区（默认展开），位置在**底行之后追加**（`nb-settings-wrap` 是底栏最后一个
  子元素），参数**直接摊开**（比例网格 / 下拉 / 开关各自成块），不再塞进 `ToolParamGroup` 的合并下拉；
  展开/收起走 `<Transition name="nb-set">` + `grid-template-rows 0fr↔1fr`（高度平滑长开）
  再叠一点上滑淡入。底行原来的参数下拉位置换成**只读摘要**（点它开合设置区）；右下角滑块图标同效。
  「智能引用 AutoLink」也从滑块图标里挪到设置区。
  **浏览器实测**：底栏子元素顺序 `nb-pills → nb-cards → nb-editor → nb-bottom → nb-settings-wrap`
  （设置区在底行**之后**、已 `settingsAfterBottom:true`），点摘要能收起再展开。
- **模型下拉浮层宽度**：去掉上次为「太窄」加的固定 240px 最小宽，恢复与按钮同宽（用户实测
  「你这里的 trigger 宽度被固定了大小？？」——长条目本就该撑开、短的与按钮齐）。
- **底栏右上角「展开」按钮接上**（用户要求「点击展开 UI（变成 dialog 的形式，展示这里的 UI）」）：
  原来是个死按钮。做法**不复制 DOM** —— 同一块 `.nb-root` 在展开时 `<Teleport to="body">` +
  外层 `.nb-shell.is-expanded`（fixed 铺满 + 遮罩 + 居中），内容/状态一份；收起时 Teleport 禁用、
  外壳 `display:contents`（完全透明，底栏还是原来那条浮层）。展开态宽度 min(760px,100%)、
  限高滚动、输入区放宽到 40vh；Esc / 点遮罩 / 再点按钮都能收；按钮图标换成「收起」箭头。
  **浏览器实测（Playwright 无头 Chromium，dev :5399）**：展开后 `aria-modal=true`、
  外壳 `display:flex` + 遮罩 `rgba(0,0,0,.6)`、面板 760×274 且水平垂直都居中、
  同一份 UI（输入框/素材卡/模型下拉都在）；Esc 后回到 `display:contents`。

**同日第四次修正（用户第四～五轮截图）**：
- **底栏素材卡模糊值**：用户指定改 `blur(1px)`（原 3px）。
- **底部 dock「移动 / 抓手」按钮的图标不跟着模式切**（用户实测，指出在 `packages/ui`）：
  按钮此前**恒定**画 `Hand`（抓手）图标，切到「移动」也还是抓手的样子。改成
  `<component :is="s.canvasMode === 'move' ? Move : Hand" />` —— 移动态显示 Move、抓手态显示 Hand。
  **浏览器实测（Playwright 无头 Chromium，dev :5399）**：点按钮→「抓手工具」后图标 class 变
  `lucide-hand`、再切回「移动」变回 `lucide-move`，来回都跟着模式走。
- **底栏素材卡：正方形 + cover + 图片本身模糊**（用户先指「素材卡」（第 414 行那块 div），
  纠正过一次——第一次我误做到全屏预览上，已回退）。用户原话：「这里是正方形 你的图片要使用
  cover 方式展示，然后给他一个模糊效果，但是你这里图片并没有模糊而是背景模糊（我要的是图片模糊）」。
  最终做法就是一张 `.nb-card-img`：`object-fit: cover` + `filter: blur(3px)` +
  `transform: scale(1.18)`（放大一点防 blur 啃出透明边）；不再分「模糊背景 + 清晰前景」两层。
  **浏览器实测（Playwright 无头 Chromium，dev :5399）**：卡片 48×48 正方形、
  `imgFit:cover`、`imgFilter:blur(3px)`、`imgTransform:matrix(1.18…)`，截图肉眼可见卡片是模糊的缩略图。

**同日第三次修正（用户第三轮截图）**：

- **下拉浮层太窄**（用户实测「至少得两百px」）：`Select` 新增 `dropdownMinWidth`（缺省 200px），
  只在 `dropdownWidth:'match'` 时生效 —— 底栏模型下拉的触发框只有 ~100px，match 会让浮层
  缩成一条窄缝、模型名全截断。底栏模型下拉显式设 `dropdown-min-width="240px"`。
- **「风格」再兜底**（用户要求「删掉」）：除删预设参数外，`NodeBottomBar` 的 `paramDefs` 现在
  **过滤掉任何 `kind:'style'` 字段**（与来源无关，防运行时清单再冒出风格参数）；
  `fieldSummary` 改读过滤后的 `paramDefs`（原先读原始 `fields`，会把风格的默认值漏进 🌟 摘要 ——
  这条是被新单测当场抓到的真 bug）。新增 1 条单测锁「带 kind:style 的动作，底栏摘要里不出现它」。

用户带三张截图要求：①「参考」要真的能选节点建立链接（现在功能没实现）；②「标记」暂不支持但要给出
不支持的样子；③底栏右侧那排按钮也没实现；④「风格」；⑤素材卡预览要**全屏**（原来缩在底栏里）。
另明确：截图里那张有问题的预览卡是 **LibTV 参考站**的（索引在左上、图底带模糊），别照抄它。

**参考选择态（新）** —— 判定全在 `referenceMode.ts`（零 DOM 纯函数，20 条单测）：

- **谁能当参考 = 读节点类型自己声明的端口能力**（源输出口的 `contentType` ∈ 目标输入口的
  `acceptsTypes`），不是底栏写死一张类型表 —— 加一个新节点类型不用动本插件。
  与内核「缺省即全收」同口径（目标没声明 acceptsTypes → 来者不拒；源没声明产出 → 不当参考）。
- 四种面孔：`owner`（自己，只描边）/ `selectable`（可点、悬停出「选择 XX」提示）/
  `connected`（已连，提示变「取消选择 XX」，再点解除）/ `blocked`（灰罩 + 半透明，不可点）。
- 点可选节点 = `doc.connectEdge({source, target})` 建立链接（它随即出现在底栏素材区）；
  点已连节点 = 摘掉那条边。宿主节点掉出选中集 → 选择态自动收（逐帧守，防「底栏换人了盖层还留着」）。
- 浮层 `ReferenceSelectOverlay.vue` 注册在既有 overlay 槽（与底栏宿主同槽、order 41），
  Teleport 到 body + 屏幕坐标 fixed（与 `NodeBottomBarOverlay` 同一手法，绕开节点层叠上下文）。
顶部蓝底操作框：提示 + 「返回节点」+ ✕；底部「按 ESC 退出」；Esc 可退。
**「返回节点」= 聚焦回节点**（用户实测反馈）：点击后先把视口中心移到该节点（缩放 <60% 时抬到 100%，
否则保留用户当前尺度），再退出选择态。**悬停提示改为跟随鼠标**（不再钉在节点右侧，与光标保持 14/18px
偏移 —— 用户实测反馈「提示要跟着鼠标走」）。

**全屏预览（改）** —— 用户要「全屏，是整个视图」：新 `MediaPreviewOverlay.vue` + `mediaPreview.ts`
（module 级会话状态），铺满整个视口看大图/全文；Esc / 点背景 / 右上 ✕ 三种关法。
素材卡序号角标仍是**左下**（没有被参考站那张卡带偏），缩略图**不加模糊底**。

**「标记」置灰** —— `disabled` + `opacity .38`（用户要求：给一个透明度效果表示不支持）。

**「风格」接通** —— 与「参考」同一条选择态通道，只是 purpose=`'style'`：选中的图写进本节点
`data.styleRef`（一张风格参考图，不建连线），底栏素材区最前面显示「风格」卡（可点开预览、可替换）。

**右侧按钮接通**：

- 「高级参数」：就地展开**全部参数控件**（比底行那个合并下拉更细，逐项可改）+ 「智能引用 AutoLink」
  开关（照参考图的高级设置项，写 `data.autoLink`）。
- 「翻译提示词」：`promptActions.ts`（纯函数，6 条单测）在提示词后追加/摘除一句「译成英文」指令，
  按钮两态高亮。**顺带修了一个真 bug**：程序化改文本时必须清掉 `promptDoc`，否则编辑器会优先用
  旧 JSON 还原、把追加的指令顶回去（实测：用户先打过字就完全点不动）。

**验证**：plugin-bottom-bar 单测 **76/76**（新增 referenceMode 20 / promptActions 6 / uiState 4）、
typecheck 过；回归 ui **64/64**、canvas-render **406/406**、theme-default **241/241**、
node-image **111/111** / node-text **31/31** / node-video **105/105**。
Chrome MCP 实测（dev :5388）：参考态盖层 4 种状态齐、点可选→连上（素材卡 0→1）、点已连→解除、
文本节点做宿主时图片节点为 `blocked`；全屏预览根 1400×836 = 整视口；翻译按钮空文案↔28 字两态来回、
开关可写 `data.autoLink`；无 console error。



### 最近完成（2026-09-30，节点尺寸改为单一来源 node.size）

用户问题：卡片尺寸为什么要存两份（`node.size` 与 `data.cardWidth/cardHeight`）？能不能合成一个？

结论：能。`node.size` 现在是**唯一正身**，`data.cardWidth/cardHeight` 降级为**数据层自动生成的镜像**
（卡片壳 BaseNode 只拿得到 VueFlow 摊平的 `props.data`，读不到 `node.size`，所以镜像必须由数据层统一补，
而不是让每个写尺寸的插件各写一份）。之前"要同时写两个数"的纪律散在五六个地方，谁漏一个就出现
"卡片变了、边端点还停在旧宽度"；现在写尺寸只剩一处成型。

- **数据层收口**（`canvas-data/nodeStore.ts`）：写 `size` → 自动刷镜像；只写 `data.cardWidth/cardHeight`（老插件 /
  后台 / MCP 的旧写法）→ 自动**提升为 `node.size`**；清 `size`（`size: undefined`）→ 镜像一并清掉。
  `replaceAll`（读档 / 云端合并 / 导入）对**存量老存档**做一次性迁移：只有 `data` 尺寸的节点补上 `size` 并刷镜像。
  新增导出 `nodeSizePatch(w,h)`（只给 `size` 的写回补丁）与 `nodeSizeOf(data)`（从 data 读回尺寸）。
- **生产端收敛**：resize（`useNodeCardSize`）、图片 / 视频 / 对比 / 分组 / 自动布局 / 拖入文件 / 视频换源
  全部改成只报 `size`；各自的 `CardSizePatch` 从三件套收成单字段 `size`。
- **不凭空造尺寸**：建节点（`addNode`/`addNodes` 未给 size）不写 `size`，缺席 = 用类型默认尺寸
  （布局回退链与卡片壳都认这条），只有真被写过尺寸的节点才有 `size`，避免给存量图强加一个尺寸。

**改尺寸的一等入口**（作者不必自己拼 patch）：
`ctx.nodes.setSize(id, w, h)`（薄糖，与下者同一实现）或 `ctx.get('doc').setNodeSize(id, w, h)` ——
内部走唯一写入口（进历史 + 调度落盘），自动刷 `data` 镜像；宽高非正有限数（0/负数/NaN）→ 返回 `false`
且不写。批量/进阶仍可用低层 `doc.updateNode(id, { size })` / `updateNodes`。

**节点语义写方法收口**（作者不写原始字段 `data.label`/`position`/`parentId`）：
`ctx.nodes.setLabel / move / setParent / remove / setSize`（薄糖），或 `doc.setNodeLabel / moveNode /
moveNodes / setNodeParent / setNodeSize`（真实现，走唯一写入口 + 历史 + 落盘）。`setNodeLabel` 会把
空串/空白归一成"无标题"（显示回类型名）。`doc.updateNode(id, { data })` 等原始字段口仍在（低层/批量/内部用），
只是不再是一等入口。

验证：`canvas-data` 342（新增 `nodeSizeSingleSource.test.ts` 12 条锁单一来源/迁移/清镜像/`nodeSizeOf` 边界）、
`canvas-render` 406、`ui` 64；图片 111 / 视频 105 / 对比 46 / 分组 48 / 自动布局 33 / 拖入 42 全绿；
typecheck 过（canvas-data / canvas-render 业务码 / node-image / node-video / node-image-compare / group /
auto-layout / file-drop / theme-default / mcp-server）。

### 最近完成（2026-09-27，插件上下文与包边界 T01–T09）

### 最近完成（2026-09-30，左下角「缩放选项」接上真实画布）

用户要求：左下角状态栏那个缩放百分比是**假的**，请把它接成"真正设置画布缩放值"。

实测确认原状：`state.zoom = 39` 是写死的纯 UI 数字，菜单动作只改这个数字 —— 从没接到 viewport 上
（表现：点「缩放至 100%」画布纹丝不动、读数永远是 39%，而真实视口其实是 160%）。

做法（唯一事实来源 = 真实视口）：

- `composables/ui.ts` 新增「缩放」段：`zoomInStep / zoomOutStep / zoomToPercent / zoomFit` 一律调
  `ctx.get('viewport')`（宿主恒在注入的视口服务）去改真画布；`syncZoomDisplay()` 把
  `getViewport().zoom` 镜像到状态栏读数。放大/缩小以**真实缩放**为基准 ±10%、钳 10%–800%；
  「适合屏幕」= `viewport.fitView()`（替代原先那个只改文字的假按钮）。
- **读数同步用常驻 rAF 比对，不订阅 move 事件**：实测 `zoomTo / fitView / 小地图拖拽 / 首屏 fitView`
  **都不发** VueFlow 的 move 事件（`RenderEvents.MoveEnd` 收不到），只订阅事件会让读数停在旧值。
  逐帧比一次整数、变了才写（同值不触发响应式）；node/SSR 无 rAF 时退化为只同步一次。
  与 `App.vue` 里给小地图逐帧定位的 rAF 同款做法。`App.vue` 卸载时 `unbindZoomSync()` 停掉循环。
- `StatusArea.vue`：三个动作改调 ui 入口；「缩放至 50% / 100%」的选中态按**真实缩放**高亮（±1% 容差）；
  末项文案由「缩放至 800%」改为**「缩放到最大」**（用户要求），并改为按设置 `maxZoom`（默认 2 = 200%，
  面板可调 1–8）走 —— 原先写死 800% 在默认上限 200% 下点了也到不了。

验证：`canvasToggles.test.ts` 扩到 10 条（新增 4 条：菜单真调 viewport.zoomTo/±10% 钳位/fitView/
读数取自真实 viewport；用假后端挂到真实 viewport 服务上，兑现 ui→ctx.get('viewport') 那条真实路径）；
浏览器实测 **11/11**（读数=真实值 160%、缩放至 100%→1.0、50%→0.5、放大→0.6、适合屏幕→1.676、
滚轮后读数跟随）；官方回归：画布 e2e 51/51、多选 33/33、主题色板 19/19；ui 单测 59/59
（其余 2 条失败与本次无关：`entrypoint` 的插件数 19 与 `themeColorHygiene` 的 2 处颜色，
均由工作区里**别的并行改动**（plugin-bottom-bar / assembly 增删插件）引入，非本次触碰）。

### 最近完成（2026-09-30，抓手工具下不显示端口球）

用户要求：切到**抓手工具**后，节点两侧的端口球（`MovingHandle`）不再显示。

理由与做法：端口的本职是「拖节点用的手柄」；抓手模式下拖动是平移画布、节点根本不会被拖走，
端口留着只会误导。抓手 = 设置 `nodesDraggable=false`（首轮已接通），故端口显示门直接读它：

- `plugin-theme-default/src/components/node/BaseNode.vue`：新增 `CANVAS_NODES_DRAGGABLE`
  （初值 `nodesDraggable ?? true`，`onChange` 窄更新），纳入 `shouldShowHandles` 的压制项。
  **唯一事实来源 = 设置 `nodesDraggable`**：底栏「移动/抓手」按钮与设置面板「节点可拖拽」
  改的都是它 → 三条路永远一致，不新增第二份开关。移动工具、以及未声明该键的旧宿主照常显示。
- 同时排掉一个误判来源（本轮查出，非本改动引入）：低细节阈值 `nodeLodLowDetailZoom` 默认 0.4，
  **低于它端口本就整体压掉**；而应用首屏 `fitView` 落在 39%，正好被压住 —— 表现为「刚进来就没端口」。
  若需要低缩放也保留端口，调低该阈值（或后续把端口从低细节压制里摘出来）即可。

验证：新增 SSR 测试 `baseNode/__tests__/handToolPortVisibility.test.ts`（3 条：移动/未声明→显示，
抓手→不显示；实测把门摘掉即红，证明真在测）；theme-default 单测 **233/233**、typecheck 过；
浏览器实测 6/6（含「同一页面热切抓手→圆球消失、切回移动→恢复」与「抓手仍能平移画布」）；
官方回归：画布 e2e 51/51、多选 33/33、主题色板 19/19；ui 单测 59/59。

### 最近完成（2026-09-30，画布工具按钮接通内核）

用户要求（带截图）：左下角那一排按钮（整理画布 / 小地图 / 隐藏节点连线 / 网格吸附）与
底栏「移动 / 抓手工具」当时**点了只有图标变化、画布毫无反应** —— 它们只改了 `useUi`
里的本地状态，没有任何一处写到内核（设置面板改同一件事却真的生效）。

做法：按钮改成和设置面板**走同一条通道**，自己不再存状态。

- 写设置（`ctx.get('settings').set`）：`edgeVisible`（隐藏节点连线）、`snapToGrid`（网格吸附）、
  `miniMapVisible`（小地图）、`nodesDraggable`（抓手 = 关掉拖节点，拖哪都平移画布）。
  真正干活的是订阅这些键的消费方：`CustomEdge` 读 edgeVisible、渲染宿主 CanvasHost 把
  snapToGrid/nodesDraggable 绑给 VueFlow、mini-map 插件订阅 miniMapVisible。
- 执行命令（`ctx.get('command').execute`）：整理画布 → `auto-layout:run`（与 Ctrl/Cmd+L 同一条命令，
  结果进历史栈、一并落盘）。顺带修掉按钮上过时的提示文案（原写 Alt+Shift+F，真实键是 Ctrl/Cmd+L）。
- `bindCanvasToggles()` 订阅设置变化，把按钮图标与底栏高亮同步过来 —— 面板改了、按钮立刻跟着变，
  不会出现"面板关了按钮还亮着"的假状态；`App.vue` 卸载时 `unbindCanvasToggles()` 退订。
- 验证：新增整装测试 `packages/ui/src/__tests__/canvasToggles.test.ts`（6 条，真实内核 + 真实插件，
  锁"按钮入口写的就是设置面板那个键"）；ui 单测 **59/59**；浏览器实测脚本 17/17
  （含真拖拽：移动态拖节点节点动、抓手态拖节点不动而视图平移、光标 grab）；
  官方 e2e **51/51**、多选回归 33/33、主题色板 19/19。

### 最近完成（2026-09-30，多选框改为跟随画布缩放）

用户要求（带截图）：多选时「节点边缘 → 选框边缘」的 padding **不要反缩放**，要跟随画布一起缩放。
实测（修前，同一节点同一多选集）：屏幕间距恒 16px、flow 间距 0.5x→32 / 2x→8 —— 就是反缩放。

- 三处去掉 `1/zoom`：`multiSelectConfig.scaleFramePaddings`（间距）改为恒等、`frameStrokeCss`
  调用方不再传 `1/zoom`（线宽/圆角）、`SelectionFrame.batchStyle` 的端口定位去掉 `scale(1/zoom)`
  （端口与节点端口同款 = flow 尺寸）。
- 语义：配置项「两框间距 / 小框外扩 / 线宽 / 圆角」现在是**画布(flow)单位**，与节点卡片边框同约定。
  缩小时 spacing/线宽一起变细；不再需要「间距与线宽同空间」那套补偿（两者现在同域）。
- 验证：multi-select 单测 148 全绿、typecheck 过；浏览器 e2e 多选回归 **33/33**（新增场景 G 四条：
  flow 间距恒 16/34/16/16、屏幕间距随缩放变、线宽不反缩放、无报错）、画布总回归 **51/51**。
  实测（修后，同一条测量）：flow 间距恒 16、屏幕间距 0.5x→8 / 1x→16 / 1.5x→24 / 2x→32。

执行计划：`docs/plans/2026-09-27-canvas-plugin-context-boundaries.md`（规格 `docs/goal/canvas-plugin-context-and-boundaries-spec.md`）。
九项已落地、每项独立提交并验证，T10 待负责人拍板。

- **T01** c50b108：主题/节点区域的注册事实源与 order 只有一份。`ctx.theme.add/remove` 过去只写
  或只删 `ThemeRegistry`，与 `registryOf("theme")` 读数不一致；`nodes.contribute` 在场里自行算 order
  且忽略显式 `opts.order`。现两处同源写入、同一 id/order/回收。
  （实测修正：原审查称"卸载后注册场留幽灵条目"**未复现** —— 插件作用域视图本就随 fiber 回收。）
- **T02** e129d76：`defineNode` 不再静默丢字段。它过去手抄透传清单，类型允许的
  `icon/resizable/frameless/transparent/segments/连接声明` 运行时被丢；改为原样转发 `NodeRegisterDef`，
  并去掉包内自引用。canvas-base 首次有 test 脚本。
- **T03** 2bbe6bc：`ctx.get/tryGet` 按服务名推导类型。集中声明 doc/selection/resources/save/command/
  nodeFactory/nodeRegistry/themeRegistry/settings/settingsPersist 与渲染层 nodeLayout/viewport；
  显式泛型与扩展服务名保持可用。**顺带修一处类型/运行期漂移**：`PluginScope` 声明了 `tryGet`，
  但插件作用域视图从未实现它（插件里调用会 `not a function`）。
- **T04** b88f4ad：有就绪状态的 Flow/DOM 能力面。旧 `ViewportService` 在后端未挂载时静默降级
  （默认坐标 / 原样回传 / no-op）；新增纯逻辑状态机 `detached→flow-ready→dom-ready→disposed`，
  未就绪即抛 `CanvasFlowNotReadyError`，经 `useCanvasRender().flow` 暴露；与旧 viewport 共用同一份后端。
- **T05** d56c4de：默认主题组件改用集中类型的服务（`ctx.get` 不再手写结构断言）；`DefaultBackground`
  不再直接 import VueFlow，改从 `useCanvasRender()` 取视口。BaseNode 内 `useVueFlow` 保留（红线核心节点件）。
- **T06** 70bbb59：多选端口/拖线件改从主题可替换目录取（`useUiComponent("movingHandle"/"connectionLine")`），
  生产代码不再依赖 `plugin-theme-default`（降为 devDependency，仅测试注入真实件）。
- **T07** 5cb5310：image/text/video 三个节点插件不再把主题包当共享组件库（清 dependencies 与构建 external）。
- **T08** 28d6e1d：钉住插件依赖方向（`packages/ui/src/__tests__/pluginDependencyDirection.test.ts`，
  扫 24 包 / 201 个生产源码文件；实测运行时依赖与值导入均为 0）。
- **T09** 1a13f41：`canvas-foundation` 拆包 **no-go**（`docs/plans/2026-09-27-canvas-foundation-go-no-go.md`）——
  四条准入只满足一条：反向依赖仍在（`graphDocument.ts → canvas/connection`）、无第二个真实消费者
  （cloud-server/mcp-server 刻意不 import canvas-data）、迁移会再次移动 doc/canvasBasePlugin。
- **T10** ⏳：端口几何默认值决策材料就绪（`docs/plans/2026-09-27-port-zone-default-decision-brief.md`，
  实测成品应用走主题值 10/0.55/0.8，非宿主回落 86/0.8/1）。**待负责人选定后**再开几何实现票。

**验证基线（2026-09-27 实测）**：kernel 212 / canvas-data 328 / canvas-render 396 / canvas-base 6 /
ui 42 / 24 个插件包合计 1350；UI e2e **40/40**、多选回归 22/22、主题色板 19/19、视觉回归 6/6。
已知遗留（非本轮引入）：plugin-auto-layout / clipboard / file-drop / multi-select / node-image /
node-text / theme-default 的 `typecheck` 在改动前就有报错（多为 .vue 类型导出与测试文件），本轮未新增。

### 追加（2026-09-27 第二轮，typecheck 全仓清零）

e6a36e5：把各插件包 typecheck 从 7 个失败清到 0（上面那条"已知遗留"不再成立）：

1. 基础服务直访类型：doc/selection/resources/save/command/nodeFactory/nodeRegistry/themeRegistry
   也声明到 Context（ctx.doc 等直访），并删掉 6 个插件里逐个 declare 的重复声明。注意 settings
   不在此列：ctx.settings 是能力段糖（define/set/…），与 ctx.get('settings') 的原始 SettingsStore
   形状不同，重复声明会接口冲突。
2. css shim：canvas-render 的 index.ts 顶部 import styles/ui-theme.css，消费包的 tsconfig include
   只覆盖自身 src，tsc 跟随依赖时报 TS2882。与 .vue shim 同一处理，各插件 env.d.ts 补一条即可。
3. .vue 具名类型导出只有 vue-tsc 认：theme-default 把 DropdownTrigger/SelectOption 挪进
   components/ui/types.ts，普通 tsc（multi-select/node-image/node-text 的 typecheck 随依赖解析到它）
   不再报 no-exported-member。
4. toolParamField 测试的组件桩改 defineComponent（消除 this 隐式 any）。

**验证基线（2026-09-27 第二轮实测）**：typecheck 全部通过（kernel / canvas-data / canvas-render /
canvas-base / ui / 24 个插件）；测试 kernel 212 / canvas-data 328 / canvas-render 396 /
canvas-base 6 / ui 42 / 插件 1350；e2e 40/40、多选 22/22、色板 19/19。

### 追加（2026-09-27 第三轮，T10 端口几何双源关闭）

4a62618：执行计划 T10 完成，方案 A：宿主回落 DEFAULT_HANDLE_VISUAL 对齐主题默认
10/0.55/0.8（原 86/0.8/1），核心节点契约 §9-1 记录的双源漂移关闭。选 A 的理由：86 从未成为
任何真实用户的观感（成品一直走主题值），B 会当场改变全部用户可见体验；不从主题派生宿主回落，
避免 canvas-render 反向依赖主题包。验证：装主题宿主 10/0.55/0.8 行为不变；theme demo
（未传 handleVisual，走宿主回落）端口区同为 110px，两场景一致；e2e 40/40、多选 22/22、
色板 19/19、视觉 6/6；canvas-render 396 / theme 202 / multi-select 145 全绿。用户已保存的
具体值不受影响（settingsPersist 存具体值）。决策全文见
docs/plans/2026-09-27-port-zone-default-decision-brief.md。

至此 docs/plans/2026-09-27-canvas-plugin-context-boundaries.md 的 T01 至 T10 全部完成。

### 追加（2026-09-28，全量 API 迁移 + 作者 SDK 类型收口 + 兼容面清理）

用户要求：**所有插件改成最新 API、不要任何兼容代码**，并核对执行计划 T01–T10。逐条落地：

1. **迁移残漏修复**（f036634 / 4739928）：0786bd4 的全插件迁移留下两处回归与两处漏改：
   - `VideoTopToolbar.vue` 上传回调的多行 `ctx.get<{...}>(` 只换了首行 → 破坏 SFC 语法（video 与
     packages/ui 的装配测试同时红）；改为 `ctx.tryGet('resources')`。
   - `alignGuideConfig.test.ts` 的 ctx 桩缺 `tryGet`（生产已改 `tryGet`）。
   - `BaseNode.vue` 仍在解构已删除的 `viewport` / `updateNodeVisualSize` → 统一改走 `flow` facade；
     同步 3 个 SSR 测试桩（补 `flow` 对象与 `tryGet`）。

2. **作者 SDK 类型收口**（c4b9d0f）：这是用户"插件只需一个 canvas-base 类型入口"诉求里此前
   **没做到位**的一环。服务名 → 类型的唯一事实源过去被拆在两层：数据服务声明在 canvas-data，
   渲染服务（`nodeLayout`/`viewport`）**只在 canvas-render declare**。于是只依赖 canvas-base 的
   纯逻辑插件（canvas-export / cloud-save / align-arrange…）拿不到这两个服务类型，只能手写
   `ViewportPort` / `NodeLayoutPort` 窄端口（类型对错靠人抄），或为两个名字 import 整个渲染包。
   做法：新增 `canvas-data/src/canvas/renderServiceContracts.ts`（`NodeLayoutContract` /
   `ViewportContract` + `ViewportState`/`FlowPoint`/`LayoutRect`，零 Vue/零 VueFlow/零实现细节），
   在 `serviceTypes.ts` 登记进 `Services` 与 `Context`；canvas-render 删重复 declare、改为
   `implements` 契约；canvas-base 重导出契约。全插件清理内置服务的显式泛型残留与由此多余的窄端口。
   插件自有服务（text/panorama3d/group/mini-map/…）仍保留显式泛型——这是新 API 允许的。

3. **兼容面清理**（5f571ae）：核对全仓后删除**零生产消费方**的旧兼容面：
   六个旧渲染注入令牌（`HOST_KEY`/`NODE_REGISTRY_KEY`/`NODE_WRITE_KEY`/`CANVAS_PARAMS_KEY`/
   `EDGE_VISUAL_KEY`/`EDGE_SELECTION_KEY`/`DEBUG_KEY`）、`contentBridge.ts` 整文件、
   `geometry.ts` 的 `SnapRatios`/`DEFAULT_SNAP_RATIOS`、CanvasHost 失效的 `minZoom`/`maxZoom` props、
   以及 `CAPABILITY_BAG_KEY` 的对外导出。

**验证基线（2026-09-28 实测）**：kernel 212 / canvas-data 328 / canvas-render 396 / canvas-base 6 /
ui 42 / 24 个插件包合计 **1350**；typecheck 全包 0 错（`ui` 仅剩迁移前既有的 17 条，本次未新增）；
浏览器：UI e2e **40/40**、多选回归 **22/22**、主题色板 **19/19**、视觉回归 **6/6**。

文档同步：`docs/代码开发/canvas-render/05-渲染上下文与content组件.md`（原"六注入令牌"篇重写为
"渲染上下文"，旧令牌枚举全部移除）、`01-包定位与整体架构.md`、`03-CanvasHost与CanvasSurface.md`、
`docs/plugin-dev/07-into-canvas.md`、`packages/plugins/README.md`。

### 最近完成（2026-09-25，主题配色「两格制」+ 全仓去硬编码色）

**用户问题**："一个连接线颜色我只能设一种 —— 设成灰色，暗色主题上就没法看"。

- **核心：可配置颜色改成「亮/暗两格」**（`canvas-render/src/contracts/themePalette.ts`）。
  每个颜色两个 Config 字段、写两个**不同名字**的内联变量
  （`--uic-<key>-light` / `-dark`），由 `ui-theme.css` 的 `:root` / `html.dark` 各挑一个 →
  **切主题仍是纯 CSS、零 JS**，消费方照旧只写一次 `var(--ui-accent, 兜底)`。
  只在**用户改过**的格写内联（等于默认值不写），否则会压掉主题插件在 CSS 里给的配色。
  色板 7 项：强调/强调悬停/危险/警示/连线/流光/参考线。
- **位置归位**：原先住在 `packages/ui/src/themeColorPlugin.ts`（成品应用插件）→ 上移进
  渲染层，由宿主 `createMiniCanvasHost` 直接声明（与「常规/画布」交互配置同层），
  **任一宿主都自带**。旧文件已删。
- **连线颜色真的跟着主题走**（用户举的例子）：`CustomEdge` 经新增的 `useThemeColor()`
  读色板（SVG 表现属性不认 `var()`，必须取具体值）。顺带发现并修掉一个旧 bug ——
  theme-default 原先声明单值 `edgeColor`（默认 `#1f2937`，暗色画布上对比度约 1.3:1
  ≈ 看不见）且**永远盖住**色板 → 已删除该单值配置。
- **JS 通道**：`useThemeColor(token)` 同时跟"改设置"与"切主题"；`watchThemeMode` 全仓
  **共用一个** MutationObserver（连线组件是每边一份，几百条边不能各挂一个）。
- **全仓去硬编码色**：把插件/渲染层/应用壳里写死的颜色换成主题 token（品牌色半透明档一律
  `color-mix` 现算）。净化守卫 `packages/ui/src/__tests__/themeColorHygiene.test.ts` 把违规数
  从 **325（38 个文件）** 压到 **0**，并把这条钉成测试（不再靠人工清单）。
  同目录新增 `stylesCompile.test.ts`：全仓 `.vue` 样式段必须能被 Vue SFC 编译器解析 ——
  堵住"守卫绿但应用打不开"（踩过一次：豁免标记在 CSS 里写成 `//`，PostCSS `Missed semicolon`）。
- 规范已更新：`docs/代码开发/主题与配色.md` §七 重写为两格制、§五 token 表、§八 验收清单。
- **验证**：28 个包全绿（kernel 212 / canvas-data 321 / canvas-render 390 / ui 39 /
  theme-default 202 / 插件合计 918）；官方 e2e **40/40**；浏览器实测脚本
  `packages/ui/e2e/theme-palette-check.mjs` **19/19**（含"改亮色格不影响暗色"与
  "真实连线元素取到对应主题的色"）。

### 最近修复（2026-09-25，多选拖动中缩放的跟手性）

- **拖动中缩放后内容不再跟手**（用户报："拖拽的时候缩放你的定位就出现了问题"）。
  浏览器实测（修前）：zoom=1 拖 100px 内容走 100px；缩到 2x 后再拖 100px 内容只走 60.5px
  （脱手）；缩回 1x 再拖内容走 156.6px（过冲）。根因：整组平移的位移公式是
  "(当前client − 起手client) ÷ 当前zoom" —— 中途缩放会把**已拖过的屏幕距离**按新 zoom
  重新换算，历史段被篡改。修复：改为**逐段累加**（每段屏幕增量 ÷ 该段时的 zoom），
  与 d3-zoom 拖画布手感一致；`dragStartClient` 收拢成 `lastClient`（上帧坐标）。
  修后实测三段 ratio 恒为 1.0，终点抓取点贴合鼠标。测试：新增
  `dragZoomFollow.test.ts`（4 条纯函数模型断言，含修前/修后公式对照）+ 更新
  `selectionFrameRender.test.ts` 源码断言（锁"逐段增量"实现、禁旧公式回潮）；
  multi-select 145 / group 45 单测全绿，官方 e2e 40/40，
  `multiselect-regression.mjs` 22/22（含上轮"拖动中缩放选框贴合"场景 E 仍通过）。

- **追加（2026-09-25 第二轮）· 抓节点拖拽中缩放，选框闪回拖拽前位置一帧**（用户报：
  "缩放和拖拽同时进行时，多选框会莫名出现在拖拽之前的位置，下一帧移动才恢复"）。
  与上一条同根因的另一条路径：**抓成员卡片拖**（VueFlow 原生多选拖拽，非框内空白拖）。
  该路径的框跟随用 nodeDragFrameAnchor（起手快照 + 位移），但缩放触发 refreshFrame 时
  走了"从 store 重算"分支（store 里还是拖动前位置）→ 框闪回；节点层已被 VueFlow 拉走，
  下一帧 NodeDrag 才把框拉回来。修复三件：① refreshFrame 增加"拖拽中"分支
  （interaction.isNodeDragging || nodeDragging 时保持当前位置、只按当前缩放重算间距）；
  ② NodeDrag 逐帧**快进快照**（并集快照 += 本帧位移，anchorStart 重置为本帧），
  缩放帧到达时快照已与节点同步；③ 起手快照改用 nodeUnionSnapshot（锚点读 payload
  位置，其余读 nodeLayout）。实测异常帧 41 → **0**（偏移簇只剩基准簇 + 亚像素抖动簇）。
  探针脚本已清理；验证：multi-select 145 全绿、回归脚本 22/22、官方 e2e 40/40。

### 包结构（现行，已定型）

`packages/canvas-core-v2` **已删除**（实现与测试分别迁入 kernel 与 canvas-data）。

```
@mini-canvas/kernel         纯插件框架（装载/依赖/事件/作用域回收/注册表 + tools），零画布概念、零 Vue
@mini-canvas/canvas-data    数据层 + 画布语义（nodeStore/edgeStore/graph/save/history/selection
                            + canvas/ 下节点/主题注册表、能力段、连接校验、菜单聚合、建节点、画布 Context）
@mini-canvas/canvas-render  渲染层（CanvasHost/CanvasSurface/令牌 + nodeLayout/viewport）
@mini-canvas/canvas-base    插件作者薄入口（重导出 kernel + canvas-data 类型 + define* 助手）
@mini-canvas/ui             成品应用出口（一行 CanvasHost 出画布；App.vue 装配 21 个插件）
packages/plugins/*          插件库（**24 个**）
packages/cloud-server       自托管云端（KV + 资源 + 静态托管 + MCP 控制画布）
packages/mcp-server         AI 工具链后端（MCP/SSE + 生成任务）
```

**依赖方向（已核对单向）**：`kernel ← canvas-data ← canvas-render ← plugins`。
kernel 不依赖任何 @mini-canvas 包；canvas-data 只依赖 kernel。

### 当前主线：注册场改造（执行中）

设计文档：`docs/design/core-layers-and-registry.md`（v2，已过一轮独立审核）。

解决的问题（用户原话）："功能全是堆砌上去……很多功能都需要其他的地方支持，这就又需要我提供新的 api 功能"。
两条根因：**位置是数出来的**（给节点加东西只有 5 个写死位置，加进度条要改 `BaseNode.vue`）、
**新功能只能靠加服务**（没有通用"放东西"机制，菜单就是这么来的）。

终态：三根轴（装载 / 服务 / 注册）+ 七个原语 + 一张服务归属表 **18 → 7**。

9 条决策已批准，步骤 1–3 已落地（见下）；继续执行步骤 4–9，每步独立提交、可单独回退。

⚠️ **端口默认值双源漂移**（契约金标准 §9）：宿主回落 `portZoneWidth=86` vs 主题插件 Config `10`，
差 8.6 倍。**动端口几何前必须先对齐这两处**（属行为变更，需单独拍板；步骤 1–3 未触碰）。

### 最近一轮已完成（2026-09-17）

- 架构分层调查 → `docs/tmp/architecture-layer-audit/report.md`（只读，未改代码）。
- 设计文档 v2 成稿并过一轮独立审核（两个子代理：设计审核 + 事实核验，29 条问题已修）。
- `AGENTS.md` 按现状重写（原内容指向已删除的 `packages/canvas-core-v2` 与丢失的契约文档）。
- **注册场改造步骤 1、2 已完成**（分支 `codex/registry-refactor`）：
  - 步骤 1：kernel 新增 `Registry<T>`（`registryOf` / `state` / `isDev`），+38 测试（125 → 163）。
  - 步骤 2：五个能力段（nodes/theme/commands/slots/settings）糖底改走注册场，行为零变化，
    canvas-data +6 条落点测试（275 → 281）。
  - 契约金标准 `docs/tmp/canvas-core-v2-survey/core-node-contract.md` 已重建（593 行，
    六件 66 条不变量 / 27 条易碎点）——AGENTS.md 的「待重建」标记即指它，已可解除。
  - 实测基线：kernel **163** / canvas-data **281** / canvas-render **322** / ui **26** 全绿。
  - 勘误记录：theme「同槽重复抛错」实为「同 occupant id 重复抛错」（不同 id 走 addOccupant 叠加）。

### 下一步（未开始）

**九个步骤已全部落地 + §十 验收清单全部达成 + 两轮严格审查修正 + UI 自动化验证通过**（2026-09-19）。
分支 `codex/registry-refactor`（2026-09-19 更新；提交数见 `git rev-list --count main..HEAD`）。

已完成的三件交付（目标定义的三条）：
1. **完整功能**：设计文档 §九 九个步骤全部落地（每步独立提交、可单独回退）。
2. **严格 code review**：两个独立子代理（Standards 轴 + Spec 轴）复查；
   3 条硬违规（H1/H2/H3）逐条核实后已修，5 条坏味道 + 1 条规格缺口已申报。
3. **UI 自动化测试**：`packages/ui/e2e/canvas-e2e.mjs`（真实 Chromium 跑 :5288），
   **36/36 通过**。跑法：先 `pnpm -C packages/ui dev`，再 `pnpm -C packages/ui e2e`。

另外，设计文档 §十 验收清单最后两条（**ui 组件目录场** = 决策 4、**能力包** = 决策 9）
已于 2026-09-19 落地，见下方「两条收尾已完成」。

**新增交付（2026-09-19）：自省 API `ctx.surface()`**（用户需求：列出注册的列表 + 它们支持的参数）

```ts
const s = ctx.surface();
s.services;   // [{ name, source, methods }] —— 按名可取的服务 + 谁注入的 + 方法清单
s.registries; // [{ kind, keys: [{ key, count }] }] —— 每个场有哪些键、几条
s.commands;   // id/title/keys/areas/group/icon + origin: field|service
s.tools;      // 生成工具声明式参数（key/label/type/options/default/min/max/step…）
s.modelTools; // 模型可调用工具（description/parameters JSON Schema/outputSchema）
```

要点：只读、零副作用、created/started 皆可调。`origin:'service'` 标出「走 command 服务直注册」
的命令（建节点/删除/撤销/重做 4 条不进注册场，只读场会漏报）；`methods` 用 descriptor 反射取
方法名、**不执行 getter**，属 best-effort 诊断字段。

**两条「扩展」项收尾已完成（2026-09-19）** —— 设计文档 §十 验收清单里**属本轮范围的两条**（都在
「扩展」段）已勾上；§十 其余条目（分层/可诊断/工具等）是**整套终态的**验收项，不在本轮范围内，
仍保持未勾，别误读成"全面验收通过"：

1. **ui 组件目录场**（决策 4，commit efa6e5c）：`canvas-render/src/contracts/uiCatalog.ts`
   （`uiComponent` / `useUiComponent` / `uiNames` / `UI_NAMES`）；theme-default 把
   button/dropdown/select/slider/toolParamField 登记进 `registryOf('ui')`（id='default'）。
  边界照决策 4：只收"希望被主题整体换掉"的设计系统件，插件内部小组件照旧 import。
   **并已接上真实消费者**（8eea382）：node-image / node-text / node-video 的按钮·下拉·参数控件
   全改走 `useUiComponent` 按名取，这些文件对 theme-default 的 import 清零；
   `useUiComponent` 由快照改成**响应式 Ref**（订阅 ui 场）—— 换主题当场生效，消费组件不必重挂。
   测试：uiCatalog 6 条（含"目录换成新组件后同一消费组件渲染出新组件"）+ node-image 136 /
   node-text 65 条改为**经目录取真件**渲染（而非 import）+ e2e 3 条（按键可枚举 / 叠层换主题 /
   换目录后节点控制栏按钮真的跟着换）。

2. **能力包**（决策 9，commit d6dffae）：`canvas-render/src/contracts/capabilities.ts`
   + `components/RegionEntryHost.vue` + `contracts/standardCapabilities.ts`（宿主标准四件
   node/zoom/selected/tools，id='host:standard'、order=100）。组件在 `ctx.nodes.attach` 里写
   `needs`；BaseNode 持有**每节点一份**的实例缓存（`createCapabilityCache`），
   十个区域渲染位经 `RegionEntryHost` 按各自 needs 取袋并 provide（`useCapabilities()` 取）——
   于是同一节点上的"按钮"与"它打开的面板"拿到的是**同一个**实例。
   决策 9 三件事全落地：① 任何插件可注册（叠层 order 小者赢，主题可整套换掉）；
   ② **每节点一份实例**、由消费它的组件回收（BaseNode 卸载时统一 dispose）；③ `needs` 缺项 dev 抛错（写明缺哪个、谁声明的）
   / prod undefined + warn。
   测试：capabilities 13 条（含"**每节点一份实例**：两条条目同 needs → 工厂只调 1 次且同对象"、
   热换重造、dispose 回收）+ SSR 端到端 6 条（attach→BaseNode→provide→组件 inject 整条链，
   含 dev 抛错、"两条目各带自己 needs 互不串"、"同 needs 两条目共享实例"）+ e2e 2 条。

   另有 61f3180 修掉两个"配了却没生效"的缺陷：**ctx.isDev 在真实宿主里恒为 false**
   （决策 9 的 dev 抛错分支因此是死代码）。原因是 vite 的 import.meta.env 替换只作用于应用包自身源码，
   canvas-render 作为 workspace 包读不到替换；改为由 packages/ui 的 App.vue 显式传 :dev。
  接通后暴露第二处：**RenderEvents 等事件名从未 registerEventName**（§7.4 要求），已全部补齐
  （canvas-render 的 RenderEvents 全量 + clipboard/edge-cutting/canvas-export/context-menu/theme-default）。
  e2e 新增 2 条锁死：**零条 "[EventBus:dev] 未声明的事件名" warn** + **dev 开关接通（isDev === true）**。

3. **自省 API 补两条轴**（2e3f199，回应用户"列出注册的列表 + 它们支持的参数"）：
   - `surface().registryEntries[].fields`：条目值的**顶层字段名**（如 node/type 的 `{type,label}`、
     区域条目的 `{component,needs,props}`）。两处收窄（只认朴素对象、识别组件形状即跳过、下划线键不算），
     否则这条轴只会输出 `__name`/`setup`/`render` 这类编译内部物。
   - `surface().events`：`registerEventName` 的登记表此前只进不出，现在可直接列出"有哪些事件可监听"。
   仍未闭合（如实申报）：capability 工厂签名/实例形状、ui 每个组件的 props、theme 槽当前赢家
   （可经 `ctx.get('themeRegistry').winner(...)` 取）、某 type 用了哪些区域词。

**遗留（已申报，非阻塞）**：
- `settingsPersist` 收回 save 内部、四个插件服务收回内部（都有既有测试直接断言，风险/收益不划算）；
- 剩余几个 kind 的场仍无生产读取端（5c 前过渡态；`ui` 与 `node/shell` 两条已补上读取端与订阅，见上）、
  §2.2 通配查找未实现；
- **端口默认值双源漂移**（契约金标准 §9，86 vs 10）—— 动端口几何前必须先对齐。

### 步骤 8 / 9 已完成（2026-09-18）

**步骤 8 · 收口 ui 出口**（8414b6a）
- 新增 `packages/ui/src/index.ts` —— package.json 的 main/types/exports 此前指向**不存在的文件**，
  现在真实存在。导出应用本体（`CanvasApp` / `mountCanvasApp`）与装配决定
  （`APP_PLUGINS` / 存储工厂 / 首屏种子）；有意不导出 `CanvasHost` / `SettingsHost`
  （想自己组装的人应直接依赖 canvas-render）。
- 新增 `packages/ui/src/assembly.ts` —— 21 项插件清单从 `App.vue` 抽离，换一套组合不用改 UI 组件。
- 新增 4 条入口链测试（`entrypoint.test.ts`）。ui 27 → 31。
- **块二（两个后端复用画布模型）经评估明确不做**，依据可复现（已落代码注释 + 本文件）：
  ① `npm pack` 实测 canvas-data 的 tarball 只有 src/*.ts 无 .d.ts，且 39 处 import kernel
  （kernel 同样 private），所以「发布 canvas-data」实为「先发布 kernel」，卡在范围外；
  ② 两边的画布不是同一种东西（canvasDoc 存语义类型 vs GraphModel 存渲染类型
  `type: custom` + `data.nodeType`；边 id 也不同源 `e-{s}-{t}` vs randomUUID）；
  ③ 存储形态本就不同（KV vs workspace/project-{id}/canvas.json）。
  将来真合并的顺序：先发布 kernel → 再发布 canvas-data → 然后抽共享内核。

**步骤 9 · 删区域词垫片**（f5433af）
- `NodeSegment` 收窄成 `NodeRegion`（十个区域词，单一来源 region.ts）—— 老词写进去
  就是 TS 报错。删掉 `SEGMENT_TO_REGION` 与四个垫片函数。
- 作者侧字段 `content` 一并改名 `in`（留着就是把垫片换个位置留下）。
- 运行时兜底：`assertRegion(value)` 挂在所有入口，非区域词当场抛错并列出合法词。
- 迁移：生产代码 14 处 → 3 处（仅 `RETIRED_SEGMENT_NAMES` 单一来源，只用于报错文案）。
- **`BaseNode.vue` 未动**（步骤 3 已是按区域词遍历，从不读老段名）；六个核心节点件 diff 全空。
- 新增 `nodeRegionTypeLock.test.ts` 用 `@ts-expect-error` 锁编译期（老词又变合法则指令报 unused）。
- canvas-data 306 → 312。

**全量实测基线（2026-09-19，第四轮审查后）**：kernel 212 / canvas-data 314 / canvas-render 359 / ui 31 /
24 个插件包全绿（合计 1303，theme-default 177）/ mcp-server 47 / cloud-server 109；
kernel、canvas-data、canvas-render、canvas-base 四个 typecheck 0 错；
`pnpm -C packages/ui build` 通过；UI e2e **36/36**。

### 步骤 5 / 6 / 7 已完成（2026-09-18）

**步骤 5 · 服务合并（5a/5b）+ menu 删除**（5 个提交 483e3fd…465d3e7）
- **5a**：新增 `canvas-data/src/docService.ts` —— `doc` 门面（门面 + 按名惰性解析，
  与 cordis 规范一致，服务热换后不会用到旧实例）。进 `doc` 的：读（getNodes/getNode/
  childNodesOf/types 只读投影/getEdges/getEdge）、写（createNode/addNodes/updateNode/
  updateNodes/updateNodeData/removeNodes/addEdge/connectEdge/removeEdges）、事务与撤销
  （transaction/undo/redo/canUndo/canRedo/undoDepth）、快照落盘（snapshot/replaceAll/
  onCommit/hasPendingCommit）、subscribe。**留内部**：registerType/orphanTypes 等（类型注册
  正式入口是 `ctx.nodes.register`，避免第二条注册路径）、prune/orphan 内部维护动作。
- **5b**：21 个插件包的 `inject` 改到 `doc`（老名保留）。剩下用老名的都是有意保留：
  `canvasBasePlugin`（门面数据来源，5c 才下线）、`docService`/`capabilityLayer` 内部解析、
  `CustomEdge.vue`（核心节点件红线禁改，其 edgeStore 写路径是契约 §4.3-15 记录的回退路径）、
  `plugin-history`（职责就是薄适配老名）、3 处迁移期兜底。
- **menu 删除**：删 `menuService.ts` + 导出 + `ctx.inject('menu')` + `CanvasHostHandle.menu`；
  `buildMenuItems` **复活为生产代码**；类型保留（5 个文件在用）。改的测试严格限决策 8
  例外清单（另加删 `menuService.test.ts`，6/8 条在 plugin-context-menu 有等价覆盖）。
- `image-meta` 探针已删（决策 4.3）。

**步骤 6 · 工具四缺口**（fe3f7bd）
- 新增 `kernel/modelTool.ts`：事件（`tools/registered|unregistered|result`，
  **同时 registerEventName** 解决 dev warn；挂点在场本身，因为同 id 顶替只有表知道）、
  `defineTool`（parameters→JSON Schema，复用 ToolParamDef、零依赖）、
  `callId`/`signal`（可关联可取消）、`output.schema`+`render`（产物规范化 + text/json 可持久化块）。
- 验收硬指标跑通：教程第 7 章的 tool-logger 观察者插件输出与教程逐字一致，已固化成测试。
- `ctx.tools`（画布生成工具目录）**原样未动**，两套工具不混。

**步骤 7 · 拆插件循环依赖**（d7a90b6）
- 路线乙：只断 theme-default → 节点插件（那条腿是纯死声明：全仓零 `ctx.text` 消费点）。
- 红绿双验证"只断一头足够"（环是闭合路径，零出边即不可穿越）。
- 复用件导出形态未变（契约 §10 约束）；新增 3 条断环守卫测试（做了红测）。

**实测基线（2026-09-18）**：kernel **196** / canvas-data **306** / canvas-render **333** /
ui **27** / 24 个插件包全绿 / mcp-server 47 / cloud-server 109。
既有测试除决策 8 例外清单外一条未删未改。

### 步骤 8 已完成（2026-09-18）

**块一 · 收口 packages/ui（必做，已完成）**

此前 packages/ui/package.json 的 main/types/exports 都指向 ./src/index.ts，而**该文件不存在**
（安装方 import 本包会直接模块找不到，仓库内却没有任何测试会红）。

1. 新增 packages/ui/src/index.ts（真入口）：导出 CanvasApp（= App.vue）、mountCanvasApp(root)
   （一行挂载），以及装配决定 APP_PLUGINS / createDefaultStorageAdapter / seedDefaultCanvas /
   SAMPLE_TEXT / SAMPLE_IMAGE_URL。有意**不**导出 CanvasHost / SettingsHost：想自己组装一套的人
   应当直接依赖 canvas-render，那是另一条路，不是本包的成品出口（见文件头注释）。
2. 21 个插件的装配清单移出 App.vue，落到 **packages/ui/src/assembly.ts**（APP_PLUGINS 数组 +
   存储工厂 + 首屏种子）。换一套插件组合只改这个文件，App.vue 一行不动。
3. App.vue 对外行为与外观**零变化**：两个示例字面量（SAMPLE_IMAGE_URL / SAMPLE_TEXT）逐字符
   核对与原文件一致（曾一度把换行转义误写成字面反斜杠，已用字符码核对修正）。
4. 新增 packages/ui/src/__tests__/entrypoint.test.ts（**新增，未改动任何既有测试**）钉住这条链：
   package.json 声明的路径真实存在、入口导出面稳定、清单自洽（21 项 / 无重名 / 形态可装载）、
   首屏种子未变。既有 27 条 ui 测试一条未删未改。

**块二 · 两个后端的画布模型复用（评估结论：本步不做，走路线乙）**

cloud-server/src/mcp/canvasDoc.ts 与 mcp-server/src/graph/GraphModel.ts 维持各一份，不合并。
结论与可复现依据写在两个文件头部注释里，摘录三条：

 1. **前提没满足，且卡在范围外**：canvas-data 要可发布先得能编译 .d.ts，而它有 39 处
    import/export 直接依赖 @mini-canvas/kernel，kernel 也是 private 且同样只发 src/ —— 发布等于先发布
    kernel，而 kernel 在本步禁止改动。探针（tsc 以 rootDir=./src + declaration 消费一个 src-only
    的包）实测报 error TS6059: File ... is not under rootDir。
2. **两边的「同一份画布」不是同一种东西**：canvasDoc 存语义类型（text/image…）；GraphModel 存
   渲染类型（语义类型被改写成 type=custom + data.nodeType，有测试钉死）。边 id 也不同源：
   edgeIdOf 生成 e-{source}-{target}（与数据层 edgeStoreId 逐字一致），GraphModel.createEdge 用
   randomUUID()。合并就得在数据层里加一个「用哪种形态」的开关。
3. **存储形态本就不同**：本包 KV（.mini-canvas/kv/*.json）vs mcp-server 的
   workspace/project-{id}/canvas.json。真正共用的只有 JSON 字段形状，已由 canvasDoc.test.ts
   逐字比对守住。

将来若要合并，正确顺序：先发布 kernel → 再发布 canvas-data → 然后才在两个后端间抽共享内核。

  的 `dragStartPositions` 类型与用法不一致（他人进行中的改动），与注册场改造无关。
  （步骤 8 复核：该红与本步无关 —— 改动前后错误清单逐条相同；另有
  `canvas-render/src/host/CanvasHost.vue:721` 一条同属 HEAD 既有红。
  ⚠️ **另有 1 条是本分支引入的**（步骤 5b，提交 5b07677）：`SelectionFrame.vue:122` 的
  `DocService as NodeStoreService` 类型断言 —— 见「严格审查修正」一节的 H1，本轮已修。）
- 未做：5c（删 four 老名，风险最高）、`settingsPersist` 收回 save 内部、
  `shortcut-remap`/`history-facade`/`mini-map`/`auto-save` 收回插件内部
  （这四个服务名都有既有测试直接断言，改动必然牵连例外清单之外的测试，风险/收益不划算）。

## 严格审查修正（2026-09-18）

九个步骤全部落地后，做了一轮严格 code review（两个独立子代理：Standards 轴 + Spec 轴）。
共提出 3 条硬违规 + 5 条坏味道 + 1 条规格缺口。**全部先经主 agent 亲自核实真代码**，处置如下。

### H1 · ui typecheck 红 + STATUS 失真 —— 已修

审查发现：`packages/ui typecheck` 报 12 条错误，其中 `SelectionFrame.vue:122` 的
`DocService as NodeStoreService` 类型断言**是步骤 5b（提交 5b07677）引入的** ——
doc 门面返回 DocService，插件里直接 as 成 NodeStoreService，类型上不重叠（TS2352）。
而本文档宣称"全绿才前进"却没有承认它。

**修正**：该行改为兼容两种装配路径的防御式取值（doc 门面缺省回退老名），消除非法断言；
本节如实记录。剩余 11 条为 HEAD 既有红（`dragStartClient` 等，他人进行中）+
`CanvasHost.vue:721` 一条，与前几轮记录一致。

### H2 · pluginManager 把 canUninstall 三态压扁成二值静默 —— 已修

审查发现：`assertUninstallable` 只对 `reason === "core"` 抛错，`not-found` / `not-started`
被静默吞掉 —— 调用方拿 false 分不清"没有"还是"没启动"，`canUninstall` 三态可诊断的意义
被 manager 层丢弃，且 not-started 时"先删 config 再发现卸不动"的副作用仍在。

**修正**：`assertUninstallable` 对一切 `!ok` 都抛带 reason 的错误；corePluginGuard 测试补断言。

### H3 · theme.register 防覆盖行为 —— 核实后部分推翻，行为保留并申报

审查指控：糖加了"同 occupant id 重复 register 抛错"，与 main 的"顶替"语义不同，
且 capabilities.test.ts 被改写以匹配新行为 —— 违反决策 8。

**主 agent 核实（逐行 diff）**：
1. main 上 `ctx.theme.register` 走 `placeTheme` → `addOccupant`（同 id 替换不抛错）——
   行为变化确实存在（同 id 重复 register 从顶替变抛错）。
2. **但** main 的 capabilities.test.ts 里**没有任何一条**测试覆盖"同 id 重复 register"
   （8 条 theme 断言全是不同 id 或单插件场景；本分支对该文件的 16 行改动全是步骤 9 的
   content→in 机械改名，0 条涉及 theme）—— 实现新行为不需要改任何既有测试，
   测试是"自然通过"，"改测试消解门槛"的指控不成立。
3. 该行为有产品语义依据：静默顶替让"两插件抢同一 slot 同一 id"变成后装者静默胜出，
   与决策 1"core 不可被同名覆盖"的防覆盖精神一致；与 §8.2 原文的差异只是抛错范围
   （原语义只拦 default id），step2 回报已勘误。

**处置**：行为保留（更防错），本节即显式申报。同时修掉审查发现的同源 bug：
原抛错条件 `reg && themeField && …` 在"场存在而 ThemeRegistry 缺席"时漏抛，已改为
两者任一存在即校验；并核实 `placeTheme` 与场条目 id 同源（`opts.id ?? pluginName`），
热卸回收路径一致。

### 规格缺口 P1 · 决策 9 能力包未实现 —— 挂账 + 申报

`registryOf("capability")` 无实现；`ctx.nodes.attach` 的 `needs`/`props` 收进条目但无
消费方（props 不透传给组件，needs 无解析机制）—— 案例 1"两组件共享同一 state 联动"
今天不可用，此前本文件只字未提。

**处置**：本轮补最小可用版本（props 透传给区域组件）；完整能力包（capability 场 +
useCapabilities + needs 缺项 dev 抛错）单独立项，本节即申报。

### 其余审查发现（判断题，挂账不改）

- **双写漂移**：五个糖"容器 + 场"双写，id/order 各算一份（slots.register 最复杂）。
  兼容场目前无生产读者，属 5c 前过渡态；5c 落地时删容器、消费方读场，双写自然消亡。
- **死表群**：node/type、node/shell、node/creator、theme、setting、command、slot 七个 kind
  只有写入端无生产读取端（除 node/region 与 tool）。同为 5c 前过渡态。
- **通配查找未实现**：§2.2 的"精确→通配→默认"三段查找未做（现只有精确键 +
  node/region 消费方手动双查）。现用法无损失；region.ts 已注释标注。
- **"ui" 目录场未建**：案例 4 是提案（设计文档自述），非九步骤之一；决策 4 悬空但无违反。
- **BaseNode 区域条目热装响应性**：已渲染节点上运行期 attach 不触发重渲染（无订阅链），
  无测试覆盖，挂账后续任务。
- **5c 未做**：四个老名下线被 CustomEdge 红线卡住（需先解禁或迁移其写路径），
  属设计文档自己的分段安排。

### 步骤 4 已完成（2026-09-18）

**A. 决策 1 的 `core: true` 标识（三处改动 + 两个新面）**

- `kernel/types.ts`：`PluginModule.core?: boolean` + `CanUninstallResult` 类型。
- `kernel/pluginClass.ts`：类形态分支透传 `static core`（原只拷 name/inject/Config/apply，会被丢掉）；
  对象形态原样返回（字段本就在）。
- `kernel/Context.ts`：`uninstallPlugin` 唯一权威守卫（core → 返回 `false`，**不 dispose fiber、
  不发 `ctx:plugin-uninstalled`、不触发 `retractUnsatisfiedActives`**）；`corePlugins` 表在
  plugin/installPlugin 归一时刻登记、装载失败与 stop 时清除；`inspectPlugins()` 每项带 `core?: boolean`；
  新增 `canUninstall(name)`（`ok:true` / `not-started` / `not-found` / `core` 四态，含插件作用域）。
  `stop()` / `stopAsync()` **不拦**（整体生命周期终结，不是动态卸载）。
- `canvas-render/pluginManager.ts` 四条路径各自处理被拦：`uninstall`（**先问再动**，不再先删 config；
  core 抛 `core plugin cannot be uninstalled`）、`reload(name)`、`reload(name,next)`（修掉"卸失败仍继续装
  → 重名抛错"的硬 bug）、`installOne` 同名覆盖。
- `createMiniCanvasHost` 的 `api.reloadPlugin` 同一条虫也一并修（HMR 走的就是它）。

**B. 步骤 4：`canvasBasePlugin` 收编 15 行装配**

- 新增 `canvas-data/src/canvas/canvasBasePlugin.ts`：`createCanvasBasePlugin(opts)` 返回
  `{ name, plugin, services }`；`apply(ctx)` 注入 12 件基础服务（save/nodeStore/edgeStore/resources/
  nodeRegistry/themeRegistry/selection/history/graph/command/menu/nodeFactory）+ 注册画布通用命令 +
  建配置持久化桥；`plugin.core = true`。
- `createMiniCanvasHost` 缩成"建 ctx → 装基础插件 → 装业务插件 → start"；`ctx.inject` 15 → **2**
  （只留 `nodeLayout`/`viewport`：真属渲染层、必须挂载时注入）。对外契约零变化，
  `canvas-base` 从 `api.listPlugins()` / `manager.list()` 隐去（对应用层是"环境"不是"清单项"）。

**测试**：kernel 163 → **177**（corePluginGuard 14）、canvas-data 295 → **303**（canvasBasePlugin 8）、
canvas-render 322 → **333**（canvasBaseHost 11，含"ctx.inject ≤ 2"源码断言与 manager 四路径）；
ui 26 / theme-default 170 全绿（既有测试一条未删未改）。

> 与文档不符处：设计文档说 `uninstallPlugin` 返回 `false` 与"插件不存在"同值，歧义"由下一步解决"——
> 本步按 §决策 1「返回值定案」实现为新增 `ctx.canUninstall(name)`，与原契约并存。

### 步骤 3 已完成（2026-09-17）

- `ctx.nodes.attach(type, req)` 一等 API（区域进键，落 `node/region` 场）。
- 老五段映射层（content→in / title→title / top-toolbar→out:top / bottom-toolbar→out:bottom /
  overlay→over:inset），读写两条路径同场、同 id 去重、基座优先。
- `BaseNode.vue` 改按区域遍历渲染，新增 out:left / out:right / on:top / on:bottom / over:outset
  五个渲染位（挂 LOD 门）；金标准 §1.4 的 22 条不变量逐条自查未破坏。
- 测试：canvas-data 281 → **295**（region 7 + attach 7）、theme-default 158 → **167**（十区域 SSR + LOD 9）；
  kernel 163 / canvas-render 322 / ui 26 全绿，既有测试一条未删未改。

## 二、验证命令（每次改完跑，测试是唯一裁判）

根目录**没有**统一 test 脚本，各包各自跑：

```bash
pnpm -C packages/kernel test           # 202（surface 自省后）
pnpm -C packages/canvas-data test      # 314（步骤 5c 后）
pnpm -C packages/canvas-render test    # 333（步骤 4 后）
pnpm -C packages/ui test               # 26（整装 / 设置覆盖 / 插件装配）
pnpm -C packages/plugins/<插件名> test   # 单个插件，如 plugin-theme-default（170）

pnpm -C packages/kernel typecheck           # tsc --noEmit
pnpm -C packages/canvas-data typecheck      # tsc --noEmit
pnpm -C packages/canvas-render typecheck    # tsc --noEmit
pnpm -C packages/ui typecheck               # vue-tsc

pnpm -C packages/ui dev                     # 起画布应用看画面（:5288）
```

UI 端到端自动化（需 dev server 在跑）：`node packages/ui/e2e/canvas-e2e.mjs` —— **36/36**（或 `pnpm -C packages/ui e2e`）。
控制台 warn 明细：`E2E_SHOW_WARNS=1 node packages/ui/e2e/canvas-e2e.mjs`（按去重分组打印）。
自省：`ctx.surface()` 一次列出服务 / 注册场 / 命令 / 工具及其参数（见设计文档「十一·补」）。

> 数字为 **2026-09-18 实测**；会随开发变动，以本文件"最近一轮"记录为准。
>
> ⚠️ `packages/ui typecheck` **在 main 与 HEAD 上都是红的**（2026-09-19 实测：main 12 条 / 分支 11 条；
> 全部落在 `plugin-multi-select/src/SelectionFrame.vue`（`dragStartPositions`/整组平移那批未完成的改动）
> 与 `canvas-render/src/host/CanvasHost.vue:721`），**与本轮改造无关**（把本轮改动 stash 掉同样红）。
> kernel / canvas-data / canvas-render / canvas-base 四个 typecheck 均 0 错。

## 三、关键契约锚点（动手前读对应文档，不许自己发明接口）

- 架构与分层设计（终态 + 迁移步骤 + 决策记录）：`docs/design/core-layers-and-registry.md`
- 插件作者教程（7 篇，照抄能跑）：`docs/plugin-dev/`
- 各包 API 手册（按现行三层包结构分层）：`docs/代码开发/00-总览与架构.md`（子目录 `kernel/`、`canvas-data/`、`canvas-render/`、`plugins/`）
- 节点交互区域与拖线规范：`docs/规则/节点区域与连接线拖拽规范.md`
- 插件系统目标与验收：`docs/goal/plugin-system-goal.md`
- 架构决策记录：`docs/adr/0001-canvas-core-v2-plugin-kernel.md`
- 核心节点件行为契约金标准（2026-09-17 重建）：`docs/tmp/canvas-core-v2-survey/core-node-contract.md`

**v1 老版（只读参考，不碰）**：`packages/canvas-core/`、根 `src/`。

## 四、铁律（每条都要守）

1. **测试是唯一裁判**（亲眼见 runner 全绿）；浏览器画面只是演示，能跑/能恢复必须有无头测试兜底。
2. **契约不自己发明**（只按上面锚点实现/消费；要改契约先改文档）。
3. **不碰 v1**：根 `src/` 与 `packages/canvas-core`。
4. **核心节点件禁止改坏**（`plugin-theme-default/src/components/` 下的 node/edge/background 组件）。
5. **不改测试**（除非本任务明确要求先改测试）。
6. 卡住就停下（同一改法失败 >2 次 → 用新信息重写该步 spec 或上报），不脑补不无限重试。
7. 每步绿了就原子 commit，suite 全绿才进下一步。
8. 高危模块（内核 / save / 连接 / 核心节点件）动前先确认测试网在且绿。
9. 架构决策 / 接口契约 / 依赖排序 / 集成验证 / 评审关卡留在主 agent，不下发给并行子代理。

---

# 五、历史记录（按时间倒序，只供追溯）

> 以下是逐轮开发记录，保留原貌便于追溯"当时为什么这么改"。**不代表当前状态**，
> 其中的路径（`packages/canvas-core-v2` 等）与测试数字都是当时的快照。

## 变更记录（2026-09-14 ~ 09-17）

**本轮变更（2026-09-14）：三层包结构定型 —— kernel / canvas-data / canvas-render**。
`packages/canvas-core-v2` 删除（实现与测试分别迁入 kernel 与 canvas-data）；
画布通用命令（建节点/删选中/撤销/重做）从独立插件包 `plugin-canvas-commands` **收进 `canvas-data`**
（`src/canvas/canvasCommands.ts` 的 `registerCanvasCommands`，宿主 boot 时默认注册，命令 id/keys 逐字不变）；
同时删除死代码包 `plugin-custom-handle`（全仓无人 import）。插件库 24 → 22 个。
当时验证基线：kernel 125 / canvas-data 257 / canvas-render 215 / ui 23，22 个插件包共 872 条。

**已知遗留（与本次无关）**：`plugin-theme-default` 的 `typecheck` 脚本用 raw `tsc` 处理 `.vue`，
报 `export type { X } from './X.vue'` 找不到导出（HEAD 里就存在）；其余 29 个包 typecheck 通过。

**本轮变更（2026-09-16）：画布交互配置收进「常规/画布」（对齐 v1 VueFlow 交互开关）**。
v2 渲染宿主此前只绑 minZoom/maxZoom（组件写死 0.2/2），其余 VueFlow 交互一律吃库默认值 ——
既不能配，且 5 处与 v1 行为不一致（edgesUpdatable/selectNodesOnDrag/zoomOnDoubleClick/
connectOnClick/onlyRenderVisibleElements）。本轮：
1. 新增 `canvas-render/src/contracts/canvasInteractionSettings.ts`（纯逻辑可单测）：18 项 schema
   （17 个开关 + 网格间距 X/Y）、默认值逐项对齐 v1 core、resolve/apply 纯函数（缺项/非法逐项回落默认）。
2. `createMiniCanvasHost` 在插件装载后、持久化桥 restore 前 `settings.define(常规/画布, …, 'canvas-render')`
   —— 宿主级声明不随插件热卸回收；用户已保存值命中快照作初值；设置面板自动长出这组配置，
   改动经 settingsPersist 跨刷新恢复。
3. `CanvasHost` boot 后把 settings 读成响应式 interactionSettings 并订阅 onChange 实时更新；
   `CanvasSurface` 全部绑到 `<VueFlow>`（nodesDraggable/nodesConnectable/elementsSelectable/edgesUpdatable/
   selectNodesOnDrag/snapToGrid/snapGrid/zoomOnScroll/zoomOnPinch/panOnScroll/panOnDrag/zoomOnDoubleClick/
   connectOnClick/onlyRenderVisibleElements/preventScrolling/minZoom/maxZoom）。行为对齐 v1：
   边可重连、拖节点不再顺手选中、双击不再缩放、点击不再连线、只渲染可见元素默认开。
   `CanvasHost` 的 minZoom/maxZoom props 兼容保留但不再生效（settings 单源）；ui demo 删除写死的传参。
4. 测试：canvas-render **241**（+16：schema/resolve/apply 12 条 + 宿主声明/持久化 2 条 + 原有全绿）、
   ui **23** 全绿、theme-default 118 / canvas-data 274 抽查全绿；canvas-render `tsc` 0 错、ui `vue-tsc` 0 错。

**修复（2026-09-16 同日）：auto-layout 的 minZoom/maxZoom 与宿主「常规/画布」撞 key 导致 boot 失败**。
settings 的 key 全局平面命名、define 重复 key 会抛错 —— auto-layout 的「聚焦最小/最大缩放」用了裸
minZoom/maxZoom，与宿主声明的画布缩放范围冲突（宿主先声明，插件装配即炸）。按本仓约定
（multi-select 的 multiSelectFrame*、align-arrange 的 alignArrange* 同例）改成 autoLayoutMinZoom /
autoLayoutMaxZoom，引擎内部字段名（AutoLayoutConfig.minZoom/maxZoom）不变。教训：新增设置 key
必须带语义前缀；裸通用词属于全局公共命名空间。

**修复（2026-09-16 同日二）：「常规/画布」改动不实时生效（用户实测反馈）**。
根因：CanvasHost 订阅回调里调用的 `applyCanvasInteractionChange` 是纯函数（返回新对象），
回调**丢弃了返回值**、没写回响应式 interactionSettings —— 链路断在最后一步，VueFlow 绑定永远拿旧值。
此前 12 条单测全测纯函数本身，恰好没盖住"回调把结果写回响应式对象"这一步（教训：接线层的
in-place 语义必须有测试锁，纯函数绿 ≠ 链路通）。修复：新增 `applyCanvasInteractionChangeInto`
（原地 Object.assign 写回、引用不变、无变化不触发、返回是否真改），回调改用它；+5 条测试
锁原地写回/无变化短路/不认识键短路/非法回落/snapGrid 元组联动。canvas-render **246** 全绿。

**调整（2026-09-16 同日三，用户指定）：「常规/画布」删除 2 项 + 描述去 v1 字样 + selectNodesOnDrag 说明修正**。
- 删除「点击连线」(connectOnClick)与「边可重连」(edgesUpdatable)：宿主没有重连落边链路、点击连线在
  v2 的连线校验语义下易误触，均不该作为可配项暴露（VueFlow 端回落库默认，行为与 v2 现状一致）。
  「常规/画布」18 → 16 项。
- 全部 description 改为直接介绍功能，不再出现"v1 默认关/开"字样。
- 「拖拽选中」(selectNodesOnDrag) 用户反馈开了没效果：VueFlow 1.48 该开关在节点按下时才生效
  （useDrag.startDrag 里 handleNodeClick），宿主渲染态节点每次 syncFromStore 都带 selected 投影 +
  内核 selection 单源（onNodeClick 走内核 clickNode），按下即拖的场景下两边时序使"顺手选中"被
  随后的投影覆盖/无从体现 —— 该项在 v2 架构下无实际效果，先保留声明（不删 key 防旧配置残留报错），
  后续如确认无用再随设置清理任务移除。
- **「拖拽选中」真修复（同日四）**：根因 = v2 选中单源在内核 Selection，VueFlow 内部
  select-on-drag 不回写内核 → 内部选中瞬间被渲染投影覆盖。修复：宿主 onNodeDragStart 显式调
新纯函数 `dragSelectNode(selection, id, {enabled, selectable})`（开关关/不可选中不动、
已在选中集保持整组、否则单选替换）把"顺手选中"写进内核。+4 条测试；canvas-render **250** 全绿。

**新增（2026-09-17，用户指定）：多选标记可配（大小 / 颜色 / 低缩放显示开关）**。
用户原话：「这个多选标识变小一些，并且支持改变颜色，在这个插件的 Config 中提供对应配置，
同时支持大小 size；并且支持一个开关 —— 当前在低缩放下不显示，我希望你支持一个开关支持显示」。
1. 新增纯逻辑模块 `plugin-theme-default/src/components/node/multiRadio.ts`：默认值（18px / #111827 /
   低缩放不显示）+ 三个配置键（`nodeMultiRadioSize` / `nodeMultiRadioColor` /
   `nodeMultiRadioShowInLowDetail`，带语义前缀防撞别的插件）+ `resolveMultiRadio`（逐项非法回落）+
   `applyMultiRadioChange`（不认识的键**原样返回同一引用**，不触发无谓重渲染）+
   `multiRadioStyle`（大小写在元素上、再乘 `1/max(zoom, titleScaleMinZoom)` 反缩放）。
2. `Config` 新增「节点/多选标记」一组三项（number 滑块 12–48 / color / boolean），设置面板自动长出，
   改动经 settings.onChange 窄更新到 `BaseNode` 的 `MULTI_RADIO` ref → 实时生效、不整图重建。
3. `BaseNode.vue`：标记的显隐改为 `showMultiRadio`（多选 && （非低细节 || 开了开关）），
   内联样式改走 `multiRadioStyle()`；CSS 里写死的 `width/height: 26px` 与 `transform-origin` 删除、
   颜色由 `currentColor` 承接（`.v2-multi-radio-icon` 改 `color: inherit`）→ 原来"变小一些"的诉求
   默认即生效（26 → 18px），颜色/大小/开关三项都在设置里可调。
4. 测试：multiRadio 纯函数 **15** 条 + Config 声明 **6** 条（对齐 multi-select 的 config 测法）+
   BaseNode 渲染 **7** 条（默认更小 / 配置驱动大小 / 配置驱动颜色 / 低缩放默认不显示 / 开开关后显示 /
   开关不改变"只在多选时出现" / 阈值同源），ui 设置覆盖度 +**1** 条（"节点/多选标记"出现在真实
   设置页面且可改可读）。theme-default **153** 全绿、ui **26** 全绿，canvas-render 251 /
   canvas-data 275 / multi-select 127 / node-text 65 / node-image 148 回归全通过；theme-default
   仅剩**既有**的 raw tsc 对 `.vue` 再导出报错（STATUS 早先已记录），本次新增文件无报错。
   说明：本次改动全部落在 `plugin-theme-default`（不改内核/渲染层），多选框几何与 multi-select 插件不受影响。

## 当前主线（2026-09-04，历史）：canvas-core-v2 重构 · 开发测试期最小闭环
目标：把旧画布(180 文件, `packages/canvas-core/src`)收敛成自研 Cordis 内核(`packages/canvas-core-v2`)，先做出"text + 最简 image 两节点、能拖能连能删、起 vite 看到、刷新不丢"的最小闭环。**红线：不碰 `src/`(老版宿主)，不把 M6 复杂件(image 裁剪/蒙版/25个交互插件/云)带进当前闭环。**

## 当前进度（哪个里程碑）
- ✅ M0：M1 内核(Scope/Context/topo) + tracer bullet 全链 demo —— 83 测试绿
- ✅ runbook 修订 + 核心节点件行为契约金标准已产出(见下方契约锚点)
- ✅ **M1(浏览器)最小闭环骨架**：vite + localStorageAdapter + image 插件 + NodeStore.removeNode + CanvasDemo
- ✅ **M2：NodeRenderer + 最小 BaseNode 壳 + node:{type}:* slot** —— core/registry(NodeRegistry 纯逻辑无 Vue) + nodeRenderer 解析 + components/BaseNode.vue
- ✅ **M3：命令/删除收敛** —— Selection/History/CommandRegistry/NodeFactory + command:delete/create-node/undo/redo + CanvasDemo 全走命令 + 最小右键菜单
- ✅ **M4：Save 层完整 + key 规范 + 生命周期 flush + 契约测试网** —— keys.ts + browserFlush(visibilitychange/pagehide) + saveContract.test
- ✅ **M5：连接内核（加固）** —— 原样吸收 v1 normalize/canonical/环检测/去重 + 声明式 inputs/accepts/limit；demo connect 走内核校验；connection.test(15 例) 锁死 v1 规则 —— 83 测试绿
- ▶️ **M1~M5 已全部达成**（runbook 主闭环完成）。M6(image 复杂件/Video/panorama/云等)= runbook 声明的**另开任务**，红线不并进当前闭环。
- ✅ **插件抽独立包(dsh 范式) 最小样板**：text/image 节点抽成 `packages/plugins/plugin-node-{text,image}` 独立 workspace 包，UI(content .vue)+逻辑一体、随包注册(`registerNodeType`)，宿主按 `bootCanvas({plugins})` 清单加载、零手 seed —— vite demo 可拖/连/删/编辑/刷新恢复，101 测试全绿。插件开发指南：`packages/plugins/README.md`。
- ✅ **M6 开篇：四个节点各自独立成包并复刻 v1 能力**（2026-09-12，用户指定开启 M6 的节点子项）：
  - `plugin-node-text`：加底部状态栏（字数/行数/复制/删除）；修掉编辑框拖拽坑（nodrag/nopan）、补外部写回同步（撤销/重做后画面跟着变）。
    （⚠️ 本轮还加了"顶部操作条（加粗/字号/颜色/对齐）"，**下一轮已被用户否决并删除**——对文本节点无语义，见下方工具层那条。）
  - `plugin-node-image`：补回 v1 的节点控制端——顶部操作条（上传 → dataURL 落 data、裁剪入口）+ 底部状态栏（文件名/宽×高/大小/裁剪中/失效）+ 裁剪覆盖层（可拖可缩放、几何为纯函数）+ 旋转/下载；裁剪**原地替换** imageUrl，裁剪态只存组件本地（不写 `data._overlay`，避免刷新复活）。
  - `plugin-node-3d-preview`（新包）：照 v1 PanoramaNode 复刻 three.js 球体全景预览，拖拽转视角 / 滚轮缩放 / 重置；视角数学与贴图来源判定抽成纯函数。
  - `plugin-node-image-compare`（新包）：连两张图用可拖拽分割线对比，最多 2 条输入、FIFO 挤最老，分割线位置落 data。
  - 宿主 `packages/ui` 装配清单已加入后两个新插件；新增整装测试 `packages/ui/src/__tests__/nodePluginsAssembly.test.ts`（四类型注册/段齐全/可建可卸、无残留）。
  - 测试：四个包 + ui 整装共 **151 条**（text 36 / image 60 / 3d 25 / compare 25 / ui 5）全绿，内核 326 条与主题 74 条不受影响，四包 `tsc` + ui `vue-tsc` + 四包/宿主 `vite build` 全通过。
  - 其中含两条**渲染契约**测试（SSR 拿真实 HTML 断言）：`textToolbarsRender.test.ts` / `imageToolbarsRender.test.ts` —— 锁"上下状态栏确实渲染出来、只在选中时出现、纯图标按钮都有 title+aria-label"，避免只测内部 computed 而漏掉模板写错。
  - **仍未做**（属 M6 后续，别当成已完成）：扩展/蒙版/滤镜、Video 节点、AssetStore 资产落盘（当前上传走 dataURL）、云 authority。
    （"backend 生成模型与底部 prompt 栏"已在下一轮完成，见下方工具层那条。）
- ✅ **节点 AI 能力「工具层」+ 文本/图片节点按 V1 修正**（2026-09-12 第二轮，用户指定）：
  - **内核新增 `tools` 层**（`ctx.tools` / `ctx.get('tools')`，实现 `canvas-core-v2/src/services/toolRegistry.ts`，22 测试）：工具 = 拿画布上下文调**外部能力**（与 command=画布内部动作 分工）。声明式 `params` 让节点 UI **自动**长出控件；`produces`/`accepts` 让节点按需筛选；`invoke` 把"同步返回"与"提交后轮询"两种第三方形态**归一化**，异常/超时收敛成 `{ok:false,error}`。加新模型 = 装一个工具插件，**节点与内核零改动**。契约已写入 `docs/plan/canvas-core-v2-api.md` §3.2b。
  - **新包 `plugin-tool-image-generation`**（53 测试）：把第三方图片生成 API 包成工具（照 v1 的 5 个模型能力声明，id 原样保留）。同时导出 PluginModule（宿主一行装载）与纯工厂函数 `createImageGenerationTools` / `registerImageGenerationTools`（**可在别处注册复用**，host 收 ctx 或裸 ToolRegistry）。可注入 fetch、可配 baseUrl，**不做假图 mock**。
  - **图片节点底部改成「生成图片」控制栏**（照 v1 ImageBottomToolbar）：上游素材小卡片行（图片缩略图/文本卡片，可点开大图，末尾 + 加素材）+ **大输入框（用用户自己的 ProseMirrorEditor，支持 @ 引用素材）** + 模型与该模型声明的参数下拉 + 发送。面板**不认识任何模型名**，只 `ctx.tools.list({produces:'image'})` 取工具、按 `params` 自动渲染下拉。生成成功写回 `data.imageUrl`（一次写完，含尺寸、清旧图描述；可撤销可落盘），失败只显示不落盘。
  - **文本节点按 V1 修正**：删除顶部加粗/字号/颜色/对齐工具栏（对文本节点无语义）与相关样式命令/字段；内容区改回 V1 的**透明底、无边框、无 outline 就地编辑**（p-4 内边距、**回车换行不提交**、Esc 取消、blur 提交、双击进入编辑）；底部状态栏**水平居中**（原 left:0 左贴边）。
  - 测试：相关包共 **842 条**全绿（内核 348 / 渲染 187 / 主题 74 / text 16 / image 106 / 3d 25 / compare 25 / 工具 53 / ui 整装 8），六包 `tsc` + ui `vue-tsc` + ui `vite build` 全通过。整装测试新增"图片节点经 ctx.tools 发现能出图的工具""能按吃文本输入筛工具""运行期热插工具"三条，锁住工具链闭环。
- ✅ **控制栏贴边距离可配 + 图片节点尺寸跟随图片**（2026-09-12 第三轮，用户指定）：
  - **控制栏偏移进配置**（分组 `布局/控制栏`，key `toolbarTopOffset` / `toolbarBottomOffset`，默认 6、范围 0-40）：节点顶部操作栏、底部生成面板、文本底部状态栏原本各自写死 `calc(100% + 6px)`，现全部改由配置驱动。读取收口到 `canvas-render` 的 `useToolbarOffsets()` / `toolbarOffsetStyle()`（订阅设置变化**实时生效**、卸载退订、读不到/非法值回落 6px），避免三处各抄一遍漂移。放在 theme-default 而非各节点插件：settings key 全局一张表先声明者独占，且"浮层离卡片多远"属节点外壳几何，与既有 `titleOffset` 同类 —— 日后加视频节点白拿。
  - **图片节点宽高跟随图片**（照 v1 的 fitCardSize 规则）：`ratio = min(上限宽/图宽, 上限高/图高, 1)`，只缩小不放大，下限 120×80，量不到尺寸则保持原尺寸不猜。上限可配（`imageFitMaxWidth`/`imageFitMaxHeight`，分组 `布局/图片节点尺寸`，默认 420×300 = v1 的 MAX_PREVIEW_WIDTH/HEIGHT）。**四处写回在同一次 patch 内带尺寸**（上传 / 裁剪 / 旋转 / AI 生成出图），保证一次撤销退回原样而不是"退半步"；另在 ImageContent 加**幂等兜底**（挂载补缺失尺寸、imageUrl 变化时跟随），覆盖后台/MCP 直接写节点与旧数据。
  - 顺带补上主题变量 `--canvas-node-text-body`（文本节点正文色此前只能走硬编码回落值）。
  - 测试：相关包共 **892 条**全绿（内核 348 / 渲染 200 / 主题 74 / text 19 / image 140 / 3d 25 / compare 25 / 工具 53 / ui 整装 8）。新增测试锁：偏移解析与 CSS 拼接（含非法值/0 值/无关键不重渲染）、尺寸适配边界（大图缩小、小图不放大、比例、下限、非法返回 null）、四处写回各只产生一条撤销记录、兜底监听幂等。
  - 已知既有问题（非本轮引入，报错文件与 HEAD 逐字节一致）：`plugin-theme-default` 的 `tsc --noEmit` 会对 `components/ui/index.ts` 报两条 `.vue` 类型再导出错误 —— 该包 typecheck 用裸 tsc 跑不了 .vue 类型，需换 vue-tsc。
- ✅ **控制栏多选收起 + 文本节点生成控制栏 + 下拉统一组件**（2026-09-12 第四轮，用户指定）：
  - **多选时所有控制栏（上+下）都不显示**：根因是选中判定写成"我在选中集里" → 框选 N 个节点会并排浮出 N 份面板。新增共享判定 `canvas-render` 的 `useSoleNodeSelected()` / `isSoleSelected()`（语义 = **恰好选中一个节点且就是我**，对齐 v1 NodeToolbar 的 `getSelectedNodes.length === 1`），图片顶部操作条、图片生成面板、文本生成栏三个段组件全部改用它；两个包各自的 `useNodeSelected.ts` 删除（避免再有人用错判定）。
  - **文本节点底部改成与图片同款的生成控制栏**（`TextGeneratePanel.vue`，替换原 `TextBottomToolbar.vue`）：大输入框（用户的 ProseMirrorEditor，支持 @ 引用上游素材）+ 模型下拉 + **参数下拉**（思考程度这类就是工具 `params` 的一项，面板不认识它们）+ **模板下拉** + 发送；生成结果**直接写回 `data.text`**（一次写完，走 graph，可撤销可落盘），所以结果会出现在输入框里可继续编辑。字数/行数读数与复制、删除动作并入该栏。工具来源 = `ctx.tools.list({ produces: 'text' })`，**本包不认识任何模型名**。
  - **下拉统一用项目自己的组件，彻底去原生**：`plugin-theme-default` 导出 `Select` / `Dropdown` / `PrecisionSlider`（原本只在本包内部用），图片与文本面板的原生 `<select>` 全部换成 `Select`，视觉与设置界面同源；测试断言渲染结果里**不再出现 `<select` 标签**。
  - **内核工具层补两个声明位**：`ToolDef.templates`（预设提示词模板，工具作者声明、面板自动出"模板"下拉，加模板不用改节点）+ `resolveToolTemplates()`（含 `forTools` 共享模板收集与同 id 去重）；图片工具插件随即补上 v1 的 3 条模板（高清写实/留白极简/海报感）。
  - 测试：相关包共 **933 条**全绿（内核 354 / 渲染 206 / 主题 74 / text 45 / image 142 / 3d 25 / compare 25 / 工具 54 / ui 整装 8）；七包 `tsc` + ui `vue-tsc` + ui `vite build` 全通过。新增测试锁：多选时上下控制栏均不渲染、单选渲染、模板/参数下拉按声明长出来、无原生 select、文本写回是"一次写入"、失败不落盘。
- ✅ **控制栏布局数值全部进设置 + 设置页面覆盖度兜底**（2026-09-12 第五轮，用户指定）：
  - 用户反馈"这些配置应该也要写到我的设置页面中"。核对后：偏移项（`布局/控制栏` 的上/下控制栏偏移）、图片尺寸上限（`布局/图片节点尺寸`）、生成后台三项（`常规/图片生成`）**已在设置页**（已在浏览器实测确认）。
  - 但审计发现仍有几处**用户可见的布局数值写死在面板 CSS 里**，本轮一并做进 `布局/控制栏`：`panelImageWidth`（图片生成栏宽度，默认 650）、`panelTextWidth`（文本生成栏宽度，默认 520）、`panelEditorMinHeight` / `panelEditorMaxHeight`（生成栏输入框高度区间，默认 64–220）。读取收口到 `canvas-render` 的 `useGenPanelMetrics()`（与 `useToolbarOffsets` 同语义：订阅实时生效 / 卸载退订 / 非法值回落默认）。
  - 顺带修掉一个真 bug：图片生成面板原先用"固定负 margin"做水平居中，宽度改成可配后该偏移必然错位 —— 改为 `translateX(-50%)`，并把居中与反缩放 `scale` 合进同一个 `transform`（分写会互相覆盖）。面板背景同时改为与设置面板同材质的纯白（原为浅灰底）。
  - **新增设置页覆盖度测试** `packages/ui/src/__tests__/settingsCoverage.test.ts`：用真实内核 + 真实插件断言 `ctx.settings.groups()` 与关键键值，锁"这些配置确实会出现在设置页面里"，并约束一级分类只允许 `布局/常规/节点/边`、每个分组名都必须带二级段 —— 以后新增配置忘了写 group（界面上表现为"配置项凭空消失"）会被立刻拦住。
  - 测试：相关包共 **947 条**全绿（内核 354 / 渲染 215 / 主题 74 / text 45 / image 142 / 3d 25 / compare 25 / 工具 54 / ui 14）；五包 `tsc` + ui `vue-tsc` + ui `vite build` 全通过。
- ✅ **生成能力注册独立成插件 + 参数支持自定义组件渲染**（2026-09-12 第六轮，用户指定）：
  - 用户问"图片生成/文本生成要如何注册"，要求**注册放在单独的插件里**，参数要有名称/描述/**指定组件渲染/甚至自定义组件**。核对：图片侧早有独立注册插件（`plugin-tool-image-generation`），但**文本侧完全没有注册方** —— 文本节点面板一直显示"无可用工具"。本轮补齐。
  - **新增 `plugin-tool-text-generation`**（31 测试）：与图片侧完全同构，把文本生成后台包成工具（`produces:'text'`，结果走 `ToolResult.text`）。内置 3 个模型（思考程度/长度档位各有差异），带 4 条预设提示词模板；`POST /api/tasks` 提交 + `GET /api/tasks/:id` 轮询，进度由内核转发。同时导出 PluginModule（宿主一行装载）与纯工厂 `createTextGenerationTools` / `registerTextGenerationTools` / `registerFromBackend`（**可在别处注册**）。Config 用 `textGen` 前缀避免与图片侧撞 settings key，分组 `常规/文本生成`。**绝不做假文本 mock**。
  - **内核 ToolParamDef 扩展**：补 `description` / `min` / `max` / `step` / `placeholder` / `span`（布局权重）/**`component`（自定义渲染组件）**/ `componentProps`。`component` 是 opaque 句柄（内核不解析、不 import Vue），约定 props `param / modelValue / disabled`、事件 `update:modelValue` —— **内置控件不够用时工具作者自带组件即可，面板与内核都不用改**。
  - **新增通用参数渲染器 `ToolParamField`**（theme-default 的 UI 组件，随包导出，9 测试）：按声明渲染 select/string/number（有范围走滑块，否则数字输入）/boolean，**并优先使用 `param.component`**。图片与文本两个生成面板的参数区都改用它（删掉各自的参数下拉样板），于是"自定义组件"在两个节点上同时生效。
  - 顺带修一个真 bug：参数回写此前一律 `String()` 化，会把开关的 `true` 变成 `"true"` 发给后台、数值参数也会变成字符串。现按类型保持原值，并新增 `paramRaw()` 供渲染器取原值。
  - 测试：相关包共 **998 条**全绿（内核 354 / 渲染 215 / 主题 83 / text 45 / image 142 / 3d 25 / compare 25 / 图片工具 54 / 文本工具 31 / ui 17）；七包 `tsc` + ui `vue-tsc` + ui `vite build` 全通过。整装测试新增"两类生成工具并存且互不混入""参数声明字段齐全（label/description/options）"。
- ✅ **文本/3D 节点双态 + 图片对比宽度跟随**（2026-09-12 第七轮，用户指定）：
  - **文本节点两态**（用户原话："第一种是预览，只显示内容，超出隐藏就行，双击才进入编辑状态，提供滚动条，拦截画布的滚轮（缩放画布）"）：新增纯函数 `textViewMode.ts` 定判定（编辑态 > 缩略 > 首行截断 > 全文预览；预览态一律裁掉且**不**拦滚轮；编辑态给滚动条且把滚轮从画布手里抢过来）。编辑框除类名 `nowheel`（VueFlow 按 `closest('.nowheel')` 跳过 d3-zoom）外另加 `stopPropagation` 作双保险。新增按 nodeId 记名的会话态 `textEditSession.ts`（**不写 data** —— 写进去会落盘/进历史/被复制），顺带让"编辑态到底有没有滚动条、有没有拦滚轮"能被无头渲染直接断言（过去只能靠肉眼）。
  - **3D 预览节点两态**（用户原话："也是双击进入，进入之后可以转动视角，默认模式下是用来拖拽节点的"）：新增 `panoramaMode.ts` 把"哪种模式吃事件"收成一个开关 —— **预览模式（默认）3D 画面 `pointer-events:none`、不挂 nodrag/nopan/nowheel**，于是按住画面就是拖节点；**交互模式（双击进入）**才接管指针与滚轮（拖拽转视角 / 滚轮改视野角），Esc 或**点画布空白**退出（经内核 `RenderEvents.PaneClick`，对齐 v1 的 paneClick 收起 `_editing`）。模式会话 `panoramaSession.ts` 同样不写 data（v1 写 `data._editing`，得靠 `sanitizeForSave` 手动抠掉才不落盘 —— v2 没这层兜底，写进去必然刷新即卡在交互模式）。交互模式无论有没有图都显示"怎么退出"的提示（用户是被关进来的，不说明白会以为节点坏了）。
  - **图片对比节点宽度跟随第一条连线**（用户原话："他的宽度应该跟第一个连接线连接的图片的宽度一致"）：新增纯函数 `compareFit.ts` —— 只认**第一条连线**（两张图宽度不同就以先连的为准）、宽度取上游图片节点的**显示宽度** `data.cardWidth`（即用户实际看到的那个宽度，不是原始像素）、**拿不到就不猜**（保持原宽度，猜错比不跟随更糟）、**幂等**（算出来等于当前就一次都不写，否则监听自己触发自己转死循环 —— 与 imageFit 同一教训）。只跟宽度不动高度（高度留给用户拖）；`cardWidth` 与内核 `size` 同一次写回（只改一个会让相连边端点停在旧宽度）。
  - 测试：相关包共 **1051 条**全绿（内核 354 / 渲染 215 / 主题 83 / text 64 / image 142 / 3d 45 / compare 46 / 图片工具 54 / 文本工具 31 / ui 17）；text / 3d / compare / image 四包 `tsc` + ui `vue-tsc` + 三包与 ui `vite build` 全通过。本轮新增 7 个测试文件、60 条，其中三个是**渲染契约**（SSR 拿真 HTML 断言）：`textContentRender` 锁编辑态有没有 `nowheel` 与滚动条、`panoramaContentRender` 锁预览模式画面有没有真的 `pointer-events:none`（只看画面容器，不看模板注释）、`imageCompareWidthRender` 用记录型假 graph 锁"连上图之后确实写回宽度"。

## 现在立刻该做的一件事（2026-09-16 记录）

> 注：本节以下的每次"现在立刻该做的一件事"是当时的快照标题，逐轮累加后重复出现，已就地保留（见【五、历史记录】小节说明）。

### 本轮：拖线时压住其它连线的流光（用户指定，2026-09-16）
- 用户需求（原话）：「在拖拽连接线的情况下 其余连接线不要光斑动画效果（流光效果动画）」。
- **根因**：CustomEdge 的 `isHighlighted` 含「两端任一节点被选中」→ 多选批量连线时选中集覆盖一大片边，它们的流光全亮（用户截图：整片线都在流）。
- **改法**：新增纯函数 `flowAllowedDuringDrag({ isDraggingConnection, isTemporary })`（edgeFlow.ts）—— 拖线手势进行中只允许临时拖线本身流光，其余边（含因选中而高亮的）全部静止；没在拖线时行为不变。`CustomEdge.flowActive` 接上它，光斑渲染与逐帧动画自然一起停（每帧回调开头直接 return，零开销）。
- 注意：只压**流光动画**，不压其它视觉（选中环/线色不变）—— 需求只针对"拖线时全屏流动"的干扰。
- 验证：浏览器实测多选 3 源拖线中 —— 3 条临时线全部流光、画布既有边 0 条流光（修前全亮）；松手 3 条边正常落齐。edgeFlow 测试 18 条全绿（新增 2 条），theme-default 包其余测试不受影响。

### 上一轮：connectEdge 统一建线入口 + handle 匹配真 bug（用户指定，2026-09-16）
- 用户指出（原话）：「我觉得你这个逻辑依然存在 BUG。我的很多操作都会创建新的连接线，不管是多选批量创建还是拖拽到空白处创建节点的时候（自动创建连接线，这是右键菜单插件的逻辑）还有普通拖拽建立连接线，或者历史记录什么的。我认为你应该做一个添加连接线的函数，在这个地方解决 evictOnFull / capability 两个属性，还有验证连接线是否有效的地方，只有全部通过之后才创建」。

#### ① 真_bug：3d-preview 的"只接一条"完全失效（用户实测报的）
- **根因**：具名口容量统计写成 `e.targetHandle === effectivePort`，而声明里的 `port` 是 `'target'`、**真实拖拽建出的边 targetHandle 是 null**（edgeStore 不存默认 handle）→ `null === 'target'` 永远为假 → 容量统计恒为 0 → 永远不挤。
- **修法**：`validateConnection` 与 `pickOverflowEvict` 两处统一改为 `e.targetHandle ?? 'target' === effectivePort` —— 具名声明的 target 口与"默认 target 口"是**同一个口**，无 handle 的边必须算进去。补 2 条测试锁死（含多具名口场景：无 handle 边只算进它真正落到的那个口）。

#### ② connectEdge —— 全路径统一建线入口（按用户要求的架构）
- **背景**：画布里建线至少有 5 条路径（普通拖线 / 右键菜单拖到空白自动建节点 / 生成面板加素材 / 多选批量连线 / 云端合并与粘贴），以前每条路径各自决定"要不要校验、满了怎么办"，这是容量 bug 反复出没的土壤。
- **改法**：`graph.connectEdge(input)` 一个函数管完：**校验 → 满额挤出 → 落边**，返回结构化结果 `{ edgeId, status: ok|rejected|duplicate, reason?, evictedEdgeId? }`（空串丢原因的老问题一并解决）。`addEdge` 保留为薄包装（老调用方零改动），事务句柄同样暴露 `tx.connectEdge`。
- **迁移**：普通拖线（CanvasHost.commitEdge，删掉自查 + 手写幂等）、右键菜单真边、生成面板加素材（删掉自算挤出与 `oldestIncomingToEvict` import）、多选批量连线、云端合并、剪贴板粘贴 —— **全部走 connectEdge，没有旁路**。唯一例外仍是 `data.transient` 临时脚手架边（跳过校验/挤出）。
- `imageOps` 的 `inputCapacity` / `evictEdgeId` 参数一并删除（接口瘦了，插件作者不用再理解这些）。

#### 验证
- 浏览器实测（真实拖拽）：**3d-preview 拖第二条线 → 第一条被挤掉**，始终只有一条（修前两条并存，用户截图报的正是这个）。
- 全量回归：canvas-data **274**（新增 7 条：connectEdge 五条 + handle 匹配两条）/ canvas-render 227 / node-image 148（含改 2 条旧语义断言）/ node-text 65 / image-compare 46 / 3d-preview 71 / context-menu 51 / clipboard 23 / cloud-save 90 / theme-default 118 / multi-select 126 / ui 23 全绿；7 个包 tsc 干净。

### 上一轮：连接容量的正确语义 + 加边守门人（用户指定，2026-09-16）
- 用户纠正（原话）：「你一直在强调图片的 capacity 是1，但是我这里图片输入端口分明是可以添加多条连接线的」「最初提出这个 capacity 是因为我有一个 图片diff 节点…只有它只能连接2条连接线，其他的节点都没有限制」「这里默认就是挤，当前没有任何一个节点为拒」「你这里添加连接线的时候 绝对不能绕过这个规则检验」。
- **用户是对的，V2 迁移时把容量语义弄窄了。** 查 V1（packages/canvas-core/src/nodes/*）：image/text 只声明 acceptsInputs（**只限类型、不限条数**），全靠 image-compare 自己手写「超了挤最老」。V2 给所有节点都加了 capacity:1，行为随之变窄。

#### ① 容量的三条语义（改前 / 改后）
- **改前**：capacity 未声明 = 当 1 用（只接一条）；满额一律 limit-reached 拒。→ 图片/文本节点接不了第二个上游；而「挤老边」因为 `if (capacity < 2) return null` 这道门槛**从未生效过**。
- **改后**：
  - **不声明 capacity = 不限条数**（image / text 现在都不声明，回归 V1 语义）；
  - 声明了且满额 → **默认挤老边**（evictOnFull 缺省 true），落边时先删最老一条再加新的，同一条历史记录；
  - 只有显式 evictOnFull:false 才满额直接拒（当前**没有任何节点**用这个，与用户要求一致）。
- capacity 现在只有两处声明：3d-preview = 1（换图）、image-compare = 2（保留最老两条）。
- image-compare 顺带从「上限 2 + 1 个缓冲位 = 3」改回**如实的 2** —— 那个缓冲位是「内核不会挤」时代的 workaround，现在不需要了。

#### ② 挤出决策收口成唯一实现
- 新增内核纯函数 pickOverflowEvict()（canvas-data/canvas/connection.ts），与 validateConnection 的容量段**同源**。
- 以前这条决策散在三处：CanvasHost.evictOldestIncoming（还带着 capacity < 2 的死门槛）、plugin-node-image 的 imageOps 自己算一遍、image-compare 又用「缓冲位 + 边变化订阅」绕过一遍。**判定分散 = 行为漂移**，这正是「同一条边拖线能连、批量连却被拒」的根因。现在只有一份。

#### ③ 加边守门人：任何入口都不能绕过校验
- **漏洞**：graph.addEdge 是「图唯一写入口」，但**完全没有校验** —— 插件 / 云端合并 / 测试脚本都能把自连、成环、重复、类型不符的边直接塞进图。我上一轮就是误用这个后门「验证」图片能连多条，得出的是假结论。
- **改法**：graphDocument.addEdge 落闸（addEdgeGuarded）—— 规则不过就不落边（返回空串）。挤出也一并在这里做，同事务原子。
- **例外**：data.transient 的临时脚手架边不校验（拖线途中的占位边端点可能还没进 store），也不参与挤出。
- 新增 5 条测试锁死：自连 / 重复 / 成环 / 类型不符全部拦下；transient 边正常放行。**浏览器实测**同样四类非法边全部被拦（返回空串、一条没落）。
- 顺带把 registerNodeType 里**手抄的 inputs 字段列表**换成复用 PortDef —— 正因为抄了一份，新增 evictOnFull 时插件写了会被类型误拦。

#### 验证
- 浏览器实测（真实拖拽）：两个图片源拖到同一图片目标 → **两条都连上**（修前第二条被拒）。
- 浏览器实测：image-compare 连第 3 条 → 自动挤掉最老一条（保留最新两条）。
- 全量回归：canvas-data **267** / canvas-render 227 / node-image 148 / node-text 65 / image-compare 46 / 3d-preview 71 / context-menu 51 / clipboard 23 / cloud-save 90 / theme-default 118 / group 21 / multi-select 126 / ui 23 全绿；五个包 tsc 干净。
- 更新了 7 条断言旧语义的测试（canvas-data 连接内核 5 条 + context-menu 1 条 + image-compare / 3d-preview 各 1 条）：它们锁的正是被改掉的旧行为，按新规则重写而非删除。

### 上一轮：批量连线的"部分支持"语义（用户指定，2026-09-16）
- 用户原话：「多个节点 可以拖是拖拽一条连接线 你的目标节点应该如何判断是否可以链接？比如只要部分连接线支持就可以链接（链接的时候也只允许支持的连接线进行连接）不能一股脑的直接建立连接线」。
- **先查清了"一股脑"到底发生在哪**（三个场景浏览器实测）：落边本身**一直是逐条校验**的（类型不符、容量已满、类型级部分支持三种都只落了合法的那几条），所以"全建进去"并不存在。真正的三处问题在别处：

#### ① 容量不在批内累计 —— 这是真正会"多建一条"的漏洞
- 内核 `validateConnection` 判容量看的是"目标输入口**现有**入边数"。批量落边时每条边各自查一次图，**兄弟边互相看不见**：目标口 capacity=1 时，3 个合法源会各自都判合法、3 条一起落进只装得下 1 条的口。
- 改法：新增纯函数 `planBatchApply(specs, { isDuplicate, canConnect })`，其中 `canConnect(spec, **alreadyPlanned**)` 第二个入参就是"这一批里已经决定要建的边"。组件的 `validateBatchEdge` 把已计划的边并进"现有边"一起喂给内核校验。顺序即优先级（先到先得），与单条拖线"先连上的占住口"一致。
- 实测：两个合法文本源拖到容量 1 的文本目标 → 只落第一条（修前会落两条）。

#### ② 目标可连性被"某个源不合法"整体判死
- 原来用 `resolveFeedback` 按**单个源**跑，某一个源不合法就把整个目标画成"不可连"——哪怕别的源明明连得上。
- 改法：几何命中与合法性**解耦**。resolveFeedback 只负责回答"aim 到哪个节点"（validate 恒返回空串），合法性改用整批结论：`plan.build.length > 0` 即"至少有一条能连"→ 目标亮"可连"；一条都连不上才按非法处理，并把真实原因（如"类型不匹配"）透到气泡。
- 注意"已存在"**不算非法**：那条边本来就在，按可连显示。

#### ③ 预览与落边是两套独立判断（迟早漂移）
- 改法：预览与落边**共用同一份** `batchPlan`（computed），做不到"所见非所得"。
- 临时线新增 `willConnect` 位：连不上的那条加 `is-rejected` 压暗（opacity 0.28 + grayscale），用户在**松手前**就看得见"这一拖只有几条会成"。不用虚线是因为线型来自用户可配的主题，再叠一层 dash 会与配置打架。
- 实测：text 源 + image 源一起拖到 text 目标 → 一条线正常、一条压暗到 0.28、目标显示可连；松手只建 `text→text` 那条（`image→text` 被内核以 type-not-accepted 拒）。

#### 顺手抓到并修掉一个我自己引入的严重 bug
- `onBatchUp` 里先执行了 `batchSide.value = null`，之后才读 `batchPlan.value` —— 而 batchPlan 是依赖 batchSide 的 computed，于是**恒为 null，一条边都建不出来**（表现为"预览两条线都对、松手什么都没有"）。改为**先取计划、再清状态**，并在注释里标明顺序不可调换。

#### 测试与回归
- multi-select **126 条**（新增 10 条：`planBatchApply` 六条 —— 含"容量 1、两个源各自合法只落第一条"这条回归；`markGuideLines` 四条 —— source/target 两侧对号入座、duplicate 也算会连上、不改动其它字段）。
- 回归全绿：canvas-render 227 / canvas-data 258 / theme-default 118 / ui 23；`vue-tsc` 对本轮改动文件零报错。

### 上一轮：多选框"缩放后 padding"bug + 父子级方案取舍（用户指定，2026-09-16）
- 用户反馈（原话）：「你的这个多选框缩放之后的 padding 存在 BUG 你这里框选的话 你认为是做成一个节点 给框选的节点设置 父子级？？还是目前这种让框选直接跟随画布的缩放，那个好一些？？」

#### ① 缩放后 padding 的 bug：间距与线宽不在同一个空间
- **实测数据**（间距配 24 / 外框线宽 4 / 内框线宽 2；"重叠"= 两条线各半宽之和 > 屏幕上间距）：

  | zoom | 屏幕上间距 | 外框线宽 | 结果 |
  |---|---|---|---|
  | 2 | 48px | 2px | 正常 |
  | 1 | 24px | 4px | 正常 |
  | 0.5 | 12px | 8px | 临界 |
  | 0.3 | 7.2px | 13px | 重叠 2.3px |
  | 0.2 | 4.8px | 20px | **重叠 10.2px** |
- **根因**：两框**线宽**按 1/zoom 反缩放（屏幕恒定粗细），而 **padding 是 flow 常量**（屏幕上 = 配置 × zoom）。缩得越小线越粗、间距越窄，两条线最终糊成一条。
- **改法**：新增纯函数 `scaleFramePaddings(pads, zoom)`，把间距也除以 zoom —— 让"间距"与"线宽"用**同一套空间约定**：配置值恒等于"你在屏幕上量到的值"。zoom 非法/≤0 回落 1（绝不产生 Infinity 把几何算炸）。
- **同时补上另一半**：`refreshFrame` 的 watch 依赖里加了 `viewport.zoom`。少了这一项，缩放画布后间距会**停在旧缩放算出来的值**上，与线宽对不上 —— 单改 scaleFramePaddings 是不够的。
- **实测结果**：修后屏幕上间距在 2 / 1 / 0.5 / 0.3 / 0.2 五档缩放里**恒定 24px**，再无重叠（修前 0.2 时重叠 10px）。

#### ② 父子级 vs 跟随画布缩放：建议继续用现在这套
- **结论：不改成父子级。** 理由是项目里已经有真正的父子级分组（`plugin-group`，走 `parentId` + `toRelativePosition`），两者职责重叠，硬把框选也做成父子级会直接打架。
- 跟随缩放这套（浮层 + 自己贴 viewport 变换）的**实际优势**：① 不写数据、不进历史，框选不该污染文档；② 不参与图结构，不会影响连接校验/导出/后端；③ 跨顶层节点本来就是常态，而父子级要求所有节点归到同一个父下，语义反而拧巴；④ 已是当前架构，改造成本为零。
- **父子级唯一真正占优的地方**：节点很多、缩放很小时，浮层要按虚拟化只画可视区（`visibleRect` / `visibleNodes`）—— 这一条是性能问题，不是正确性问题，等真出现几千节点再说。
- **要让观感与线宽同空间**这件事，父子级并不自动解决（它解决的是"拖动时要不要重算"），仍要像本轮这样把间距按 zoom 换算。所以换方案并不能省掉这个 bug 的修法。
- 唯一与本方案有关的小麻烦：拖动中用"快照 + 位移"跟手（不能每帧重算并集），这是已解决的历史坑（见 dragFollow 的注释与回归测试）。

#### 测试
- multi-select **116 条**（新增 6 条：`scaleFramePaddings` 的 zoom=1 原样 / zoom=0.5 翻倍 / 非法值回落 / zoom=0.2 间距不被线宽吃掉；渲染契约两项 —— 间距随缩放换算、缩小时两框不糊在一起）。
- `vue-tsc` 对本轮改动的文件零报错。

### 上一轮：批量连线的"端口直接用 MovingHandle / 3D 反馈 / 多源"三问（用户指定，2026-09-16）
- 用户反馈（原话）：「你的多选框左右的 2 个 movinghandler 效果不对，有没有办法直接使用 MovingHandle.vue？有没有办法直接讲他导出，然后在我的这个多选插件中导入他 并且使用？？其次就是拖拽到目标节点上的时候没有那种 3d 动效 之前你的这个判断写在了什么地方？？ canvas-render 还是 plugin-theme-default 判断连接线是否可以链接，这里之前判断的是只有单个连接线，现在可能需要让他支持多个？？」
- **三个问题各自的根因都定位到了（实测 + 读代码得出，不是猜的）**：

#### ① 端口"效果不对"：不是没复用 MovingHandle，而是拿 !important 去改它的定位
- 现状：多选框上**本来就是**主题的 MovingHandle（preview 模式，上一轮已导出并导入）。但外面套了个 **0×0 定位点**，再用 !important 把 top/transform 压回 0，去绕开组件自带的 top:50% !important。
- **改法**：删掉那两条 !important 覆盖，改成**顺着组件的契约走** —— 给定位盒一个**真实高度**（= 跟随区高），它自己的 top:50% + translateY(-50%) 就自然落在盒子垂直中点上、跟随区上下各露一半，与节点端口同一套几何。以后改跟随区高度也不用再动定位代码。
- 顺带修了跟随区高度的算法：原先写成 (portZoneHeightRatio ?? 0.8) * 100（把一个 0~1 的**比例**硬乘 100 当 px），跟节点那边"节点高 × ratio"完全不是一回事。现在基准 = **选中集里最高的那个节点的高度** × ratio，并留 72px 下限。实测跟随区从 22.5×60 变成 **45×120**，与节点端口逐字一致。
- 还修了"端口拖不动"：圆球永远画在跟随区**里面**、跟随区 z-index 更高，所以按下命中的是跟随区、圆球收不到 mousedown（preview 模式下没有 VueFlow Handle 那层兜底）。改为**两条入口都接**（connect-start + 定位盒的 mousedown），函数内做幂等判重，不会装两套监听。

#### ② 拖到目标上没有 3D 动效：喂给反馈几何的矩形**字段名写错了**
- **判断写在哪里**：连接**规则本身**在 packages/canvas-data/src/canvas/connection.ts（validateConnection：自连 / 成环 / 重复 / 类型 acceptsTypes / 容量 capacity），**不在** plugin-theme-default —— plugin-theme-default 只管"长什么样"（CustomEdge / MovingHandle / BaseNode）。
- **真因**：nodeLayout 给的是 { x, y, w, h }，而渲染层 resolveFeedback 要的是 { x, y, width, height }。少了这一步转换 → width/height 恒为 undefined → 吸附带 / body 命中全算成 NaN → hover 永远 null → hoverNode 永远写不进去 → BaseNode 的 3D 条件（showConnectFeedback → isConnectionValidTarget）永假。
- **改法**：新增纯函数 toNodeRects(rects)（nodeLayout 形 → NodeRect 形）并在组件里走它；同时把命中用的吸附带配置从写死的 DEFAULT_SNAP_ZONE_CONFIG 换成渲染上下文里的 snapZone（宽 42 / 高占比 0.8），与"从节点端口拖线"**同一份配置**（原先宽 undefined → 吸附带塌成 0 宽，永远吸不到端口）。
- **浏览器实测**：拖到干净目标 → 卡片 .v2-card.is-connecting-hover + transform: perspective(800px) rotateX(...) rotateY(...) scale(1.018)（3D 回来了）；拖到已有入边的节点 → is-connection-invalid + 气泡"已存在同一条连线"；松手落边 68-77 成功（69-77 因目标容量 1 被内核正确拒绝）。

#### ③ "之前判断的是只有单个连接线，现在需要支持多个"
- **改法**：ActiveConnection 增加可选 sourceNodeIds?: string[]（**缺省 = 单源语义，逐字不变**），并新增渲染层共用判定 isConnectionSource(active, nodeId)（单源比 sourceNodeId、多源查集合）。BaseNode 的 isCurrentConnectingNode 改为走它 —— 这是"我算不算拖线源"的唯一维护点，散在各处必然漏掉多源那一路。
- 多选插件起手时把**整个选中集**写进 sourceNodeIds。**实测**：拖线中两个源节点的左右端口都变 is-disabled（修前只有第一个）。

#### 测试与回归
- multi-select **110 条**（新增 6 条：toNodeRects 三项 —— 含"拿真实 resolveFeedback 断言转换后能命中 / 不转换则永远命中不了"的对照；端口定位不得再用 !important；跟随区高度算法两项）；canvas-render **227 条**（新增 4 条 isConnectionSource 单源 / 多源 / 空数组回落）。
- 全量回归：canvas-data 258 / theme-default 118 / ui 23 全绿；canvas-render tsc 干净。
- 浏览器实测：整组拖动、端口跟随鼠标（球随鼠标 943→958）、Shift 加选、批量落边均正常。
- **已知既有问题（非本轮引入，未修）**：plugin-multi-select / plugin-theme-default 的 typecheck 脚本用**裸 tsc**，处理不了 .vue，于是 SelectionFrame.vue 的 script setup 里**类型错误不会被 CI 拦住**（本轮 ① 的猜数错误就是这么漏进来的）。本次改用 vue-tsc 复核：这两个包我的改动无报错，剩余报错来自 prosemirror-editor-bundle 与三个既有测试文件。

### 上一轮：批量连线补齐"N 条线 + 目标反馈"（用户指定，2026-09-15）
- 用户反馈（原话）：「我要的连接线是 从多选中每一个节点 对饮端口创建一条连接线到鼠标位置 / 你没有get到这一点而且当前 他移动到目标节点上的时候 没有任何效果？？ 比如这里的3d 动效，什么模糊（失败检测什么的）你这里都没有实现」。
- **确认了两处缺失**：① 上一轮只画了**一条**线（从多选框边缘出发），不是"每个选中节点各一条"；② 完全没写渲染层的连接反馈状态，所以目标节点上没有 3D 倾斜 / 模糊 / 气泡。

#### ① N 条临时线（每个选中节点各一条）
- 新增纯函数 `buildBatchGuideLines(side, selectedIds, rects, cursor, snap?)`：每个选中节点**从他自己的外侧端口锚点**连到鼠标（或吸附点）。右侧拖出从各节点右缘中点出、左侧反之；吸附时所有线都指向目标端口锚点。拿不到矩形的节点跳过（不瞎猜位置）。
- 组件里把单条 `guideLine` 换成 `guideLines` 数组，模板 v-for 渲染，每条都用主题 `ConnectionLine`（内部委托 `CustomEdge`）→ **与正式边同款**。
- 浏览器实测：拖动中 `.conn-line-shell` 数量 = 2（选中 2 个节点各一条），截图可见两条线汇聚到鼠标。

#### ② 目标节点连接反馈（3D / 模糊 / 气泡）
- **根因（对宿主连接机制读完后确认）**：目标节点的 3D 倾斜、非法模糊、气泡都由渲染层的 `connectionState` 驱动（`isConnecting`/`activeConnection`/`hoverNode`/`suppressHandles`），BaseNode 只消费它。我上一轮完全没写这些状态，所以拖到目标上"什么效果都没有"。
- **改法**：批量连线开始/结束时写同一份 `connectionState`（开始：`activeConnection` + `suppressHandles`；结束：全部清空）——**与宿主 `beginConnection`/`endConnection` 同语义**；每帧拖动用渲染层现成的 **`resolveFeedback` 纯函数**（吸附带/body 几何命中 + 内核 `validateConnection` 校验 + `reasonText` 文案）算出 hover 并写 `hoverNode`。这样目标节点的反馈与"从节点端口拖线"**同一套逻辑、同一套观感**，不是我另做一份。
- **两个实测踩出来的坑**：
  1. **`isConnecting` 是 computed（派生自 `activeConnection`），不能直接赋值** —— 直接写无效且不报错，反馈静默失效。只能写 `activeConnection`。
  2. **flow 坐标换算必须用渲染层官方的 `screenToFlow`** —— 手写公式（`(client - pane - vp) / zoom`）实测算出错误 flow 坐标导致 hover 永远 null；官方换算后坐标正确、命中正常。
- **浏览器实测**：拖到 67（image 类型）上 → 卡片出现 `is-connecting-hover`（3D 倾斜 + 蓝色高亮），截图可见；松手落边 `68->67`（`69->67` 因容量 1 被 `limit-reached` 正确拒绝）。

#### 测试与回归
- multi-select **104 条**（新增 5 条：`buildBatchGuideLines` 的方向/吸附终点/跳过无矩形/空选集），`tsc` 干净。
- 全量回归：canvas-render 223 / canvas-data 258 / theme-default 118 / ui 23 / node-text 65 / node-image 148 全部通过。

### 上一轮：拖未选中节点时框乱动 + 多选框端口拖不动（用户指定，2026-09-15）
- 用户反馈（原话）：「1, 我拖拽未选中的节点的时候你的这个选框也在移动 2. 你的多选框 的 movinghandler 无法进行拖拽 建议你可以观察一下 vender/vueflow的源码？使用codegraph」。
- **按建议读了 `vendor/vueflow` 源码**（`packages/core/src/components/Handle/Handle.vue` + `composables/useHandle.ts`、`useVueFlow.ts`）：
  - `Handle` 的按下走 `@mousedown="onPointerDown"` → `useHandle.handlePointerDown`，且**必须能 `findNode(nodeId)`**（`if (!fromHandleInternal) return`）—— 即真实连接点必须挂在某个节点上；这印证了"多选框上的端口不能用真 `Handle`、只能用 `MovingHandle` 的 `preview` 模式自己 emit"是正确路线。
  - 也确认了 d3-zoom 的平移挂在 `.vue-flow__viewport` 的 `mousedown`（前几轮已实测过），与本次两个 bug 无关但一起复核了。

#### ① 拖未选中的节点时选框跟着动
- **复现（量化）**：多选 68+69，按住**未选中**的节点 70 拖 6 帧 → 框逐帧 `368→382→396→410→424→438`（与 70 完全同步），节点位移 140、选中集没变。
- **根因**：`RenderEvents.NodeDragStart` 里我**无条件**记下"拖动锚点"，于是拖任何节点框都会跟随。框代表的是**选中集**的包围盒，没被拖的成员不在选中集里就不该理它。
- **改法**：抽出纯函数 `shouldFrameFollowDrag(draggedNodeId, selectedIds)`（= 被拖节点在选中集里才跟随），在 `NodeDragStart` 用它判定；不在选集内就把锚点置空、整段拖动都不跟随。
- **浏览器决定性验证**：把未选中的 70 移到不重叠处后拖它 → 拖动中框**恒定不动**（327→327），70 正常移动（829→899），拖后框 Δ0 / 节点 Δ200 / 选中集不变；探针确认走的是 `skip` 分支。

#### ② 多选框上的端口无法拖拽
- **根因**：`onPaneCaptureDown`（挂在 `.csurface` 捕获阶段、判断"框内空白 = 整组平移"）**把端口上的按下也接管了** —— 端口球就画在多选框边缘**内侧**，几何判定把它算成"框内空白"，于是这次按下被抢走、`MovingHandle(preview)` 的 `connectStart` 收不到事件。
- **改法**：抽出纯函数 `isHitOwnBatchPort({batchSlot, movingHandle})`，在接管判定里排除"命中本插件端口/端口槽"的落点，让给端口自己处理。
- **浏览器验证**：多选后按下右侧端口球 → **引导线立刻出现**（修复前完全没有反应）；端到端拖到目标节点上成功落边 `68->70`。
- 顺带说明：这轮排查中我发现过一次"按点落在 69 却以为在按 70"的假象（两节点屏幕重叠）—— 用元素命中反查所属节点后确认判定一直是对的，避免了一次误修。

#### 测试与回归
- multi-select **99 条**（新增 5 条：`shouldFrameFollowDrag` 的"选中成员跟随 / 未选中不跟随 / 空选集"三条 + `isHitOwnBatchPort` 的两条），`tsc` 干净。
- 全量回归：theme-default 118 / canvas-render 223 / canvas-data 258 / ui 23 / node-text 65 / node-image 148 全部通过。

### 上一轮：批量连线端口改用主题 MovingHandle + 临时线用 CustomEdge（用户指定，2026-09-15）
- 用户反馈（原话）：「你这里的UI 样式和效果 都存在问题 / 我要的是 和 当前 MovingHanlde 一样的效果， 拖拽的时候也是使用 ConnectionLine / CustomEdge 这个组件 / 你的这个给我整笑了」。
- **我上一轮做错的地方**：批量连线端口我自己手画了一个白底圆片按钮（`border-radius` + 内联 SVG 加号），拖拽时画的是一条 `stroke-dasharray` 的虚线。用户要的是**和节点端口、和正式边完全一致**的观感 —— 我这是另造了一套，必然漂移。
- **改法一：端口复用 `MovingHandle`（preview 模式）**。它本来就内置了 `preview` 语义 —— 渲染成 `span` 而非 VueFlow 的 `<Handle>`（不注册真实连接点）、并 emit `connectStart`，正是为"挂在自己浮层上的临时端口"准备的。现在多选框左右两侧各挂一个，`rest-offset`/`cursor-gap`/`button-size`/`zone-*` 全部取自同一份 `handleParams`，所以**外观、半圆跟随区、圆球跟随动画、180ms 归位淡出、显隐规则全部与节点端口同源**。
- **改法二：拖拽临时线复用 `ConnectionLine`**。该组件内部把渲染**完全委托**给 `CustomEdge`，所以拖出来的临时线与落成的正式边**长得一模一样**（导轨/流光/箭头/配置/动画）。并按它的注释要求把 `sourcePosition/targetPosition` 正确设为 right/left（硬编码方向会把贝塞尔控制点翻到内侧、曲线往反方向弯）。
- **为此把两个渲染件从 theme-default 导出**（`MovingHandle` / `ConnectionLine` / `CustomEdge`），并把 `@mini-canvas/plugin-theme-default` 加进多选插件的依赖 —— 否则就是"各自手绘一套"的老路。
- **两个实测踩出来的坑**：
  1. **MovingHandle 的锚点 CSS 有 `top:50% !important`**，直接给它内联 top 会被覆盖（实测端口渲染到 y=-1182，跑到画布外）。解法：外面套一个**零尺寸定位点** `selection-frame-batch-slot`，由它决定锚点落在大框左/右缘的垂直中点。
  2. **引导线起点不能读端口球的位置** —— 球会跟着鼠标跑（它就是跟随区），读它会得到抖动/错位的端点。改为读**定位点**的位置（稳定不动）。
- **测试**：本包 **94 条**（新增 1 条渲染契约：端口确实是主题的 `moving-handle-anchor` + `is-preview` + `port-follow-zone`，左右各一个 → 锁"复用同一组件、不各画一套"）；`tsc` 干净。
- **浏览器实测**：多选后左右两侧各出现一个与节点端口同款的白色圆球（带 + 号）；按住圆球拖出 → 临时线由 `ConnectionLine`/`CustomEdge` 渲染（DOM 实测 `conn-line-shell` + 13 个 path，与正式边同款）；松手落在节点上 → 按类型/容量规则落边（实测新增 `68->70`；`69->70` 因目标输入口容量为 1 被内核 `limit-reached` 正确拒绝）。
- **副作用说明**：为让 vite 解析新依赖，重启了 5288 的开发服务器（新依赖需要重新预构建）；源文件未受影响。

### 上一轮：多选时禁止对齐吸附（用户指定，2026-09-15）
- 用户反馈（原话）：「这里多选的时候 应该禁止 我的对齐节点（对齐插件 - 拖拽的时候那个参考线）」。另问：「你的这个多选框是如何实现的？？ 使用的是父节点还是其他的方式？」
- **架构答复（多选框不是父节点）**：`SelectionFrame` 是**独立浮层组件**，注册进 `overlay` 槽，与 VueFlow 的节点层是**兄弟关系**（不是父子）。它自己贴一层与 VueFlow viewport **完全相同的 transform**（`translate(x,y) scale(zoom)`）把框定位在 flow 坐标系；几何取自 `nodeLayout` 的矩形并集；整组拖动由它自己算（逐帧视觉写 + 松手经 graph 落盘）。好处：不碰 VueFlow 内部结构、不依赖节点父子关系，普通节点与 group 子节点一视同仁。
- **根因**：对齐插件的吸附实现是 `updateNodeVisual(被抓住的那个节点, 吸附后位置)` —— 它只动**一个**节点。多选整组拖动时，这一下会把组里被抓住的那一个单独吸到对齐位、其余成员留在位移后的位置，**整组的相对位置被弄乱**。实测：参考线出现 1 条、且整组位移被吸住（预期 140 只走了 130）。
- **改法**：新增纯函数 `shouldAlignOnDrag(selectedCount)` —— 选中 <= 1 才对齐，多选一律让位。`AlignGuideOverlay` 在每帧拖动里读当前选中数，多选时**不吸附也不画线**（用 `hideGuides()` 只清参考线、保留 `primaryId`，因为拖动还没结束、主节点不能丢）。
- **单一职责**：判定放在对齐插件自己的引擎里（"要不要对齐"是它的事），多选插件不反向依赖它，两插件仍互不认识。
- 测试：本包 **28 条**（新增 2 条：单选/未选中参与对齐、多选不参与），`tsc` 干净。
- **浏览器实测（含对照，证明没把单选对齐弄坏）**：单选拖动 → 参考线最大 **1 条**（`align-guide-hline`，对齐仍生效）；多选拖动 → 参考线最大 **0 条**（已禁止）。验证时打开的对齐开关已按用户原状态恢复为**关闭**。
- 全量回归：multi-select 81 / theme-default 118 / canvas-render 223 / canvas-data 258 / ui 23 / node-text 65 / node-image 148 全部通过。

### 上一轮：第二次拖框清空选中 + 拖节点时框漂移（用户指定，2026-09-15）
- 用户反馈（原话）：「第一次拖拽多选框（空白区域）可以进行拖拽，拖拽之后 选框没有消失 / 但是第二次不管我是拖拽节点还是 多选框 他的多选中黄台都会消失 / 图2 是第二个问题，拖拽里面节点的时候 你的多选框位置错误， 你看看你拖拽结束之后 是如何设置 多选框位置的， 拖拽结束之后的多选框位置是正确的」。

#### ① 第二次拖拽后选中被清空
- **复现**：第一次拖框 → 选中保住（正常）；**第二次**拖框（或拖节点）→ 松手后选中变空。
- **根因（探针实测的守卫状态）**：两次拖拽的事件链对比 —— 第一次 `click → swallowed:true`（守卫生效）；第二次 `pointerdown 时 armed:true`。
  即：`groupDragArmed`（上一轮为"抵消紧随的 mousedown"加的标记）**从未被消费**（因为我们在 `pointerdown` 上做了 `preventDefault`，浏览器就不再补发 `mousedown`），于是第二次按下时它还是 true → 处理函数走进"抵消 mousedown"分支直接 return：**既没开始新的拖动、标记又被清掉**，最后补发的 click 穿过去把选中清空。
- **改法**：把"这次 mousedown 要不要抵消"改由 `isDragging`（真的在拖）判断，**不再用这个易失灵的标记**：
  - `isDragging === true && e.type === 'mousedown'` → 抵消（d3-zoom 的入口）；
  - `e.type === 'pointerdown'`（新手势开始）→ 作废上一次遗留的吞 click 标记。
  删掉 `groupDragArmed` 这个中间状态（它同时兼任两个语义，是这次 bug 的来源）。
- 浏览器实测：**连做三次拖框，选中每次都保住**（`["68","69"]` ×3）；随后再点真正空白 → `[]`（清空回归正常）。

#### ② 拖动节点时框位置漂移（松手才跳回正确位置）
- **复现（量化）**：拖节点 68 时逐帧测"框相对选中节点并集的外扩量"，从 `(-7, -9)` 一路漂到 `(-7, -21)`，**松手后又跳回** `(-7, -9)`。
- **根因**：上一轮我把拖动跟随实现成"每帧用**实时位置 + 其余节点的 store 位置**重算并集"。但 VueFlow 原生拖动**只在松手时落盘**，所以拖动中途 store 里被拖节点的位置还是旧的 —— 于是并集把"新位置"和"旧位置"混在一起，框越算越偏。用户观察到的"松手后才正确"正是因为这个：松手落盘后 store 变新，重算就对了。
- **改法**：与整组拖动**统一成同一种算法** —— 用"框快照 + 位移量"移动框（`followFrame`）。拖动时记下框快照与"抓着的那个节点的起始位置"，每帧只算该节点的位移量再平移框。这样框与节点走同一个 delta，相对偏移天然恒定，不需要读 store、也不受落盘时机影响。
  - 只认"抓着的主节点"的帧：多选拖动时 VueFlow 会给每个成员各发一帧，用同一节点算位移才严格同步。
- 浏览器实测：拖动中逐帧外扩量**恒定 `(-17, -23.5)`**（修前漂到 -21），松手后一致，选中同时保住。

#### 测试与回归
- multi-select **81 条**（新增 4 条：连续三次手势各自吞掉自己的 click / 漏掉"新按下作废"会让标记失效这个坑本身 / 逐帧位移量推进偏移恒定 / **对照**"重算并集会漂移"的修前错误形态）。
- 全量回归：theme-default 118 / canvas-render 223 / canvas-data 258 / ui 23 / node-text 65 / node-image 148 / align-guide 26 全部通过；multi-select `tsc` 干净。

### 上一轮：拖动后选中被清空 + 单选圈改自绘 SVG（用户指定，2026-09-15）
- 用户反馈（原话）：「当前选框可以拖拽了，但是拖拽之后我的 选中状态也会被情空 / 还有你的多选UI 效果 节点内部左上角的那个单选样式 请使用自定义svg 把，你的这个ui效果很难评 直接使用svg替代把」。

#### ① 拖动结束后选中被清空（复现 + 根因 + 修法）
- **复现**：选中 68/69 → 在框内按住拖动 → 松手 → 选中变空（拖动**期间**选中还在，只有松手那一下被清）。
- **根因（事件探针实测的事件序列）**：`pointerdown@window → pointerup@window → pointerup@pane → click@window → click@pane` —— 松手后浏览器**补发了一个 `click`**，VueFlow 的 pane click 语义是"点空白 = 清空选中"，于是刚拖完的选中被这一下清掉。
- 这与我早先修的"Shift 框选后选中被清空"是**同一个病**，当时已经写了状态机 `boxSelectGuard.ts`（`BoxSelectClickGuard`）。本轮直接**复用它**：整组拖动结束时 `markGestureDone(true)` → 紧随的那次空白 click 在**实例根捕获阶段**被吞掉；并在每次新的 `pointerdown` 时 `reset()` 作废未消费的标记（松手点若落在节点上、浏览器不补发 click，标记不能留到下一次误吞真实点击）。
- 浏览器实测：拖动前 `["68","69"]` → 拖动后 `["68","69"]`（**保住**），节点 Δ133；随后**再点一次真正空白** → `[]`（清空回归正常，守卫没有误吞正常点击）。

#### ② 单选圈改为自绘 SVG（用户要求）
- 原实现是 CSS 画的圆（`border-radius` + 边框 + 中心伪元素），用户认为效果不佳。改为**内联 SVG**：`viewBox 0 0 20 20`，两个 `<circle>` —— 外圈（白底 + 2px 主题色描边）+ 中心实心点（选中态）。
- 好处：矢量、任意缩放下都清晰；颜色统一走 `currentColor` / `var(--canvas-node-border-selected)`，**跟随主题**而不是写死色值。
- 尺寸：容器 26×26、距卡片左上各 8px，仍按 `1/max(zoom, titleScaleMinZoom)` 反缩放（屏幕上大小恒定）。纯指示不接事件（`aria-hidden` + `pointer-events:none`），点击行为仍归卡片（Shift+点节点 = 取消该节点选中）。

#### 测试与回归
- theme-default **118 条**（新增 1 条：标记确实是 `<svg>` + 两个 `<circle>` + 有 `viewBox`，锁"用自绘 SVG 而非 CSS 画圆"）；multi-select **77 条**、`tsc` 干净。
- 全量回归：canvas-render 223 / canvas-data 258 / ui 23 / node-text 65 / node-image 148 / align-guide 26 全部通过。
- 三项行为最终浏览器实测：①框内拖动 → 选中保住、节点 Δ133、画布 Δ0；②拖动后再点空白 → 正常清空；③框内滚轮 → zoom 0.450→0.682（穿透缩放照旧）。

### 上一轮：多选框三处交互修正（用户指定，2026-09-15）
- 用户反馈（原话）：「你这里的选框 有问题，我只说了 鼠标滚轮可以透传，鼠标左键平移节点你给我弄错了 / 拖拽这个多选框是平移这个多选框和选中的这些节点 / 还有就是多选之后 在节点的左上角（内容区域）添加一个单选框的这个圆形单选UI（用来区分当前节点是否选中）需要写入到 baseNode 中（default-theme 插件中）/ 其次就是我拖拽节点的时候 你的多选框没有实时生效，移动节点之后当我鼠标松开的时候它才触发这里的多选框位置重置」。

#### ① 左键拖框 = 平移框 + 选中节点（修正上一轮做错的地方）
- **上一轮的错误**：为让节点可点，我把框内部设成事件穿透，于是左键落在框内空白被 VueFlow 当成"拖空白 = 平移画布"。实测确认：节点 Δ0、画布 Δ75。
- **这一轮的做法**：框**整体**不接事件（节点完整可点），改在**画布层按几何判断**该不该接管 —— 落点在框内、且不在任何节点上 → 这次手势归"整组平移"；落在节点上则原样放过（节点选中/拖动照旧）。
- **三个坑（全部实测定位，非猜）**：
  1. **监听必须挂在 `.vue-flow` 的祖先（实例根 `.csurface`）的捕获阶段**：d3-zoom 的平移挂在 **`.vue-flow__viewport` 的 `mousedown`** 上（深度调试实测查到的），拦 pane 拦不住；
  2. **`pointerdown` 与 `mousedown` 是两个独立事件，必须都拦**：前者是 VueFlow 的入口、后者才是 d3-zoom 的入口。只拦前者 → 画布仍被拖走（实测节点在动、画布也在平移）；用 `groupDragArmed` 标记把同一物理动作的第二个事件一并拦掉；
  3. **`preventDefault` 会抑制该 pointer 的兼容鼠标事件**：一旦在 `pointerdown` 上 preventDefault（抑制原生拖拽/选中文字），后续 `mousemove` 就不再来 —— 拖动必须用 **`pointermove`/`pointerup`** 驱动（踩过：监听 mousemove 导致拖动全程收不到事件）。
- 浏览器实测：框与节点**逐帧同步**平移（框 525→589 / 节点 541→605），两个节点各移 178，**画布 Δ0**；最终回归：节点 Δ160、画布 Δ0。

#### ② 节点左上角的多选圆形单选标记（写入 BaseNode）
- 在 theme-default 的 **BaseNode** 内容区左上角加 `v2-multi-radio`：白底圆环 + 中心实心点，**只在多选（选中 >=2）时出现**（单选时卡片已有选中环，再叠一个圆点反而多余）。
- **纯指示、不接事件**（`pointer-events:none` + `aria-hidden`）：点击行为仍归卡片本身，这样 Shift+点节点 = 从选中集里去掉它，逻辑不被装饰层挡掉。
- 圆圈按 `1/max(zoom, titleScaleMinZoom)` **反缩放**，与标题同一套语义：屏幕上大小恒定，缩到 0.2x 时不会小成一个点。

#### ③ 拖动节点时框实时跟随（原先只在松手后跳一下）
- **根因**：VueFlow 原生拖动**逐帧只改渲染层**（`updateNode` 内部状态），位置要**松手才落盘**；而框只订阅了 `nodeStore`，所以整个拖动过程中框定在原地、松手那一瞬才"跳"过去（正是用户截图看到的现象）。
- **改法**：订阅渲染层逐帧广播的 `RenderEvents.NodeDragStart/NodeDrag/NodeDragEnd`（宿主已有这套事件），按"拖动中的实时位置 + 其余选中节点的 store 位置"重算并集。
- 关键细节：**不能只记一个节点的位置** —— 多选拖动时 VueFlow 会给每个被拖成员各发一帧，必须把它们的实时位置都存下来（`liveNodePos` Map），否则框会按"一个动了、其它还在原地"的并集抖动。
- 浏览器实测：拖动节点时逐帧 `[框 left, 节点 left]` = 589/605 → 607/623 → 625/641 → 643/659 → 661/677，**差值恒定 15px**（框与节点完全同步，不再松手才跳）。

#### 测试与回归
- multi-select **77 条**（更新 2 条：原"四条拖动把手"的断言改成"框整体不接事件且没有把手元素"，与新设计一致）；theme-default **117 条**（新增 4 条：多选出现圆点 / 单选不出现 / 未选中不出现 / 圆点是纯指示不接事件）。
- 全量回归：canvas-render 223 / canvas-data 258 / ui 23 / node-text 65 / node-image 148 / align-guide 26 全部通过；multi-select `tsc` 干净。
- 说明：验证期间发现 **5288 的开发服务器已停止**（端口无监听），已重新拉起（`packages/ui` 的 `pnpm dev`）以便继续端到端验证。

### 上一轮：多选四项体验问题（用户指定，2026-09-15）
- 用户反馈（原话）：「1. 多选的时候 可以设置是否显示标题（config配置开关 这里的padding计算看是否需要更新）2. 使用shift框选的时候禁止出现节点的上下控制栏（NodeToolbar）3. 使用浏览器检查，你可以发现多选的时候他们的z-index 存在问题，我希望的是节点在最上面 因为这样我就可以加减选了，（当前我多选之后无法操作节点，不能做到单独取消某个选择）4. 在多选区域这个位置让他支持 鼠标滚轮穿透（也就是这里的 缩放画布）」。

#### ③ 节点在框之上、可加减选（最关键的一项）
- **根因不是框的 z-index，而是整个 overlay 层压在节点之上**：CDP 实测节点 `.vue-flow__node` 是 `z-index:1000`，而框所在的 `.csurface-overlay` 是 `z-index:20` —— 但节点在 `.vue-flow__viewport`(z:4) 这个**堆叠上下文**内部，它的 1000 只在里面生效；overlay 是 viewport 的**兄弟**且 z=20 > 4，于是**整个浮层盖在整棵 VueFlow 之上**。再叠加框的容器是"铺满、`pointer-events:auto`"的矩形，结果就是节点中心 `elementFromPoint` 命中 `selection-frame-outer` —— 点不到节点，自然没法单独取消某个选中。
- **改法（浮层内部让出事件，不动框架层级）**：大框拆成两层 —— `selection-frame-outer` 只做**视觉**（`pointer-events:none`），另加 `selection-frame-grips` 沿大框边框铺**四条薄把手**（`pointer-events:auto`）承接整组拖动。框内部彻底留空 → 事件落到节点上。
- 为何不改 overlay 的 z-index：节点有**动态选中环**（::after box-shadow）与浮动端口，一旦把节点抬到浮层之上，这些会被盖住，代价更大；而在浮层内部让出事件既解决问题又不碰既有层级契约。
- 浏览器实测：节点中心命中回到节点内容（`preview`）；**Shift+点节点可单独取消选中**（`["68","69"]` → 点 68 → `["69"]`）；框内空白命中 `vue-flow__pane`（穿透到画布）；四条把手到位。

#### ④ 多选区域滚轮穿透缩放
- **根因**：VueFlow 的 wheel 监听挂在它的 canvas 容器上，而框在 `.csurface-overlay`（另一个分支、且铺满）—— 滚轮事件到不了画布，`preventDefault` 也没人做。
- **改法**：浮层上加 `wheel` 监听（`passive:false`），把事件**转发**给 `.vue-flow__viewport` 元素。为何是转发而不是自己算 zoom：VueFlow 的缩放中心要按鼠标在画布内的位置算，自己调 zoomTo 会变成"以画布中心缩放"，手感不对；转发一个真实 wheel 给它，缩放中心/增量/动画与直接在空白处滚完全一致。
- 浏览器实测：框内空白 -300 → zoom 0.300→0.455、+300 → 0.455→0.300；**左/上/右三条拖动把手上**滚轮同样生效（0.12→0.209→0.364→0.209），且缩放中心跟随鼠标（x/y 同步变化）。

#### ② 框选期间不出现上下控制栏（NodeToolbar）
- **改法**：框选手势开始时把渲染层已有的 `interaction.selecting` 置位（`beginSelecting`，对齐老版 `canvasStore.isBoxSelecting`），BaseNode 据此把上/下插槽整层不渲染；松手或组件卸载时复位（`endSelecting`，含 detach 兜底，防止热卸把位卡在 true）。
- 浏览器实测：单选 image 节点时插槽容器在（`上插槽:在/0`、`下插槽:在/1`）→ 框选中两个都**从 DOM 移除** → 松开后恢复。
- 顺带：多选（>=2）时同样收起（面板语义本就是"恰好选中一个"），与既有压制条件合并到同一个 `hideToolbars`。

#### ① 多选时是否显示标题（config 开关）
- **改法**：新增配置 `multiSelectHideTitles`（「多选时隐藏节点标题」，默认关）。BaseNode 按"开着 + 处于多选"两条同时成立才隐藏标题条。开关放在 multi-select 插件（它才是"多选"这件事的语义归属，把多选框的配置集中在一处；settings key 是全局平面命名，theme-default 按名字读）。
- **关于用户提到的 padding**：默认关掉隐藏时，`两框间距（上）` 的语义与数值都不变，**不需要联动改**；只有用户**主动开启**隐藏后才可能想调小它，故在 description 里写明"关掉隐藏后若想让大框仍兜住标题，把两框间距（上）适当调大"，不引入隐式的自动改值（自动改会覆盖用户设定）。
- 另外补了 `multiSelectFrameEnabled` 总开关（默认开）：关掉即不画两个框，多选本身照常可用。
- 浏览器实测：开关打开后单选 70 → 标题显示；多选 70+67 → **标题隐藏**；回到单选 → 恢复显示。

#### 测试与回归
- multi-select **78 条**（新增 7 条：总开关不画框、框选中不画框、面板指针穿透（外观层不接事件 + 把手恰好四条 + 把手只铺边框的尺寸）、两个开关的 schema 与脏值回落）；theme-default **113 条**（新增 6 条：框选中插槽整层不渲染、多选插槽不渲染、单选照常渲染、hideTitles 多选隐藏/单选不隐藏/默认不隐藏）。
- 全量回归：canvas-render 223 / canvas-data 257 / ui 23 / node-text 64 / node-image 147 / align-guide 26 全部通过；multi-select `tsc` 干净。

#### ⚠️ 并行改动的处理说明
- 本轮工作期间**同一工作区存在另一个进程在改代码**（`plugin-node-image/ImageTopToolbar.vue`、`plugin-theme-default/components/ui/*`、`canvas-render/nodeLayoutSettings.ts` 等并非本轮改动的文件也在变，并新增了 `NodeToolbarButton.vue`、`baseNodeSlotsRender.test.ts` 等文件；期间出现过一次 HMR 编译错误与一次写文件被占用）。
- 我的改动与之**没有冲突**：对方把 BaseNode 的上下控制栏从"单个段组件"重构成"可叠多个 occupant 的上/下插槽（`topSlots`/`bottomSlots` → `.v2-slot--top/--bottom`）"，而我加的 `hideToolbars` / `showTitle` 两个压制条件被**完整保留并接进了新的插槽模板**（两处 `v-if` 都带 `!hideToolbars`）。验证时已按**重构成后的新类名**重新取证。

### 上一轮：小框（内框）也能设圆角与 padding（用户指定，2026-09-15）
- 用户反馈（原话）：「框选之后 你这里内部的这个最小 rect 框 我也希望可以设置圆角 和 padding」。
- **圆角本来就能设**：上一轮已把「内框圆角」的默认值改成 0（直角），配置项一直在设置里。本轮再确认了它能改（设 14 → 屏幕上 28px，按 1/zoom 反缩放），并补了测试锁住"不是写死直角"。
- **新增「小框外扩」（本轮的主要工作）**：以前只有"两框间距"一个 padding，它管的是大框离小框多远，**小框自己没有任何可调的外扩**（永远紧贴节点并集）。现补三项 —— `小框左右外扩` / `小框上方外扩` / `小框下方外扩`（key `multiSelectFrameInnerPadding{X,Top,Bottom}`），默认全 0。
- **几何改成逐层往外算**：`节点并集 → 内框(+小框外扩) → 外框(+两框间距)`。原先 `ComputeSelectionFrameGeometry(rects, padding)` 只有一层，现在签名扩成 `(rects, gap, innerPadding)`；两个 padding 的默认值各自独立（小框 0/0/0、间距 16/34/16），故**默认观感与之前逐像素一致**。三条几何不变量用测试钉死：小框 = 并集 + 小框外扩、大框 = 小框 + 间距、大框永远包住小框（不管小框扩多大都不交叉）。
- **顺带把设置项名字说清楚**：原先那三项 label 叫「群组框左右/上方/下方内缩」，容易跟新的"小框外扩"混起来（都带"内缩/外扩"字样却管不同东西）。改名为 `两框间距（左右/上/下）`，description 同步重写为"大框（外）与小框（内）之间留多少"，与新三项形成"大框↔小框 间距 / 小框↔节点 外扩"的清晰对照。
- **配置 → 几何的转换收口成 `framePaddingsOf(cfg)`**：把一份外观配置拆成 `{ inner, gap }` 两组 padding，组件不再手抄六个字段（抄错一个就静默错位）。
- 测试：本包 **71 条**全绿（新增 10 条：几何 4 条锁逐层语义与大框包小框、配置 4 条锁三项默认 0 与 `framePaddingsOf` 拆解、渲染契约 2 条锁"配了值内框真的变胖且大框跟着外推"与"不配时仍严格等于节点并集"），tsc 干净；canvas-render 215 / canvas-data 257 / ui 23 / 主题 91 / text 64 / image 148 / 对齐辅助线 26 全部不受影响。
- **浏览器实测**（真 dev server）：默认态小框相对并集四边均为 0、两框间距 16/34/16；设 12/24/8 后小框四边精确外扩 12/24/8 而两框间距仍是 16/34/16（说明间距是相对小框算的）；内框圆角设 14 → 计算样式 28px（= 14/0.5 反缩放）；设置面板「布局 → 多选」列出「两框间距（左右/上/下）」+「小框左右/上方/下方外扩」+「内框圆角」；验证后把配置恢复为默认（持久化里只剩显式写入的 0 值，与默认一致）。

### 上一轮：内框去掉圆角（用户指定，2026-09-15）
- 用户反馈（原话）：「你的内部框有一个 圆弧，我不希望有这个 圆角效果」。
- **现象确认**：默认配置下内框圆角是 12px（按 1/zoom 反缩放后屏幕上 17.14px），四个角明显是圆的 —— 选中框要"紧贴选中节点的并集"，而节点并集是个正矩形，圆角会让四条边在角上提前弯掉、看起来没贴住。外框的圆角（6px 虚线大框）保留不动。
- **改法**：`DEFAULT_MULTI_SELECT_FRAME.inner.radius` 12 → **0**（直角）。该配置项本身保留（`内框圆角` 仍可在设置里调，想回圆角就调大），只改默认值 —— 不是把圆角写死成 0。
- 测试：本包 **61 条**全绿（新增 3 条：配置默认为 0、默认渲染出的内框 `border-radius:0px` 且外框仍是 6px、圆角设 10 时能出 10px 证明没写死），tsc 干净；canvas-render 215 / canvas-data 257 / ui 23 / 主题 91 / text 64 / image 148 / 对齐辅助线 26 全部不受影响。
- **浏览器实测**：内框计算样式 `border-radius: 0px`、外框仍 `8.57143px`（= 6/0.7 反缩放）；放大到内框左上角目视四个角均为直角；设置面板「布局 → 多选」显示「内框圆角 = 0」。

### 上一轮：多选群组框「拖动时框位置错误」（用户指定，2026-09-15）
- 用户反馈（原话）：「拖拽的时候 选框位置错误」。
- **根因（浏览器实测量化定位）**：拖动整组节点时节点跟手是准的，但**框越跑越快**。埋点逐帧测量：鼠标拖 20/40/60/80/100px，框跑了 **20/60/120/200/300px**，漂移量 0/20/60/120/200 —— 正是三角数，说明每帧都拿"当前框位置"当基准又加了一次"从按下算起的累计位移"，位移被重复计入，第 n 帧偏差 = n 倍位移。
- **这是上一轮的自身回归**：清理冗余字段（innerOffset）时顺手把 `dragOuterBounds`（按下瞬间的框快照）删掉了，导致拖动跟随从"快照 + 位移"的绝对定位退化成"当前值 + 累计位移"的累加。修法即恢复快照语义。
- **抽成纯逻辑 `dragFollow.ts`**：`followFrame(按下时快照, 累计位移) → 两框新位置`。为什么值得单列 —— 这条几何最容易在清理重构时被顺手改错（本 bug 就是），抽出来才能直接断言"多帧推进后位移**恰好**等于累计位移"，并顺手把这个坑本身写进测试（同一文件里对比"误把当前值当快照 = 200px"与"正确 = 80px"两种写法）。
- 测试：本包 **58 条**全绿（新增 `dragFollow` 6 条），tsc 干净；canvas-render 215 / canvas-data 257 / ui 23 / 主题 91 / text 64 / image 148 全部不受影响。
- **浏览器实测**（真鼠标手势，逐帧测量）：修复后拖 20/40/60/80/100px 框与节点**逐帧零漂移**；斜向/反向/纯横/纯纵四种方向拖动**以及松手落盘后**漂移均为 0.0px；zoom = 0.4 / 1.0 / 1.8 三档下同样零漂移（位移按 zoom 换算正确）；框内拖动、拖动中截图目视两框均紧贴节点。

### 上一轮：多选插件的框选失效与群组框双框错位（用户指定，2026-09-14）
- 用户报的两个缺陷（原话）：
  ① 「shift + 左键 在画布中框选的时候 框选完成之后并没有真实的框选，也就是操作完成之后没有任何选中状况，只有通过 Ctrl 一个一个加选才有效」；
  ② 「框选之后你的UI 存在异常，2个框竟然有重合」，并给出两框的定义 —— 「小框 就是根据选中节点计算的最小 rect 框（不包含标题）；大框 是根据一个固定的padding 进行的（这个请写在插件的config配置中）；你的小框和大框颜色和样式（比如使用实现还是虚线， 线框宽度，颜色等）写在config 配置中」。
- **缺陷①根因（浏览器实测定位，非猜）**：框选期间插件确实把命中节点写进了内核 selection（CDP 埋点可见逐帧写入 空→68→62,64,68 … 一路累加），但**松手后浏览器还会补一个 click 事件**，宿主的 onPaneClick 语义是「点空白 = 清空选中」（selectionInteractions.clickPane），于是刚框出的选中被这一下 click 全清掉 —— 用户看到的等价于「框选不生效」。Ctrl 逐个点选不走 pane click，所以看起来只有它有效。修法对齐老版 MultiSelectPlugin：框选真的发生（超过 4px 阈值）就给下一次 pane click 打「要吞掉」的标记，落点在画布空白时于捕获阶段 stopPropagation。两个坑一并堵上：**标记必须在新的 pointerdown 作废**（松手点落在节点上时 VueFlow 不派发 pane click，标记会留着误吞用户下一次真实点击）；**没拖动不算框选**（否则 Shift 点空白清空选中会失效）。判定抽成纯逻辑 boxSelectGuard.ts 的 BoxSelectClickGuard（零 DOM 可单测）。
- **缺陷②根因**：内框的 width/height 被写成了**外框**的尺寸（只有 left/top 用了 padding）。外框 = 并集 + padding、内框位置 = padding、内框大小却 = 外框 —— 于是内框被推到右下且比外框还大，两框交叉错位。新几何一次算清：multiSelectEngine.computeSelectionFrameGeometry 返回 { outer, inner, innerOffset }，其中 **内框尺寸恒等于节点并集**（不掺 padding）、只由 padding 决定它落在何处。另把内框从「外框的子元素」改成**兄弟节点** —— 嵌在里面时外框线宽配成 0 会把内框一起带走（新加的渲染契约测试当场抓到这条连坐）。
- **外观与间距全部进 Config**（用户要求）：新增 multiSelectConfig.ts，分组 `布局/多选` 共 **13 项** —— 左右/上/下三个内缩，以及内外两框各自的**颜色 / 线型（实线·虚线·点线）/ 线宽 / 圆角 / 填充%**。key 一律加 multiSelectFrame 前缀（settings key 是全局平面命名、先声明者独占，裸 color/paddingX 会被静默丢弃）。线宽与圆角按 1/zoom 反向缩放，与 cardFrame.ts 同约定 —— 配置值的含义恒为「你屏幕上看到的粗细」。改动经 settings.onChange 实时生效，无需重载画布。
- **默认值与 v1 逐项对齐**：三向内缩取 v1 的 `selectionFramePaddingX/Top/Bottom` = **16 / 34 / 16**（最初按 v2 旧代码写成 36，核对 `canvas-core/src/composables/useCanvasStore.ts:49-51` 后改回 34）。两框式样（外框灰虚线 + 内框浅蓝实线）也与 v1 SelectionFrame.vue 同名同值。
- **两条几何语义经 v1 逐行核对**（用户说「请参考 V1 版本」，故不只看表现）：v1 SelectionFrame 的 `canvasBounds` = 并集 + padding（= 大框）、`innerBoundsStyle` 的 width/height = **并集原样**（= 小框，`left/top` 才用 padding）。本实现与之一致 —— 缺陷②正是当初把内框尺寸写成了大框尺寸而偏离了 v1 这条规则。
- **顺带修正**：外框同时是整组拖动的把手，故它**永远渲染**（线宽配 0 时看不见但仍能按住拖动），不再随「线宽 > 0」条件消失。
- 测试：本包 **52 条**全绿（引擎 15 + 几何 6 + 守卫 7 + 配置 16 + 渲染契约 8），tsc 干净；canvas-render 215 / canvas-data 257 / ui 23 / 主题 91 / text 64 / image 148 / 对齐辅助线 26 全部不受影响，ui vue-tsc 干净。本包此前无 vitest.config.ts（跑不了 .vue），本轮补上并与主题/text 包同款（@vitejs/plugin-vue + @vue/server-renderer），使「模板有没有把几何与配置真的贴到元素上」可被 SSR 真 HTML 断言 —— 这正是缺陷②的形态（几何算对、模板接错字段照样错位）。
- **浏览器实测**（内置浏览器 + 真 dev server，真鼠标手势）：Shift 框选空白起→空白止 **选中保住**（6 个节点，clear 调用从调用栈 trace 里消失）；框选后**再点一次空白仍能清空**（回归）；松手落在节点上 / 反向拖 / 只框一个节点三种路径均正确，且单个节点不画框；外框 500×101 而内框 494×91（并集原样、精确贴合）；改设置后外框 虚线·灰 → 点线·红、内框 实线·蓝 → 虚线·绿、内缩 16→40 全部即时生效；外框内拖动整组三节点位移一致且可撤销；设置面板「布局 → 多选」目视 13 项齐全。

### 上一轮：对齐辅助线补上「总开关」配置（用户指定，2026-09-13）
- 用户反馈：「你的对齐辅助线还缺少一个 config 配置，比如当前是否开启这个功能。只有在我开启这个功能的时候，你的插件才生效。需要将这种效果设置到 config 中进行配置」。
- **新增 `plugin-align-guide/src/alignGuideConfig.ts`**：导出模块级 `Config` schema，只有一个布尔项 `alignGuideEnabled`（默认开、label「启用对齐辅助线」、分组 `布局/对齐辅助线`），与老版 AlignGuidePlugin 的 panel 设置项同名同义。分组沿用项目既有四个一级分类（`布局/常规/节点/边`），不新立无主分类。
- **key 用 `alignGuideEnabled` 而非裸 `enabled`**：settings 的 key 是**全局平面命名**、先声明者独占 —— 裸 `enabled` 已被 `plugin-edge-cutting` 占用，撞名会被内核静默跳过、开关形同虚设（真实内核测试把这一点锁住了）。
- **关闭 = 浮层不装配**：插件本体只有「把 `AlignGuideOverlay.vue` 注册进 overlay 槽」这一件事，而浮层组件就是全部实现（订阅拖拽 → 算吸附 → 写 `updateNodeVisual` → 画参考线）。故关闭时**连槽都不注册**：不吸附、不画线、不订阅拖拽事件；打开即现装（组件重新挂载并重订阅），实时生效、不必重载画布。
- 装卸接线抽成纯逻辑 `alignGuideToggle.ts` 的 `bindAlignGuideToggle(ctx, attach)`：装配时按当前开关决定挂不挂，订阅 `settings.onChange` 跟着开关变；`apply` 里交给 `ctx.effect`，随插件 fiber 一起回收（热卸/重载不留残线、不误触别的插件配置）。
- 测试：本包 **26 条**全绿（引擎 13 + 配置 7 + 装卸 6），`tsc` 与 `vue-tsc` 干净；`packages/ui` 新增整装测试（真实插件模块装载 → overlay 槽里有没有它、关掉后实时摘除、装配即关则不出现、关着卸载不报错），ui **23 条**全绿、`vue-tsc` 干净；内核 361 条不受影响。原有 13 条引擎测试一条未改。
- 目验入口：`cd packages/ui && pnpm dev` → 顶部「⚙ 设置」→ 左导航「布局」→「对齐辅助线」→ 关掉后再拖节点，应既不吸附也不出参考线；重新打开即恢复。

### 上一轮记录
- ✅ **3D 预览：快捷键 + 全屏 + 去遮挡**（2026-09-12 第八轮，用户指定）：
  - **删掉常驻&quot;提醒&quot;与右上角重置按钮**（用户原话：&quot;这个提醒可以删除，这样会遮挡视线&quot;、&quot;删除你的右上角的 重置按钮&quot;）：`panoramaMode` 不再产出 `hint` / `showReset`（这两个字段连同样式一并删除），画面上除 3D 画面本身不再叠任何东西 —— 操作全部改走快捷键。
  - **全屏（f 切换）**：新增 `fullscreen` 会话态 + `Teleport` 全屏层（`z-index:100000`、纯黑无装饰）。实现方式是把 three 的 canvas **搬**进全屏层、退出再搬回节点内（不是重建渲染器：WebGL 上下文与贴图都在同一个 renderer 上，重建既慢又容易漏 dispose）。搬迁时同步 `ResizeObserver` 目标与相机宽高比 —— 这两个不跟着换，全屏就会按节点尺寸渲染一张铺不满的画面。
  - **节点快捷键 f（全屏切换）/ r（重置视角）**：全屏与重置都不再依赖按钮。r 的视角状态在组件内部，命令与组件互不认识，故经 `panoramaSession` 的&quot;重置请求计数器&quot;通信（命令 +1、组件 watch 到就去拉回相机；用计数器而非布尔，连按两次也各触发一次）。
  - **本轮的核心：快捷键优先级**（用户原话：&quot;注意这里画布也可能注册了 f，你需要有一个优先级，选中节点之后支持这些快捷键&quot;）。f/r 早已被自动布局插件占用（f=聚焦选中、r=适应视图），故给内核指令分发补两条规则：**① `when` 不满足 = 让位**（交给同键的其它命令，而不是&quot;命中即吃掉、execute 时被 when 拦成空操作&quot;——后者会把全局快捷键永久挤没）；**② `order` 小的赢**（order 相同才回落到注册先后，既有分发顺序不变）。宿主 `CanvasHost` 分发时把内核 ctx 作为执行上下文传入，`when` 才真正参与判定。节点侧用纯函数 `resolveCommandTarget` 界定&quot;什么时候归节点&quot;：**恰好选中一个、且它就是 3D 预览**才接管；没选/选的是别的类型/选了多个一律让位（多选时该操作哪一个不明确，不猜）。
  - **Esc 一次只退一层**（对齐 v1 PanoramaNode 的金标准：全屏时 Esc 只退全屏、人仍留在&quot;能转视角&quot;状态）：全屏 → 退回节点内仍可转视角 → 再按一次才回到&quot;按住就能拖节点&quot;。判定抽成纯函数 `resolveEscapeAction` —— 起因是发现最初写成 `if (fullscreen) exitInteract()` 两个分支做同一件事，等于一次跳到底，浏览器实测抓到后改掉。
  - 测试：相关包共 **1084 条**全绿（内核 361 / 渲染 215 / 主题 83 / text 64 / image 142 / 3d 71 / compare 46 / 图片工具 54 / 文本工具 31 / ui 17）；core-v2 / render / 3d 三包 `tsc` + ui `vue-tsc` + 3d `vite build` 全通过。本轮新增 4 个测试文件、26 条：内核 `commandDispatchPriority`（when 让位 + order 优先）、3d 的 `node3dCommands`（目标判定）、`node3dShortcuts`（真内核 + 真分发的整链优先级）、以及扩展后的 `panoramaMode`/`panoramaSession`/`panoramaContentRender`（全屏、Esc 分层、画面上不再有按钮提示）。
  - **浏览器实测**（内置浏览器 + 本地 dev server，用真键盘事件，不只跑测试）：f 进全屏（全屏层 canvas 实测 1280×720 铺满）、拖拽转视角后 r 回到初始朝向、Esc 逐层退出（fullscreen→interactive→preview）、以及优先级两种情形 —— 没选中时执行的是 `auto-layout:focus-selected`、选中 3D 节点时执行的是 `3d-preview:fullscreen`。

### （2026-09-13 第九轮）图片节点显示修复：铺满不留空隙 + 卡片尺寸跟上

- ✅ 用户指定：
  - 用户报的缺陷（原话）：&quot;你的图片节点显示有些问题，横屏图片 宽度大了几像素，竖屏高度大了几像素&quot;。用内置浏览器实测复现并量到确切数字：横屏图卡片外框 420×236 而图片只画到 416×234（左右各留 2px）、竖屏图卡片 169×300 而图片只画到 167×296.9（上下各留约 1.6px）。
  - **根因一：填充方式**。卡片是 `border-box` 且带 1px 边框，边框先从声明尺寸里扣掉，于是**内容区**比&quot;按图片比例算出的卡片尺寸&quot;矮胖了一点（差 2px）；`object-fit: contain` 在比例不吻合的框里必然在某一侧留白，所以&quot;节点比图片大几像素&quot;用 contain 消不掉。改为平时**铺满**（`cover`，与老版 ImageNode 的 `object-cover` 一致）。
  - **但裁剪时必须切回 contain**：裁剪覆盖层的遮罩与裁剪框都按 object-contain 几何计算（ImageCropper 的 `computeFit`），它底下就是这张图片；此时若仍铺满，遮罩会盖错、裁剪框指向错误的像素区域，裁出来不是用户框选的那块。故加 `is-fill-cover` / `is-fill-contain` 两态，随裁剪开关切换。
  - **根因二（顺手查出的真缺陷，更隐蔽）**：靠&quot;挂载时兜底补算尺寸&quot;的节点（后台/MCP 直接写节点、旧存档）**尺寸算出来了、卡片却不跟随** —— 内置浏览器实测 **8/8 稳定复现**：内核 data 与宿主渲染态都已是 420×236，但已挂载的节点组件收到的 `props.data` 仍是旧快照（只有 imageUrl/imageWidth/imageHeight、没有 cardWidth），卡片停在类型默认 320×240，16:9 的图被硬塞进 4:3 卡片。对照实验确认这是**挂载窗口内写入丢失**：挂载前写生效、挂载后写生效，只有正好落在这次挂载窗口内的写入会丢。修法：`onMounted` 的补算推迟到 `nextTick`，让写入落在挂载完成之后。
  - **浏览器实测**（内置浏览器 + 真 dev server）：横屏 420×236（比例 1.78 ≈ 图片 1.778）、竖屏 169×300（0.563 = 0.563）、正方形 300×300，全部&quot;卡片尺寸 = data 尺寸&quot;且图片铺满无空隙；8 个不同比例节点复测 7/7 正常跟随（第 8 个是 400×1200 的极细长图，宽度被设计下限 120px 抬起，属既有规则非缺陷）；裁剪模式切回 contain 且遮罩对齐、退出后恢复铺满。
  - 测试：相关包共 **1011 条**全绿（内核 361 / 渲染 215 / 主题 83 / text 64 / image 148 / 3d 71 / compare 46 / ui 23）；image / render / core-v2 / 3d 四包 `tsc` + ui `vue-tsc` + image 与 ui `vite build` 全通过。本轮新增 `imageContentRender`（SSR 真 HTML 锁&quot;平时铺满 / 裁剪时完整可见&quot;两态）。

### （2026-09-13 第十轮）图片节点去边框 + 清掉死配置 + 节点注册字段收成单一来源

- ✅ 用户指定：
  - 用户追问（原话）："我不明白 为什么图片插件会有边框?? 什么地方需要他？"。查明：边框**不是图片插件的**，它来自**共享外壳**（theme-default 的 BaseNode `.v2-card`，`borderWidth: 1px/zoom` + `border-style: solid`），本意是让卡片从画布背景上浮起来 + 承载选中态/非法连接的边框高亮 —— 所有节点类型共用，v1 也是同一个壳（`custom-node-card` 同样带 1px 边框），所以这 1px 是从 v1 继承来的，不是本轮重构引入。
  - **图片节点去掉边框**：图片是**内容铺满整张卡**的类型，那圈边框对它没有分层价值、只会变成内容边缘多余的一圈缝（用户一路在追的"图片边上还有一像素边距"就是它）。新增**类型级能力 `frameless`**（与 resizable/icon 同层，由类型自己声明，不让外壳猜节点类型），图片类型声明 `frameless: true`。**选中环不受影响**：环是 `.v2-card::after` 的 box-shadow，与边框互相独立 —— 这条是删边框最容易漏的回归，已单独写进契约测试。浏览器实测：图片节点边框 `0px`、3D 预览与图片对比仍 `1px`，图片四边间隙全部为 0（彻底贴边），选中环照常显示。
  - **删掉 6 个死配置**：`cornerRadius` / `showShadow` / `borderWidth` / `borderColor` / `blurOnLoad` / `lazyLoad` 在图片插件里声明过但**全仓无人读取** —— 设置界面里能看到、改了却毫无反应（比没有更糟：让设置面板显得可信，实际在骗人）。已整体删除，浏览器实测这 6 个 key 均读不到了。真要支持"图片可调边框/圆角"时再加，那时一次性把实现与测试一起补上。
  - **顺手修掉一个结构性隐患（本轮最重要的发现）**：给类型加字段时发现**同一份字段清单散落三处** —— `registerNodeType.ts` 的 `NodeTypeDef`、`capabilities.ts` 的 `NodeRegisterDef`、`types.ts` 里内联的 `register(def: {...})`。插件实际走 `ctx.nodes.register`（第二条路），而漏改 `types.ts` 那份会导致**类型检查报错、或字段被静默丢掉**。这次就真实踩到：`capabilities.ts` 的透传清单漏了 `frameless`，**单测全绿、浏览器里边框照旧**（测试覆盖了 `registerNodeType` 那条路，插件用的却是另一条）。已把 `types.ts` 的内联定义收成引用 `NodeRegisterDef`（单一来源），并在 `capabilities.test` 加"类型级能力逐字段透传"的测试钉住这条缝。
  - 测试：相关包共 **1106 条**全绿（内核 363 / 渲染 215 / 主题 91 / text 64 / image 148 / 3d 71 / compare 46 / 图片工具 54 / 文本工具 31 / ui 23）；core-v2 / render / theme / image / text / 3d / compare 七包 `tsc` + ui `vue-tsc` 全通过。本轮新增 2 个测试文件 + 2 条用例：`cardFrame`（边框/圆角/选中环的取值规则，含"删边框别把选中环删没了"）、`capabilities.test` 的透传契约、`registerNodeType.test` 的 frameless 透传。

## 早期里程碑（2026-09-13 及以前，历史）

### 四个节点双态 / 尺寸行为 / 3D 快捷键 / 图片去边框（用户第七~十轮）
已落地，测试与类型检查全绿。当时目验入口 `cd packages/ui && pnpm dev`。
当时目验重点：① 文本节点默认无滚动条、双击进编辑后内容长了能滚且滚轮不缩放画布；② 3D 预览默认按住画面能拖节点、双击后能转视角、选中后 f 全屏 / r 重置 / Esc 逐层退出，画面上不再有提醒与重置按钮；③ 连一张图后图片对比节点宽度跟随该图。

### 更早：M0~M6 里程碑
见下方"当前进度（哪个里程碑）"一节（该节为 2026-09-04~09-12 的历史记录）。

---
*本文件由主 agent 维护：开工前更新【一、现在该做什么】，其余各节按需追补。*
### 步骤 5c 完成（2026-09-18，88cf307）

- 四个老服务名 `nodeStore` / `edgeStore` / `graph` / `history` 已下线（`ctx.get` 取不到）；
- 数据服务统一为 `ctx.get('doc')` 门面（直接持有四个底层实例，不再按名解析）；
- `CustomEdge.vue` 剪切回落路径改走 `doc.removeEdges`（优先路径 `command:delete-edge` 不变）；
- 全仓 `rg "ctx.inject('(nodeStore|edgeStore|graph|history)')"` → **0 处**；
- 基础服务现状实测：save / doc / resources / nodeRegistry / themeRegistry / selection /
  command / nodeFactory / nodeLayout / viewport / settingsPersist = **11 个**
  （§4.2 六个"表型服务"的退场属后续清理；slots/settings 为能力层内置）
 
---

## 追加（2026-09-28，节点底栏注册化 + 进度覆盖层）

分支 `codex/node-bottom-bar-registry`（基于 49c165b，含设置面板外壳重构）。

**新包**：`packages/plugins/plugin-bottom-bar` + `packages/plugins/plugin-mock-task-backend`。
设计稿与执行计划见 `docs/superpowers/specs/2026-09-28-node-bottom-bar-design.md` 与
`docs/superpowers/plans/2026-09-28-node-bottom-bar-registry.md`（子代理审核 4 轮）。

**做了什么**：

1. `doc.updateNodeRuntime`（canvas-data）：写节点运行期状态 —— 落盘但**不进撤销栈**（进度帧用）。
2. `plugin-bottom-bar`：读服务 `nodeBar` + 执行服务 `nodeTask` + 注册糖 `registerBarAction` /
   `registerBarApplier` / `publishToolActions`（落场用调用方 ctx，条目归注册方，卸载自动摘除）。
3. 默认底栏 `NodeBottomBar`（themeRegistry 槽 `bottomBar`，order 最小者赢 = 整体可换皮）+
   覆盖层 `NodeTaskOverlay`（`over:inset`，running 时显示进度/取消）。
4. 三个节点插件删掉自己的 `out:bottom` 基座段（不设兼容）：生成动作经 `publishToolActions` 发布
   （参数/模板照工具声明长出来），旋转/下载/复制/删除为 `apply:'self'` 即时动作；结果写入器复用
   `writeGeneratedImage` 等既有写回规矩。
5. mock 后台插件：同步动作（1.2s）+ 异步动作（10 帧进度，带 taskId/resume）。

**验证基线（2026-09-28 实测）**：kernel 212 / canvas-data 332 / canvas-render 405 / canvas-base 6 /
ui 44 / plugin-bottom-bar 17 / node-text 31 / node-image 111 / node-video 105 / mock-task-backend 3，
全部通过；typecheck 全部通过；UI e2e 45 原有用例 + 5 条新断言 = **50/50**（底栏装配、覆盖层、
runState 落盘、刷新不悬挂）。

**注意**：mock 动作经 image 写入器写 `data.imageUrl` —— 点了它当前图会被换成 mock 产物（预期行为）。

## 追加（2026-09-29，底栏修「点不进去」+ 复刻 LibTV 版式）

分支 `codex/node-bottom-bar-registry`。计划与实测见
`docs/plans/2026-09-29-bottom-bar-libtv-parity.md`（子代理 plan_reviewer 审核，四点修正已并入）。

**用户报的问题**：底栏输入框点不进去、打不了字；素材卡要点击才显示；底栏 UI 与参考图不一致。

**根因（Chrome MCP 实测）**：底栏原挂在节点 `out:bottom`（`.v2-slot--bottom`）。
`.vue-flow__node` 带 transform（VueFlow 定位用）**必然创建层叠上下文** ——
节点内任何 z-index 都出不去；而应用外壳的底部工具栏 `.shell-dock`（`CanvasShell.vue`，
`position:fixed; z-index:30`）是画布的**兄弟**，于是压在底栏输入区上、把点击整段截走。
（实测：重叠段打字进不去，非重叠段正常。）

**做法（比计划更小）**：不改 `canvas-render`、不新开层 —— 只把底栏 DOM 挪出节点层叠上下文：
新增 `NodeBottomBarOverlay` 注册进**既有 overlay 槽**，内容 **Teleport 到 body** 并按屏幕坐标 fixed 定位
（与本插件 @ 菜单同一手法）。这样一次性绕开三个坑：`.csurface-overlay` 的 z:20 层叠上下文、
`overflow:hidden` 裁剪、与 z-index 分层表的契约冲突。
栏内内容仍是 `themeRegistry.winner('bottomBar')`（整体可换皮，不变）。

**顺带**：顶行补「标记 / 风格」两枚 pill（对齐参考图三枚）；加载材质由 92% 实底改 62% + 呼吸动画
（用户要的「不要黑底卡片、整块进入加载态」）；mock 两条动作参数统一成同一套。

**过程中真发现的坑**：浮层实例在不同节点间复用时只换 `id` prop，而 `NodeBottomBar` 只在 setup
读一次节点类型 → 选中图片节点却按文本节点渲染、整栏空白。修法：`BottomBarHost` 加 `:key="selectedId"`。
SSR 单测（每例新实例）照不出这条，只有真浏览器「先缩放再选中」的序列能复现。

**验证**：`plugin-bottom-bar` 32/32、`plugin-theme-default` 213/213、`canvas-render` 405/405、
`ui` 44/44、`mock-task-backend` 3/3、`node-text` 31/31、`node-image` 111/111；
UI e2e **50/50**；三个 typecheck 全过。
浏览器实测：输入区与底部工具栏重叠处点击命中 `ProseMirror` 且打字成功；素材卡常显带 1/2 角标；
点卡片出预览；`@` 菜单贴光标；拖动节点底栏跟随；加载中拖拽节点仍可移动。

**注意**：`packages/ui/e2e/canvas-e2e.mjs` 的 `BASE` 现支持 `CANVAS_PORT` 环境变量
（`vite.config` 是 `strictPort:false`，多个 worktree 同起时 5288 归属不定，写死会打到别人的代码上）。
### 最近完成（2026-10-06，Agent 对话「顺序 + 合并」+ 自带画布 MCP 锁）
