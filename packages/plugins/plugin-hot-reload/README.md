# 热重载

> `@plume-canvas/plugin-hot-reload` - v0.1.0

调试用：把 watch 上报过的插件列出来，看监听在不在线，一键重装 / 卸载。
装到 `npx @plume-canvas/server` 起的发布版里，也能像开发版一样调插件。

## 装上之后能得到什么

设置面板的「开发 → 调试」里会多出「调试插件」一栏：

- 每个在跑 `pnpm watch` 的插件一行，左边是名字，右边是产物地址与心跳时间；
- 两盏灯分开看：**已安装**（内核里有没有这个名字）、**监听中 / 已失联**（watch 有没有在发心跳）；
- 点「重装」立刻按上报地址卸旧装新；点「卸载」把这一侧从内核摘掉。

发布版里后台仍然提供 `/api/kv/config`、`/api/kv/events`、`/api/plugin-presence`
与 `/plugins/**`，所以插件管理装上本插件后，watch 一上报就会被它接住并自动重装。
前提是 watch 构建出来的产物能通过一个地址访问到：要么放进后台的插件目录，要么用
`--front` 指到你另起的静态服务。

## 最快验证一遍

```powershell
# 1. 后台（发布版或仓库 dev 都行）
npx @plume-canvas/server@latest serve -d C:\Users\<你>\.plume --port 8865

# 2. 在「设置 → 插件」里装上热重载，然后在画布上打开「设置 → 开发 → 调试」

# 3. 另开一个终端，让 watch 盯着要调的那个插件
pnpm -C packages/plugins/plugin-bottom-bar watch --backend http://127.0.0.1:8865
```

watch 默认上报的地址是 `<后台>/plugins/<包目录>/<产物>.js`，所以产物要真的落在
后台读的那个插件目录里（发布版默认 `~/.plume/plugins`）。产物不在那、或者由别的
静态服务提供，就加 `--front http://localhost:5199/plugin-bottom-bar.js`，并把 `--server`
指给后台真正能读到的后台产物路径。

## 原理

```text
watch 工具   盯 src → 自动 build → PUT /api/kv/config/plugin-watch:<插件名>
后台         KV 写 → /api/kv/events 推 {type:'config', key:'plugin-watch:<名>'}（现成）
本插件       监听该前缀 → 内容哈希对比 → 变了才按上报地址重装 → 弹通知
心跳         watch 每 10 秒 POST /api/plugin-presence/heartbeat，只存内存
```

监听是自动的（复用宿主共享 KV 通道，零新连接），不需要再手动登记 SSE 链接。
提示走上下文里的 notify 服务（默认主题提供；本插件不 import 任何通知库）。

## 功能说明

plugin-hot-reload · 热重载插件（KV 门铃通知 → HEAD 对比 → 自动重装）。
## 最终形态（用户口径）
  watch 工具：盯 src → 自动 build → 成功后 PUT /api/kv/config/plugin-watch:<插件名>
  后台：      KV 写 → /api/kv/events 推 {type:'config', key:'plugin-watch:<名>'}（现成，零改动）
  本插件：    监听该前缀 → HEAD 对比产物 → 变了才拉新重装 → 弹通知
没有可登记的 SSE 链接、没有 UI 面板 —— 监听是自动的（复用宿主共享 KV 通道，零新连接），
提示走上下文里的 notify 服务（默认主题提供；本插件不 import 任何通知库）。
装载即生效，宿主 APP_PLUGINS 放 hotReloadPlugin 一个即可。
## 导出面
- hotReloadPlugin：宿主装配用（推荐）
- createHotReload / HotReload：数据层（测试、或宿主想自建 UI 时用）
- PLUGIN_WATCH_PREFIX：watch 工具 PUT 的 key 前缀约定
/

## 注册项

### 提供的服务 (ctx.inject / provide)

- `hot-reload`

### 声明的依赖 (export const inject)

- ``

### 注册的插槽 (slots.register)

- `settings.nav`
- `settingsGroup/`

## 安装

```bash
npm i @plume-canvas/plugin-hot-reload
```

发布版里在「设置 → 插件 → 市场」搜索「热重载」安装；仓库开发版由
`apps/web/src/dev-plugins.ts` 冷启动装配，不用另装。
