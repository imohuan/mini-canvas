# 计划：web2api 底栏插件（图片 / 音频 / 视频）

日期：2026-09-29　分支：`codex/web2api-bottom-bar`（基于 8827247）

## 1. 要解决的问题

用户有一个自建服务 **web2api**（`D:\\Code\\Git\\web2api`），把豆包 / dola / seedance /
火山引擎等平台封装成 **MCP 工具**。要在 mini-canvas 里通过该 MCP 中转，把这些平台能力做成
**节点底部控制栏的可视化 UI**，覆盖 **图片 / 音频 / 视频** 三类节点。

用户点名：

- 图片与视频走 **dola 与豆包的 UI 自动化（auto）模式**：`doubao/chat-auto` / `dola/chat-auto`；
- 配置**写死在插件里**（不运行时问服务端），执行时**以调用 MCP 工具**的方式跑；
- **按能力显隐**：动作只声明它真支持的参数，合并下拉里就只出现这些；
- **按参数类型映射到预设组件**（ratio / duration / resolution / style / model / count / speaker / format / speed…）；
- UI 对齐参考站版式：合并下拉里的内容是「**分组标题 + 选项按钮网格**」。

## 2. 事实基线（已实测，不重复挖掘）

### 2.1 web2api MCP 表面（执行契约）

- Streamable HTTP，`http://localhost:8033/mcp`，协议 `2024-11-05`；`initialize` 拿
  `mcp-session-id` 响应头，之后每个请求都带该头（不带 → `-32002`）。
- 工具名 `{platform}/{operation}`；每个平台工具第一个必填参数是 `cookieId`。
- 同步操作阻塞等待（最长 30 分钟）；异步操作立即返回 `taskId`（`structuredContent.taskId`），
  用 `system/get-task`（参数 `taskId`）查进度；`structuredContent.resources[].downloadUrl`
  或 `content[]` 里的 `resource.uri`（**相对地址**）拼 origin 才是可访问 URL。
- `tools/list` 返回里带 `_meta.baseUrl`，用作相对地址的 origin 兜底。

### 2.2 真实工具与参数（tools/list 实测，权威）

| 工具 | 类别 | 关键参数（含枚举与默认） |
|---|---|---|
| `doubao/chat-auto` | 图片+视频 | 只有 `prompt`（/image、/video 前缀带括号参数）+ `referenceImages` |
| `dola/chat-auto` | 图片+视频 | 同上 |
| `doubao/generate-image` | 图片（同步） | prompt、ratio(1:1/2:3/3:4/4:3/9:16/16:9,默认1:1)、style(32 种)、model(Seedream 5.0 Pro/5.0 Lite/4.5/4.0,默认4.5) |
| `doubao/generate-video` | 视频（异步） | prompt、ratio(auto/1:1/3:4/4:3/9:16/16:9/21:9,默认auto)、duration(4-15,默认10)、camera*、model(seedance_v2.0_mini/seedance_v2.0) |
| `seedance/generate-video` | 视频（异步） | model(fast/2.0)、prompt、duration(4-180,默认5)、ratio(16:9/9:16) |
| `doubao/tts` | 音频（同步，不开浏览器） | text、speaker(音色枚举,默认 zh_female_xiaohe_conversation_wvae_bigtts) |
| `volcengine/generate-audio` | 音频（同步） | text、model(seed-audio-1.0)、speaker(可选 string)、referenceAudios、format(wav/mp3/ogg_opus)、sampleRate、speechRate、loudnessRate、pitchRate |

chat-auto 前缀指令：`/video({model:"Seedance 2.0 Fast", ratio:"16:9", durationSec:10}) 正文`、
`/image({model:"Seedream 4.5", ratio:"16:9"}) 正文`。

- 豆包 chat-auto 视频：模型 `Seedance 2.0 Fast` / `Seedance 2.0 Mini`；比例 自动/4:3/9:16/3:4/16:9/1:1/21:9；时长 4-10s。
- 豆包 chat-auto 图片：模型 `Seedream 5.0 Lite` / `4.5` / `4.0`；比例 自动/9:16/3:4/1:1/4:3/3:2/16:9。
- dola chat-auto 视频：模型 `Seedance 2.5` / `2.0` / `1.0`；比例 1:1/3:4/4:3/9:16/16:9/21:9；**时长只有 5 / 10 两档**。
- dola chat-auto 图片：模型 `Seedream 5.0 Pro` / `Seedream 4.5`；比例 1:1/2:3/3:4/4:3/9:16/16:9。

**这三条的差异就是「按能力显隐」的现成例子**：dola 视频时长两档（按钮网格）、豆包到 10s、
豆包 generate-image 多一个 style。

### 2.3 mini-canvas 侧扩展点（已读过源码）

- 底栏动作：`registerBarAction(ctx, action)`；`BarAction` 见
  `packages/plugins/plugin-bottom-bar/src/barTypes.ts`（id/types/title/fields/needsPrompt/
  promptBinding/apply/order/run/resume）。`run` 可返回同步 `ToolResult` 或**轮询函数**。
