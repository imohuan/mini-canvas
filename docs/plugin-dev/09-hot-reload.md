# 插件调试（热重载）—— 改完源码，画布自己换新

> 面向「正在写插件的人」。目标只有一个：**改 `src/` → 保存 → 画布里那个插件自动换成新代码**，
> 不刷新页面、不丢画布状态、不用手动点重装。
>
> 本文写的是**现在的实际链路**（KV 上报制，2026-10 落地）。
> 老文章里的 SSE 声明文件、`hotReloadManifest`、「设置 → 热重载」面板都**已经下线**，别照抄。
>
> **监听脚本由插件作者自己写**，平台不强制任何构建工具。格式契约与状态定义见
> `docs/plugin-dev/10-debug-protocol.md`；本文是**照着做一遍**的教程。

---

## 0. 全景：这条链上有谁

```
你（改 src/）
   │
   ▼
watch 脚本（插件包里的 pnpm watch）
   · 盯 src/，防抖 200ms
   · 变了就 pnpm build（构建失败不通知）
   · 成功后往后台写一条记录（KV）
   ▼
cloud-server 后台
   · 把这条记录存下来
   · 通过现成的 KV 实时通道（SSE）广播一句「plugin-watch:某插件 变了」
   ▼
画布里的「热重载插件」（随应用启动，不用装）
   · 收到广播 → 读那条记录 → 拿到产物地址
   · 探测产物确实变了 → 卸旧装新 → 右下角弹通知
```

一句话记住分工：**watch 负责「构建 + 告诉地址」，后台负责「存记录 + 喊一嗓子」，画布负责「换代码」。**

---

## 1. 你需要准备什么

| 东西 | 怎么来 | 说明 |
|---|---|---|
| 后台服务 | `pnpm -C packages/cloud-server serve`（默认 `127.0.0.1:8865`） | 存调试记录、发产物、推通知 |
| 画布页面 | 后台托管页（`:8865`）或 `pnpm -C packages/ui dev`（`:5288`） | dev 页的 `/api` 会代理到 8865 |
| 一个插件包 | 见 `docs/plugin-dev/01-first-plugin.md` | 放 `packages/plugins/plugin-xxx/` |
| watch 脚本 | `packages/plugins/plugin-hot-reload-demo/scripts/watch.mjs`，复制进你的包 | 这就是整条链的「本地半」 |

---

## 2. 插件包需要满足的三件事

### 2.1 `package.json`：声明插件的唯一名字

```jsonc
{
  "name": "@mini-canvas/plugin-my-thing",
  "scripts": {
    "build": "vite build",
    "watch": "node scripts/watch.mjs"
  },
  "miniCanvas": {
    "pluginName": "my-thing",
    "installable": true
  }
}
```

`pluginName` 是**唯一判据**：内核里已有同名插件就不再装第二份（内核按名字索引，重复装直接拒绝）。
它同时也是调试记录的 key（`plugin-watch:my-thing`）。

### 2.2 打包：自包含 UMD + CSS 打进 JS

照抄 demo 的 `vite.config.ts`（或用共享的 `pluginLibBuild`）：

```ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'

export default defineConfig({
  plugins: [vue(), cssInjectedByJs()],
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'MiniCanvasPluginMyThing',
      formats: ['umd'],
      fileName: () => 'plugin-my-thing.js',
    },
    rollupOptions: { external: ['vue'], output: { globals: { vue: 'Vue' } } },
  },
})
```

两个坑提前说：

- **CSS 不打进 JS = 样式全部失效**。宿主只加载 `plugin-my-thing.js` 一个文件，
  vite 默认拆出来的 `.css` 没人去加载（真机踩过：界面裸奔无样式）。
- **external 只留 vue（及宿主全局）**。宿主只允许一份 Vue / MiniCanvas\*，
  多余的打进产物会加载出第二份实例，直接炸。对照表见 `packages/plugins/vite-plugin-lib.ts`。

### 2.3 复制 watch 脚本

把 `plugin-hot-reload-demo/scripts/watch.mjs` 复制到你的包 `scripts/` 下即可，**零配置可用**：

> 这份脚本只是**参考实现**。你用 rollup / esbuild / 自写脚本都可以，只要按协议发那几条 HTTP
> 请求（见 `10-debug-protocol.md` §3 的最简实现，不装任何包也能用）。脚本留在各自插件里，
> 平台不统管构建方式。

