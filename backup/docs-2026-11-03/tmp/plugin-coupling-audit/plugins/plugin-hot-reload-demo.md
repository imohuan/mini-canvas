# plugin-hot-reload-demo

## 一句话

热重载试验台：只往 `overlay` 槽挂一张显眼的版本卡，用来验证“改源码 → build → 自动重装”整条链。插件间耦合几乎为零，但和 `plugin-hot-reload`、watch 脚本、云端清单之间有一组字符串暗契约。

## 清单

| 项 | 值 |
|---|---|
| 包名 `@mini-canvas/plugin-hot-reload-demo` | 插件名 `hot-reload-demo` |
| 身份 | installable（`defaultInstalled:false`） |
| 源码 / 测试 | 3 个生产源文件 / 1 个测试文件（另含 `scripts/watch.mjs`） |
| 包依赖的其他插件 | 无 |
| 是否引用其他插件内部入口 | 否；连 canvas-base 都不 import |

## 跨包 import

| 目标 | 入口 | 是否公开出口 | 证据 |
|---|---|---|---|
| 无运行时跨包 import | 只 import `vue` 与本地 `DemoCard.vue` | — | `src/index.ts:11-12` |
| 构建 | 自包含 UMD，只 external `vue` | — | `vite.config.ts:6,25-28` |

## 运行时协作

| 依赖 | 方式 | 必需/可选 | 证据 |
|---|---|---|---|
| `overlay` 槽 | 注册卡片；实际定位由 `DemoCard.vue` 决定，`meta.style` 不生效 | 契约 | `src/index.ts:22-27`；`src/DemoCard.vue:26-37` |
| `plugin-hot-reload` | 不 import；靠同名 + 清单 + KV 门铃被重装 | 外部工具链 | 见 `plugin-hot-reload` 详情；清单扫描 `packages/cloud-server/src/plugins/catalog.ts:377-430` |
| `watch.mjs` | 构建后 PUT KV 门铃 | 外部脚本 | `scripts/watch.mjs:29-32,50-56` |

## 全局与宿主粘连

| 对象 | 用途 | 风险 | 证据 |
|---|---|---|---|
| `meta.style` 固定定位 | 意图是卡片右上角，但 `SlotHost` 未消费 `meta`，实际不生效 | 中：字符串样式绕过设计 token；与 `DemoCard.vue` 自带样式叠加 | `src/index.ts:26`；`src/DemoCard.vue:26-37`；`packages/canvas-render/src/components/SlotHost.vue:29-33,56-65` |
| `order: 9999` | 排在 overlay 最后 | 低（仅开发）但会盖住其它浮层 | `src/index.ts:24` |
| `pointer-events` 期望“外层不挡画布、内层可点” | 但 `meta.style` 未落到 DOM，`SlotHost` 会把 `item-class` 加到卡片根上，宿主 `.csurface-overlay-item` 直接设 `pointer-events:auto` | 中：卡片当前很可能挡住其 100px 以下区域 | `src/index.ts:26`；`src/DemoCard.vue:31`；`packages/canvas-render/src/host/CanvasSurface.vue:542-544` |
| `http://127.0.0.1:8865` 默认后台 | watch 脚本写 KV | 中：端口写死，换端口需参数/环境变量 | `scripts/watch.mjs:25-27` |
| `plugin-watch:<pluginName>` | 门铃 key | 中：与热重载插件各写一份前缀 | `scripts/watch.mjs:31-32`；`packages/plugins/plugin-hot-reload/src/data/hotReload.ts:526` |
| `pnpm build` 子进程 | 文件变 → 构建 | 中：依赖包内脚本名与 shell 环境 | `scripts/watch.mjs:43-49` |

## 内部职责与风险

1. **职责单一**：只有一张卡片，适合作为热重载靶子；没有服务、命令、事件，卸载风险低。
2. **样式两套来源且一处不生效**：`index.ts` 的 `meta.style` 未被 `SlotHost` 消费，`DemoCard.vue` 的 `.hrdemo` 才是实际样式；文档与实际行为不一致。
3. **卡片本身有硬编码内容**：`VERSION='v15'`、`12312123` 之类测试文案留在源码（`src/DemoCard.vue:9-11,21`），容易误以为产品功能。
4. **watch 脚本与插件是隐式配套**：脚本写死 `plugin-watch:` 约定与默认后台端口；插件端解析同一前缀（`packages/plugins/plugin-hot-reload/src/data/hotReload.ts:526`），但两边没有共享常量或类型。
5. **没有覆盖整链**：`src/smoke.test.ts` 只锁插件名与 overlay 注册（`src/smoke.test.ts:5-22`），不验证“KV 门铃 → 清单查址 → GET 对比 → reload”这条链。

## 单独装卸判断

- 不装：无影响。
- 卸载：overlay 条目随作用域回收；watch 脚本独立运行，不受插件卸载影响。
- 装了但没跑 watch：卡片常驻，不会自动变化。
- 跑 watch 但没装插件：KV 门铃照发，热重载插件找不到清单项会记 error。

## 建议改法

1. **最小改动**：删掉不生效的 `meta.style`，把固定定位真正写进 `DemoCard.vue`；若要“不挡画布”，卡片根需要 `pointer-events:none`，仅按钮可点。
2. **共享约定**：把 `plugin-watch:` 前缀与默认后台端口提成脚本/插件共用的小常量文件，或至少让 watch 脚本从环境变量读，不写死 8865。
3. **测试补整链**：在仓库测试里模拟“清单 + KV 事件 + GET 对比 + reload 调用”，不必真浏览器；这是热重载唯一值得补的集成测试。
4. **清理演示文案**：把 `12312123` 这类测试残留删掉，版本号改为构建注入，避免手改源码才能看出变化。

## 待验证

- `meta.style` 未被 `SlotHost` 消费，已核实；但其它槽宿主是否会读 `meta.style`，未逐个排查。
- watch 脚本在 Windows 下 `spawn('pnpm', ..., { shell: true })` 的行为；未做跨平台验证。
- 热重载后旧卡片是否随插件卸载从 overlay 移除；依赖宿主重装路径，未在测试内核验。

