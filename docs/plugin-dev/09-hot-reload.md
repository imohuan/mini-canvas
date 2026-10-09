# 插件热重载（开发时改完即生效）

> 面向"正在写插件的人"。目标：**改插件源码 → `pnpm build` → 浏览器里的画布自己更新，不用刷新、不用手点。**

## 一句话

两条腿：

1. **前端一条命令**：`window.MiniCanvasPlugin.reload('插件名')` —— 卸旧 + 拉最新产物 + 装新。
2. **后端一个开关**：插件管理面板里的 **「热重载」**（或一行 `watch()`）—— 它连上 cloud-server 的
   **SSE**（`/api/plugin-events`），产物一变就自动替你调第 1 条。

连上之后，日常就是：**改代码 → 构建 → 看画布自己变**。

---

## 一、为什么需要它：改完为什么不会自动生效

浏览器里的插件是**已经加载进内存的模块**。你在磁盘上改了源码、甚至重新构建了产物，
浏览器手上那份还是旧的 —— 它不会知道磁盘变了。这跟"网页打开后，服务器换了图片、
网页不会自己变"是同一回事。

所以"生效"总要人推一把。以前推的方式是刷新页面（整页重来、画布状态丢），
或者手动重装插件（卸旧装新）。热的做法是**只重装那一个插件**，页面与画布状态都留着。

---

## 二、手动：一条命令重装

页面加载后就有一个全局函数（`packages/ui` 在启动时挂的）：

```js
// 按插件名 / 目录名 / 产物地址 —— 三种写法都认
await window.MiniCanvasPlugin.reload('style-library')
await window.MiniCanvasPlugin.reload('plugin-style-library')
await window.MiniCanvasPlugin.reload('/plugins/plugin-style-library/plugin-style-library.js')

// 装完顺手做一件事（可选）：比如把该插件的面板打开
await window.MiniCanvasPlugin.reload('style-library', { then: 'style-library:open' })
```

**它内部做了四步**（这就是"手敲那几行"的封装）：

1. **定位产物地址** —— 按名字去清单（`/plugin-catalog.json`）查；你直接给地址就跳过这步。
2. **加载最新产物** —— 走 UMD 加载器（和插件管理装插件同一条路），带时间戳破浏览器缓存。
3. **卸旧 + 装新** —— `reloadPlugin(name, 新模块)`：先卸（旧插件的注册/副作用全自动回收），再装。
4. **（可选）执行一条命令** —— 你传了 `then` 就执行，比如打开面板。

> 为什么不写 `uninstall` + `install` 两步：只装不卸会撞名报
> `[core] Duplicate plugin name`；`reloadPlugin` 内部就是"先卸后装"，不会踩这个。

**另外两个侦察函数**：

```js
await window.MiniCanvasPlugin.list()          // 列出可重装的插件（id / 名字 / 地址 / 现在装没装）
await window.MiniCanvasPlugin.catalog(true)   // 强制刷新清单（改了插件目录后）
```

---

## 三、自动：设置里的「热重载」分类（推荐）

手动重装总要你记得敲。自动版是：**登记几条链接，产物一变就自己重装。**
入口在 **设置 → 热重载**（左导航的一个分类），页面上四块：新增链接 / 已监听 / 手动重装一次 / 最近发生。

### 3.1 为什么要"手动填链接"

你的**后台地址不一定一样**（本机 8865、别的端口、别的机器），而且插件可以用
**vite dev server** 单独跑（那条链一次就覆盖该源下的多个插件/组件）。
所以这里不写死任何地址 —— 你填几条，它就听几条，**每条可以不同源**。

### 3.2 两种来源（填进去自动判，也能手动切）

| 类型 | 填什么 | 干什么 | 适合 |
|---|---|---|---|
| **SSE** | `http://127.0.0.1:8865/api/plugin-events` | cloud-server 盯**本机插件产物目录**，变了就推一条 `{id,name}` → 重装那个插件 | 改本仓库插件、走 `pnpm build` |
| **Vite** | `http://localhost:5311`（dev server 根地址） | 连 vite 的 HMR；有更新就把**该地址上的插件全重装** | 插件单独 `pnpm dev`，一个源多个插件/组件 |

> 填进去时按地址**自动判类型**（带 `/@vite/client` 或就是个裸 `host:port` → Vite；否则 SSE）。
> 判错了点那一行的图标手动切。

**Vite 那条为什么能"一个源支持多个插件"**：vite 的 HMR 只说"某模块变了"、不说插件名，
所以做法是**按 dev 地址反查清单** —— 清单里产物地址落在同一个 origin 上的插件，全部重装。
一个连接覆盖全源。

### 3.3 页面上的东西

- **已监听**：每行一条链接，可**开关**（临时停）、可**切换类型**、可**删除**。列表存在浏览器本地（localStorage），刷新还在。
- **手动重装一次**：不靠监听，直接重装某个插件（填插件名 / 目录名 / 产物地址都认）。
- **最近发生**：连接、重装、出错的流水（`connected` / `reload` / `error`），一眼看出"到底听没听、重没重"。

### 3.4 代码里怎么用（同一个单例）

页面用的是宿主挂的**单例** `window.MiniCanvasHotReload`，控制台与别的插件拿到的都是**同一份**
（不会两处各连一遍、把同一插件重装两次）：