- 插件名：自动读 `package.json` 的 `miniCanvas.pluginName`（退回落包名去作用域）；
- 前端地址：自动拼 `http://<后台>/plugins/<包目录>/<插件名>.js`（按后台的托管规则）；
- 后台路径：`dist/server.js` 或 `dist/plugin-server.js` 存在就自动带上。

启动时它会打印一次自己将要上报的地址，**先看这一行再开改**，地址不对就用参数改（见 §4）。

---

## 3. 日常调试流程

```bash
# 终端 1：后台
pnpm -C packages/cloud-server serve

# 终端 2：你的插件（挂着别关）
pnpm -C packages/plugins/plugin-my-thing watch

# 浏览器：打开画布，把插件装一次（设置 → 插件 → 本地清单 → 安装）
```

然后：

1. 改 `src/` 里任何文件，保存；
2. watch 打印 `[watch] built in … → 通知 OK | front=…`；
3. 1–2 秒内画布右下角弹「热重载完成」，插件界面变成新代码；
4. 页面没刷新，画布状态没丢；
5. 构建失败时 watch 会打印错误、**不发通知**（半成品不进画布），改完错误再保存即可。

---

## 4. watch 的三个可调参数

| 想改什么 | 怎么给 | 缺省 |
|---|---|---|
| 后台地址 | `--backend http://…` 或环境变量 `MINI_CANVAS_BACKEND` | `http://127.0.0.1:8865` |
| 前端产物地址 | `--front <浏览器能打开的地址>` 或 `MINI_CANVAS_PLUGIN_FRONT` | 按 `<后台>/plugins/<包目录>/<名>.js` 拼 |
| 后台产物路径 | `--server <后台机器上的绝对路径>` 或 `MINI_CANVAS_PLUGIN_SERVER` | 自动找 `dist/server.js` / `dist/plugin-server.js` |

什么时候必须用 `--front`：**你的产物不在后台的插件目录里**（插件放在别的盘、别的项目），
自动拼的地址浏览器打不开，就手动给一个能打开的。
`--server` 只对「插件与后台在同一台机器」有意义，跨机器时省略它（走插件管理上传那条路）。

---

## 5. 通知与记录：到底发生了什么

watch 构建成功后写这条 HTTP（整条链唯一的「上报」）：

```
PUT /api/kv/config/plugin-watch:my-thing
{ "value": {
    "t": 1760000000000,
    "front":  "http://127.0.0.1:8865/plugins/plugin-my-thing/plugin-my-thing.js",
    "server": "D:\\work\\my-plugin\\dist\\server.js"
} }
```

- **地址由上报方给出**（build 的人最清楚产物在哪），画布不猜目录、不查清单。
- 后台广播的 SSE 事件**只带 key 不带值**，画布收到后自己 GET 一次读地址。
- 画布拿 `front` 做一次轻量探测（比上次长度变了才重装），防乱序旧通知误触发。
- 插件卸载时这条记录会被一起删掉，不会在后台越积越多。

---

## 6. 设置 → 调试插件（你的调试面板）

打开设置，左侧有独立的 **「调试插件」** 页（和「插件」页是两个东西，互不依赖）：

- 列出**上报过**的插件，每行显示：名字、内核实际状态（已安装 / 待依赖 / 装载失败 / 未安装）、
  前端地址、后台路径、上报时间；
- **重装**：立刻按上报地址卸旧装新（想强制换版本时用）；后台有 `server` 时一并按路径装；
- **卸载**：内核卸 → 后台卸 → 删上报记录，一步到位；
- **刷新**：重新拉一次清单与内核状态；
- 本插件有自己的配置项 `watchBackend`（调试服务地址，留空 = 同源），不借插件管理的配置。

**判「装没装」只有一条**：内核里有没有这个**唯一名字**。谁装的、从哪装的都不影响——
调试先装过，插件管理页就显示「已安装」；反过来也一样。不会装出两份同名插件。

---

## 7. 后台半（server.js）怎么生效

前端半是自动的，后台半分两种情况：

