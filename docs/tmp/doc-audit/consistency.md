# 文档一致性审核（快照：2026-10-18 15:11）

审核对象（均按 15:11 的文本复核）：

- `docs/插件开发规范.md`
- `docs/design/node-data-and-upstream-contract.md`
- `docs/design/plugin-contracts-proposal.md`
- `docs/design/plugin-contract-migration-plan.md`
- `docs/文档审计与整改清单.md`
- `docs/插件规范索引.md`
- `docs/plugin-dev/index.md`
- 被引用的三篇 API 手册（节点注册 / doc / 连接校验）

方法：只读。`codegraph status` 确认索引最新（1,855 文件 / 21,951 节点），用 codegraph 查符号、`rg` 定位文字，逐条对照源码。源码与文档冲突时以源码为准。

审核期间这批文档正被多人同时写（15:00–15:11）。**已经修好的条目不再列在下面**，避免把过时结论当成交付物；文中每条都能在 15:11 的文本里复现。

## 结论

方向已经统一，主要风险从“规则写错”变成了“**同一份接口有多个副本，副本之间已经开始漂移**”。目前仍会让人写错代码的，集中在两处：

1. `media.addNode` 的参数形状在两份文档里不同。
2. 迁移清单里“先改展示层”的顺序补上了，但没写旧存档回退放在哪、删哪一处。

## P0：会让读者写出错的代码

### 1. `media.addNode` 的参数形状两份不一致

- 规范 `docs/插件开发规范.md:132`：`media.addNode(kind, resourceId, position, { meta })` —— 第四参是一个**裸对象**。
- 方案 `docs/design/plugin-contracts-proposal.md:46-50`：`addNode(kind, id, position, opts?: { nodeType?, meta? })` —— 第四参是 **`opts`**，`meta` 是它里面的字段。

后果：两个写法拼起来看，`{ meta }` 会被当成 `opts`；如果实现按方案读 `opts.nodeType`，调用方传的 `meta` 就丢了。这是“看起来一样、跑起来不一样”的典型。

建议：规范改成 `media.addNode(kind, resourceId, position, { meta })` 并紧接一句“第四参是 `opts`；`meta` 是 `opts.meta`”，或直接删掉这一行，只留“签名见方案 §方案一”。

### 2. 迁移清单 5.1/5.2 的顺序补了，但“旧地址回退放哪”没写

- 迁移清单 `docs/design/plugin-contract-migration-plan.md:22-23` 现在写明“5.2 先完成 5.1 的展示层改造”，顺序正确。
- 但 5.1 只写“从 `data.imageUrl` 改为 `resourceId` + `resolve`”，没写旧存档的回退分支放哪。
- 现状：`ImageContent.vue:30` 的 `imageUrl` 与 `:86` 的 `displaySrc` 完全依赖 `data.imageUrl`；`imageOps.ts:260/309/341/447/485` 这 5 处是它当前的唯一来源。

后果：按 5.1 直接删 `imageUrl` 读取，旧画布立即白屏；按 5.2 直接删写入，新图也白屏。两条单子各自看都对，合起来做成“先删再补”就会有一段真空期。

建议：5.1 明确“旧存档回退集中到 `resolveImageSrc(node)` 一个函数，打 `// 迁移期`，5.2 完成后再删”；5.2 的验收加真机步骤：刷新、翻旧画布、裁剪、旋转、扩展各一次。

## P1：会造成理解偏差或重复劳动

### 3. `MediaKind` 与契约词表仍是两份

- 契约 `docs/design/node-data-and-upstream-contract.md:33-38`：`image / video / audio / text / pano / file`（6 个）。
- 方案 `docs/design/plugin-contracts-proposal.md:56`：同样 6 个（已同步）。
- 但方案 `:246` 的待决问题仍写“`MediaKind` 包含 `text`，但 `put` 只接受 Blob；短文本直接写 `data.text`，长文本……声明 `refField`”，与 `valueField` 的新规则不一致（长文本该用 `valueField` 还是 `refField`）。

