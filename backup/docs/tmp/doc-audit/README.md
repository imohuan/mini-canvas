# 文档审核（2026-10-18）

审核对象：

- `docs/插件开发规范.md`
- `docs/design/node-data-and-upstream-contract.md`
- `docs/design/plugin-contracts-proposal.md`
- `docs/design/plugin-contract-migration-plan.md`
- `docs/文档审计与整改清单.md`
- `docs/插件规范索引.md`

规则：只读，不改业务代码；每条结论附 `file:line`；发现文档与源码不一致时，以源码为准并标出。

输出：

- `resource.md`：资源“只存 ID”方案审核（已完成）。
- `consistency.md`：跨文档一致性审核（已完成）。
- `facts.md`：与源码事实核对（已完成；实测 `canvas-data` 398 条、`plugin-node-image` typecheck/build 通过）。

## 已修（2026-10-18 15:20 前）

| 问题 | 修正 |
|---|---|
| “只存 ID”被写成已完成事实 | 规范 §1.4 标为**目标形态**，并写明云端 `putResource` 仍返回 URL、`restoreNodeMediaUrls` 仍写回 `data` |
| `DataPortDef` 两套定义 | 统一为 `refField?` / `valueField?` / `externalUrlField?` 三选一；`text` 用 `valueField` |
| `ref` 与 `resourceId` 混用 | 示例统一 `resourceId`；`ResourcePutOptions.ref` 只表示“引用名” |
| `media.addNode` 签名不一致 | 规范写 `(kind, resourceId, position, { nodeType?, meta? })`，并指向方案为唯一签名来源 |
| 示例当前编不过 | 规范 §2.4 拆“现在能编译 / 迁移后启用”两段；契约 §三/§六标“提案，未实现” |
| 能力名把 `media/upstream` 写成已存在 | 规范能力表标“提案未实现”；`selection` 注明只给选择集条目 |
| 迁移顺序错位 | 资源引用形态提为第 0 步；迁移清单标“设计稿，未开工”；5a/5b、7a/7b 拉开顺序 |
| 章节重复/错位 | 契约重排为“地址准入表 → 连接方向 → 消费方 → 提供方”；重复 §6.2 改为 §7.3 |
| 派生字段与“不进 data”冲突 | 区分“编辑所需元信息（允许）”与“纯展示派生值（titleExtra 现算）” |
| 外部地址边界 | 新增“地址准入表”：`resourceId` 唯一推荐；`blob:` 永不；`data:` 按有无 `resourceId` 区分 |
| 云端复制画布会裂图 | 迁移清单要求“逻辑 ID 带画布作用域，复制按 ID 重映射” |
| `ResourcePutOptions` 文档过时 | `packages/docs/services/resources.md` 改为四字段 |
| `AGENTS.md` 教程篇数 | 改为“以入口为准”，不再写死 7 篇 |

## 仍待办

1. **事实审核（facts.md）**：补服务名/字段/数字的逐条核对。
2. **`STATUS.md` 冲突标记**：开头 `<<<<<<< ours` 未解；本次未改，避免碰坏历史记录。
3. **`useResourceUrl`**：目前只是提案 API，尚未实现；迁移前用 `resources.resolve`。
4. **剪贴板载荷**：当前深拷贝整份 `data`，临时地址会一起进载荷；迁移时要收敛。
5. **宿主回收资源**：`CanvasHost.flushSave` 只扫 `data.resourceId`，不扫 `frameResourceId`/`leftResourceId`/`rightResourceId`；这是现存 bug，需单独修。
6. **嵌套上游（执行插件）**：`UpstreamNode.upstream/ancestors/depth` 与 `UpstreamCapability.closure/order` 仍是提案；实现顺序见迁移清单 13a-13c。

