# plugin-style-library

## 一句话

风格库/特效库的前后端成对插件。UI 已经通过 `ui` 注册场按名取件，真正的耦合在外壳、后台地址和设置键。

## 清单

| 项 | 值 |
|---|---|
| 包名 | `@mini-canvas/plugin-style-library` |
| 身份 | installable |
| 源码文件 | 14（含测试；生产 12） |
| 测试文件 | 2：`data/api.test.ts`、`data/store.test.ts` |
| 包依赖的其他插件 | 无直接包依赖 |

## 跨包 import

| 目标 | 入口 | 是否公开出口 | 证据 |
|---|---|---|---|
| canvas-base | 类型、`markRaw` 的 Vue 依赖 | 是 | `src/index.ts:39` |
| canvas-render | `useCanvasRender` / `useUiComponent` | 是 | `src/components/StyleLibraryOverlay.vue:16`、`EffectLibraryOverlay.vue:14` |

## 运行时协作

| 依赖 | 方式 | 必需/可选 | 证据 |
|---|---|---|---|
| `settings` | `ctx.tryGet('settings')` 读 `cloudClientBaseUrl` | 可选 | `src/data/api.ts:40-47` |
| `cloud-client` / `cloud-save` | 读 `status().baseUrl` | 可选 | `src/data/api.ts:44-46` |
| `ui` 场 | 注册六个 UI 件，组件之间按名取 | 契约 | `src/index.ts:129-136`、`names.ts:15-22` |
| `overlay` 槽 | 注册两个外壳 | 契约 | `src/index.ts:139-150` |
| `command` 场 | 注册开合命令 | 契约 | `src/index.ts:153-165` |
| `ctx.settings.onChange` | 设置改动后推后台/重载 | 契约 | `src/index.ts:169-183` |

## 全局与宿主粘连

| 对象 | 用途 | 风险 | 证据 |
|---|---|---|---|
| `fetch` | 访问 `/api/style-library`、`/api/effect-library` | 无法注入；单测需假 fetch | `src/data/api.ts:60-105` |
| `cloudClientBaseUrl` 字符串 | 跨插件地址配置 | **暗契约**：cloud-client 改键名，这里会静默回落同源 | `src/data/api.ts:41` |
| `cloud-client.status().baseUrl` | 地址回落 | 依赖一个未在 canvas-base 里声明的形状 | `src/data/api.ts:45-46` |
| 默认目录 `I:/Assets/...` | 本机绝对路径 | 换机器/换系统直接失效 | `src/data/store.ts:78-80` |

## 内部职责与风险

1. **外壳和内部件职责分开做得好**：外壳只读服务 state，卡片/广场/详情从 `ui` 目录取，换 UI 不需要改数据层。
2. **前后端成对**：前端 `data/api.ts` 的六个路由前缀与 `server.ts` 的路由必须手工保持一致；没有共享常量。`server.ts:52-65` 同时定义两套前缀。
3. **跨插件地址解析重复**：与本包 `api.ts` 几乎相同的三级回落也出现在 `plugin-showcase/src/apiBase.ts`，两份实现各自维护，键名/形状漂移时不会一起坏。
4. **`inject = []` 是诚实的**：缺 cloud-client 时仍可同源运行；但地址配置在设置面板里属于 cloud-client，用户不一定知道要装它。

## 单独装卸判断

- 不装：画布正常，仅风格库/特效库入口不存在。
- 只装前端、不装后台半：UI 能开，首次拉取会显示“后台没应答 JSON”，错误提示已做成人话。
- 卸载：服务和 UI 注册随插件作用域回收；磁盘目录不会被删除。

## 建议改法

1. **把“后台地址解析”提成一个公共契约**，放在 `canvas-base` 或 `canvas-data` 的公开类型里（例如 `CanvasServerEndpoint` 服务，含 `baseUrl()`）。`style-library`、`showcase`、生成工具统一按名取，去掉对 `cloudClientBaseUrl` 和 `cloud-client.status()` 的私有假设。
2. 前端路由前缀从单一常量表导出，`server.ts` 也引用同一张表；这样加一个库不会只改一半。
3. 默认目录改成可空/相对路径，启动时由后台确认；本机绝对路径只作为文档示例。
4. 给 `resolveApiBase` 增加“键存在但没有提供者”的明确诊断，避免用户以为地址已生效。

## 待验证

- `ctx.settings.onChange(scope, cb)` 与 `ctx.tryGet('settings').onChange(cb, opts)` 的参数顺序差异是否已有统一类型守卫；当前只能靠注释提醒。
- 两个库的 `server.ts` 在企业部署下是否会因为默认绝对路径而扫描失败；需要真机验证。

