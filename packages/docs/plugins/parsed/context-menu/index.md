# 右键菜单 context-menu

> 插件解析 · `@mini-canvas/plugin-context-menu` · 自带件

**一句话**：在画布空白、节点、连线上点右键弹出的菜单 —— 空白处新建节点、节点上删除、连线上删除；
它还把**拖线落到空白处**变成一张"连线菜单卡"（直接选要连到哪种节点）。

## 它注册了什么（全部落点）

| 种类 | 键 / 名字 | 放的是什么 | 详情 |
| --- | --- | --- | --- |
| 节点类型 | `connection-menu` | 拖线落空白时放的**占位菜单卡**（一个真节点） | [节点类型](/plugins/parsed/context-menu/node-type) |
| 主题槽 | `nodeShell:connection-menu` | 这张卡的专属外壳（整体就是一张菜单，无标题条） | [节点类型](/plugins/parsed/context-menu/node-type) |
| 命令 | `context-menu:delete-node` / `context-menu:delete-edge` | 菜单里的内置项 | [命令](/plugins/parsed/context-menu/commands) |
| 监听的事件 | `RenderEvents.ContextMenuPane/Node/Edge`、`ConnectionDropBlank` 等 | 右键与落线的事件源 | [事件](/plugins/parsed/context-menu/events) |
| 设置项 | `dragThreshold` | 拖多少像素才算"真在拖线" | [设置项](/plugins/parsed/context-menu/config) |

## 身份与依赖

| 项 | 值 | 来源 |
| --- | --- | --- |
| 插件名（`name`） | `'context-menu'` | `src/contextMenuPlugin.ts` |
| 包名 | `@mini-canvas/plugin-context-menu` | `package.json` |
| 硬依赖（`inject`） | `['doc', 'selection', 'nodeFactory']` | 同上 |
| 自带件 | `miniCanvas.builtin: true` | `package.json` |

## 注意事项

1. **菜单项不是写死的**：它按命令的 `areas` 收命令（`'node'` / `'pane'` / `'edge'`），
   所以**别的插件注册一条带 areas 的命令，右键菜单就自动多一项** —— 这就是它作为"通用接缝"的价值。
2. **菜单卡是一个真节点**：经 `nodeStore` → VueFlow 渲染，位置 / 尺寸 / 缩放全由画布负责。
3. **`dragThreshold` 存在的理由**：从端口按下后没拖动就松手（等于点了一下端口）不该弹菜单。

