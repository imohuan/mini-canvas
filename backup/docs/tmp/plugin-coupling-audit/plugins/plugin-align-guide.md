# plugin-align-guide

## 一句话

拖单个节点时吸附其它节点边缘/中心并画参考线。实现集中在 overlay 组件，apply 只做挂载与颜色变量同步。

## 清单

| 项 | 值 |
|---|---|
| 包名 | @mini-canvas/plugin-align-guide |
| 身份 | installable |
| 源码文件 | 6 个（plugin / toggle / config / engine / overlay / index） |
| 测试文件 | 3 个，32 个用例 |
| 包依赖的其他插件 | 无 |

## 跨包 import

| 目标 | 入口 | 是否公开出口 | 证据 |
|---|---|---|---|
| canvas-base | Context / PluginModule / ConfigSchema | 是 | src/alignGuidePlugin.ts:15、src/alignGuideConfig.ts:15 |
| canvas-render | useCanvasRender / RenderEvents / NodeLayoutService | 是（公开出口） | src/AlignGuideOverlay.vue:34 |
| 其他插件 | 无 | — | 全 src 无 plugin- import |

没有 L3 硬耦合。

## 运行时协作

| 依赖 | 方式 | 必需/可选 | 证据 |
|---|---|---|---|
| overlay 槽 | ctx.slots.register('overlay', order 60) | 宿主需渲染 overlay 槽 | src/alignGuidePlugin.ts:31-36 |
| settings | tryGet + onChange，监听 alignGuideEnabled 与两个颜色键 | 可选 | src/alignGuideToggle.ts:28-37、src/alignGuidePlugin.ts:50、65 |
| selection | 组件内 tryGet，用于判断是否多选 | 可选 | src/AlignGuideOverlay.vue:43-49 |
| doc | 组件内 tryGet，仅取 parentId | 可选 | 同上:76 |
| nodeLayout | 组件内 get，absolutePosition/nodeSize | 必需（组件内直接 get） | 同上:78、87 |
| RenderEvents.NodeDragStart / NodeDrag | ctx.on 订阅 | 必需 | 同上:111-119 |

隐式契约两处：

- 设置键 alignGuideEnabled 是为了避开 plugin-edge-cutting 已占用的裸 enabled（src/alignGuideConfig.ts:11-13、测试 alignGuideConfig.test.ts:10；edge-cutting 侧见 packages/plugins/plugin-edge-cutting/src/edgeCuttingConfig.ts:14-22）。这是一条跨插件命名避让，属于 L2 级别的弱契约：没有代码引用 edge-cutting，但改回裸 enabled 会撞键。撞名的实际行为是**先占者保留、后声明者被跳过**：canvas-data 的 declareConfig 先 `settings.has(key)` 判断，已存在则只在 dev 下 warn（packages/canvas-data/src/canvas/capabilityLayer.ts:94-117），不会抛错。
- 颜色通过 html 内联变量 --uic-align-guide-light/dark 交给主题 CSS（src/alignGuidePlugin.ts:57-70）。主题包 ui-theme.css 消费这两个变量（packages/canvas-render/src/styles/ui-theme.css:89 附近提到多选，参考线变量在主题样式侧）。变量名是跨包契约，拼错就静默回落。

多选让位逻辑读 selection.ids.size，自己决定不吸附（src/AlignGuideOverlay.vue:46-51、83-86）。这意味着：卸载 multi-select 后选中仍由宿主维护，行为不变；但如果换成另一套多选实现，align-guide 仍按“选中数 > 1”判断，不需要知道 multi-select 是否存在。

## 全局与宿主粘连

| 对象 | 用途 | 风险 | 证据 |
|---|---|---|---|
| document.documentElement | 写参考线颜色 CSS 变量 | 低，卸载时清理 | src/alignGuidePlugin.ts:52、60-70 |
| CSS 变量名 --uic-align-guide-* | 与主题样式共享 | 中，改主题需同步 | 同上:57 |
| 无定时器 / 无 localStorage | — | 无 | 本包 src 无 setInterval/localStorage |

旧实现用过 window pointerup/blur + 150ms 定时器，现已改成 interaction.isNodeDragging 的 watch（src/AlignGuideOverlay.vue:20-24、124-126）。这是一次正确的收口，值得保留。

## 内部职责与风险

apply 只做两件事：按总开关挂 overlay、同步颜色变量。吸附算法、坐标换算、主节点锁定都在组件与 engine。职责清楚。

风险点：组件里同时存在 tryGet 与 get 两种取服务写法（selection/doc 用 tryGet，nodeLayout 用 get），缺少服务时的失败方式不一致；nodeLayout 缺失会直接抛错，而不是静默不吸附。

## 单独装卸判断

可独立装卸。关闭总开关等价于不装（不订阅拖拽、不画线）。不装不影响其它插件。与 auto-layout 的“对齐”只是词面相近，没有代码耦合。

## 建议改法

1. 最小改动：nodeLayout 改为 tryGet，缺失时直接 return，避免组件抛错打断整个 overlay 槽。
2. 把 --uic-align-guide-* 变量名收进主题包的公开常量或文档，避免字符串散落。
3. 验证：补一条“多选拖动时不出参考线”的宿主级测试；现有测试只覆盖 shouldAlignOnDrag 纯函数与开关接线。

## 待验证

- 已确认主题消费 --uic-align-guide-light/dark：packages/canvas-render/src/styles/ui-theme.css:83-86（亮色）与 :217（暗色）。
- 多宿主页面下 document.documentElement 是全局的，两个画布实例会互相覆盖颜色变量。

