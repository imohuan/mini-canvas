# plugin-align-arrange

## 一句话

选中节点做边缘对齐、等距分布、Ctrl+方向键紧凑排列。算法纯函数、写回只走 doc，边界干净。

## 清单

| 项 | 值 |
|---|---|
| 包名 | @mini-canvas/plugin-align-arrange |
| 身份 | installable（package.json miniCanvas.installable=true，无 builtin） |
| 源码文件 | 4 个（alignArrangePlugin / arrangeEngine / compactArrange / index） |
| 测试文件 | 3 个，24 个用例（rg -c 统计） |
| 包依赖的其他插件 | 无 |

## 跨包 import

| 目标 | 入口 | 是否公开出口 | 证据 |
|---|---|---|---|
| canvas-base | 类型 ConfigSchema / Context / InferConfig / PluginModule | 是（公开类型） | packages/plugins/plugin-align-arrange/src/alignArrangePlugin.ts:15 |
| canvas-data | 类型 DocService / SelectionService / CanvasNode | 是 | packages/plugins/plugin-align-arrange/src/alignArrangePlugin.ts:16 |
| 其他插件 | 无 | — | 全 src 无 @mini-canvas/plugin- import |

没有 L3 硬耦合。

## 运行时协作

| 依赖 | 方式 | 必需/可选 | 证据 |
|---|---|---|---|
| doc | inject + ctx.get('doc') | 必需 | src/alignArrangePlugin.ts:27、83 |
| selection | inject + ctx.get('selection') | 必需 | 同上:27、84 |
| nodeLayout | ctx.tryGet('nodeLayout') | 可选，缺失回落 size 或 200x100 | 同上:86、108-112 |
| settings | ctx.tryGet('settings') | 可选，每次命令现读 | 同上:90-105 |
| 命令 | ctx.commands.register，10 条 | — | 同上:180-257 |

它和 plugin-auto-layout 有两处隐式约定：设置分组同住「布局/自动布局方向」（alignArrangePlugin.ts:55），字段前缀 alignArrange 用于避开全局键撞名（同文件:44-45 注释）。这两个插件互不 import，也没有服务依赖。设置项同住一格会让用户以为改一个值对两边都生效，实际各读各的键。

撞名的实际后果：canvas-data 的 declareConfig 先判断 `settings.has(key)`，已存在就跳过该项，只在 dev 下 warn（packages/canvas-data/src/canvas/capabilityLayer.ts:94-117）。插件仍能装配，但后声明者的这个设置项不生效。注释里“静默丢弃”的说法在运行期基本准确，只是 dev 下会有一条告警。

快捷键风险：align-arrange 的 4 条 Ctrl+方向键（:229-253）与 VueFlow 画布平移/方向键手势同域。CanvasHost 的 keydown 只排除 input/textarea/contentEditable（packages/canvas-render/src/host/CanvasHost.vue:1071-1072），没有排除画布内有焦点或无选中时的情况；无选中时命令 run 直接 return（:134-136），但键已被 preventDefault（CanvasHost.vue:1084），可能吞掉宿主的方向键行为。待真机验证。

## 全局与宿主粘连

| 对象 | 用途 | 风险 | 证据 |
|---|---|---|---|
| console.log | 诊断日志 | 低，受设置开关控制 | src/alignArrangePlugin.ts:140、154、172 |
| 无 window/document/localStorage/定时器 | — | 无 | 本包 src 检索为空 |

## 内部职责与风险

一个 261 行的插件入口里同时装了：配置 schema、设置读取、矩形采集、日志、10 条命令。算法已拆到 arrangeEngine / compactArrange，边界清晰。主要风险不在耦合，而在快捷键与设置分组的隐式共享：卸载 auto-layout 后，align-arrange 的设置仍然挂在「自动布局方向」这个分组名下，分组语义失去另一半。

## 单独装卸判断

可独立装卸。不装不影响画布基础操作；装了不会改别人的行为。唯一可感知变化是 Ctrl+方向键被占用。

## 建议改法

1. 最小改动：把设置分组改成「布局/方向键排列」，与 auto-layout 解耦（只改 Config 的 group 字符串与关联测试）。
2. 命令增加 when：selection.ids.size >= 2 才认领键，避免无选中时吞掉 Ctrl+方向键。
3. 验证：补一条宿主级测试，断言无选中按 Ctrl+方向键时事件未被 preventDefault。

## 待验证

- Ctrl+方向键在浏览器里是否与页面滚动/画布平移冲突，需要真机确认。
- 设置分组只影响面板展示层级，不进入持久化键（设置按 key 存值）。本轮未核对 SettingsStore 全文，如需改分组应先查 tests/settingsEffect 的 groupOf 断言。

