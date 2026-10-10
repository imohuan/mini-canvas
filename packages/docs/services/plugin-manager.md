# `pluginManager` · 插件管理

**一句话定位**：**`pluginManager` 是画布的"装卸车间"—— 装一个新插件、卸掉一个插件、把一个插件换成新版本，都从它这里走。**

**它属于哪一档**：**渲染宿主**。由渲染层 `canvas-render` 的宿主建好并注入（源码：`packages/canvas-render/src/host/pluginManager.ts` 的 `createPluginManager`；注入点：`packages/canvas-render/src/host/createMiniCanvasHost.ts` 里的 `ctx.inject('pluginManager', manager)`）。**纯数据层拿不到它**——没有渲染宿主时 `ctx.get('pluginManager')` 返回 `undefined`。

## 用法

### 先分清两个名字很像的东西

| 名字 | 是什么 | 拿法 |
| --- | --- | --- |
| `pluginManager` | **宿主注入的服务**（本次要讲的） | `ctx.get('pluginManager')` / `ctx.tryGet('pluginManager')` |
| `plugin-manager` | **一个插件**（在设置面板里长出"插件"页的那个） | 它自己 `ctx.inject('plugin-manager', reactive(service))` 上架服务；页面用 `ctx.get('plugin-manager')` 取 |

一句话：**服务 `pluginManager` 是"装卸的手"，插件 `plugin-manager` 是"装卸的界面"**。界面自己也是通过 `pluginManager` 动手的。

### 插件来源有五种（`PluginEntrySource`）

```ts
export type PluginEntrySource =
  | PluginModule                          // 内存里的插件对象（源码 import 来的）
  | PluginClassLike                       // Service 子类
  | { module: () => PluginModule | Promise<PluginModule> }   // 懒加载
  | { url: string }                       // 远程 URL（拉下来当脚本执行）
  | { text: string }                      // 单文件插件 js 文本
```

配套有个分类函数，**只分类、不决策**（宿主可据此实施自己的信任策略，比如只放行白名单域名）：

```ts
export function sourceKind(source: PluginEntrySource): PluginSourceKind   // 'inline' | 'lazy' | 'url' | 'text'
```

### 方法逐个看

签名逐字来自 `packages/canvas-render/src/host/pluginManager.ts` 的 `PluginManager`。

| 方法 | 签名 | 干什么 | 什么时候用 |
| --- | --- | --- | --- |
| `install` | `install(source: PluginEntrySource, opts?: { config?: PluginManifestEntry['config'] }): Promise<string>` | 装一个来源，返回**插件名**；同名已装会先卸再装（换版本）；核心插件则**抛错** | 用户点"安装" |
| `uninstall` | `uninstall(name: string): boolean` | 卸一个插件；**核心插件 / 没装 / 未启动都会抛错**（不静默失败） | 用户点"卸载" |
| `reload` | `reload(name: string, next?: PluginEntrySource): Promise<void>` | 换版本：卸旧的装新的；`next` 不传 = 只卸不装；会保留上次的装配 config | 用户点"重装/更新" |
| `list` | `list(): InstalledPluginInfo[]` | 已装插件清单（名 + 装配 config + 运行态 `state`/`missingDeps`/`error`） | 渲染"已装列表" |
| `diagnose` | `diagnose(): InstalledPluginInfo[]` | 只看**没在正常跑**的那些（`state !== 'active'`） | 排查"装了怎么没反应" |
| `applyManifest` | `applyManifest(manifest: PluginManifest): Promise<string[]>` | 按清单顺序批量装；同 id 后装覆盖先装；`disabled: true` 的跳过 | 冷启动按清单装配 |
| `manifestReport` | `manifestReport(manifest: PluginManifest): ManifestReportEntry[]` | **只读**分析清单：哪条关闭了、哪条会被同名覆盖、哪条将装 | 装配前给用户看"会发生什么" |

清单的形状：

```ts
export interface PluginManifest {
  plugins: PluginManifestEntry[]
}

export interface PluginManifestEntry {
  id: string                 // 稳定身份（推荐 = 插件 name）
  source: PluginEntrySource
  config?: object            // 这个插件的装配 config（经它自己的 Config schema 校验 + 补默认）
  disabled?: boolean         // true = 登记但跳过不装（便于日后打开）
  group?: string             // 展示分组（不影响装载语义）
}
```

`list()` 每条的形状：

