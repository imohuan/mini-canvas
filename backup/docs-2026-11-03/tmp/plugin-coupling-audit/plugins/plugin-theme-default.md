# plugin-theme-default

## 一句话

默认皮肤：注册节点壳、连线、背景、拖线，以及一整套按名取用的 UI 零件和设置面板。它本身不引用别的插件，当前最大的风险是“主题 + 设计系统 + 设置面板”三件事绑在同一个包里，换皮时必须整包替换。

## 清单

| 项 | 值 |
|---|---|
| 包名 | `@mini-canvas/plugin-theme-default` |
| 身份 | builtin（`package.json:6-11`） |
| 源码文件 | 40 个实现文件（不含测试与 demo） |
| 测试文件 | 29 个 |
| 包依赖的其他插件 | 无；源码与 package.json 都没有面向其它插件包的依赖（`src/index.ts:53-60`，`src/__tests__/pluginDependencyGraph.test.ts:63-86`） |

## 跨包 import

| 目标 | 入口 | 是否公开出口 | 证据 |
|---|---|---|---|
| `@mini-canvas/canvas-base` | 类型、`registerEventName` | 是，插件作者入口 | `src/index.ts:13-18`，`src/index.ts:33` |
| `@mini-canvas/canvas-render` | 渲染上下文、主题色、类型、SettingsHost 契约 | 是 | `src/components/node/BaseNode.vue:11-28`，`src/components/settings/PluginSettingsContent.vue:29-30` |
| `@mini-canvas/canvas-data` | 节点区域栈、尺寸补丁、瞬态判断 | 是 | `src/components/node/BaseNode.vue:29`，`src/composables/useNodeCardSize.ts:28` |
| `@mini-canvas/kernel` | 图标渲染模式、工具参数类型 | 是 | `src/components/node/BaseTitle.vue:7`，`src/components/ui/ToolParamGroup.vue:20` |
| 其它插件 | 无 | — | 无命中 |

## 运行时协作

| 依赖 | 方式 | 必需/可选 | 证据 |
|---|---|---|---|
| theme 注册场 | `ctx.theme.register` 注册 `nodeShell / edge / background / connectionLine / edgeDefaultType` | 硬（没装主题就没有皮） | `src/index.ts:666-671` |
| ui 注册场 | 以 `default` 为 id 注册 `button / dropdown / tooltip / select / mediaViewer / slider / toolParamField / toolParamGroup / toolParamGrid / toolParamRatio / toolParamSlider / color / movingHandle / connectionLine` | 硬，节点面板按名取 | `src/index.ts:673-699` |
| settingsPanel 槽 | `ctx.theme.register('settingsPanel', PluginSettingsContent, { order: 0 })` | 可替换 | `src/index.ts:700-705`；成品应用以 order -1 顶替（`packages/ui/src/settingsPanelPlugin.ts:18-23`） |
| settings 服务 | 设置面板经渲染层拿到 `SettingsPanelSource`，不直接 `ctx.get('settings')` | 契约 | `src/components/settings/PluginSettingsContent.vue:36-40`；宿主侧关闭订阅见 `packages/ui/src/composables/ui.ts:1379-1390` |
| `settings:ui-close` 事件 | 模块加载时 `registerEventName`，外壳广播、宿主订阅 | 契约 | `src/index.ts:49-51`；`src/components/settings/PluginSettingsContent.vue:23-24`；`packages/ui/src/composables/ui.ts:1379-1390` |
| `SETTINGS_FIELD_RENDERER` | 面板 `provide` 给 `settingsGroup/<key>` 自定义页 | 契约 | `src/components/settings/PluginSettingsContent.vue:42-44`，`packages/ui/src/components/settings/AppSettingsPanel.vue:34-35` |
| `uiComponentOutside` | 树外（资产抽屉、生成历史）按名取主题件 | 契约 | `src/components/ui/MediaViewer.vue:95-100`，`src/components/ui/useCatalogDropdown.ts:20-31` |
| `localStorage` / 固定 URL | 无 | — | 源码无命中 |

## 全局与宿主粘连