建议：把 `:246` 改成“短文本走 `valueField`；长文本走资源库并用 `refField`”，与契约 `:72` 一致。

### 4. `canvas-base` 的重导出范围与依赖方向不符

- 迁移清单 `docs/design/plugin-contract-migration-plan.md:13` 要求 `canvas-base` 重导出 `MediaCapability`/`UpstreamCapability`/`DataPortDef`。
- `canvas-base` 只依赖 kernel + canvas-data（`packages/canvas-base/package.json:17-20`）；`MediaCapability`/`UpstreamCapability` 是能力类型，定义在 `canvas-render` 才拿得到 Vue 的 `Ref`（参考 `packages/canvas-render/src/contracts/capabilities.ts`）。

建议：第 3 步拆成两句——“`DataPortDef` 放 `canvas-data`，由 `canvas-base` 重导出；`MediaCapability`/`UpstreamCapability` 留在 `canvas-render`；若插件作者需要，再从 `canvas-base` 以 `import type` 重导出，但不要让 `canvas-base` 依赖 `canvas-render`”。

### 5. “能力清单”没写清哪个能力给哪种条目

- 规范 `docs/插件开发规范.md:25` 列了 `node/zoom/selected/selection/tools`，并正确标了 `media/upstream` 未实现。
- 但 `selection` 是给**选择集条目**用的，`node/zoom/selected/tools` 是给**节点条目**用的（`packages/canvas-render/src/contracts/standardCapabilities.ts:61-64`）。

建议：表格加一列“用在哪种条目”：节点条目 / `ctx.selectionRegion.attach` 条目。否则新人会在节点组件里 `useCapability('selection')`，拿到 `undefined`。

### 6. 契约文档补了状态标记，但迁移清单还没有

- 契约 `:3` 与 `:49`、`:103` 现已补“提案，未实现”，正确。
- 但迁移清单 `docs/design/plugin-contract-migration-plan.md:5` 自称“施工单，不是新规范”，开头没有“当前状态：设计，未开工”。
- 读者从索引 `docs/插件规范索引.md:12` 直接进迁移清单时，会以为第 1 步已经在做或做完。

建议：迁移清单 `:5` 补一句“状态：设计稿，尚未开工；已完成项打勾”，并给每批加一个空复选框。

### 7. 例外表已拆分，但没写清 `plugin-node-video` 的额外问题

- 规范 `docs/插件开发规范.md:224` 现在把三个包拆成一行，并注明 video 的 package.json 格式问题，**比之前准确**。
- 但 `packages/plugins/plugin-node-video/package.json:32` 的依赖行是 `,"@mini-canvas/plugin-bottom-bar": "workspace:*"`（逗号开头、缩进不对），这是真实的格式错误；文档写了“有空行/格式问题”，但没写具体是哪行。

建议：在处理列补“`package.json` 第 32 行逗号开头，需格式化为正常字段”。

## P2：表述、格式与小错

### 8. 小数序号

`docs/design/plugin-contract-migration-plan.md:22-27` 用 `5.1/5.2/7.1/7.2`，与整数混排。建议改成 `5a/5b`，避免“5.1 读作 5 的补丁、实际先于 5.2”的歧义。

### 9. 索引页缺少“先看状态”的入口

`docs/插件规范索引.md:9-14` 列了 6 份文档，但没有标哪份是“已实现”、哪份是“提案”。建议在表里加“状态”列（规范=生效 / 契约=提案 / 方案=提案 / 迁移清单=施工单），并把阅读顺序改成“方案 → 迁移清单 → 规范 → 契约”。

### 10. `STATUS.md` 的教程篇数仍是 7

- `AGENTS.md:72` 已改成“篇数以入口为准”，正确。
- `docs/STATUS.md:5855` 仍写“7 篇”，`docs/plugin-dev/index.md:29` 与目录是 9 篇正文。

建议：把 `STATUS.md` 那一行也改成“见 `docs/plugin-dev/index.md`”，不再写死数字。

