# 热装热卸与 NPM 插件

**一句话定位**：不重启服务，把一个后台插件装进去、再卸下来 —— 从浏览器点一下装（HTTP 上传），或直接从 NPM 装现成的包。这篇讲三种装载形态、热装为什么可行、以及卸载时 id 与插件名的对应关系。

## 这篇能让你做什么

读完本篇你会：

- 分得清三种装插件的方式（启动扫描 / HTTP 热装 / NPM 安装）各自适合什么场景；
- 明白为什么路由必须在 `apply` 里同步注册、卸载为什么能即时生效；
- 用 curl 完整走一遍「装 → 验证 → 卸 → 验证」的循环。

## 具体做法

### 三种装载形态，一张表分清

| 形态 | 怎么发生 | 什么时候用 |
| --- | --- | --- |
| ① 启动时扫目录 | 服务启动时扫 `<数据根>/server-plugins` 里的 `.js`，逐个装载 | 自己手工放文件，重启生效即可 |
| ② 运行期 HTTP 热装 | `POST /api/server-plugins/install` 落盘 + 当场装进内核 | 部署后不想重启；装完即时可用 |
| ③ NPM 安装 | `POST /api/npm-plugins/install` 下载 tarball、拆出后台半 `server.js` 落盘并热装 | 用发布到 npm 的现成插件 |

三种形态最终都走同一个动作：**把一个 `{ name, apply }` 模块交给内核登记**（启动是 `ctx.plugin(mod)`，热装是 `ctx.installPlugin(mod)`），差别只是「模块从哪来、什么时候来」。

### 热装为什么可行（三条根因）

1. **内核支持运行期装载**：`ctx.installPlugin(mod)` 就是内核提供的运行态方法（`serverFramework/index.ts` 里把根 Context 的这个能力经能力段 `ctx.runtime` 暴露给热装钩子）。
2. **路由代理每请求现查注册场**：插件路由不是一次性烙进 Hono 的死表，而是每条代理 handler 每次请求都现查注册场 —— 注册场变了，行为立刻跟着变。
3. **Hono 路由表冻死，靠 catch-all 兜底**：Hono 首次请求后路由表冻结，运行期新注册的 path 在 Hono 里没有条目。所以启动时挂了一条 `app.all('*')` 的兜底代理：请求按 `method + path` 现查注册场，命中就调真 handler。这三条合起来（`hotLoad.ts` 文件头注释原文），热装才真正做到「装完即可用」。

### 用 curl 走一遍热装循环

前提：目录里已有插件文件（比如 showcase 的 `dist/server.js`，id 是 `mini-canvas-plugin-showcase`）且 `/plugin-catalog.json` 清单里登记了它。

```bash
# ① 查已装清单（看 id 与 loaded 状态）
curl http://127.0.0.1:8865/api/server-plugins

# ② 热装：code 是插件 JS 的完整文本；confirm 与 sha256 都必填
curl -X POST http://127.0.0.1:8865/api/server-plugins/install ^
  -H "Content-Type: application/json" ^
  -d "{"id":"mini-canvas-plugin-showcase","code":"<JS文本>","sha256":"<清单里那份>","confirm":true}"

# ③ 验证：装完立刻可用（不用重启）
curl http://127.0.0.1:8865/api/showcase/hello

# ④ 热卸：按 id 摘
curl -X POST http://127.0.0.1:8865/api/server-plugins/uninstall ^
  -H "Content-Type: application/json" ^
  -d "{"id":"mini-canvas-plugin-showcase"}"

# ⑤ 验证：路由立刻 404
curl http://127.0.0.1:8865/api/showcase/hello
```

- ① `plugins` 数组是**目录实况**（文件名 + 大小 + permissions 声明），`loaded` 是**内核里活着的插件名**（启动登记 + 运行期热装都在内）。
- ② 四道安全关一条都不能省（细节见下文「install 路由的安全关」）。实际操作一般不用 curl 手拼 —— 浏览器的插件管理页会替你下载产物、带上确认与哈希。
- ③④⑤ 卸载是**删文件 + 从内核摘除**两步：文件删了下次启动不会复活，内核摘了路由立刻失效。

