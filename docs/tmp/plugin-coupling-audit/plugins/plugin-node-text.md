# plugin-node-text

## 一句话

文本节点自带服务、生成动作与写入器。节点本身较独立；主要问题是为了注册底栏动作，直接在源码里 import 了底栏包，另外有两处用 `ctx.doc` 直访，绕过了同文件其它地方用的 `ctx.get('doc')` 形状。

## 清单

| 项 | 值 |
|---|---|
| 包名 | `@mini-canvas/plugin-node-text` |
| 身份 | builtin（`package.json:6-11`） |
| 源码文件 | 10 个实现文件 |
| 测试文件 | 6 个 |
| 包依赖的其他插件 | `@mini-canvas/plugin-bottom-bar`（dependencies，`package.json:28-35`）；`@mini-canvas/plugin-theme-default` 只在 devDependencies 供测试（`package.json:39-42`） |

## 跨包 import

| 目标 | 入口 | 是否公开出口 | 证据 |
|---|---|---|---|
| `@mini-canvas/plugin-bottom-bar` | `registerBarAction / registerBarApplier / publishToolActions` | 是包根出口，但仍是插件间源码依赖 | `src/nodeTextPlugin.ts:41` |
| `@mini-canvas/canvas-base` | `Service / PluginModule / bindTypeDefaultSize` | 是 | `src/nodeTextPlugin.ts:18` |
| `@mini-canvas/canvas-data` | `DocService` 类型 | 是 | `src/nodeTextPlugin.ts:39` |
| `@mini-canvas/canvas-render` | `useCanvasRender` 收口 | 是 | `src/TextContent.vue:34` |
| `@mini-canvas/kernel` | 无直接 import | — | 无命中 |
| 其它插件内部路径 | 无 | — | 无命中 |

`plugin-bottom-bar` 在 package.json 是 dependencies，但源码只用三个注册糖；如果契约搬到共享包，这条依赖可以降为 type-only/no-dep。

## 运行时协作

| 依赖 | 方式 | 必需/可选 | 证据 |
|---|---|---|---|
| `doc` | `inject=['doc']` | 硬 | `src/nodeTextPlugin.ts:102-103` |
| `nodeBar` | `ctx.tryGet('nodeBar')`，没有则监听 `ctx:plugin-installed` 补注册 | 可选 | `src/nodeTextPlugin.ts:128-160` |
| `node/bar` / `node/bar-applier` | 经注册糖落场：复制、删除、文本生成写入器 | 可选 | `src/nodeTextPlugin.ts:133-152` |
| `tools` | 由 `publishToolActions` 间接读取，按 `produces:'text'` 生成动作 | 可选 | `src/nodeTextPlugin.ts:131`；实现 `packages/plugins/plugin-bottom-bar/src/toolActions.ts:63-95` |
| `ui` 目录 | 注册 `textPreview` | 契约 | `src/nodeTextPlugin.ts:121-123` |
| `settings` | 读 `titleScaleMinZoom` / `textLodIconZoom`，并订阅变化 | 可选（缺失回落默认） | `src/TextContent.vue:71-79` |
| `text` 服务 | 内容组件 `ctx.get('text').editText` 写回 | 硬（本插件自己提供） | `src/TextContent.vue:46-50,119,155` |
| `ctx.doc` 直访 | 删除动作与写入器直接 `ctx.doc.removeNodes/updateNode` | 契约，但形式不一致 | `src/nodeTextPlugin.ts:145`，`src/nodeTextPlugin.ts:151` |

## 全局与宿主粘连