```ts
export interface InstalledPluginInfo {
  name: string
  config?: object
  state?: string             // pending / loading / active / failed / …
  missingDeps?: string[]     // state !== 'active' 时：还缺哪些依赖
  error?: string             // failed 时的错误消息
}
```

### 两个辅助函数（宿主/加载器用）

| 函数 | 签名 | 干什么 |
| --- | --- | --- |
| `loadPluginFromText` | `loadPluginFromText(text: string): Promise<PluginModule>` | 把一段 ESM 插件 js 文本加载成模块（走 data-URL import，不用 `eval`） |
| `loadPluginFromUrl` | `loadPluginFromUrl(url: string): Promise<PluginModule>` | 抓 URL 再用上面的函数加载 |
| `resolveSource` | `resolveSource(source: PluginEntrySource): Promise<PluginModule>` | 把任意来源归一成一个 `PluginModule`（`install` 内部就走它） |

### 三件必须知道的语义

**① 核心插件不能被卸**。插件在自己模块里声明 `core: true`（例如基础插件 `canvas-base`），`uninstall` 会**抛错**而不是返回 `false`：

```
[pluginManager] cannot uninstall plugin "canvas-base" (core) during uninstall
```

原因：应用层的句柄不做静默失败。而且**抛错时不碰它的配置快照**（半途丢配置是旧实现的 bug）。想先问再动手，用内核的 `ctx.canUninstall(name)`（返回 `{ ok, reason }`，`reason` 有 `core` / `not-found` / `not-started`）。

**② `list()` / `diagnose()` 会隐去宿主自有装配**。建 manager 时可以传 `hiddenPlugins`（宿主传的是 `[base.name]`，也就是 `'canvas-base'`）——画布基础服务对应用层是"环境"，不是"清单项"。

**③ 名称有三种可能的写法，别搞混**：清单里的 `id`（多数是目录名）、清单里的 `name`（包名）、以及插件源码里 `export const name`（**真实插件名**）。`install` 返回的、`uninstall` 要的是**真实插件名**。真实消费者就是按"真名 → 清单名 → 目录名"依次尝试来对齐的（`packages/plugins/plugin-cloud-client/src/manager/pluginManagerService.ts` 的 `tryUninstall`）。

## 注意事项

1. **核心插件卸载会抛错，不是返回 `false`**。插件声明了 `core: true`（例如 `canvas-base`）时，`uninstall` 抛 `... (core) during uninstall`，而且**不会碰它的配置快照**（"先删配置再被拦"是旧实现在这个问题上踩过的坑）。想避免异常流，先问 `ctx.canUninstall(name)`。
2. **`uninstall` / `reload` 对"没装 / 未启动"也抛错**。`assertUninstallable` 把 `canUninstall` 的三种失败态（`core` / `not-found` / `not-started`）都带原因抛出来——好处是调用方能区分"没装"和"装着但不可卸"，代价是每次调用都要准备好 try/catch。
3. **服务 `pluginManager` 与插件 `plugin-manager` 是两样东西**。宿主注入的叫 `pluginManager`（装卸的手）；设置面板里那一页来自插件 `plugin-manager`（它自己再上架一个叫 `plugin-manager` 的服务）。写代码时看名字容易串，认准大小写与连字符。
4. **名称有三种形态：清单 id、清单 name、真实插件名**。`install` 返回的是**真实插件名**；`uninstall` 要的也是它。真实消费者（插件管理插件）用"真名 → 清单名 → 目录名"依次尝试并逐个 `try/catch`，就是因为这三者常常对不上。
5. **URL/文本来源的脚本卸不干净（代码本身）**。通过 `{ url }` 装的 UMD 产物是用 `<script>` 执行的——脚本一旦执行就留在页面里，`uninstall` 只是让内核回收它注册的一切（这已经足够安全），但那段代码的全局变量还在。用 `install` 装同名插件时，manager 会先卸旧的再装新的（避免撞重名）。
6. **`list()` 默认看不到宿主的自有装配**。`createMiniCanvasHost` 建 manager 时传了 `hiddenPlugins: [base.name]`，所以 `'canvas-base'` 不在列表里；但内核的 `ctx.listPlugins()` 依然看得到它。想查"到底装了哪些"，两者都要看。
7. **纯数据层拿不到它（`undefined`，不抛）**。没有渲染宿主的环境里 `ctx.get('pluginManager')` 是 `undefined`。取用方照插件管理插件的写法：`ctx.tryGet('pluginManager')`，拿不到就给一句清晰错误/提示，别静默装死。