### NPM 安装：一条命令背后发生什么

```bash
curl -X POST http://127.0.0.1:8865/api/npm-plugins/install ^
  -H "Content-Type: application/json" ^
  -d "{"package":"mini-canvas-plugin-showcase","confirm":true}"
```

服务端按顺序做这些事（`routes/npmPlugins.ts` 的 `doInstall`）：

1. **包名形状 + 前缀白名单**：默认只允许 `mini-canvas-` / `@mini-canvas/` 开头的包（可用环境变量 `MINI_CANVAS_NPM_SCOPES` 放开），防止「npm 上任意包」被装进来；
2. **查 packument** 定版本（缺省 `dist-tags.latest`），并校验包的 `miniCanvas` 段结构（`pluginName` + web/server 入口）——不是插件就拒装；
3. **下载 tarball**（`npmClient.ts`，默认 30 秒超时）并解包到临时目录；
4. **拆两半落盘**：前端半 `dist/*.js` → 插件目录 `<包名>/dist/`（catalog 收录、强制补 `installable: true` + `npmInstalled: true` 标记）；后台半 `dist/server.js` → `<数据根>/server-plugins/<包名>.js`，并**服务端自己算 sha256** 记进来源记录（`.npm-installed.json`）；
5. **热装钩子**：后台半落盘后立刻 `hotInstall(id)` 装进内核 —— 装完即时可用；
6. 前端半**刷新页面**即可见（catalog 动态收录），后台半如上即时生效。

更新（`/api/npm-plugins/update`）= 按 `dist-tags.latest` 重走一遍 install，版本一致返回「已是最新」；卸载删掉 NPM 副本目录（只删 `package.json.name` 与包名一致的那份，绝不会误删你的源码包）+ 来源记录 + 后台半文件。

### id 与插件名：为什么可能不同

- **id** = 落盘文件名（去 `.js`），比如 `mini-canvas-plugin-showcase`；
- **插件名** = 模块里 `export const name`，比如 `showcase`。

两者可以不同。卸载时按 id 精确摘：`hotLoad.ts` 装载时记下 `id → 真名` 映射；**重启后**那份映射丢了，就按候选序列现推（先真名，再逐步剥离 `mini-canvas-` / `-plugin-` 前缀，最后用 id 本身），逐个试，摘到就停 —— 不然重启后卸载会留下「列表里还在、内核里没有」的幽灵项。

## 每一步在干什么

- **路由必须在 apply 里同步注册**：Hono 首次请求后路由表冻结，启动装载的路由靠「start 时一次性把注册场里已有的 path 翻成代理」命中；运行期热装的靠 catch-all 兜底命中。但两条路都只认**注册场里已经有的条目** —— 如果你在 `apply` 里 `setTimeout` 之后再注册路由，注册场里暂时没有这条，请求就打不到。
- **卸载/重装即时生效**：注册场是活的表。重装（同名插件再次 `installPlugin`）替换注册场里的条目；卸载（`uninstallPlugin`）让条目连同路由、定时器、私有存储一起消失。
- **`serverPluginsLoaded` 快照怎么保持「活着」**：启动登记的外挂插件名存进一个共享数组，`bindHotLoadedTracking(sink)` 把它绑到热装/热卸上 —— 热装时把名字推进去、热卸时摘掉，而绑定那一刻已在数组里的启动名单**永不摘除**。这样 `GET /api/server-plugins` 的 `loaded` 与插件自省（如 showcase 的 `hello.plugins`）看到的始终是最新集合。
- **install 路由的安全关**（`serverPlugins.ts` 文件头，一条都不能省）：
  1. `confirm: true` 必填 —— 界面必须让用户看到「以服务端权限运行」并显式确认；
  2. `sha256` 必须与**服务端自己的清单**（扫插件目录算出的那份）一致 —— 比对调用方现算的哈希等于没校验；
  3. `id` 白名单 `[A-Za-z0-9_-]{1,64}` —— 杜绝 `../evil` 路径穿越；
  4. 落盘与执行分离：请求里只写文件，热装钩子由宿主当场执行（没配钩子就退化成重启生效）；
  5. 跨源默认拒绝（`origin` 与本服务不符 → 400）。

