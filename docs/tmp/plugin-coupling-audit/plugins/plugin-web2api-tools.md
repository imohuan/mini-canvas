# plugin-web2api-tools

## 一句话

把 web2api 的 MCP 能力做成节点底栏动作。它只借底栏的**类型**，运行时按名取 `nodeBar`，方向基本正确；真正的耦合是底栏字段形状、结果写入器和 MCP 端点。

## 清单

| 项 | 值 |
|---|---|
| 包名 | `@mini-canvas/plugin-web2api-tools` |
| 身份 | installable |
| 源码文件 | 13（含测试；生产 9） |
| 测试文件 | 4 |
| 包依赖的其他插件 | `@mini-canvas/plugin-bottom-bar`（dependencies） |

## 跨包 import

| 目标 | 入口 | 是否公开出口 | 证据 |
|---|---|---|---|
| plugin-bottom-bar | 仅 `import type` 的 `BarRunContext`、`BarAction`、`BarApplier`、`BarRunInput` | 是包入口，但仍是插件间依赖 | `src/web2apiPlugin.ts:29-30` |
| canvas-base / canvas-data | 类型与 `DocService` | 是 | `web2apiPlugin.ts:26-28` |

## 运行时协作

| 依赖 | 方式 | 必需/可选 | 证据 |
|---|---|---|---|
| `doc` | `inject=['doc']` | 硬依赖 | `web2apiPlugin.ts:95-96` |
| `nodeBar` | `ctx.tryGet`，没有则等 `ctx:plugin-installed` | 可选 | `web2apiPlugin.ts:132-139,237-242` |
| `settings` | 读 `web2api*` 配置 | 可选 | `web2apiPlugin.ts:70-85` |
| `nodeBar.register/registerApplier` | 自定义窄接口 | 契约，但未共享类型来源 | `web2apiPlugin.ts:133-137` |

## 全局与宿主粘连

| 对象 | 用途 | 风险 | 证据 |
|---|---|---|---|
| `http://localhost:8033/mcp` | 默认 MCP 端点 | 本机地址写死 | `web2apiPlugin.ts:45-50` |
| `fetch` | MCP 请求/资源上传 | 可注入，但默认全局 | `src/mcpClient.ts:76-81` |
| `globalThis.Buffer` | 参考图 base64 | Node 环境分支；浏览器需兜底 | `src/referencePrep.ts:95-100` |
| `nodeBar` 的 `register(scope, action)` 形状 | 跨插件调用 | 底栏改签名不会被类型检查发现（这里是手写窄接口） | `web2apiPlugin.ts:133-137` |

## 内部职责与风险

1. **“只借类型”避免了运行时代码耦合**，但类型仍从底栏包导入；若底栏把类型搬到 canvas-base，这个依赖可以彻底断开。
2. **结果写入器重复**：video/audio 的 applier 在这里注册，image 的由节点图片插件注册；同一份“把 URLs 写回节点”的逻辑分散。
3. **MCP 协议自实现**：`McpClient` 负责 initialize/会话/重连，属于协议层，和画布无关；适合独立成通用 MCP 客户端。
4. **底栏动作声明字段很多**：`needsPrompt`、`fields`、`order`、`pollIntervalMs`、`resume`、`onCancel` 都要与底栏实现对齐；没有 schema 校验。

## 单独装卸判断

- 不装底栏：动作注册静默跳过，插件其余部分仍装载；用户看不到功能，只有 `tryGet` 返回空。
- 不装节点图片/视频/音频：动作仍注册，但没有对应节点类型可显示。
- 卸载：动作/写入器随作用域回收；MCP 会话没有显式关闭接口，可能需要补。

## 建议改法

1. 把底栏动作/写入器的公开类型与注册函数移到 `canvas-base` 或独立契约包，插件不再依赖 `plugin-bottom-bar` 包。
2. 把 `McpClient` 提到通用工具层，供其他 MCP 类插件复用。
3. 统一“生成结果写回节点”的 applier，减少每个节点插件的重复实现。
4. 给 `nodeBar.register` 的窄接口加共享契约测试，防止底栏改签名后静默失效。

## 待验证

- 没装底栏时插件是否应该保持 `PENDING` 而不是“装载成功但无功能”；当前选择是静默降级，需要产品决策。
- MCP 会话在插件卸载时是否有资源泄漏；当前没看到 dispose。

