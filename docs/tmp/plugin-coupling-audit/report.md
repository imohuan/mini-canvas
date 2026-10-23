# 插件耦合审查报告

日期：2026-10-18。范围：`packages/plugins` 下全部 36 个插件目录，加上成品壳里承担插件接缝的 4 个文件。只读调查，没有修改业务代码。

## 结论

当前插件系统的主要问题不是“插件数量多”，而是**几类跨插件约定没有被公开成契约**。插件之间直接 import 源码的地方只有一组：底栏注册糖被节点插件依赖；其余大量问题属于“按名字、字符串、DOM 类名协作”，能跑，但换实现或单独装卸时容易静默坏。

按影响面排序，最值得先处理的是：

1. **底栏动作契约**。`plugin-node-text`、`plugin-node-image`、`plugin-node-video` 直接 import `@mini-canvas/plugin-bottom-bar` 的注册函数；`plugin-web2api-tools` 虽然只借类型，也复制了一份底栏窄接口。底栏从“可选插件”变成了节点包的编译期依赖。
2. **共享节点媒体字段**。视频截图创建 `image` 节点并写 `imageUrl/imageWidth/imageHeight`；3D 预览读 `imageUrl`；图片对比读 `imageUrl/cardWidth`；文件拖入写媒体字段；底栏收集上游素材。五处各写一遍规则，字段一改就静默断。
3. **宿主扩展点**。`selectionRegion` 本身在 `canvas-data` 有公开能力实现，但消费方仍依赖“多选插件会渲染它”这一运行时事实；`settingsNav` + `settingsGroup/<name>`（Agent/插件管理/展示/光标）、`ui` 目录名、`.v2-card`/`.moving-handle-anchor`/`.vue-flow` 选择器、`MiniCanvas.reloadPlugin`，目前都是字符串协议。`multi-select` 还会在捕获阶段 `stopImmediatePropagation` 抢 VueFlow 事件；`align-guide` 直接 `ctx.get('nodeLayout')`，缺服务会抛错。
4. **安装/卸载生命周期**。`plugin-node-ui` 的前端与后台半分开发布；`plugin-manager` 用 `<script>` 装 UMD，脚本执行后无法真正卸载；`plugin-hot-reload` 把单例挂 `window`。这些会让“卸载了插件，后台/全局还留着东西”。
5. **热重载全局 API 有两套名字**。成品壳实际挂的是 `window.MiniCanvasPlugin.reload`（`packages/ui/src/pluginReload.ts:163,362-368`），节点包的 HMR 却读 `globalThis.MiniCanvas.reloadPlugin`（如 `packages/plugins/plugin-node-text/src/index.ts:15`）。后者在成品壳里取不到，节点包的 HMR 分支会静默跳过。这是可以直接修的一处；现有 `plugin-hot-reload.md` 的正文已注明宿主侧没有 `MiniCanvas.reloadPlugin` 的生产实现。

## 必须保留的耦合

有几条看起来像耦合，实际是正常设计，不建议拆：

- 节点包发布生成动作、底栏消费；工具插件注册 `ctx.tools`、节点包按 `produces` 发现工具。这是“加一个模型=装一个工具插件”的保持点。
- 主题把设计系统件登记进 `ui` 目录，业务插件按名取；换皮不改业务代码。
- `clipboard` 与 `file-drop` 通过 `clipboard/paste` 注册场仲裁，而不是互相 import；方向正确。
- 设置页/Agent 面板“插件给内容、宿主给外壳”的分工；插件不应自己画最外层窗口。

这些方向应保留，问题只在“名字和类型没有集中”，不是协作本身错了。

## 交叉审核后的两处校正

- `selectionRegion` 不是多选插件的私有字段：`packages/canvas-data/src/canvas/capabilities.ts:389-406` 有公开能力实现。真正的问题是“能力注册了，但消费/渲染只由多选插件完成”，所以 Agent、资产上传、多选之间仍缺一份渲染契约。
- `plugin-manager` 的首次安装已经改成 opt-in（`src/catalogTypes.ts:123-153`、`src/pluginManagerService.ts:697-727`），不再“首次默认全装”。早期草稿里这条判断已失效。

## 分阶段整改建议

### 第 1 阶段：收口契约，不改行为

目标：把重复字符串换成单一来源，先让 typecheck 和测试成为守护。