- 参数声明：`ToolParamDef`（`packages/kernel/src/toolRegistry.ts`）已有
  `component`（opaque 自定义组件句柄）+ `componentProps` —— 这就是「类型映射到预设组件」的落点。
- 渲染链：`NodeBottomBar.vue`（默认皮）→ `ToolParamGroup.vue`（合并下拉）→
  `ToolParamField.vue`（逐项渲染，支持 `component` 与内置 `type` 两条路径）。
- 结果写入器：`registerBarApplier(ctx, kind, fn)`；image / text 已有；
  **video 没有 applier**（node-video 只发布动作）；`audio` 节点类型**尚不存在**。
- 装配清单：`packages/ui/src/assembly.ts` 的 `APP_PLUGINS`。
- T08 守卫：业务插件**不得** import `plugin-theme-default`（连 type-only 值导入都不行）——
  所以「预设组件」必须住在 theme-default（或 canvas-render 契约层），由主题目录分发。

## 3. 设计

### 3.1 分层（谁提供什么）

```
packages/plugins/plugin-web2api-tools     业务插件：预置配置表 + MCP 客户端 + 动作注册
packages/plugins/plugin-theme-default     预设组件（ToolParamGrid / ToolRatioGrid 等）+ 类型映射渲染
packages/kernel                          ToolParamDef 新增 kind（参数语义类型，纯类型扩展）
```

### 3.2 「按类型映射预设组件」这条线怎么通

1. 内核 `ToolParamDef` 新增可选字段 **`kind`**（`'ratio'|'quality'|'resolution'|'background'|'count'|
   'duration'|'model'|'style'|'speaker'|'format'|'speed'|'camera'...`），语义 = 「这个参数是哪一类」。
2. theme-default 新增预设组件并把 `kind` → 组件做成映射（**集中在一处**，见 3.3）。
3. `ToolParamField` 看到 `kind` 且有对应预设组件 → 走预设组件；否则回落内置 `type` 控件。
   这样 web2api 插件**只声明 `kind`**，零 theme-default 依赖，换主题时预设组件跟着换。

### 3.3 预设组件（照参考站实测数值；已实现）

| kind | 组件 | 形态 |
|---|---|---|
| `ratio` | `ToolRatioGrid` | 5 列网格；每格 = 17×17 图标位（内含按真实宽高比绘制的 12×12 描边矩形，1.5px 边、圆角 2）+ 12px 文案 |
| `quality`/`resolution`/`background`/`count`/`camera` | `ToolParamGrid` | 3 列网格；按钮 100×32、圆角 8、1px 边、透明底；选中 = 主题 hover-strong 底 |
| `duration`（取值少、非连续） | `ToolParamGrid`（同上） | dola 的 5/10 两档 |
| `duration`（连续） | `ToolParamSlider` | 滑块 + 值 + 单位 |
| `model`/`speaker`/`style`/`format`（选项多） | 内置下拉 | 保持现有 `Select` |

落地件（都在 `plugin-theme-default/src/components/ui/`）：
`ToolOptionGrid.vue`（标题 + 按钮网格）、`ToolRatioGrid.vue`（比例网格 + 按真实宽高比画的
描边矩形，解析不出时画虚线方框）、`ToolParamSlider.vue`（滑块 + 值 + 单位）、
`paramKind.ts`（**判定表**：kind → ratio/grid/slider/回落，纯函数可单测）。

`ToolParamField.vue` 的渲染顺序：作者 component → resolvePresetKind 命中的预设件 →
内置 type 控件。四个预设件登记进 ui 目录（toolParamGrid / toolParamRatio /
toolParamSlider），业务插件按名取（T08 守卫禁止业务插件 import 主题包）。

面板容器（`ToolParamGroup` 的浮层内部）：**有预设块时**切成整块版式 ——
面板宽 342 / 圆角 16 / padding 12 / 块间 gap 8（照参考站实测）；每块 = 标题 20px 弱化色 + 网格。
没有预设块的动作仍走原来的「标签 + 控件」一行式。**配色一律走主题 token**，不写死。

触发器（底栏那一行的 16:9 · 标准画质 ⌄）保持原样，这次只改点开之后的面板内容。

### 3.4 预置配置表（插件内写死，服务端不可用也能渲染）

`presets.ts` 声明每个动作：`{ id, platform, tool, kinds, nodeType, title, fields, promptMode }`。

