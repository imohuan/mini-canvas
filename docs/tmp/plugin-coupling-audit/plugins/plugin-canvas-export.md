# plugin-canvas-export

## 一句话

整图/选中导出 PNG：临时把视口切到 zoom=1 分块截图，再拼成一张图。核心风险是把主题的标题几何、调试类名和 VueFlow 的 DOM 类名写死在自己包里。

## 清单

| 项 | 值 |
|---|---|
| 包名 | @mini-canvas/plugin-canvas-export |
| 身份 | installable |
| 源码文件 | 4 个（plugin 658 行 / exportGeometry 437 行 / index / env.d.ts） |
| 测试文件 | 2 个，70 个用例 |
| 包依赖的其他插件 | 无（html-to-image 是第三方库） |

## 跨包 import

| 目标 | 入口 | 是否公开出口 | 证据 |
|---|---|---|---|
| canvas-base | PluginModule / Context / ConfigSchema / InferConfig / registerEventName | 是 | src/canvasExportPlugin.ts:59-64、67 |
| canvas-data | 类型 SelectionService、isTransient | 是 | 同上:65-66 |
| html-to-image | toCanvas / getFontEmbedCSS | 第三方 | 同上:68 |
| 其他插件 | 无 | — | 全 src 无 plugin- import |

没有 L3 代码级 import，但存在 L3 级别的“实现细节写死”。

## 运行时协作

| 依赖 | 方式 | 必需/可选 | 证据 |
|---|---|---|---|
| selection | inject + ctx 直访 const { selection } | 必需 | src/canvasExportPlugin.ts:95、413 |
| viewport | tryGet，getRootEl/getRendererEl/setViewport | 可选但缺失即不导出 | 同上:160-165、455-460 |
| nodeLayout | tryGet，getAllRects | 可选 | 同上:431-433 |
| doc | tryGet，getNodes/getEdges | 可选 | 同上:432、441-443 |
| settings | tryGet，实时读 | 可选 | 同上:415-427 |
| 事件 | emit canvas-export:exported | — | 同上:98、624-627 |

## 全局与宿主粘连

| 对象 | 用途 | 风险 | 证据 |
|---|---|---|---|
| .vue-flow__viewport | 定位截图根 | 高，VueFlow 实现细节 | src/canvasExportPlugin.ts:163 |
| .vue-flow__edges / g.vue-flow__edge[data-id] | 导出过滤 | 高 | 同上:207-214 |
| 主题设置键 titleOffset / titleVisible | 计算标题带 | 高，跨插件契约 | 同上:479、482 |
| 类名 moving-handle-debug / v2-debug-overlay / port-follow-zone / moving-handle-button | 排除调试层 | 中，主题内部类名 | 同上:169-174 |
| mc-export-ignore | 通用“别截我”标记 | 低，已有主题配合 | src/exportGeometry.ts:94；主题侧 packages/plugins/plugin-theme-default/src/components/node/MovingHandle.vue:476、BaseNode.vue:953、1050 |
| document.head 注入 style | 遮罩与标题色 | 中，全局样式 | src/canvasExportPlugin.ts:252-262、278-286 |
| document.createElement('a') | 下载 | 低 | 同上:236-239 |
| setTimeout / rAF | 等帧 | 低 | 同上:224-231 |

最重的一条是 titleOffset / titleVisible。它们由 plugin-theme-default 声明（packages/plugins/plugin-theme-default/src/index.ts:306-316），canvas-export 按裸键名读取（canvasExportPlugin.ts:479、482）。两边没有共享常量，默认值也是各写一份（主题 12、导出 12；主题 true、导出 true）。主题若改默认值或改键名，导出会静默多留或少留一条标题带。这是典型的 L3 实现细节粘连：没有 import，但依赖对方的设置键语义。

同样，DEBUG_OVERLAY_CLASSES 是主题组件内部的类名（MovingHandle.vue:681-685）。主题重构类名后，导出图会把调试层截进去，且不会有测试失败。

反过来说，mc-export-ignore 是一条做得好的公开契约：主题在端口球、resize 拖柄、多选圆圈上挂类（BaseNode.vue:953、1050；MovingHandle.vue:476），导出按类剔除（exportGeometry.ts:94、408；canvasExportPlugin.ts:181、216）。这条应该保留并写进主题开发规范。

## 内部职责与风险

658 行的插件入口同时做：配置 schema、DOM 查询、导出过滤、遮罩 UI、字体内联、分块取景、下载、事件广播。几何计算已抽到 exportGeometry（437 行，69 个纯函数用例），但 DOM 与流程仍很重。测试覆盖几何与 smoke，没有覆盖真实 DOM 截图、主题类名剔除、标题带与主题键的一致性。

## 单独装卸判断

可独立装卸。不装时没有导出命令。装了之后会临时改视口与全局样式，但 finally 会还原（src/canvasExportPlugin.ts:631-636）。风险在异常路径：若 setViewport 本身抛错，saved 视口可能无法恢复；代码把 restore 放在 finally 里，但 vp.setViewport(saved) 若也抛错，遮罩已 remove、标题色已 restore，视口会停在临时位置。属于低概率但影响可见。

## 建议改法

1. 最小改动：把 titleOffset / titleVisible 的键名与默认值提成主题包的公开常量（或 canvas-render 的公开契约），导出侧引用，消掉两份默认值。
2. 把 DEBUG_OVERLAY_CLASSES 改为主题统一挂 mc-export-ignore，删掉按类名白名单剔除的硬编码。
3. 验证：补一条“主题改 titleOffset 后导出上边距跟着变”的集成测试；现有测试只测 planExport 的纯几何。

## 待验证

- .vue-flow__edges 外壳与内层 g.vue-flow__edge[data-id] 的 DOM 结构是否在 VueFlow 升级后仍稳定，需要真机或 DOM 快照确认。
- 导出期间 setViewport 的异常恢复路径没有测试覆盖，实际影响待验证。

