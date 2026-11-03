# plugin-manager

## 一句话

设置页里的插件市场与装卸入口。它把云端清单、UMD/ESM 加载、宿主安装句柄、后台插件安装串在一起，是这批插件里跨层最多的一件；主要风险是宿主与后台接口都是手写窄契约、清单有两套真相。

## 清单

| 项 | 值 |
|---|---|
| 包名 `@mini-canvas/plugin-manager` | 插件名 `plugin-manager` |
| 身份 | builtin |
| 源码 / 测试 | 9 个生产源文件 / 4 个测试文件（全包 13 个文件） |
| 包依赖的其他插件 | 无 |
| 是否引用其他插件内部入口 | 否；但宿主 `packages/ui/src/pluginReload.ts` 反向 import 了它的公开 `createUmdLoader` |

## 跨包 import

| 目标 | 入口 | 是否公开出口 | 证据 |
|---|---|---|---|
| canvas-base | `Context`、`PluginModule` 类型 | 是 | `src/pluginManagerService.ts:12`；`src/pluginManagerPlugin.ts:15` |
| canvas-render | `useCanvasRender`（页面取 ctx） | 是 | `src/usePluginManager.ts:7-12` |
| ui 反向依赖 | `packages/ui/src/pluginReload.ts` 动态 import `createUmdLoader`/`bustCache` | 公开出口 | `packages/ui/src/pluginReload.ts:346-353` |
| 其他插件源码 | 无 | — | — |

## 运行时协作

| 依赖 | 方式 | 必需/可选 | 证据 |
|---|---|---|---|
| `pluginManager` | 宿主统一安装句柄（`install/uninstall/reload/list`） | 可选探测，缺则操作报清晰错误 | `src/pluginManagerService.ts:222-223,563-565` |
| `save` | `config` 域存“已装意图” | 可选 | `src/pluginManagerService.ts:252-255,698` |
| `save.onAdapterChange` | config 切云端后重读名单 | 可选 | `src/pluginManagerService.ts:285-295` |
| `settingsNav` + `settingsGroup/插件` | 设置页 | 契约（两个 id 同名） | `src/pluginManagerPlugin.ts:57-68` |
| `plugin-manager` 服务 | 页面读状态 | 自有 | `src/pluginManagerPlugin.ts:54`；`src/usePluginManager.ts:12` |
| `/plugin-catalog.json` | 清单 | 固定路由 | `src/pluginManagerService.ts:145,692` |
| `/api/server-plugins`、`/install`、`/uninstall` | 后台半状态与安装 | 固定路由 + 固定 JSON 形状 | `src/pluginManagerService.ts:367,501,528`；服务端 `packages/cloud-server/src/routes/serverPlugins.ts:75-180` |
| `/api/npm-plugins/{browse,search,install,update,installed,uninstall}` | NPM 市场 | 固定路由 | `src/pluginManagerService.ts:743,753,763,790,809,829` |
| 全局 `MiniCanvasPlugin*` | UMD 产物取模块 | 跨插件构建契约 | `src/umdLoader.ts:26,55-100` |

## 全局与宿主粘连

| 对象 | 用途 | 风险 | 证据 |
|---|---|---|---|
| `globalThis` / `window` | UMD 全局扫描、确认框 | 高：依赖全局命名与脚本执行顺序 | `src/umdLoader.ts:55-100`；`src/pluginManagerService.ts:197` |
| `globalThis.crypto.subtle` | 计算前端半 sha256（实际后台以服务端清单为准） | 中：环境缺失直接拒绝安装 | `src/pluginManagerService.ts:166-171` |
| `window.confirm` | 后台插件授权确认 | 中：阻塞式、非设计系统；5 处 | `src/pluginManagerService.ts:653`；`src/components/settings/PluginManagerPage.vue:44,58,179,212` |
| `plugin-manager:installed` | `config` 域存档键 | 中：固定字符串，无类型化键表 | `src/pluginManagerService.ts:20-21` |
| `document.createElement('script')` | UMD 装载 | 中：脚本执行后无法真正卸载，只能卸注册 | `src/umdLoader.ts:61-100`；注释 `src/umdLoader.ts:9-11` |
| `MiniCanvasPlugin` 全局前缀 | 无 `globalName` 时扫描全部 | 高：多插件并存可能挑错 | `src/umdLoader.ts:75-94` |
| `Date.now()` 破缓存 | 重装拉新产物 | 低 | `src/umdLoader.ts:103-105`（`bustCache`） |

