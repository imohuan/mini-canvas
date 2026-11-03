# 插件管理插件 + 本地中转后台（实现记录）

日期：2026-10-02 · 类型：功能实现 · 状态：**已完成（单测 + 真浏览器验证通过）**

## 一、要做什么（用户原话拆解）

1. 做一个 **插件管理插件**：它自己是一个插件，提供一个 **自定义设置页面**（插槽实现，照 `plugin-agent` 的设置界面）。
2. 这个页面能 **安装 / 卸载 / 重装** 第三方插件。
3. 第三方插件怎么加载：**请求一个 JSON 清单拿到每个插件的 JS 地址，再加载那个 JS**（cloud-server 的 `/plugin-manifest.json` 就是这条路）。
4. 后台放在哪还没定 → 先做一个 **本地临时中转后台服务**（单独开启，很简单，就是把地址转换一下）。
5. `packages/ui` 里 **注释掉一部分插件**（不必全留），改成由「插件管理」插件来安装；**默认全部设为已安装**。

## 二、已确认的两个决定（用户答复）

- **加载方式 = 宿主暴露全局 + 加载 UMD**：`ui` 把 `Vue / MiniCanvasCore / MiniCanvasRender / MiniCanvasBase` 挂到 `window`，中转站直接发已有的 UMD 产物，插件管理用 `<script>` 装载。改动最小、复用现有打包。
- **先放这几个（已能 UMD 打包）**：`plugin-node-image-compare`、`plugin-tool-image-generation`、`plugin-tool-text-generation`。

## 三、终态

### 3.1 清单与资源投放 —— **已并入 cloud-server**（原独立包 `plugin-relay` 已删）

> 2026-10-02 下午：用户要求「把 plugin-relay 的功能转移到 cloud-server」——已照做。
> 独立的中转进程不再需要，功能全部搬进 `cloud-server`（`mini-canvas-cloud serve`，默认 8865）。

- `GET /plugin-catalog.json` → `{ ok, version, plugins: PluginCatalogEntry[], skipped }`；每条含
  `id / name / title / description / url / globalName / requiresGlobals / defaultInstalled / version`。
  实现见 `packages/cloud-server/src/plugins/catalog.ts`（`buildPluginCatalog`）。
- `GET /plugins/<pkg>/<相对路径…>` → 发 `packages/plugins/<pkg>/dist/<相对路径>` 的字节（挡穿越 +
  扩展名白名单，支持子目录与**非 js 资源**——css/图片/字体）；`/plugins/<file>` 扁平形态也认。
- **两份清单分工**（别混）：
  | 清单 | 给谁 | 收录 | 加载方式 |
  | --- | --- | --- | --- |
  | `/plugin-manifest.json` | 画布应用自己（ui 的 onReady） | **ESM** 产物 | `import(data:text/javascript)` |
  | `/plugin-catalog.json` | 「插件管理」插件（用户手动装卸） | **UMD + miniCanvas.installable** | `<script src>` |
- 插件管理的默认清单地址 = **同源 `/plugin-catalog.json`**（不再写死端口；跨源时在设置页填绝对地址）。

### 3.2 插件管理插件 —— `packages/plugins/plugin-cloud-client/src/manager/`（原独立包已并入）

> 2026-10-02 晚：用户要求「删除插件管理，移植到 client 中」——已照做。
> 独立的 `packages/plugins/plugin-manager` 包已删，整套（服务 + 两个 .vue + UMD 加载器 + 单测）
> 搬进 `plugin-cloud-client/src/manager/`；仍是**一个可独立装卸的插件**（宿主照旧把它加进 `APP_PLUGINS`），
> 界面一个字没改。导入路径由 `@mini-canvas/plugin-manager` 变为 `@mini-canvas/plugin-cloud-client/manager`。
>
> **为什么必须走子路径入口而不是并进 `index.ts`**：`plugin-cloud-client` 的 ESM 产物要**零 import**
> （由服务器清单下发、经 `data:` URL 加载，裸模块名解析不了）。而插件管理要 Vue 与 .vue 组件 ——
> 混进同一条出口会把 Vue 拖进产物、云插件当场炸。所以另开 `./manager` 子路径（源码入口，随 ui 打包走）。
> 已实测：ESM 产物 `hasImportStmt=false / mentionsVue=false / mentionsManager=false`。