```js
const hr = window.MiniCanvasHotReload
hr.addSource({ url: 'http://127.0.0.1:8865/api/plugin-events', label: '本机', type: 'sse', enabled: true })
hr.addSource({ url: 'http://localhost:5311', label: '文本节点 dev', type: 'vite', enabled: true })
hr.addSource({ url: 'http://其它机器:8865/api/plugin-events', label: '同事的服务', type: 'sse', enabled: true })

await hr.reload('style-library')   // 手动重装一个
hr.reconnect()                     // 改完地址后重连全部
hr.stopAll()                       // 全停
```

它内部**不重复实现重装** —— 只调用 `window.MiniCanvasPlugin.reload`（第二节那个），
所以"怎么卸旧装新 / 怎么查清单 / 怎么纠错"只有一份实现。

## 四、完整流程（从改代码到画布更新）

```bash
# 1. 起服务（画布界面 + 插件清单 + SSE 都在这一个端口上）
npx mini-canvas-cloud serve            # 或 pnpm -C packages/cloud-server serve

# 2. 起插件开发（可选：只改一个插件时，用它的 watch 构建）
pnpm -C packages/plugins/plugin-style-library build -- --watch   # 产物一变就重新构建
```

浏览器打开画布 → 设置 → 插件 → 打开 **「热重载」**。之后：

1. 改 `packages/plugins/plugin-style-library/src/...`
2. 构建（`pnpm -C packages/plugins/plugin-style-library build`）
3. → 后台在 2 秒内发现产物变了 → 推 SSE → 浏览器自动 `reload('style-library')`
4. → 画布上那个插件的界面/行为更新，**页面没刷新、画布状态没丢**

---

## 五、后台半（server.js）怎么热重载

上面说的是**前端半**（浏览器加载的 `plugin-*.js`）。
如果插件还有**后台半**（`dist/server.js`，由 cloud-server 跑），它是另一条路：

- 后台插件**重启 cloud-server 才生效**（`server-plugins` 目录是启动时扫的）；
- 想不重启就换，用 **插件管理的"重装"** —— 它会调 `/api/server-plugins/install`，
  cloud-server 有**热装**能力（运行期 import 进内核，路由即时可用）。

热重载 SSE **只管前端半**（产物目录里 `dist/*.js` 任一变都通知）。
前后端成对的插件，改了后台半请点一次"重装"，或重启服务。

---

## 六、想跳过 build？（插件自己的 vite dev server）

上面整条链的前提是"改完要 build"。如果你想要**改源码直接生效、连 build 都省**，
那是另一套做法 —— 让插件自己起一个 vite dev server，宿主直接 `import` 它的源码模块：

- 插件侧：`vite.dev.config.ts`（样板见 `packages/plugins/plugin-node-text/vite.dev.config.ts`），
  `pnpm dev:hmr` 起独立端口（如 5311）；关键是 **vue 单例**
  （插件 dev 必须 alias 到宿主同一份 vue，否则浏览器里两份 vue、组件挂不上）。
- 宿主侧：`import('http://localhost:5311/src/index.ts')` 拿模块 → `reloadPlugin`；
  变更通知用 vite 自带的 HMR（插件 `index.ts` 里 `import.meta.hot.accept`）。

权衡：**省了 build，但每个插件都要单独配 dev server、还得处理 vue 单例与跨端口**。
本仓库的调研与落地计划见 `docs/plan/plugin-dev-hmr-reload-plan.md`。

**结论（本项目的默认选择）**：统一走"**build + SSE 热重载**"这条 ——
一个后端盯所有插件、前端零配置、没有双 vue 风险。真要极致热更再单独上 dev server。

---

## 七、排查

| 现象 | 先查什么 |
|---|---|
| 改了没反应 | 是不是忘了 `pnpm build`？（SSE 只盯**产物**，不盯源码） |
| `reload` 报"宿主还没就绪" | 页面刚加载、画布还没起；等一会再调 |
| `reload` 报"清单里找不到插件" | 插件没构建（没有 `dist`）→ 清单里就没有它；先构建 |
| 报 `[core] …` | 你重装的是**核心插件**（`core: true`），它不允许热替换，这是设计 |
| 后台没推送 | `curl -N http://127.0.0.1:8865/api/plugin-events` 看连不连得上；再确认插件有 `dist` |
| 重装成"别的插件" | 不该发生（有全局名反查 + 纠错兜底）；真遇到请报，附上 `list()` 输出 |

---

## 八、相关代码在哪

| 干什么 | 文件 |
|---|---|
| 前端重装 + watch（`window.MiniCanvasPlugin`） | `packages/ui/src/pluginReload.ts` |
| 启动时挂 `window.MiniCanvasPlugin` | `packages/ui/src/main.ts` |
| **热重载数据层**（链接列表 / SSE / Vite / 日志） | `packages/plugins/plugin-hot-reload/src/data/hotReload.ts` |
| **热重载界面**（分类正文 / 导航项 / 容器） | `packages/plugins/plugin-hot-reload/src/components/` |
| 设置分类注册（本应用侧） | `packages/ui/src/hotReloadPlugin.ts` |
| 后台 SSE + 目录监视 | `packages/cloud-server/src/plugins/pluginWatch.ts` |
| 注册进内置插件 | `packages/cloud-server/src/plugins/builtin/routes.ts` |
| 单测 | `plugin-hot-reload/src/data/hotReload.test.ts`、`packages/ui/src/__tests__/pluginReload.test.ts`、`packages/cloud-server/src/__tests__/pluginWatch.test.ts` |
| e2e（真起服务连 SSE） | `packages/cloud-server/e2e/plugin-watch-e2e.ts` |

教程里与运行期装卸相关的另见：`docs/plugin-dev/06-composition-hmr.md`（manager / manifest / PENDING 诊断）。





