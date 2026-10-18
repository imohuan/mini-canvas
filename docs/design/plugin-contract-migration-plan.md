# 插件契约迁移清单

日期：2026-10-18。配套：[契约方案](plugin-contracts-proposal.md)、[节点数据与上游契约](node-data-and-upstream-contract.md)、[插件开发规范](../插件开发规范.md)。

> **状态：部分实现（2026-10-18）。** 第 0 步（云端逻辑 ID）、第 1 步（produces/consumes）、第 2/3 步（upstream/media）、
> 第 5/5a/5b/7/7a 已落地；插件消费方迁移与拆包仍在进行。

这是一份**按插件排的施工单**，不是新规范。优先级按“收益 ÷ 改动量”排序；每项都先补测试再改代码。

## 第 1 批：底座契约（先做，其他批次依赖它）

| 顺序 | 包 | 改什么 | 验收 |
|---:|---|---|---|
| 0 | `plugin-cloud-client` / 本地资源适配器 | **持久引用统一为逻辑 ID**：云端 `putResource` 回 `<canvasId>/<hashName>`、不再回内容哈希 URL；`resolveResource` 认「新 ID / 旧 URL / 旧 res-」并把 ID 拼成路由；复制画布按 ID 前缀重映射。`restoreNodeMediaUrls` 改为只建内存视图（**未做**） | 同一节点在本地与云端存档字段形状一致；刷新后都能 `resolve`；载入不再写回 `data` |
| 1 | `canvas-data` | 加 `produces/consumes` 类型与校验；旧注册不报错 | 现有 `packages/canvas-data` 398 条测试全绿；新增字段不改变旧行为 |
| 2 | `canvas-render`（`createMiniCanvasHost`） | 标准能力加 `media`/`upstream` 的**接口与默认实现**；注册点在 `createMiniCanvasHost` 的 `registryOf('capability')`，不在 `packages/ui` | 不装任何节点插件时 `media.available()` 为空、`upstream` 返回空 |
| 3 | `canvas-data`（类型）+ `canvas-base`（重导出） | `MediaCapability`/`UpstreamCapability`/`DataPortDef` 的类型定义放 `canvas-data`（零 Vue）；`canvas-base` 只重导出 | 插件只引 `canvas-base` 能写新代码；`canvas-base` 不反向依赖渲染层 |
| 4 | `packages/ui`（验收） | 只做装配与真机验收；`ctx.surface()` 能看到 `media/upstream` | 真机诊断面板能列出两项 |

## 第 2 批：图片与视频（最大收益）

| 顺序 | 包 | 改什么 | 验收 |
|---:|---|---|---|
| 5 | `plugin-node-image` | 声明 `produces.image`；注册 `media.addNode('image')`；保留 `ImageService` 兼容 | 旧 `ctx.get('image').addImageNode` 仍可用；新 `media.addNode` 也能建图 |
| 5a | `plugin-node-image` 的 `ImageContent.vue` | 展示层从 `data.imageUrl` 改为 `resourceId` + `resolve`；缩略图服务的原图输入也改走解析结果；旧地址回退集中在一个函数并标 `// 迁移期` | 旧存档仍能显示；新存档刷新后仍能显示；5b 完成前旧字段仍是首帧兜底 |
| 5b | `plugin-node-image` 的写入方 | `imageOps.ts` 的 `imageUrl: persisted.url` 双写改为只写 `resourceId`（约 :260/:309/:341/:447/:485）；必须在 5a 完成并验证后才做 | 节点数据里不再出现新 `imageUrl`；删除写入后真机刷新仍显示 |
| 6 | `plugin-node-video` | 截图改 `media.put` + `media.addNode('image')`；删掉手写 `imageWidth/imageHeight` 分支 | 不装图片节点时截图返回明确失败，不建孤儿节点 |
| 7 | `plugin-node-video` | 声明 `produces.video`；帧图用独立字段/kind | 视频仍可连给下游；帧图不冒充用户图片 |
| 7a | `plugin-node-video` 的 `VideoContent.vue` / 音频组件 | 展示层从 `data.videoUrl/audioUrl` 改为 `resourceId` + `resolve` | 播放、裁剪、截图、下载在刷新后都可用 |
| 7b | 视频/音频/云插件写入方 | `videoOps.ts:279`、`audioOps.ts:182` 的 URL 双写改为只写 `resourceId`；`cloud-client/appliers.ts` **已补 `resourceId`**（地址暂留作迁移期副本，待 VideoContent/AudioContent 全部按 ID 现取后删） | 新生成结果只有 ID；旧存档可读 |
| 8 | `plugin-file-drop` | 图片/视频/音频改走 `media.put` + `media.addNode`；节点类型存在性由 `media.available()` 判断 | 缺某节点类型时跳过并给可见提示 |

## 第 3 批：读上游