- 插件名 `plugin-manager`，`inject: []`（对宿主服务只做**可选探测**，缺了也不静默装死）。
- **设置页面（插槽）**：照 `plugin-agent` 的写法 ——
  - `Config` 声明一个 **扁平分组** `插件`（`group: '插件'`），设置面板才会长出这一页；
  - `ctx.slots.register('settingsNav', { id: '插件', component: PluginManagerNav })` 给左导航项；
  - `ctx.slots.register('settingsGroup/插件', { id: 'plugin-manager-page', component: PluginManagerPage })` 接管正文。
- **服务**：`ctx.inject('plugin-manager', reactive(service))`，页面读它。服务持：清单条目 + 每条状态（已装/未装/安装中/出错）+ 动作 `refresh/install/uninstall/reinstall/installAll`。
- **加载**：`umdLoader.ts` 往 `<head>` 插 `<script src=url>`，等 load 后从新增的 `MiniCanvas*` 全局里找出插件模块（`{ name, apply|setup }`）。重装加 `?t=` 破缓存。
- **装/卸**：走宿主注入的 `pluginManager` 服务（`manager.install(mod)` / `manager.uninstall(name)` / `manager.reload(name, mod)`）。
- **默认全装 + 持久化**：清单加载完，按 `save`（config 域）里存的已装 id 集合决定装哪些；**首次没有存档 → 默认全装**。

### 3.3 `packages/ui` 改动

- 新增 `src/sharedGlobals.ts`：把 `Vue / MiniCanvasCore / MiniCanvasRender / MiniCanvasBase` 挂 `window`（供 UMD 插件取用）。`main.ts` 里先装全局再挂载。
- `assembly.ts`：注释掉 `nodeImageComparePlugin / pluginImageGenerationTools / pluginTextGenerationTools`（改为经中转站安装）；加入 `pluginManagerPlugin`。
- `package.json`：加依赖 `@mini-canvas/plugin-cloud-client`、`@mini-canvas/canvas-base`。
- `vite.config.ts`：optimizeDeps.exclude 加 `@mini-canvas/plugin-cloud-client`。
- 更新 `__tests__/entrypoint.test.ts` 的插件数（25 → 23）。

### 3.4 `packages/canvas-render` 改动（一行）

- `createMiniCanvasHost` 建好 `manager` 后 `ctx.inject('pluginManager', manager)`，让插件按名取到统一安装句柄。

## 四、验证

- 单测：`cloud-server`（清单构造 / 路径穿越 / 非白名单拒绝 / 真取 css·png·子目录 svg 字节）、`plugin-cloud-client`（含 manager 子目录）、`canvas-render`、`ui` 全绿。
- 真机：起中转站 + `pnpm -C packages/ui dev` → 设置面板出现「插件」页 → 三个插件默认已装 → 卸载「图片对比节点」后节点类型消失 → 重装后回来。

### 实测结果（2026-10-02）

| 检查点 | 结果 |
| --- | --- |
| 首次打开（清 localStorage） | 三个插件（图片对比 / 图片生成工具 / 文本生成工具）**默认全部装上**、state=active ✅ |
| 设置面板左导航 | 出现「插件」一级项，正文是中转地址 + 刷新 + 全部安装 + 逐条 安装/卸载/重装 ✅ |
| 卸载「图片对比节点」 | 内核里 `image-compare` 消失、节点类型 `image-compare` 消失、存档意图同步移除 ✅ |
| 重装 | 回来、state=active ✅ |
| 刷新页面 | 照存档：卸过的不自动装回 ✅ |
| 控制台 | 0 报错 ✅ |

单测基线：cloud-server 185、plugin-cloud-client 114、kernel 212、canvas-data 360、canvas-render 404、ui 67 全绿；
`ui` 生产构建通过（云插件的零依赖 ESM 产物实测不含 import / Vue / manager）。

### 排查过程中修掉的两个真缺陷（都不是猜的，是浏览器实测暴露的）

1. **重装/并存时挑错插件**：UMD 加载器原来「取脚本新挂的全局」，重装时那个全局名已存在（宿主的
   `MiniCanvasPlugin*` 是常驻的），于是退化成「扫全部全局取第一个」→ 三条清单都挑到了
   `image-compare`。修：清单带 `globalName`，加载器优先按名取。
