# 计划：节点 AI 能力「工具层」+ 文本/图片节点 UI 修正

日期：2026-09-12 · 状态：实施中

## 用户诉求（原话要点）
1. 图片节点下半部分参考 V1：**一个大输入框（用我的 ProseMirror 组件）+ 一些选项**，能生成图片；输入上下文来自连进来的文本节点与图片节点。
2. 把第三方 API **做成一个工具**，用我的上下文创建工具；节点操作直接使用工具；**这个工具要能在别处注册**。
3. 文本节点顶部那排加粗/颜色等**对它没有意义，删掉**；**只保留底部状态栏**；状态栏**没有居中**。
4. 文本节点中间的输入框 **UI 完全错误**，参考 V1 的实现。

## 参考实现（V1 实测）
- `packages/canvas-core/src/nodes/text/TextNode.vue`：内容区 `p-4` + **透明无边框** textarea；只读态 `whitespace-pre-wrap cursor-text`，双击进入编辑；**回车换行**（不是提交），Esc/blur 结束。
- `packages/canvas-core/src/nodes/image/ImageBottomToolbar.vue`：上游素材小卡片行 + `ProseMirrorEditor`（`@` 引用上游素材）+ 模型/比例/分辨率/模板下拉 + 发送。
- `packages/canvas-core/src/nodes/image/imageModels.ts`：模型能力声明 + `executeRun` 轮询驱动（本次抽象为内核「工具」）。
- `packages/canvas-core/src/nodes/image/backendImageModels.ts`：后台 `POST /api/tasks` + 轮询 `GET /api/tasks/:id`。

## 架构决策（主 agent 定稿，子代理不得自创）

### 1. 内核新增「工具」层（已完成，22 条测试绿）
`ctx.get('tools')` / `ctx.tools`，实现于 `packages/canvas-core-v2/src/services/toolRegistry.ts`。

| 要点 | 说明 |
|---|---|
| 与 command 的分工 | command = 画布内部动作（删/撤销/建节点）；tool = 拿画布上下文调**外部能力** |
| 注册 | `ctx.tools.register(def)`，随插件 scope 自动回收；同名重复抛错 |
| 声明式参数 | `ToolParamDef[]`（select/string/number/boolean）→ **节点 UI 自动渲染控件**，加参数不用改节点 |
| 产出/输入声明 | `produces` / `accepts` → 节点据此筛选"能给我出图的工具"，**节点不认识任何模型名** |
| 调用 | `ctx.tools.invoke(name, input, { ctx, onProgress, interval, timeoutMs })`，同步结果与轮询两种形态归一化，异常/超时收敛成 `{ok:false,error}` |
| 加新模型 | 装一个注册了新工具的插件即可，节点与内核零改动 |

### 2. 分层
```
内核: tools 注册表（纯逻辑，headless 可测）
  ↑ ctx.tools.register
工具插件: plugin-tool-image-generation —— 第三方 HTTP API → 工具（可配置 baseUrl / 可注入 fetch）
  ↑ ctx.tools.list({produces:'image'}) / ctx.tools.invoke
节点插件: plugin-node-image 底部生成面板（ProseMirror 输入 + 参数 + 发送）
```

## 任务划分（文件 owner 唯一，避免并行冲突）

| # | owner | 范围 | 内容 |
|---|---|---|---|
| A | 子代理 | `packages/plugins/plugin-node-text/**` | 删顶部工具栏；内容区按 V1 重做；底部状态栏居中 |
| B | 子代理 | `packages/plugins/plugin-node-image/**` | 底部生成面板：素材卡片 + ProseMirror 输入 + 工具参数 + 发送 |
| C | 子代理 | `packages/plugins/plugin-tool-image-generation/**`（新建） | 第三方图片生成 API → 工具；可在别处注册 |
| D | 主 agent | `packages/canvas-core-v2/**`、`packages/ui/**`、`docs/**` | 内核工具层（已完成）、宿主装配、文档、集成验收 |

## 验收
- 各包 vitest 全绿 + `tsc --noEmit`；`packages/ui` `vue-tsc` 干净、`vite build` 通过。
- 节点不认识模型名：图片节点只经 `ctx.tools.list({produces:'image'})` 取工具。
- 工具可在别处注册：工具插件同时导出 PluginModule 与工厂函数。
- 文本节点：无顶部工具栏；内容区透明无边框就地编辑；底部状态栏水平居中。