| 对象 | 用途 | 风险 | 证据 |
|---|---|---|---|
| `document` / `window` | 无直接使用 | 低 | 无命中 |
| `localStorage` / 固定 URL | 无 | — | 无命中 |
| `ctx.doc` 属性访问 | 同文件其它处用 `ctx.get('doc')`，这里绕过 | 中：极简宿主/测试桩只实现 `get` 时会崩 | `src/nodeTextPlugin.ts:145,151` 对比 `src/nodeTextPlugin.ts:206` |
| `data.text`（底栏写） | 文本动作 `promptBinding:'text'` 时底栏直接写 `data.text` | 中：底栏与文本节点共享字段契约 | `src/nodeTextPlugin.ts:131`；底栏 `src/NodeBottomBar.vue:292-306,336-337` |
| 默认尺寸双写 | `size: {w:300,h:200}` 与 `bindTypeDefaultSize` 同值 | 低：两处需一起改 | `src/nodeTextPlugin.ts:173,186` |

## 内部职责与风险

1. **底栏动作与节点本体同文件**：`nodeTextPlugin.ts` 同时做服务、UI 目录登记、底栏注册、节点类型注册、两条命令。文件 196 行，尚可控，但底栏一改就波及节点包。
2. **服务和组件都依赖 `text` 服务名**：组件在根上下文里用 `ctx.get('text')`（`src/TextContent.vue:46-50`），而不是直接用节点数据写回。这保证写回统一走服务，但把“组件能否编辑”绑定到服务是否在。
3. **LOD 配置的键由主题拥有**：`titleScaleMinZoom` / `textLodIconZoom` 是主题 Config 里的字段（主题页证据），文本插件只按名读。若只装文本不装主题，值回落默认（`src/TextContent.vue:71-79`，`src/textViewMode.ts:69-74`）。这是合理的可选契约，但键名是隐式的。
4. **测试覆盖了节点行为，不覆盖跨插件注册。** 现有 6 个测试覆盖服务写回、复制、渲染、LOD（`src/__tests__/nodeTextSmoke.test.ts:32-59`，`textNodeWriteback.test.ts:43-122`），但没有 “装底栏后动作出现/卸载后消失” 的断言。

## 单独装卸判断

- **单独装文本、不装底栏**：节点可建、可编辑、可复制/删除（命令仍在），但底部生成栏不出现；`registerBar` 返回 false 并挂一个 `ctx:plugin-installed` 监听等待底栏。
- **单独卸文本**：`text` 服务、节点类型、UI 目录项随 scope 回收；底栏里的 `text.*` 动作若已注册会随调用方 scope 回收。其它插件若缓存了 `text` 服务引用，需自己重新 `get`（本包组件是每次调用现取）。
- **只装底栏**：没有 `text` 类型，文本动作不出现；底栏不崩。
- **热装底栏**：代码路径存在（`ctx:plugin-installed` 补注册），缺测试。

## 建议改法

1. **最小改动：把两处 `ctx.doc` 改成 `ctx.get('doc')`。** 与同文件 206 行、其它节点包保持一致，避免测试桩/极简宿主下只实现 `get` 时崩。验证：补一条只提供 `get` 的 smoke。
2. **把底栏注册糖改为契约包 import。** 与底栏页同一条整改；文本包本身不需要底栏实现，只需要 `registerBarAction` 的类型与函数。验证：迁移后节点包不再声明 `@mini-canvas/plugin-bottom-bar` 运行依赖，typecheck + 测试仍绿。
3. **把底栏注册抽到独立的 `barActions.ts`。** `nodeTextPlugin.ts` 只保留服务与节点注册，便于单独测试与单独卸载。验证：现有 smoke 不需要改行为断言。
4. **补跨插件生命周期测试。** 装文本 → 装底栏 → 断言 `text.duplicate`/`text.delete` 与 `tool:*` 动作存在；卸底栏 → 断言消失。

## 待验证

- `ctx.doc` 在真实宿主里是否总是有值；内核服务解析 Proxy 是否给根上下文暴露属性。代码注释说“根 Context 没有服务属性 Proxy”（`TextContent.vue:46`），但这里直接用了，需确认是否只在插件 scope 内成立。
- 文本生成动作的 `promptBinding:'text'` 与底栏输入框写回是否在卸载重装后仍指向新服务实例；未做热重载实验。
