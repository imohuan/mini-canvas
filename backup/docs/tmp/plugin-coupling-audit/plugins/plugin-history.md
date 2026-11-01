# plugin-history

## 一句话

一个 71 行的兼容薄包：注册 history:undo / history:redo 两条无键命令，上架 history-facade 只读服务。撤销栈本体在 doc，不在本包。

## 清单

| 项 | 值 |
|---|---|
| 包名 | @mini-canvas/plugin-history |
| 身份 | 未声明 miniCanvas 字段（按运行环境选装） |
| 源码文件 | 2 个（plugin / index） |
| 测试文件 | 1 个，3 个用例 |
| 包依赖的其他插件 | 无 |

## 跨包 import

| 目标 | 入口 | 是否公开出口 | 证据 |
|---|---|---|---|
| canvas-base | Context / PluginModule | 是 | src/historyPlugin.ts:16 |
| canvas-data | 类型 DocService | 是 | 同上:17 |
| 其他插件 | 无 | — | 全 src 无 plugin- import |

没有 L3 硬耦合。

## 运行时协作

| 依赖 | 方式 | 必需/可选 | 证据 |
|---|---|---|---|
| doc | inject + get，undo/redo/canUndo/canRedo/undoDepth | 必需 | src/historyPlugin.ts:22、34、41-58 |
| 命令 | history:undo / history:redo，无 keys | — | 同上:37-48 |
| history-facade 服务 | ctx.inject | 对外提供 | 同上:51-60 |

关键设计点是“不注册带 keys 的撤销/重做命令”，键位交给 canvas-data 内置的 command:undo(mod+z) / command:redo(mod+shift+z)（packages/canvas-data/src/canvas/canvasCommands.ts:84-100；本包注释 historyPlugin.ts:9-11）。这条避免了同键双命令，是正确做法。

但它和 command:undo 的职责重叠是真实存在的：两套命令名都做同一件事，history:undo 没有 keys、不进快捷键面板（快捷键面板只收带 keys 的命令，packages/plugins/plugin-shortcut-manager/src/v2ShortcutManager.ts:70-73），所以用户只能从菜单/程序化调用看到它。成品 UI 的 APP_PLUGINS 明确不装本包，理由写在 packages/ui/src/assembly.ts:81-83：“history 与宿主自带的撤销栈职责重叠”。这句话就是本插件最高的风险总结。

## 全局与宿主粘连

| 对象 | 用途 | 风险 | 证据 |
|---|---|---|---|
| 无 window/document/localStorage/定时器 | — | 无 | 本包 src 检索为空 |

## 内部职责与风险

本包自己列出了内核 History 的四个缺口：无 clear、无 isRestoring、无状态变化事件、无 beginBatch/endBatch（src/historyPlugin.ts:62-67）。这些缺口没有在本包绕过，符合“薄适配”的定位。风险是服务名 history-facade 与 doc 的撤销能力形成第二入口，调用方可能不知道用哪个；目前 rg 未发现其它代码调用 history-facade。

## 单独装卸判断

可独立装卸。不装时画布仍有 command:undo/redo。装了只多两条无键命令与一个服务名，不改变任何快捷键行为。成品应用默认不装。

## 建议改法

1. 最小改动：若保留本包，在 README/文档里明确“history:undo 仅供旧宿主菜单兼容，快捷键永远走 command:undo”，避免调用方误用。
2. 中期：把 history-facade 合并进 doc 的公开查询面，或直接删包；它与宿主命令职责重叠，维护成本大于收益。
3. 验证：不需要新增行为测试；若要删包，先 rg 全仓确认无 history-facade / history:undo 调用方。

## 待验证

- 云端清单（packages/cloud-server/src/static.ts:431-437）是否仍会安装本包，取决于部署目录里的构建产物；本次只确认成品 APP_PLUGINS 不含它。
- 是否有第三方宿主依赖 history:undo 这个命令 id；本次检索未见。