## 源码出处

| 这篇里的说法 | 真实文件 | 真实行为 |
| --- | --- | --- |
| 热装可行三根因 | `packages/cloud-server/src/serverFramework/hotLoad.ts` 文件头 | 内核支持运行期装载；路由代理现查注册场；Hono 冻死靠 catch-all 兜底 |
| id→真名映射与卸载候选序列 | 同上 `hotUninstallServerPlugin` | 先真名（装时记下），再剥离 `mini-canvas-`/`-plugin-` 前缀，最后 id 本身；摘到就停 |
| `serverPluginsLoaded` 活快照 | 同上 `bindHotLoadedTracking` | 热装推入、热卸移除；启动名单永不摘除 |
| install 安全关（confirm/sha256/id 白名单/落盘不执行/跨源拒） | `packages/cloud-server/src/routes/serverPlugins.ts` 文件头 + `POST /api/server-plugins/install` | 每条约束顺序执行，任一不符返回 400 |
| loaded 字段 | 同上 `GET /api/server-plugins` | `plugins` = 目录实况；`loaded` = `serverPluginsLoaded` 快照 + `hotLoadedNames()` 现取 |
| NPM 前缀白名单 | `packages/cloud-server/src/routes/npmPlugins.ts` | 默认 `mini-canvas-` / `@mini-canvas/`；环境变量 `MINI_CANVAS_NPM_SCOPES` 可覆盖 |
| 下载与解包 | `packages/cloud-server/src/npm/npmClient.ts` | `packument` / `search` / `downloadTarball`（30s 超时），解包用系统 tar |
| 两半落盘 + 服务端算哈希 | `npmPlugins.ts` `doInstall` | 前端半 → `plugins/<pkg>/dist/`；后台半 → `server-plugins/<id>.js`，sha256 记入 `.npm-installed.json` |
| catalog 提供可信哈希 | `packages/cloud-server/src/plugins/catalog.ts` | 扫插件目录时对 `dist/server.js` 算 sha256，作为服务端信任源 |
| 浏览器侧怎么发 install | `packages/plugins/plugin-cloud-client/src/manager/pluginManagerService.ts` `installServerHalf` | 下载产物文本 → 带 `confirm: true` 与清单哈希 POST install；confirm 未给就静默不发 |

## 常见坑

1. **热装时报「sha256 与清单声明不符」**：你的插件文件改过了，但 `/plugin-catalog.json` 是扫插件目录算的哈希，两者对不上。重新构建插件（让产物与清单同源），或者确认清单里登记的就是你要装的那份。
2. **服务端没配可信哈希来源时 install 直接 400**：这是刻意设计 ——「宁可不装，也不要假装校验过」。开发态走仓库默认配置（自带 catalog），不会遇到。
3. **卸载后 `loaded` 里还有它**：先查 id 是否拼对（按 id 摘，不是按插件名）。重启后 id→真名映射靠前缀剥离现推，如果 id 的形态特殊（推不出真名），会留下幽灵项 —— 这时直接重启服务最干净。
4. **NPM 装完前端列表里没有**：catalog 靠落盘的 `package.json` 判定。安装路由会强制补 `installable: true`；如果你手工改过那份 package.json 把它关了，列表就不收录 —— 别手工动 NPM 副本的清单。
5. **在 apply 里 setTimeout 再注册路由**：注册场里那条会晚于热装动作出现，catch-all 兜底虽然每请求现查，但查不到就 404。路由注册必须同步完成（这也是 showcase 精读篇反复强调的一条）。
6. **以为装 NPM 包只影响前端**：只要包里有 `dist/server.js`，后台半就会以服务端权限运行 —— 所以 `confirm: true` 必填、前缀白名单默认收紧，都是同一件事的两面。