### 11. `STATUS.md` 开头仍是未解决的冲突标记

- `docs/STATUS.md:1-3` 是 `<<<<<<< ours` / `=======` / `>>>>>>> theirs`，正文被夹在标记里。
- `docs/文档审计与整改清单.md:36` 已列为 P0，至今未见修复。

建议：先解冲突；这份是“开工先读”的入口，坏掉的影响比任何规范都大。

### 12. `nodeSizeOf` 的说明不准确

- 规范 `:69` 写“尺寸统一写 `node.size`；……需要读旧数据时用 `nodeSizeOf`”，方向对。
- 但 `nodeSizeOf` 读的是 `data.cardWidth/cardHeight` 镜像（`packages/canvas-data/src/nodeStore.ts:72-78`），不是 `node.size` 正身（`:352-372`）。

建议：补一句“`nodeSizeOf` 读镜像，用于兼容只写了镜像的老数据；新代码读 `node.size`”。

## 需要统一的术语

| 概念 | 现有写法 | 建议 |
|---|---|---|
| 资源持久引用 | `resourceId`、`id`、`ResourceId`、`ref` | 字段名 `resourceId`；类型别名 `ResourceId` 只用于签名；`ResourcePutOptions.ref` 在文档里写成“引用名（refName）” |
| 非资源值 | `valueField`、`data.text` | 统一 `valueField`；不要再写“长文本用 `refField`” |
| 解析后的地址 | `url`、`src`、`xxxUrl` | 统一“临时地址”；`xxxUrl` 只用于旧存档与外部链接 |
| 节点的 data | `data`、`node.data` | 正文写 `node.data.<field>` |
| 槽名 / 端口名 | `slot`、`key`、`port` | 数据层“槽（slot）”、连接层“端口（port）”，不再互相类比 |
| 迁移期 | 迁移期、兼容期、现状、旧存档 | 统一“迁移期”，兼容分支必须带 `// 迁移期` 标记 |

## 需要补的章节

1. **规范 §3 加“失败与降级”**：`media.available()` 不含目标 kind、`put` 抛错、`resolve` 返回 `undefined` 时各显示什么。
2. **契约 §三 加“三选一的校验”**：`refField`/`valueField`/`externalUrlField` 恰好一个，缺省按 `kind` 推导；现在只有一句说明，没有规则表。
3. **方案加“与现有服务的关系”**：`resources`、`image/video/audio` 服务、`media` 三者调用方向与删除时机。
4. **迁移清单加“回滚与回归样本”**：每批怎么回滚、旧存档样本放哪、`resolve` 失败的文案由谁负责。
5. **索引页加“按角色读”**：节点作者 / 工具插件作者 / 宿主维护者三条线。
6. **审计清单加“状态列”**：区分“已改 / 待改 / 已归档”，避免读者把已修的条目当成待办。

## 附：核对用源码锚点

- 资源引用与地址：`packages/canvas-data/src/storage/types.ts:45-92`；`packages/canvas-data/src/resourceService.ts:74-78`、`:178-198`、`:249-330`。
- 现状双写：`plugin-node-image/src/imageOps.ts:260/309/341/447/485`；`plugin-node-video/src/videoOps.ts:279`；`plugin-node-audio/src/audioOps.ts:182`；`plugin-cloud-client/src/appliers.ts:97/115`（后两者只写 URL、缺 `resourceId`）。
- 展示层依赖：`plugin-node-image/src/ImageContent.vue:30`、`:86`。
- 能力清单：`packages/canvas-render/src/contracts/standardCapabilities.ts:105/118/129/133/152`。
- 端口与方向：`packages/canvas-data/src/canvas/connection.ts:92-180`、`:281-320`。
- 尺寸正身与镜像：`packages/canvas-data/src/nodeStore.ts:72-78`、`:352-372`。
- 宿主 API：`packages/canvas-render/src/host/createMiniCanvasHost.ts:128-137`、`:335-354`；`packages/ui/src/pluginReload.ts:16-17`。
