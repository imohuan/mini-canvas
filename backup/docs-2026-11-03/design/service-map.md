# 服务与注册场现状

日期：2026-10-31。本文是当前代码的对照表，不写历史方案。设计背景见
[core-layers-and-registry.md](./core-layers-and-registry.md)。

## 一、基础服务只剩 7 个

`ctx.injectedServices()` 只列宿主与基础插件放进服务表的名字。`tools` 是内核内置，
不出现在这个数组里，但 `ctx.get('tools')` / `ctx.hasService('tools')` 仍然可用。

| 服务 | 归谁 | 一句话 |
| --- | --- | --- |
| `tools` | kernel | 外部能力注册表 |
| `doc` | canvas-data | 节点、边、事务、撤销、快照、订阅 |
| `selection` | canvas-data | 选中集 |
| `save` | canvas-data | 存储；`save.settings`、`save.autoSave` 是它的子对象 |
| `resources` | canvas-data | Blob / object URL 生命周期 |
| `view` | canvas-render | 节点几何 + 视口 + 唯一取景算法 `fitTo` |
| `canvas` | canvas-render | 建节点、选中、取景、模式、打组、提示、底栏动作、命令执行 |

另有一个渲染层辅助服务 `nodeToolbar`：节点上下状态栏的会话与模式注册。
它不算基础七名，但宿主会注入，插件可按名取。

### 不再按名可取

`nodeLayout`、`viewport`、`tip`、`notify`、`pluginManager`、`nodeFactory`、
`command`、`settingsPersist`、`auto-save`、`nodeRegistry`、`themeRegistry`。

| 旧名 | 现在怎么用 |
| --- | --- |
| `nodeLayout` / `viewport` | `ctx.get('view')` |
| `tip` / `notify` | `ctx.get('canvas').notify(...)` |
| `nodeFactory` | `ctx.get('canvas').createNode(...)` / `creatableTypes()` |
| `command` | `ctx.commands.register` 注册；`canvas.runCommand / listCommands` 执行与枚举 |
| `nodeRegistry` / `themeRegistry` | 宿主句柄 `host.nodeRegistry` / `host.themeRegistry`，插件用 `ctx.nodes` / `ctx.theme` 糖 |
| `settingsPersist` | `ctx.get('save').settings` |
| `auto-save` | `ctx.get('save').autoSave` |
| `pluginManager` | `useCanvasRender().host.manager` |

## 二、生产注册场共 11 个

| 场 | 键 | 值 | 谁在读 |
| --- | --- | --- | --- |
| `command` | 命令 id | `CommandDef` 或 `{ def }` | 菜单、快捷键、`surface()` |
| `node/shell` | 节点 type 或 `*` | 壳组件 | 节点壳装配 |
| `node/region` | `<type>/<region>` | `{ component, props, needs, order }` | 节点区域渲染 |
| `node/bar` | `actions/<id>`、`appliers/<kind>` | 底栏动作 / 结果写入器 | 底栏 |
| `selection/region` | 区域词 | 区域组件 | 多选框 |
| `ui` | 组件名 | 设计系统组件 | 其它插件 |
| `capability` | 能力名 | 工厂函数 | `useCapabilities()` |
| `tool` | 工具名 | `ToolSpec` | 模型调用方 |
| `clipboard/copy` | `copy`、`cut` | 写剪贴板处理器 | 宿主原生 copy / cut |
| `clipboard/paste` | `paste` | 粘贴处理器 | 宿主原生 paste |
| `media/creator` | 媒体 kind | 媒体创建器 | media 能力 |

已删除：`node/type`、`node/creator`、`setting`、`theme`、`slot`；`node/bar-applier`
已并进 `node/bar` 的 `appliers/<kind>` 键。

删除原因：这些场在生产代码里没有读方。真实数据仍在 `doc` 的类型表、内部节点工厂、
`SettingsStore`、`ThemeRegistry`、`SlotRegistry` 里。留着第二份写入只会让人误以为
「写进这个场就会生效」。

## 三、取景参数怎么选

| 你想要的效果 | 参数 |
| --- | --- |
| 整块内容放进视口，留一点边 | `padding`（缺省 0.1） |
| 内容高度占视口一半左右 | `heightRatio: 0.5` |
| 只平移，缩放不动 | `keepZoom: true` |
| 固定缩放 | `zoom` |
| 已经看得见就不要动 | `onlyIfOutOfView: true`，必要时给 `margin` |
| 顺带选中目标 | `select: true`（由 `canvas.focus` 处理） |
| 把底栏算进可视区 | `includeBars: 'bottom'` 或 `'both'` |
| 逐帧调用，不要动画 | `animate: false` |

## 四、`canvas` 动作

建节点、列可建类型、选中、聚焦、进出模式、打组、通知、跑/取消底栏动作，
以及 `runCommand / listCommands / hasCommand` 和快捷键改键接口。详细签名看
[canvas 服务](/services/canvas)。

## 五、命令与插件管理器

插件注册命令用 `ctx.commands.register(def)`。执行与枚举用
`ctx.get('canvas').runCommand / listCommands`。`ctx.surface().commands` 仍会列出
基础插件注册的四条画布命令，因为它们也写进了 `command` 场。

插件 `apply(ctx, config)` 拿不到宿主句柄。页面经 `useCanvasRender().host.manager`
取统一安装句柄；插件管理服务通过 `bindManager(manager)` 完成接线。
`pluginManager` 不再作为服务名恢复。
