# plugin-cloud-client

## 一句话

把画布存档、生成动作、生成历史和实时跟随接到 cloud-server。它不画界面，是一层协议/存档适配器；耦合主要来自固定 HTTP 路径、共享服务名与全局共享 SSE 约定。

## 清单

| 项 | 值 |
|---|---|
| 包名 `@mini-canvas/plugin-cloud-client` | 插件名 `cloud-client` |
| 身份 | installable（`defaultInstalled:false`），但在 cloud-server 托管界面时作为自带件启动 |
| 源码 / 测试 | 19 个生产源文件 / 13 个测试文件（全包 32 个文件） |
| 包依赖的其他插件 | 无 |
| 是否引用其他插件内部入口 | 否：源码刻意零工作区 import，连类型都用 `shims.ts` 自备 |

## 跨包 import

| 目标 | 入口 | 是否公开出口 | 证据 |
|---|---|---|---|
| 无运行时跨包 import | `plugin.ts` 从 `shims.js` 取类型；`keys.ts` 内联数据层常量 | 自包含 | `src/plugin.ts:12`；`src/keys.ts:1-9` |
| 构建约束 | `vite.config.ts` 不设 external，产物零 import | — | `vite.config.ts:4-8,20` |
| 其他插件源码 | 无 | — | 生产源码无 `@mini-canvas/plugin-*` import |

## 运行时协作

| 依赖 | 方式 | 必需/可选 | 证据 |
|---|---|---|---|
| `doc` | `inject=['doc']` | 硬 | `src/plugin.ts:28,199` |
| `save` | `tryGet('save')` 换 canvas/resource/config/shortcut 四个 adapter | 可选，缺则只读不落盘 | `src/plugin.ts:208-220` |
| `settings` | 读 `cloudClientBaseUrl` / `cloudClientPollMs` | 可选 | `src/plugin.ts:191-193,430-435`；`src/config.ts:9-28,40-48` |
| `viewport` | 恢复云端视口 | 可选 | `src/plugin.ts:227,258` |
| `resources` | 恢复媒体地址；视频/音频产物落库 | 可选 | `src/plugin.ts:239-246,347-351` |
| `nodeBar` | 注册后台动作与 video/audio 结果写入器 | 可选（缺则无动作） | `src/plugin.ts:273,309-336,343-364` |
| `node/bar` 注册场 | 直接清理同名族动作 | 契约场键（绕过服务写口） | `src/plugin.ts:319-325`；场名 `packages/plugins/plugin-bottom-bar/src/nodeBarPlugin.ts:38` |
| 对外服务 | `gen-history` / `cloud-client` / `cloud-save` | 自有（被宿主与其它插件按名消费） | `src/plugin.ts:366-383` |
| 宿主全局 `__miniCanvasKvEvents` | 复用全应用唯一 SSE 连接 | 可选探测（缺则自开一条） | `src/api.ts:263-313,323-336`；宿主实现 `packages/ui/src/composables/kvEvents.ts:28-36` |
| `window.location` | 取当前画布 id | 固定 URL 约定 | `src/keys.ts:30-43` |

## 全局与宿主粘连

| 对象 | 用途 | 风险 | 证据 |
|---|---|---|---|
| `/api/canvases/*`、`/api/jobs`、`/api/actions`、`/api/history`、`/api/kv/*` | 全部后台协议 | 高：前后端无共享路由/响应类型 | `src/api.ts:53-247`；`src/cloudKvAdapter.ts:42-43` |
| `/api/kv/events` | 实时跟随、动作清单、历史刷新 | 中：固定路径与事件形状 | `src/api.ts:265`；`src/remoteSync.ts:178-188` |
| `providers-version` / `history-rev` | 后台动作与历史的“铃铛”键 | 中：字符串键与 cloud-server 约定 | `src/keys.ts:16-19`；`src/remoteSync.ts:184-187` |
| `__miniCanvasKvEvents` | 防多长连接 | 中：跨 bundle 全局暗契约 | `src/api.ts:323-335`；`packages/ui/src/composables/kvEvents.ts:31` |
| 注入全局 `setInterval` | 动作清单兜底轮询 | 低：卸载清理 | `src/plugin.ts:424-427,439-443` |
| 固定画布 id 默认值 `default` | URL 取不到时回落 | 中：与 Agent/node-ui 各写一套 | `src/keys.ts:22-43` |
| 媒体字段表（`imageUrl/videoUrl/...`） | 节点数据字段约定 | 中：与 canvas-data 的媒体表逐字对齐靠测试 | `src/plugin.ts:180-188`；`src/keys.ts:45-70` |

