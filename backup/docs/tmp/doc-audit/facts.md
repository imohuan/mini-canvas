# 文档事实审核（facts）

审核时间：2026-10-18。审核对象为当日最后读到的版本：审核期间这四份文件被改过多次（最早 14:50，最晚约 15:0x）。

由于文件仍在变动，下面每条都同时给出**章节号 + 原文片段 + 审核时的行号**。行号只作辅助，按原文片段搜索最稳。

规则：只读源码，不改业务代码。每条结论附 `相对路径:行号`。项目内相对路径省略 `D:\Code\Git\mini-canvas\` 前缀。

本次实际运行：

- `pnpm -C packages/canvas-data test` → 38 个文件、**398 条全绿**。
- `pnpm -C packages/plugins/plugin-node-image typecheck` → 通过。
- `pnpm -C packages/plugins/plugin-node-image build` → 通过（75 modules）。

## 结论

四份文档的大方向与源码一致：`ctx` 三根轴、`inputs/outputs`、`ctx.nodes.attach`、`selectionRegion.attach`、`registryOf('node/bar')`、`resources.put/resolve`、`doc.getEdges` 都真实存在；`media`、`upstream`、`produces/consumes` 确实尚未实现，文档也标了“提案/未实现”。

但有 **13 处把现状写错**，其中 6 处会直接把施工带进错误目录或错误名字。另有 10 处口径不一致或疑似错误。数字只有“306”一处过时。

## 一、确定错误（按严重程度）

### E1【高】迁移清单 §第 1 批：“`packages/ui` 宿主注册标准能力”写错位置

原文（行 17）：`| 4 | \`packages/ui\` | 宿主注册标准能力；\`ctx.surface()\` 能看到 \`media/upstream\` |`

实际注册点在渲染层宿主构造里：

- `packages/canvas-render/src/host/createMiniCanvasHost.ts:200` 取 `registryOf('capability')`，`201` 逐项 `add`。
- `packages/ui` 生产代码里 `registryOf('capability')` 命中 0 条；`packages/ui/src/App.vue:223` 只是渲染 `CanvasHost`。

按施工单去 `packages/ui` 改会找不到位置。正确表述：能力注册在 `createMiniCanvasHost`，`packages/ui` 只负责装配与真机验收。

### E2【高】迁移清单 §第 5 批：“统一 `MiniCanvasPlugin.reload` 与 `MiniCanvas.reloadPlugin`”漏了真正的名字

原文（行 59）：`| 22 | 节点包 HMR | 统一 \`MiniCanvasPlugin.reload\` 与 \`MiniCanvas.reloadPlugin\` |`

成品壳挂的是 **`MiniCanvasUI`**：

- `packages/ui/src/App.vue:223`：`window-key="MiniCanvasUI"`。
- `packages/canvas-render/src/host/createMiniCanvasHost.ts:362`：`exposeToWindow(key = 'MiniCanvas')`，默认名只在直接嵌 `CanvasHost` 且不传 `windowKey` 时出现。
- 节点包读的是成品壳里不存在的 `globalThis.MiniCanvas`：`packages/plugins/plugin-node-ui/src/index.ts:35`、`packages/plugins/plugin-node-image-compare/src/index.ts:10`。

实际是三个名字：`MiniCanvasPlugin`（重装器，`packages/ui/src/pluginReload.ts:163`）、`MiniCanvasUI`（成品壳宿主）、`MiniCanvas`（直接嵌宿主默认名）。文档只写两个，会让人把成品壳改成 `MiniCanvas` 或漏掉 `MiniCanvasUI`。

### E3【高】提案 §方案一·为什么：“加图片现在只能 `ctx.get('image').addImageNode`”不成立

原文（行 29）：`“加图片”现在只能 \`ctx.get('image').addImageNode(pos, url)\`……`

现有至少五条建图片节点的路，多数不经过 image 服务：

- 资产拖入画布：`packages/ui/src/composables/ui.ts:1702` 走 `command:create-node` 的 `imageUrl` 通道。
- 资源库“添加到画布”：`ui.ts:1673` 的 `createAssetNode`。
- 风格库：`packages/plugins/plugin-style-library/src/components/StyleLibraryOverlay.vue:85` 直接 `doc.createNode('image', pos, { imageUrl, label })`。
- 文件拖入：`packages/plugins/plugin-file-drop/src/fileDropPlugin.ts:318-320` 自己拼载荷再 `tx.addNodes`。
- 视频截图：`packages/plugins/plugin-node-video/src/videoOps.ts:473` 走 `ctx.createNode('image', …)`。

