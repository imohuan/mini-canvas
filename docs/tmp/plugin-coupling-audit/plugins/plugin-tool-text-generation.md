# plugin-tool-text-generation

## 一句话

文本生成工具插件，结构与图片生成插件同构。它与节点包解耦得较好，主要风险是与图片侧重复的 HTTP 协议和默认后台地址。

## 清单

| 项 | 值 |
|---|---|
| 包名 | `@mini-canvas/plugin-tool-text-generation` |
| 身份 | installable |
| 源码文件 | 7（含测试；生产 5） |
| 测试文件 | 1：`textGenerationTools.test.ts` |
| 包依赖的其他插件 | 无 |

## 跨包 import

| 目标 | 入口 | 是否公开出口 | 证据 |
|---|---|---|---|
| canvas-base | 类型与 `Config` | 是 | `src/textGenerationPlugin.ts:16` |

## 运行时协作

| 依赖 | 方式 | 必需/可选 | 证据 |
|---|---|---|---|
| `tools` | `inject=['tools']` | 硬依赖（内核恒在） | `textGenerationPlugin.ts:32-33` |
| `settings` | `textGen*` 配置 | 可选 | `textGenerationPlugin.ts:69-84` |
| 后台 `/api/tasks`、`/api/models` | HTTP | 运行时必需 | `textGenerationTools.ts:13-15,168-208,338` |

## 全局与宿主粘连

| 对象 | 用途 | 风险 | 证据 |
|---|---|---|---|
| `globalThis.fetch` | 默认网络实现 | 可注入，但默认全局 | `textGenerationTools.ts:92-97` |
| `DEFAULT_BASE_URL = http://127.0.0.1:8765` | 默认后台 | 与图片侧重复，改端口要改两处 | `textModels.ts:14-15` |
| `/api/tasks`、`/api/models` | 暗协议 | 无共享类型/常量 | `textGenerationTools.ts:13-15` |

## 内部职责与风险

1. **职责单一**：只注册工具，不含节点 UI；文本节点通过 `ctx.tools` 取工具。
2. **重复实现**：`resolveFetch`、`fetchWithTimeout`、`registerFromBackend` 与图片侧几乎同构，错误文案也各自维护。
3. **内置模型与后台模型双源**：默认 3 个模型；开启后台表后只补不删，旧模型仍可用。
4. **测试偏少**：只有一个测试文件，生命周期/卸载覆盖弱于图片侧（图片侧有 `pluginLifecycle.test.ts`）。

## 单独装卸判断

- 只装工具、不装文本节点：无 UI 消费，工具表可用。
- 装文本节点、不装工具：节点编辑可用，生成动作缺失。
- 卸载：工具回收干净，已生成文本仍在节点数据里。

## 建议改法

1. 与图片侧共用同一份生成后台适配层，避免协议漂移。
2. 默认地址上移到公共设置，插件只声明“我需要一个生成后台”。
3. 补一条生命周期测试，至少覆盖“装载后注册、卸载后摘除、重复装载不误删他人工具”。
4. 模型表合并策略写成明确规则并加测试。

## 待验证

- 文本工具目前是否真的被底栏发布；如果只有节点侧调用，需要明确说明这条链路。
- `inject=['tools']` 在纯 kernel 环境恒在，但画布设置服务的生命周期是否可能晚于插件 apply。

