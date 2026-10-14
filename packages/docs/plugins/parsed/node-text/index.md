# 文本节点 text

> 插件解析 · `@mini-canvas/plugin-node-text` · 自带件

**一句话**：提供画布上的"文本节点" —— 双击就地编辑、可复制删除、底栏里能调 AI 生成工具把结果写回节点。

本页是总览；**它注册的每一类能力各有一页**（见左侧「文本节点」下的子页）。

## 它注册了什么（全部落点）

| 种类 | 键 / 名字 | 放的是什么 | 详情 |
| --- | --- | --- | --- |
| 服务 | `text` | `TextService`：建节点 / 改文本 / 复制节点 | [服务](/plugins/parsed/node-text/service) |
| 节点类型 | `text` | 数据 + 内容组件 `TextContent.vue` + 建节点入口 | [节点类型](/plugins/parsed/node-text/node-type) |
| 命令 | `text.duplicate` / `text.delete` | 外部（快捷键 / 右键菜单 / MCP）按 id 调 | [命令](/plugins/parsed/node-text/commands) |
| 底栏动作 | 2 个即时动作 + N 个生成动作 | 底栏按钮；写入器把结果写回 `data.text` | [底栏动作与写入器](/plugins/parsed/node-text/bottom-bar) |
| `ui` 目录 | `textPreview` | 纯展示的文本预览件（**有活演示**） | [ui 目录组件](/plugins/parsed/node-text/ui-components) |
| 设置项 | `textDefaultWidth` / `textDefaultHeight` | 没被手动拖过尺寸的文本节点用它 | [设置项](/plugins/parsed/node-text/config) |

## 身份与依赖

| 项 | 值 | 来源 |
| --- | --- | --- |
| 插件名（`name`） | `'text'` | `src/nodeTextPlugin.ts` |
| 包名 | `@mini-canvas/plugin-node-text` | `package.json` |
| 硬依赖（`inject`） | `['doc']` | 同上 |
| 自带件 | `miniCanvas.builtin: true` | `package.json` |
| 产物出口 | `nodeTextPlugin: PluginModule` | `src/index.ts` |

## 注意事项

1. **它的能力都要经服务调用**：不要直接调组件方法或改 store。写数据永远走 `doc`（唯一写入口，自带历史与落盘）。
2. **`inject` 只有 `doc`**：`nodeBar` 是**插件服务**，不进 `inject`（没装底栏插件的宿主也要能正常工作）；所以底栏注册走"`tryGet` 加事件补注册"。
3. **命令与服务同名不同事**：`text.duplicate` 既是命令 id 也是底栏动作 id，它们都指向同一份实现 —— 这是刻意的，避免两条路各写一遍。
4. **创建节点时 `extra` 会丢字段**：本插件的 `create(position)` 只收位置；带数据建节点要靠调用方先建再调 `editText`（其它节点插件如 `image` / `node-ui` 已支持 `create(position, extra)`）。