“只能”会让读者以为统一入口已存在、只需换名；实际是五套写法。改成“没有统一入口，当前至少五处各自建图”更准确。

### E4【高】提案 §方案二·为什么：“视频各自扫 `doc.getEdges()`”不成立

原文（行 91）：`现在底栏、\`node-ui\`、3D、图片对比、视频各自扫 \`doc.getEdges()\`……`

- `packages/plugins/plugin-node-video/src` 生产代码里 `getEdges`/`renderEdges`/`edges` 命中为 0。
- 3D 预览也不扫 `doc.getEdges`，它读渲染上下文：`packages/plugins/plugin-node-3d-preview/src/PanoramaContent.vue:44`（`useCanvasRender()`）、`109`（`renderEdges.value`）。
- 真正扫 `doc.getEdges()` 的是 `packages/plugins/plugin-node-ui/src/nodeUiPlugin.ts:311`、`packages/plugins/plugin-node-image-compare/src/nodeImageComparePlugin.ts:89`，以及底栏 `packages/plugins/plugin-bottom-bar/src/ReferenceSelectOverlay.vue:113`。

按文档去视频包里找“扫边函数”会找不到，也会漏掉底栏那处真正扫边的代码。

### E5【高】规范 §2.3：“波形缓存不进 `data`”与源码相反

原文（行 82）：`| \`audio\` | \`resourceId\` | \`resolve(resourceId)\` | 波形缓存不进 \`data\` |`

- 写入：`packages/plugins/plugin-node-audio/src/audioOps.ts:189`、`254`、`273` 用 `writeRuntime` 写 `audioWaveform`。
- `writeRuntime` 就是 `doc.updateNodeRuntime`：`audioOps.ts:97`；落点是节点 data，只是不进撤销栈（`packages/canvas-data/src/graphDocument.ts:215`）。
- 读取：`AudioContent.vue:54`、`audioOps.ts:133`。

同文件行 74 又写“缓存类字段（如波形峰值）必须标可重建”，等于承认它在 `data` 里。两处自相矛盾。

建议改成：“波形峰值现在写在 `data.audioWaveform`（运行态、可重建、不进撤销栈）；迁移目标是移出节点数据或明确标为缓存。”

### E6【高】迁移清单 §第 1 批：“现有 306 测试全绿”过时

原文（行 14）：`现有 306 测试全绿；新增字段不改变旧行为`

- 实测 `packages/canvas-data` = **398** 条（38 文件全绿）。
- `docs/STATUS.md:6210`、`6449` 也记着 398。
- `AGENTS.md` 里同样写 306，属同源过时。

拿 306 当验收基线，会误判“多出来的测试是谁引入的”，或反过来漏查。

### E7【中高】规范 §六：“一级导航 id 与 `settingsGroup/<id>` 必须同名”对二级分组不成立

原文（行 188）：`设置分组用“一级/二级”：\`布局/自动布局方向\`；一级导航 id 与 \`settingsGroup/<id>\` 必须同名`

实际槽键是**完整分组 key**，不是一级名：

- `packages/plugins/plugin-theme-default/src/components/settings/PluginSettingsContent.vue:49-51`：一级名 = `key.split('/')[0]`。
- 行 330：读 `occupants('settingsGroup/' + sectionKey)`，`sectionKey` 是 `174-197` 里完整的 `leaf`（如 `布局/图片节点尺寸`）。

所以“布局”这种一级页要接管内容，槽键必须写 `settingsGroup/布局/图片节点尺寸`；照文档写成 `settingsGroup/布局` 不会生效。只有扁平分组（`Agent`、`插件`、`光标`、`插件展示`）才是一级名 = 完整 key。

### E8【中高】契约 §九：“旧存档同时有 xxxUrl 和 resourceId”把现状说反一半

原文（行 171-173）：`旧存档同时有 \`imageUrl\` 和 \`resourceId\`` 等三行。

现状不是“旧存档才有两份”，而是**新写入仍在双写**：