| 你的插件与后台 | 生效方式 |
|---|---|
| **同一台机器**（本机开发最常见） | watch 上报了 `server` 路径 → 画布重装前端半的同时，
  调后台的调试安装入口，把磁盘上那份 `server.js` 落盘 + 热装，路由立刻生效，不用重启 |
| **不同机器** | 不上报 `server`。改了后台半请走「插件管理 → 重装」（上传代码那条路），
  或重启 cloud-server |

**开启调试安装入口**（默认关闭，只在本机开发时开）：

```powershell
$env:MINI_CANVAS_DEBUG_PLUGIN_INSTALL = '1'
pnpm -C packages/cloud-server serve
```

开了才有 `POST /api/server-plugins/install-from-path`（body: `{ id, path, confirm: true }`，
带管理令牌）。不开时这条路 **404**，等于不存在。它的边界：只收本机回环请求、
只读允许目录里的 `.js`、有大小上限；同名后台插件**先卸再装**，卸不掉就 409 中止（不会新旧并存）。

---

## 8. 想手动来一下（控制台命令）

> `window.MiniCanvasUI` 是**画布宿主**挂上去的（`App.vue` 里 `window-key="MiniCanvasUI"`，
> 画布就绪后才有）；`window.MiniCanvasPlugin` 是 `packages/ui/src/pluginReload.ts` 挂的**重装器**，
> 两者不是同一个对象，别混。

```js
// 卸旧 + 按地址装新（地址来自调试页那一行，或你手填）
await window.MiniCanvasPlugin.reload('/plugins/plugin-my-thing/plugin-my-thing.js')

// 调试页那一套，控制台也能调（window.MiniCanvasHotReload 是同一个单例）
const hr = window.MiniCanvasHotReload
const rows = await hr.listDebugPlugins()          // 上报了哪些、装没装
await hr.reinstallDebugPlugin('my-thing')         // 重装（前端 + 后台半）
await hr.uninstallDebugPlugin('my-thing')         // 卸载（前端 + 后台半 + 删记录）
hr.state.logs                                     // 最近发生了什么
```

---

## 9. 排查表

| 现象 | 原因 → 处理 |
|---|---|
| 改了完全没反应 | ① watch 没跑起来（看终端）；② 后台没起；③ 画布页没连上后台（dev 页看 `/api` 代理） |
| watch 报 `build failed` | 构建错误，**不会通知**——按终端里的报错改代码，保存即重试 |
| 通知来了但界面没变 | 浏览器缓存了旧产物：调试页点「重装」（带时间戳破缓存） |
| 通知说「找不到地址」 | 上报值里没 `front`、清单里也没有 → 确认产物已构建、`--front` 给对地址 |
| 后台半一直不生效 | ① 后台没开 `MINI_CANVAS_DEBUG_PLUGIN_INSTALL=1`；② 插件与后台不同机（改走插件管理上传）；③ 管理令牌没填（设置 → 插件页顶部那格） |
| 报 `[core] …` | 你重装/卸载的是核心插件（`core: true`），按设计不允许热替换 |
| 界面样式全丢 | vite 把 CSS 拆出去了 → 加 `cssInjectedByJs()`，见 §2.2 |
| 加载后什么都没装上 | external 漏配/配错（Vue 或 MiniCanvas\* 被打了第二份）→ 对照 §2.2 与 `vite-plugin-lib.ts` |

---

## 10. 相关代码

| 干什么 | 文件 |
|---|---|
| watch 脚本（复制它） | `packages/plugins/plugin-hot-reload-demo/scripts/watch.mjs` |
| 试验台插件（可当样板） | `packages/plugins/plugin-hot-reload-demo/` |
| 热重载数据层（收通知 / 判重 / 清单 / 装卸） | `packages/plugins/plugin-hot-reload/src/data/hotReload.ts` |
| 调试页 UI | `packages/plugins/plugin-hot-reload/src/components/settings/` |
| 宿主重装器（`window.MiniCanvasPlugin`） | `packages/ui/src/pluginReload.ts` |
| 后台 KV 上报接口 | `packages/cloud-server/src/routes/kv.ts` |
| 后台按路径安装（调试） | `packages/cloud-server/src/routes/serverPlugins.ts`（`install-from-path`） |
| 单测 | `plugin-hot-reload/src/data/hotReload.test.ts`、`src/__tests__/settingsWiring.test.ts` |