- 建一个公开的底栏契约（可放 `canvas-base` 或独立小包）：`BarAction`、`BarApplier`、`registerBarAction`、`registerBarApplier`、`publishToolActions` 的类型与函数。节点包只依赖契约，不再依赖底栏实现。
- 建共享的节点媒体描述与上游素材纯函数：统一 `imageUrl/videoUrl/audioUrl/text`、`cardWidth/cardHeight`、`refOrder` 规则；视频、3D、对比、底栏、文件拖入共同引用。
- 把 `group` 节点类型、padding 键、拖拽事件名 `canvas:node:drag-end` 提到公开常量；`group` 与 `auto-layout` 不再各写一份。
- 把 `titleOffset/titleVisible`、`mc-export-ignore`、调试层类名收进主题公开契约；`canvas-export` 不再猜主题内部类名。
- 给 `selectionRegion` 补消费方契约：能力已在 `canvas-data` 公开，但“谁负责渲染它”仍靠多选插件；Agent、资产上传、多选应共用同一份渲染契约。
- 统一热重载门面：成品壳挂 `window.MiniCanvasPlugin.reload`，节点包 HMR 读 `globalThis.MiniCanvas.reloadPlugin`；两者应只保留一个，或由宿主同时提供别名并加测试。

这一阶段的验收：现有各包测试全绿；再加“只装某个插件”的装配测试，证明缺协作方时是明确降级，而不是静默坏。

### 第 2 阶段：拆职责，不动协议

- `plugin-bottom-bar` 拆出媒体预览、参考选择、默认底栏皮；底栏核心只保留动作注册、任务运行时、状态。
- `plugin-node-ui` 把后台半拆成独立包/独立生命周期；前端卸载时后台路由也能明确卸载。
- `plugin-multi-select` 把框选、群组框、整组拖动、批量连线拆开；先拆批量连线，它是独立能力。
- `plugin-theme-default` 把设置面板拆成独立插件；主题只负责视觉。

拆分前先补跨插件集成测试，尤其是“装 A 不装 B”和“热装 B”两条路径。

### 第 3 阶段：清理历史遗留

- 删除 `plugin-node-image` 的死文件 `ImageGeneratePanel.vue` 与只服务它的 `panelSource.ts`；它引用的 `runImageGeneration` 已不存在。
- 归档 `plugin-node-video/src/VideoContent copy.vue`；它仍在 `src` 下，会被检索和构建配置扫到。
- 删除 `plugin-node-ui` package.json 里未使用的 `@mini-canvas/plugin-bottom-bar` 依赖。
- 评估删除 `plugin-history`：它与宿主 `command:undo/redo` 职责重叠，成品应用默认不装。

### 第 4 阶段：修可靠性问题

这些不是“耦合”，但审查中一并发现，值得单独开任务：

- `plugin-auto-save` 在 flush 失败时先把脏位清掉，失败后下一周期不重试。
- `plugin-manager` 的 UMD 加载在清单缺 `globalName` 时会扫所有 `MiniCanvasPlugin*`，多插件并存可能挑错。
- `plugin-edge-cutting`、`plugin-multi-select`、`plugin-cursor-effect` 都有 document/window 捕获监听；`multi-select` 还在 `.vue-flow` 根上捕获 pointerdown/mousedown/click 并阻断后续，需要统一优先级并验证异常卸载清理。
- `plugin-clipboard` 与 `file-drop` 的粘贴 order 是 10/20/30 魔法数字，且 `CanvasHost.vue` 注释方向与实际代码相反。
- `plugin-hot-reload-demo` 把定位写在 `meta.style`，但 `SlotHost.vue` 只消费 `component/order/id`，不读 `meta`（`packages/canvas-render/src/components/SlotHost.vue:50-60`）。这张试验卡片的定位样式实际不生效，位置由 `DemoCard.vue` 自己决定。

## 文档与索引问题

`docs/STATUS.md` 开头仍有未解决的 Git 冲突标记（`<<<<<<< ours` / `=======` / `>>>>>>> theirs`），会影响所有“先读 STATUS”的人。`AGENTS.md` 写 24 个插件，实际 36 个。这两处应在另一次文档整理中修正。

## 本次审查的限制

- 没有运行 typecheck 与测试，只做静态证据核对；所有“会失败”的判断都标了待验证。
- 没有启动浏览器做真机竞争测试；DOM 选择器、全局监听顺序、主题换皮后的浮层行为需要真机复核。
- 风险级别是相对排序，不是精确分数；详情页里有 `file:line`，可逐条复核。

## 建议的下一步

先做第 1 阶段的“底栏契约 + 共享媒体字段”两件事，它们能同时降低 `plugin-bottom-bar`、三个节点包、`plugin-web2api-tools`、3D、对比、文件拖入的风险。每完成一件，先补装配测试，再改源码；不要先拆包。