- 图片：`packages/plugins/plugin-node-image/src/imageOps.ts:260/309/341/447/485` 同时写 `imageUrl` + `resourceId`。
- 视频：`packages/plugins/plugin-node-video/src/videoOps.ts:279`（URL）+ `335`（`resourceId`）。
- 音频：`packages/plugins/plugin-node-audio/src/audioOps.ts:182`（URL）+ `187`（`resourceId`）。

反向也不成立：`ImageService.addImageNode` 只写 `imageUrl`、不写 `resourceId`（`packages/plugins/plugin-node-image/src/nodeImagePlugin.ts:52-56`），新建图片节点可以“有 URL、没有 ID”。既然标“现行”，就不该把新写入描述成旧存档行为。

### E9【中】契约 §十一：“左右槽靠 `refOrder` 定顺序”不成立

原文（行 190）：`左右槽仍可共用 \`target\` 端口，靠 \`refOrder\` 定顺序`

- `refOrder` 只被底栏读写：`packages/plugins/plugin-bottom-bar/src/NodeBottomBar.vue:357`、`panelSource.ts:64`。
- 图片对比里搜 `refOrder` 为 0；左右顺序来自边数组顺序：`packages/plugins/plugin-node-image-compare/src/imageCompareEngine.ts:61-66`。

按文档加 `refOrder` 会引入一个没人读的字段。

### E10【中】提案 §方案一·迁移影响：“`plugin-agent` 的资产上传”不成立

原文（行 82）：`\`plugin-file-drop\`、\`plugin-agent\` 的资产上传……改调 \`media\``

`packages/plugins/plugin-agent/src` 里没有 `createNode` / `addImageNode` / 资产落画布的代码；资产“添加到画布/拖入”在 `packages/ui/src/composables/ui.ts:1673-1730`。`plugin-agent` 只管引用标签与对话里的图片附件（`agentResources.ts:110`、`components/AgentConversation.vue:147`）。

### E11【中】规范 §1.3：“事件注册随插件卸载自动回收”不成立

原文（行 38）：`经 \`ctx\` 的注册（节点、命令、槽、服务、事件、\`ctx.effect\`）都随插件卸载自动回收`

`ctx.on` 返回的**监听**会随 scope 回收（`packages/kernel/src/Context.ts:963-966`），但**事件名登记**不会：

- `packages/kernel/src/EventBus.ts:147-149` 只是往模块级 `knownEvents` 加一条，没有注销口。
- 插件在模块顶层调用：`packages/plugins/plugin-clipboard/src/clipboardPlugin.ts:92-94`。

文档把“事件”并列进自动回收清单，会让人以为存在 `unregisterEventName`。

### E12【中】契约 §四：“`data:` 且无 `resourceId`”只算旧存档

原文（行 86）：`| \`data:\` 且无 \`resourceId\` | ⚠️ 旧存档兼容 | 旧链路唯一副本；新写入应迁入资源库 |`

成品应用自己就会新建这种节点：`packages/ui/src/composables/ui.ts:1592` 给新建图片塞 `SAMPLE_IMAGE_URL`，而它是 `data:image/svg+xml…`（`packages/ui/src/assembly.ts:164-167`），没有 `resourceId`。另外 `writeGeneratedImage` 在拿不到资源库时会原样写回地址（`packages/plugins/plugin-node-image/src/imageRun.ts:103`）。

“旧存档兼容”应改成“旧存档 + 少数兜底/占位写入仍会产生”。

### E13【中】契约 §四：地址准入表缺“云端持久引用”这一行

原文（行 81-87）整张表。

表里没有 `/api/canvases/<id>/resources/<hash>` 这种形态，而它正是**当前云端的 `resourceId` 本体**：`packages/plugins/plugin-cloud-client/src/cloudResourceAdapter.ts:59` 返回 `uploaded.url`，`68-70` 对 `/api/` 原样返回；`packages/canvas-data/src/storage/types.ts:47` 也写明“云端是同源 URL”。

迁移第 0 步要改的正是这件事；表里没有这一行，读者会以为“resourceId 已经是逻辑 ID”，与“待改”冲突。

## 二、疑似错误 / 口径不一致

### S1【中】规范 §2.1 用 `ImageService.addImageNode` 当“公开服务方法”范例，却与“只存 ID”冲突

原文（行 59）：`该类型公开了对应的服务方法（如 \`ImageService.addImageNode\`）`