## 内部职责与风险

1. **宿主句柄是手写窄接口**：`HostPluginManager`（`src/pluginManagerService.ts:56-61`）与 canvas-render 的真实安装器形状相同但不是同一类型；宿主签名变化不会让本包编译失败。
2. **UMD 全局扫描有“最后手段”**：清单不给 `globalName` 时会扫所有 `MiniCanvasPlugin*`，多插件并存可能挑错；代码已自认这条风险（`src/umdLoader.ts:84-93`）。
3. **清单与静态装配两套真相**：`packages/ui/src/assembly.ts` 的 `APP_PLUGINS` 与云端 `/plugin-catalog.json` 同时描述“装什么”；前者是冷启动，后者是设置页，二者判据不同（builtin/installable）。
4. **后台半是独立生命周期**：前端加载与后台 `server.js` 安装分开，卸载要避免重复调用；已有 `skipServerHalf` 防重复（`src/pluginManagerService.ts:544-546,584-586`），但错误分支仍复杂。
5. **NPM 包名与目录 id 靠字符串换算**：`pkg.replace(/^@/, '').replace('/', '__')`（`src/pluginManagerService.ts:781`）同时承担“目录名/清单 id”两种语义，包名规则一变就断。
6. **目录删除护栏**：NPM 卸载只删“package.json name 与包名一致”的副本（`packages/cloud-server/src/routes/npmPlugins.ts:420-430`），这一点做得对；前端仍需避免把源码目录当副本。
7. **首次默认全装已改成 opt-in**：`saved === undefined` 时只装 `defaultInstalled:true` 的项（`src/catalogTypes.ts:123-153`；`src/pluginManagerService.ts:697-727`），注释里“首次默认全装”的说法已过期。

## 单独装卸判断

- 不装：用户只能用静态装配的插件，无法从市场装/卸。
- 不装宿主 `pluginManager`：页面能开，每次操作给出清晰错误。
- 卸载：设置页、服务随作用域回收；已执行过的 UMD 脚本无法从浏览器撤回，只能卸注册。
- 装 cloud-client 后：config 域切云端会触发本服务重读名单；这是跨插件最关键的时序，已有测试覆盖（`src/__tests__/pluginManagerService.test.ts:220-251`）。

## 建议改法

1. **最小改动**：从 canvas-render 导出 `HostPluginManager` 类型，本包直接 import 类型，删除本地复制；同时强制清单带 `globalName`，去掉全局扫描兜底（或只在 dev 开）。
2. **契约收口**：把 `/plugin-catalog.json`、`/api/server-plugins/*`、`/api/npm-plugins/*` 的请求/响应类型提到共享包或由 cloud-server 生成；当前两边各写一份。
3. **清单单一来源**：`APP_PLUGINS` 与 catalog 由同一构建步骤产出，或在启动时用一份清单校验另一边，避免“面板显示已装、实际没装”。
4. **确认框替换**：把 5 处 `window.confirm` 换成设计系统对话框，便于统一文案、自动测试与无障碍。
5. **测试补边界**：补“没有 `globalName` 的清单必须被拒绝/告警”“NPM 包名含 scope 时目录 id 换算”“config 切换失败时不写空名单”三条测试。

## 待验证

- 宿主 `pluginManager` 是否所有 CanvasHost 形态都注入；当前只看到 `createMiniCanvasHost` 一侧。
- `m.reload` 在 `HostPluginManager` 接口里声明但本服务未调用；重装走的是 `uninstall + install`（`src/pluginManagerService.ts:617-645`），接口的 `reload` 可能是历史残留。
- UMD 脚本不可卸载的说明是否已进入用户界面；代码注释有，产品提示未核。