| 对象 | 用途 | 风险 | 证据 |
|---|---|---|---|
| `document` / `window` 监听 | 标题编辑、下拉关闭、全屏预览、tooltip 重排 | 中：监听都成对摘除，但属于 DOM 级契约 | `src/components/node/BaseNode.vue:336-338,396`；`src/components/ui/Dropdown.vue:249-261`；`src/components/ui/MediaViewer.vue:216-219`；`src/components/ui/Tooltip.vue:109-114` |
| `.v2-card` 类名 | 底栏测量卡片矩形时直接查这个 DOM 类 | 中：主题与底栏通过类名粘连，换皮可坏 | 消费方 `packages/plugins/plugin-bottom-bar/src/NodeBottomBarOverlay.vue:138-145`；生产方 `src/components/node/BaseNode.vue:945`（模板根）与 `BaseNode.vue:252`（自身也按该类查） |
| `data-floating-chain` | 多套下拉共享的浮层父子判定 | 中：两处各留一份实现，只共享 DOM 属性 | `src/components/ui/floatingChain.ts:1-20`；`packages/ui/src/components/hooks/floatingGroup.ts:17` |
| `html.dark` | 深色主题根类 | 低：主题约定的宿主开关 | `src/styles/node-theme.css:1`；`packages/ui/src/app.css:105` |
| 固定端口 / 固定接口 | 无 | — | 源码无命中 |

## 内部职责与风险

1. **一个包承担三种产品角色**：视觉令牌（CSS）、节点/边/背景渲染器、设计系统组件目录。换主题的人只要想换外观，就会同时换掉按钮、下拉、设置面板。证据：`src/index.ts:19-47` 与 `src/index.ts:666-705`。
2. **设置面板不只是“皮”**：它实现了一级导航、二级页签、`settingsGroup/<key>` 三套插槽（`src/components/settings/PluginSettingsContent.vue:16-24,58-80,306-330`）。这块是功能，不是纯视觉。
3. **UI 零件同时被包内与包外消费**：包内 `Select` 通过 `useCatalogDropdown` 优先取目录件，取不到回落自带件（`src/components/ui/useCatalogDropdown.ts:10-31`）；包外节点插件只按名取（见本目录各节点页）。好处是换皮不改业务；代价是目录名成为隐式契约。
4. **两套浮层链实现**：`src/components/ui/floatingChain.ts` 与 `packages/ui/src/components/hooks/floatingGroup.ts` 各一份，注释明确是用户要求的“两处独立实现”，共享仅有 DOM 属性。风险是两个实现漂移后嵌套下拉再次失灵。
5. **核心六件在红线名单里**：`BaseNode.vue` 1387 行、`MovingHandle.vue` 659 行、`CustomEdge.vue` 658 行，任何“拆包”都先要读 `docs/tmp/canvas-core-v2-survey/core-node-contract.md`，不能按普通组件搬。

## 单独装卸判断

- **单独卸载主题**：节点插件仍能装载，但 `useUiComponent('button'/'select'/'mediaViewer'…)` 全为空；图片/视频/音频顶栏与底栏会缺按钮或直接不渲染。节点壳`nodeShell`也没了，画布无法正常出节点。属于“能启动、不能用”。
- **只装主题、不装节点**：壳、边、背景、设置面板都在；空画布可用。这是当前最干净的组合。节点插件消费的 `button/select/...` 目录件都在，但没有节点类型可渲染。
- **只替换设置面板**：安全。成品应用已经用 order -1 顶替（`packages/ui/src/settingsPanelPlugin.ts:18-23`），说明这个槽的换皮路径是通的。
- **只替换 `bottomBar`**：底栏插件自己注册默认底栏（`packages/plugins/plugin-bottom-bar/src/nodeBarPlugin.ts:251-252`），主题不参与，互不影响。

## 建议改法

1. **最小改动：把 UI 目录名收成一份共享常量。** 在 `canvas-render` 或 `canvas-base` 建 `UiCatalogNames`（button/select/mediaViewer/...），主题注册与节点消费都引用它。现在名字散落在字符串里，改名只能靠搜索。验证：主题测试加一条“声明的目录名与常量一致”。
2. **拆出“设置面板”子包或插件。** 把 `PluginSettingsContent.vue` + `SettingsSchemaField.vue` 从主题包移到独立 `plugin-settings-default`，主题只负责视觉。验证：只装主题时设置面板缺失的行为要有明确空态；成品应用替换面板的测试继续通过。
3. **给 UI 目录加契约测试。** 装载主题后逐个断言 `registryOf('ui').top(name)` 存在，且消费方用的名字都在表里。可放在主题包的现有 `pluginDependencyGraph.test.ts` 旁，无需新框架。
4. **两套 floatingChain 抽成无 DOM 的纯函数包。** 共享“链解析”算法，DOM 读写各留一份。验证：跨两套下拉混用的 SSR/单测。

## 待验证

- 底栏在 `measure()` 里用 `querySelector('.v2-card')` 找卡片；主题换壳若不保留该类名，底栏不会报错，只是永远定位不到。
- 只装主题、完全不装任何节点插件时，设置面板里“节点/端口”等分组是否会出现空分组；未做真机确认。
- `settings:ui-close` 的消费方在 `packages/ui`，不属于本包；主题包卸载后事件名登记是否残留，未验证。
