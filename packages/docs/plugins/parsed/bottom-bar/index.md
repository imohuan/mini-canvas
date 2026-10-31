# 底部状态栏 bottom-bar

> 插件解析 · `@mini-canvas/plugin-bottom-bar` · 自带件

**一句话**：节点卡片下面那条状态栏就是它 —— 它同时提供**可替换的底栏皮**、**注册式动作**（谁都能往底栏塞按钮）、
**任务进度覆盖层**（跑生成时的进度与取消），三件事合在一件里。

> 关键设计：**底栏动作 = 一条"拿上下文调一个能力、拿回产物"的东西**，与内核 `ctx.tools` 里的生成工具本来就是同一件事。
> 所以"加一个模型 = 装一个工具插件"，底栏不用改一行。

## 它注册了什么（全部落点）

| 种类 | 键 / 名字 | 放的是什么 | 详情 |
| --- | --- | --- | --- |
| 服务 | `nodeBar` | `NodeBarService`：读动作 / 读写入器 / 读节点态；写走注册糖 | [服务](/plugins/parsed/bottom-bar/service) |
| 服务 | `nodeTask` | `NodeTaskService`（插件内部）：跑任务 / 取消 / 刷新续查；外部走 `canvas.runBarAction` | 同上 |
| 注册糖 | `registerBarAction` / `registerBarApplier` / `publishToolActions` | 别的插件的**作者入口** | [注册糖](/plugins/parsed/bottom-bar/registry) |
| 注册场 | `node/bar` | 动作表（`actions/*`）+ 写入器表（`appliers/*`） | 同上 |
| UI 槽 | `overlay` × 3 | 底栏宿主 / 参考选择态 / 全屏媒体预览 | [UI 插槽](/plugins/parsed/bottom-bar/slots) |
| 节点区域 | `*/over:inset` | 任务进度覆盖层（通配所有节点类型） | 同上 |
| 主题槽 | `bottomBar` | 默认底栏皮 `NodeBottomBar` | [主题槽](/plugins/parsed/bottom-bar/slots) |

## 身份与依赖

| 项 | 值 | 来源 |
| --- | --- | --- |
| 插件名（`name`） | `'bottom-bar'` | `src/nodeBarPlugin.ts` |
| 包名 | `@mini-canvas/plugin-bottom-bar` | `package.json` |
| 硬依赖（`inject`） | `['doc', 'nodeRegistry', 'themeRegistry']` | 同上 |
| 自带件 | `miniCanvas.builtin: true` | `package.json` |
| 产物出口 | `pluginBottomBar: PluginModule` | `src/index.ts` |

> **装配顺序很重要**：底栏插件必须在**三个节点插件之前**装载 —— 节点插件 `apply` 时 `nodeBar` 已在，
> 才能走"取得到就注册"的快路径（否则要等 `ctx:plugin-installed` 事件补注册）。

## 注意事项

1. **底栏挂在画布 UI 槽，不挂在节点里**：节点带 `transform` 必然成层叠上下文，底栏住在节点里就压不过外壳底部工具栏（`.shell-dock` z-index:30），输入区点击会被截走（实测复现）。
2. **写一律走注册糖、条目归注册方**：服务是共享单实例（`this.ctx` 恒为 bottom-bar 的 scope），所以它的**写面**方法都要收一个"调用方的 scope"参数，别人的动作才挂在自己名下、卸载时摘得掉。
3. **一个 kind 只能一个写入器**：`registerBarApplier` 对同 kind 重复注册会**抛错**。