2. **默认全装会漏**：`refresh()` 中途把 `state.rows` 整批换新对象，与另一次 refresh（设置页挂载时触发）
   交叠时，前一趟写在「孤儿行」上 → 三个只装上两个。修：`refresh` 重入复用同一个 Promise，
   且行改为**原地对齐**（同 id 复用 row 对象）。顺带把「已装集合」改记**意图**（想装哪些）而不是
   结果 —— 中途失败/提前关页面，下次启动会补上没装上的。

## 六、后续补充（2026-10-02 下午，用户提问驱动）

用户问了三件事，逐条做了**实测**而不是只看代码：

### 1. 装/卸是否实时生效、有没有热重载 → **有，浏览器实测**

真浏览器（`pnpm -C packages/ui dev` + 中转站）里跑：

| 动作 | 结果 |
| --- | --- |
| 卸载图片对比插件 | 节点类型 `image-compare` 消失、服务 `imageCompare` 消失（**不刷新页面**）✅ |
| 重装 | 类型与服务都回来 ✅ |
| 热装一个自带服务+命令+插槽的自定义插件 | 服务可 `ctx.get`、命令进注册表、插槽 occupant 立刻渲染在页面上 ✅ |
| 热卸它 | 服务/命令/插槽**全部回收**（页面上那坨内容消失）✅ |
| `reloadPlugin(name, 新实现)` | 同名不同实现**就地换掉**（v1 → v2）✅ |

机制本就完备：`installPlugin`/`uninstallPlugin`/`reloadPlugin` + 插件 scope 自动回收（注册/命令/服务/插槽随卸载全清）。
零报错。

### 2. 插件相关 API 检查结论

- **插槽**：`ctx.slots.register(slot, {id, order, component, meta})` / `remove` / `occupants` —— 实测注册后立刻渲染、卸载即摘。
- **主题槽（单赢家换肤）**：`ctx.theme.register(slot, comp, {id, order})`（order 小者赢）。
- **节点**：`ctx.nodes.register`（数据+展示+建节点）、`ctx.nodes.attach(type|'*', {region, component, needs, props})`、
  多选框 `ctx.selectionRegion.attach`。
- **命令/工具/配置**：`ctx.commands.register`、`ctx.tools.register`、`settings` 走 `Config` schema 自动登记。
- **服务**：`export const inject = [...]` 硬依赖 + `ctx.inject(name, impl)` 上架 + `ctx.get/tryGet` 取。
- **注册场（可诊断/可叠层）**：`ctx.registryOf(kind)`、`ctx.surface()`（一次列全部注册）。
- **生命周期事件**：`ctx:plugin-installed` / `ctx:plugin-uninstalled` / `ctx:lifecycle-change` / `ctx:ready`。

一句话：插槽/服务/命令/工具/配置/事件都齐，且**都是 effect、卸载自动回收**（实测印证）。

### 3. 本地图片 / CSS 外链 → **能**，且顺带补了中转站的资源能力

实测 vite 打包行为（临时探针，验完即删）：
- 小图（<4KB，`assetsInlineLimit` 默认 4096）→ **内联成 base64 进那一个 js**（单文件就够）。实测 66B PNG 内联 ✅
- 20KB PNG → **也内联**（vite lib 模式下的行为）✅
- 若产物里出现**兄弟文件**（超限大图 / `?url` / `new URL('./x.png', import.meta.url)`）→ **原中转站只发 `.js`，取不到**。

**已修**：`/plugins/<pkg>/<相对路径>` 现在按扩展名白名单发**任意插件资源**（js/css/json/图片/字体/音视频/wasm），
给正确 MIME、支持子目录、仍挡穿越与非白名单扩展名；并加了一个给人看的首页 `GET /`。
relay 单测 19 → 25（新增：css/png/子目录 svg 真取字节 + 首页 + 非白名单拒绝 + 多段穿越）。

> 仍需注意（提前说清）：插件运行时**动态算出**的地址（`file-loader` 风格、或运行期 `import()` 一个没写进产物的路径）
> 无法自动补全 —— 那时要插件自己指定绝对 URL。常规静态 `import` 都会被 vite 处理成内联或可请求的兄弟文件。

## 五、不做

- 不做真正的后台（用户还没定放哪）；中转站只是本地临时件。
- 不动 v1（根 `src/`、`packages/canvas-core`）。
- 不改核心节点件（`plugin-theme-default` 的六个件）。