## 内部职责与风险

1. **职责合并合理**：存档、动作、历史、实时跟随共用一条 SSE 与一套 API，避免四份连接。
2. **直接写 `node/bar` 场**：注册动作走 `nodeBar.register`，但清理同名族动作走 `ctx.registryOf('node/bar').remove`；注册场是**叠层**而非覆盖（`packages/kernel/src/registry/registry.ts:97-106`），`remove` 只摘最外一层（`packages/kernel/src/registry/registry.ts:185-198`），与底栏服务的“同 id 替换”语义不同，换底栏实现或叠层顺序变化时容易漏。
3. **对外服务名有历史层**：`cloud-client`、`cloud-save`、`gen-history` 三个名字同时存在；`packages/ui`、`plugin-showcase`、`plugin-style-library` 都按名读取，属于跨层暗契约。
4. **自包含带来的常量漂移**：`keys.ts` 内联画布 key、媒体字段、画布 id 规则；测试会逐字比对部分常量，但画布 id 解析仍是两份实现。
5. **安装并不等于可用**：后台不可达时插件仍装载，`status.error` 记录错误；画布保存已切到云端 adapter，失败路径会直接影响本地保存。需要确认切换后失败是否回退。
6. **首次上云迁移与资源引用耦合**：`migrateLocalResources` 依赖节点类型 → 媒体字段表，新增节点类型不在表里就会默认写 `imageUrl`。

## 单独装卸判断

- 不装：本地存档、离线能力保留；无后台动作、历史、实时跟随。
- 装但后台不可达：插件仍挂服务；存档 adapter 已切换，写入会失败，这是最大运行时风险。
- 在 cloud-server 托管界面中：`builtinPluginsForUiHost` 会把它作为自带件追加到清单尾部，因此不是“默认不装”。
- 卸载：服务、动作、SSE 订阅随作用域回收；已切到云端的 adapter 是否恢复本地，代码里没有看到显式回退。

## 建议改法

1. **最小改动**：把 `providers-version`、`history-rev`、`graph/graph-edges/graph-viewport` 与画布 id 解析提成一份公开契约（或至少由 cloud-server 与前端共享生成），删除 `keys.ts` 的手写副本。
2. **动作清理收口**：`staleActionIds` 的清理改走 `nodeBar` 服务提供的删除/替换 API，避免直接碰 `node/bar` 场。
3. **失败回退**：补一条“后台不可达时保存仍可用”的集成测试；若产品要求云端优先，也应在 UI 明示“当前离线、改动可能丢失”。
4. **服务名收敛**：给 `cloud-client` / `cloud-save` / `gen-history` 写一份类型化服务声明，消费方共用，避免字符串散落。
5. **迁移表单一来源**：媒体字段映射改为从 canvas-data 的公开表生成，新增节点类型自动覆盖。

## 待验证

- `save?.useAdapter('canvas', adapter)` 在后台不可达或初始化失败时是否有回退；当前只看到设置与错误记录。
- `node/bar` 的 `remove(key,id)` 只摘最外层；云插件若不清掉自己这一层，先注册的 web2api 动作仍会在 `remove` 后露出来。当前逻辑是否符合预期，需要一次集成验证。
- `keys.ts` 与 canvas-data 的媒体字段表是否已全部逐字对齐；只核对了部分测试。