| 顺序 | 包 | 改什么 | 验收 |
|---:|---|---|---|
| 9 | `plugin-node-text` / `plugin-node-audio` | 声明 `produces.text/audio` | `upstream.ofType('text')` 能取到文本 |
| 10 | `plugin-node-3d-preview` | 声明 `consumes.image`；`findUpstreamImageUrl` 改 `upstream.media('image')` | 不装图片时显示空态；装图片后自动显示 |
| 11 | `plugin-node-image-compare` | 声明 `consumes.left/right`；读上游改 `upstream` | 两张图按边序对应左右；字段改名时测试失败 |
| 12 | `plugin-node-ui` | 声明 `consumes.*`；`buildNodeContext` 改 `upstream` | 生成的上下文与旧实现字段一致 |
| 13 | `plugin-bottom-bar` | `collectUpstreamMaterials` 改 `upstream`（或抽到公共纯函数） | 底栏素材行、@ 引用、生成输入三处一致 |
| 13a | `canvas-data` 的 `upstreamGraph.ts` | 实现 `collectAncestors` / `topoOrderFrom`（纯函数，节点+边输入）；前端与后台共用 | 三层链路、分叉、菱形依赖、环四种测试通过 |
| 13b | `canvas-render` 的 `upstream` 能力 | `UpstreamNode` 提供 `upstream/ancestors/depth`；`UpstreamCapability` 提供 `closure/order` | 执行插件能拿到从末端倒推的拓扑序 |
| 13c | `cloud-server` 的 `CanvasDocument` 适配 | 用 `read()` 的 nodes/edges 调 `upstreamGraph`；给后台执行器提供同一份 `orderFor` | 前端与后台对同一张图算出相同顺序 |

## 第 4 批：底栏与工具契约

| 顺序 | 包 | 改什么 | 验收 |
|---:|---|---|---|
| 14 | `canvas-data`（类型）+ `canvas-base`（重导出） | 迁 `BarAction/BarApplier/registerBarAction/registerBarApplier/publishToolActions` 的类型与函数 | 节点包只依赖契约，不依赖 `plugin-bottom-bar` |
| 15 | `plugin-node-text/image/video` | 改用契约包 import | 临时移除底栏依赖后 typecheck 仍过 |
| 16 | `plugin-web2api-tools` | 删除手写 `nodeBar` 窄接口，改用公开类型 | 底栏改签名时编译期报错 |
| 17 | `plugin-tool-image/text-generation` | 抽公共 HTTP 适配；默认地址走公共设置 | 改协议只改一处；两条链测试共用 |

## 第 5 批：宿主扩展点与全局

| 顺序 | 包 | 改什么 | 验收 |
|---:|---|---|---|
| 18 | `plugin-agent` / `plugin-manager` / `mini-canvas-plugin-showcase` / `plugin-cursor-effect` | `settingsNav` id 与 `settingsGroup/<id>` 提成各自常量并加守卫测试 | 改 id 时编译期/测试失败 |
| 19 | `plugin-multi-select` | `.moving-handle-anchor` 改公开端口查询；`.vue-flow` 选择器收进 `canvas-render` | 主题改类名后批量连线仍可用 |
| 20 | `plugin-canvas-export` | 主题 `titleOffset/titleVisible` 与内部类名改公开契约 | 主题改默认值后导出跟着变 |
| 21 | `plugin-edge-cutting` | 边路径查询改公开契约；body 类加前缀；多画布不回退全局 | 主题改结构后切边仍可用；多画布不串 |
| 22 | 节点包 HMR | 统一三个全局名：`MiniCanvasPlugin`（重装器）、`MiniCanvasUI`（成品壳宿主）、`MiniCanvas`（直接嵌宿主默认名）；节点包现在读的 `MiniCanvas.reloadPlugin` 在成品壳里不存在 | 成品壳里改节点源码能自动重装 |

## 第 6 批：清理与拆分

| 顺序 | 包 | 改什么 | 验收 |
|---:|---|---|---|
| 23 | `plugin-node-image` | 删 `ImageGeneratePanel.vue`、只服务它的 `panelSource.ts` | typecheck/test 全绿 |
| 24 | `plugin-node-video` | 归档 `VideoContent copy.vue` | 搜索/构建不再扫到 |
| 25 | `plugin-node-ui` | 删未使用底栏依赖；后台半拆独立生命周期 | 前端卸载后后台路由可明确卸载 |
| 26 | `plugin-bottom-bar` | 拆媒体预览/参考选择/默认皮 | 底栏核心测试不变；不装子件时底栏完整 |
| 27 | `plugin-multi-select` | 拆批量连线、整组拖动、群组框 | 每条能力独立测试 |
| 28 | `plugin-history` | 评估删除；保留则标“仅兼容” | 无生产调用方后删包 |

## 每批的完成门槛

### 前置修复（与第 0 步一起做）

- 宿主资源回收 `CanvasHost.flushSave` 现在只收集 `data.resourceId`（`packages/canvas-render/src/host/CanvasHost.vue:1345-1350`）。
  `frameResourceId` / `leftResourceId` / `rightResourceId` 这类派生引用必须一并收集，否则保存后会被当成“未引用”回收。
- 修法：由节点类型声明 `refField` 列表，宿主遍历所有声明的字段；不要在每个组件里手写扫描。
- 验收：多节点共享一个 `resourceId`、以及使用左右/帧引用的节点，保存后资源仍可 `resolve`。

1. `pnpm -C packages/<包> test` 全绿；相关 `typecheck` 全绿。
2. 新增至少一条“装 A 不装 B”的装配测试。
3. `docs/插件开发规范.md` 的例外表删掉对应行。
4. 在 `docs/tmp/plugin-coupling-audit/` 详情页更新状态（保留证据，不改历史结论）。

## 不建议先做的事

- 不要先拆 `plugin-bottom-bar` 或 `plugin-node-ui`：契约没稳定时拆包会把同一份逻辑复制到两处。
- 不要先给所有插件加 `produces/consumes`：先做图片/视频/文本/音频四个数据源，消费方才有东西可读。
- 不要先做“通用插件总线”：现有服务 + 注册场 + 能力场已经够用，新增总线只会多一层。