该方法签名收 URL 并只写 `imageUrl`（`nodeImagePlugin.ts:33/52-56`）。规范一边允许“经公开服务方法写字段”，一边要求“节点只保存 `resourceId`”，照范例实现会直接违反 1.4。建议注明“这是迁移期兼容方法，参数是 URL，不是目标形态”。

### S2【中】提案 §方案一·归属：“多个插件注册同一 `kind` 按 `order` 取最小者，与能力场现有语义一致”含混

原文（行 68 附近）：`多个插件注册同一 \`kind\`：按 \`order\` 取最小者，与能力场现有语义一致`

能力场按**能力名**做键（`packages/canvas-render/src/contracts/capabilities.ts:43-44`、`top(name)`），没有“按 `kind` 取条目”的语义。要支持“多个创建器按 media kind 竞争”，需要另一张按 kind 的场，或在一个 `media` 能力内部自己维护顺序。文档现在读起来像“能力场天然支持 kind 路由”，与实现不符。

### S3【中】提案 §方案三 与契约 §八：`applyToNode(nodeId, slot, id)` 的 `slot` 语义不清

原文：提案行 54；契约行 162-163。

`slot` 在 `produces/consumes` 里是两侧各自的槽名；写进一个已有节点，落到的是它自己的持久字段（`refField`），不是它的 `consumes`。另外给文本槽传 `resourceId`（契约行 163）与“文本用 `valueField`”（契约行 57/74）矛盾。建议把参数改成 `targetField`，或明确“slot 指目标节点 `produces` 的槽”。

### S4【中】规范 §六：命令/事件命名规则与现有代码不一致

原文（行 189）：`命令 id 用 \`插件名:动作\`；事件名用 \`插件名:事件\``

现有主力写法是点号与斜杠混用：`image.upload`（`nodeImagePlugin.ts:218`）、`video.crop`（`nodeVideoPlugin.ts:247`）、`ui.setHtml`（`nodeUiPlugin.ts:253`）、`ui/context`（`nodeUiPlugin.ts:271`）、`auto-layout:focus-selected`（`ui.ts:1619`）。

作为“新规则”可以，但要写清“存量不改、仅新增生效”，否则读者会以为现状已经统一。

### S5【中】规范 §十：例外登记表不完整

表头写“下列是已知例外”（行 225），至少漏了四处当前违规：

- `packages/plugins/plugin-style-library/src/components/StyleLibraryOverlay.vue:85`：直接 `doc.createNode('image', …)` 写 `imageUrl`。
- `packages/ui/src/composables/ui.ts:1592/1702`：宿主用 `command:create-node` 塞 `imageUrl`，还塞 `data:` 占位图。
- `packages/plugins/plugin-file-drop/src/fileDropPlugin.ts:318-332`：自己拼节点载荷，且无资源库时回落 `blob:`（`317/324/330`）。
- `packages/plugins/plugin-bottom-bar/src/ReferenceSelectOverlay.vue:113`：读主题类名 `.v2-card`；表里只登记了多选读 `.moving-handle-anchor` 与导出读主题变量。

表不补全，会被当成“其余都已合规”。

### S6【中】迁移清单 §第 1 批：表格顺序与“第 0 步”冲突

第 1 批表里的顺序列是 `1, 2, 3, 4, 0`（行 14-17），而提案行 238 说“见迁移清单第 0 步”、实施顺序第 1 条就是它。按行读会先做 1，实际应先做 0。

### S7【低中】契约 §二：“在 `MediaKind` 类型里加字面量”读起来像类型已存在

原文（行 43）：`在 \`MediaKind\` 类型里加字面量`

全仓只有文档出现该类型（提案行 58 的定义块）。`DataPortDef` / `NodeDataTypeDef` 同理，只在 docs 中出现。建议统一写成“提案中的 `MediaKind`”。

### S8【低中】规范 §五：主题槽清单与类型定义不一致

原文（行 183）：`主题单赢家槽（\`nodeShell/edge/background/settingsPanel\`）`

`packages/canvas-data/src/canvas/registry/themeRegistry.ts:27-33` 的内置枚举是 `nodeShell/edge/edgeDefaultType/background/connectionLine`；`settingsPanel` 是主题插件按字符串注册的（`packages/plugins/plugin-theme-default/src/index.ts:702`），不在枚举里。文档列的四个槽少了 `connectionLine`、多了枚举外的 `settingsPanel`，却没说明后者是字符串槽。

