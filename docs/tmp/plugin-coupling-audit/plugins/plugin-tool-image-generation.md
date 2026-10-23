# plugin-tool-image-generation

## 一句话

把图片生成后台包装成 `ctx.tools` 条目。它和节点 UI 分开了，方向是对的；问题在后台地址、HTTP 路径和“谁发布成底栏动作”仍靠约定。

## 清单

| 项 | 值 |
|---|---|
| 包名 | `@mini-canvas/plugin-tool-image-generation` |
| 身份 | installable |
| 源码文件 | 7（含测试；生产 4） |
| 测试文件 | 2：`imageGenerationTools.test.ts`、`pluginLifecycle.test.ts` |
| 包依赖的其他插件 | 无 |

## 跨包 import

| 目标 | 入口 | 是否公开出口 | 证据 |
|---|---|---|---|
| canvas-base | `ConfigSchema`、`PluginModule` | 是 | `src/imageGenerationPlugin.ts:15` |
| kernel | `ToolDef` 类型（经 canvas-base 转出） | 是 | `src/imageGenerationTools.ts:18` |

## 运行时协作

| 依赖 | 方式 | 必需/可选 | 证据 |
|---|---|---|---|
| `tools` | `inject=['tools']`，`ctx.tools.register` | 硬依赖（内核恒在） | `imageGenerationPlugin.ts:34-35,82` |
| `settings` | 读 `imageGen*` 配置 | 可选 | `imageGenerationPlugin.ts:77-91` |
| 后台 `/api/tasks`、`/api/tasks/:id`、`/api/models` | HTTP | 运行时必需 | `imageGenerationTools.ts:221-261,400` |
| 底栏 `nodeBar` | 不直接调用；由节点插件 `publishToolActions` 消费 | **间接契约** | `plugin-bottom-bar/src/toolActions.ts:45-83` |

## 全局与宿主粘连

| 对象 | 用途 | 风险 | 证据 |
|---|---|---|---|
| `globalThis.fetch` | 默认网络实现 | 可注入，但默认绑全局 | `imageGenerationTools.ts:115-119` |
| `DEFAULT_BASE_URL = http://127.0.0.1:8765` | 默认后台 | 本机端口写死；远程部署必须改配置 | `imageModels.ts:87-88` |
| `/api/tasks`、`/api/models` | 与服务端共享的暗协议 | 与文本生成插件各写一份，路径漂移无编译错误 | `imageGenerationTools.ts:9-11` |

## 内部职责与风险

1. **工具与 UI 已解耦**：插件不 import 节点包，节点包也不 import 它；通过 `tools.list({produces:'image'})` 发现工具。这是正确的注册场协作。
2. **两套生成插件重复**：图片与文本各有一份 `resolveFetch`、`fetchWithTimeout`、`registerFromBackend`、HTTP 错误文案；改一处协议要改两份。
3. **默认模型表内置在插件**：`imageModels.ts` 仍有 5 个模型；与“后台模型表”双源，开启后台表后只补不删，旧模型会一直留着。
4. **模型名与 MCP 工具名同文件混装**：`mcpTool`/`mcpModel` 是外部平台标识，属于网络适配层，和 UI 模板/参数混在一个数据文件。

## 单独装卸判断

- 只装工具插件、不装图片节点：工具注册成功，但没有界面消费它；`ctx.tools.list` 能看到。
- 装图片节点、不装工具：图片节点仍可显示/编辑，生成面板没有“图片生成”动作。
- 卸载：`ctx.tools.register` 随作用域回收；不会删除已生成文件。

## 建议改法

1. 抽一个 `generation-backend` 契约（任务提交/查询/模型表的纯接口 + 一份 fetch 实现），图片和文本插件各自只提供模型与参数声明。
2. 默认地址改为设置项必填或由公共“服务地址”提供，不在模型表里写死端口。
3. 后台模型表与内置表合并策略写清：是否需要“后台为准、内置补缺”，并补一条同名覆盖测试。
4. 把外部平台标识移到独立适配文件，模型参数/UI 模板保持纯数据。

## 待验证

- `registerFromBackend` 只补不删的行为是否符合用户预期；需要看真实后台返回的模型集合。
- 工具注册与底栏发布的顺序在热装时是否稳定；当前靠 `ctx:plugin-installed` 事件重同步。