| 动作 | 节点 | 工具 | 参数（kind 语义） |
|---|---|---|---|
| 豆包图像（auto） | image | `doubao/chat-auto` | model(image)、ratio |
| dola 图像（auto） | image | `dola/chat-auto` | model(image)、ratio |
| 豆包生图 | image | `doubao/generate-image` | model、ratio、style |
| 豆包视频（auto） | video | `doubao/chat-auto` | model(video)、ratio、duration(滑块 4-10) |
| dola 视频（auto） | video | `dola/chat-auto` | model(video)、ratio、duration(网格 5/10) |
| 豆包文生视频 | video | `doubao/generate-video` | model、ratio、duration(滑块 4-15)、camera |
| Seedance 文生视频 | video | `seedance/generate-video` | model、ratio(16:9/9:16)、duration(滑块 4-180) |
| 豆包语音合成 | audio | `doubao/tts` | speaker |
| 火山引擎音频 | audio | `volcengine/generate-audio` | model、format、speaker(可选)、speed(语速)、pitch(音调) |

chat-auto 的两条：`promptMode='chat-auto'`，执行时把已选参数按 3.5 拼成前缀指令。

### 3.5 chat-auto 前缀拼装（纯函数，可单测）

`buildChatAutoPrompt({ mode:'video'|'image', model?, ratio?, durationSec? }, body) → string`。
参数按平台差异过滤（该平台不支持的键直接丢弃），比例/时长原样写进括号；正文为空时只留前缀。

### 3.6 执行与错误态

- `mcpClient.ts`：单会话（惰性 initialize + 记住 session id）、`callTool(name, args)`、
  `getTask(taskId)`；所有网络异常收敛成 `{ok:false,error:'web2api 连接失败：…'}`。
- 同步动作 → 解析 content → 返回 `{ok,urls,text}`。
- 异步动作 → 返回 `{ok, taskId}` 并**返回轮询函数**（调 `system/get-task`，completed → urls）。
- 结果写入器：插件注册 `video` 与 `audio` 两个 applier（image 用既有 applier）。
- `cookieId` 从 **插件配置**读（`web2apiCookieId`，默认空串 → run 时明确报「请先在设置里填 cookieId」）。
- 服务没起：动作 run 立刻返回清晰错误 → 底栏 status 行显示红字（不静默）。

### 3.7 audio 节点类型（已实现）

mini-canvas 无 audio 节点。本插件注册 `audio` 类型（`AudioContent.vue` 播放 + 占位；
输出口 `contentType:'audio'`；输入口收 text/audio）。applier 写 `data.audioUrl`。
装配位置：`pluginBottomBar` 之后、与节点插件并列。

### 3.8 执行参数的两种走法（已实现）

- `promptMode='chat-auto'`（图片/视频的 auto 四条）：`buildChatAutoPrompt` 把
  model/ratio/durationSec/style 拼成前缀，其余参数不发送；
- `promptMode='plain'`（豆包生图/文生视频、seedance、两个音频）：参数直接当工具参数传，
  文本参数名按平台取（音频是 `text`，图像/视频是 `prompt`）。

异步任务的轮询由 `makeTaskPoll` 造（run 与刷新续查**同一份**实现），超时读设置
（`web2apiTimeoutMs`，默认 30 分钟）——底栏共享组件的 5 分钟默认超时对视频生成太短。

## 4. 交付清单

1. 本计划文档。
2. `packages/kernel/src/toolRegistry.ts`：`ToolParamDef.kind?`（纯类型扩展，含注释）。
3. theme-default：`ui/ToolParamGrid.vue`、`ui/ToolRatioGrid.vue`、`ui/ToolParamSlider.vue`、
   `ui/paramKind.ts`（kind → 组件映射）、`ToolParamField.vue` 接 `kind`、`index.ts` 登记进 ui 目录。
4. `packages/plugins/plugin-web2api-tools`：`config.ts` / `presets.ts` / `chatAutoPrompt.ts` /
   `mcpClient.ts` / `mcpParse.ts` / `AudioContent.vue` / `web2apiPlugin.ts` / `index.ts`。
5. 单测：presets 契约、kind 映射、chat-auto 前缀、MCP 请求/响应解析（node 环境）。
6. 渲染契约测试：预设组件 + ToolParamField 的 SSR HTML 断言（含「按能力显隐」）。
7. `packages/ui/src/assembly.ts` 加装配；`packages/ui/package.json` 加依赖。
8. 真实 UI 验证（5296 + Playwright 截图 + view_image）；协议层用真实 MCP 跑通。

## 5. 验证

```bash
pnpm -C packages/plugins/plugin-web2api-tools test
pnpm -C packages/plugins/plugin-web2api-tools typecheck
pnpm -C packages/plugins/plugin-theme-default test
pnpm -C packages/plugins/plugin-bottom-bar test
pnpm -C packages/kernel test
pnpm -C packages/ui test
pnpm -C packages/ui typecheck
```

真实链路：起 `packages/ui` dev（5296）→ 选中三类节点 → 截图核对（含按能力显隐）→
真实 MCP 调用（volcengine/generate-audio 或 doubao/tts 最小任务）。

## 6. 红线

- 不碰 `plugin-theme-default/src/components/node/` 六件核心节点件、根 `src/`、`packages/canvas-core`。
- 不碰 `.scratch/`、`docs/research/`、`docs/plans/2026-09-29-canvas-z-layers.md`。
- 所有文件编辑用 apply_patch；不 git push。