### S9【低】契约 §7.1：`restoreNodeMediaUrls` 行号范围略偏

原文（行 138）：`packages/canvas-data/src/resourceService.ts:172-198`

`restoreNodeMediaUrls` 从 `packages/canvas-data/src/resourceService.ts:178` 开始（注释 `170-177`），写回在 `190-193`。起点头落在注释里，不影响判断，但引用应精确。

### S10【低】规范 §3.3：“`blob:` 永不进长期字段”与兜底路径冲突

原文（行 151）：`把 \`blob:\` 地址写进节点长期字段：刷新即失效`

`fileDropPlugin.ts:317/324/330` 在拿不到资源服务时明确回落到 `createObjectURL` 并写进节点。这是极简宿主/单测路径，但文档写“永不”，没有给这条例外留口。

## 三、无法验证 / 属于提案，不应算错

### P1 `media` / `upstream` 能力、`produces/consumes`、`useResourceUrl`

全仓生产代码为 0 命中（只出现在这四份文档）。四份文档都标了“未实现/提案”，规范行 42/46、提案行 211 还明确写了不可直接照抄。这部分与“现状”不冲突，**不算错**。

### P2 `frameResourceId`、`leftResourceId/rightResourceId`、`kind: 'frame'`

代码中不存在，只在文档出现（规范行 81、契约行 172/191）。都写在“目标形态/待决问题/迁移动作”列，属于提案字段，不算事实错误；建议统一加“提案字段”标记，避免和现行字段混排。

### P3 `kind: 'pano'` 与 `PortDef` 同词表

`PortDef.contentType/acceptsTypes` 是普通 `string`（`packages/canvas-data/src/nodeStore.ts:103/105`），现有节点只用到 `image/text/video/audio`；`pano` 没有作为连接类型出现（全景节点是 `3d-preview`，收 `image`，见 `packages/plugins/plugin-node-3d-preview/src/node3dPreviewPlugin.ts:102`）。

“同一套词表”是设计目标，代码里没有共享常量；无法用源码证明“已统一”。建议写成“目标词表”。

### P4 契约 §7.2：“派生资源用 `derived` 标记、不参与回收”——已核实为真

`packages/canvas-data/src/resourceService.ts:380` 跳过 `derived`；`packages/plugins/plugin-node-image/src/thumbCanvas.ts:259`、`packages/plugins/plugin-node-video/src/videoThumbCanvas.ts:400` 用 `derived: true` 写入。这条**不是错误**。

### P5 迁移清单里引用 `imageOps.ts` / `videoOps.ts` / `audioOps.ts` / `appliers.ts` 的行号——逐条核对为准确

`imageOps.ts` 的 260/309/341/447/485；`videoOps.ts:279`；`audioOps.ts:182`；`cloud-client/appliers.ts:97/115`。`plugin-node-ui` 的底栏依赖也确实只在 `package.json:35`、源码无 import（唯一提及是注释 `src/uiData.ts:104`）。这些**不是错误**。

## 四、数字核对

| 文档里的数字 | 仓库实测 | 结论 |
|---|---|---|
| 迁移清单“306” | canvas-data 398 | 错，见 E6 |
| 提案“36 个插件审查” | `packages/plugins` 下 36 个含 `package.json` 的目录 | 对 |
| 审查详情页数量 | 36 个插件页 + `_TEMPLATE.md` + `ui-host-adapters.md` | 对 |
| 四份文档“7 篇 / 9 篇教程” | 未出现该说法 | 无此项 |

## 五、建议修正顺序

1. 先改 E6（306 → 398）与 E1/E2（施工单位置、热重载全局名），这三条会让施工直接走错目录/写错名字。
2. 再改 E3/E4/E10，把“只有一条路/视频扫边/agent 上传”改成真实清单，避免方案建立在假现状上。
3. 然后改 E5/E8/E12/E13，把“节点只存 ID”相关的现状与目标彻底分层：当前是双写、云端引用是 URL、占位图是 `data:`。
4. 最后补 S1/S3/S5，把规范内部矛盾与例外表补全。

上文每条都已给出源码锚点；如需复核，直接按 `path:line` 打开即可。
