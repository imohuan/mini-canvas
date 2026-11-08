---
name: write-provider
description: 写或修改 mini-canvas 的后台 provider（数据根下的 providers 目录里丢一个 js 文件）时使用。覆盖单文件限制、只能用 Node 内置模块、必须导出 id/actions/submit，以及底栏动作的字段、图标、预设和 HTML 面板。前端插件开发不走这份。
---

# 写一个后台 provider

一句话：往 `<数据根>/providers/` 丢一个 `.js` 文件，后台几秒内自动装载。
它的 `actions` 会直接出现在画布底栏的模型下拉里，前端一行都不用改。

默认数据根是启动目录下的 `.mini-canvas`，所以一般是 `.mini-canvas/providers/`。
目录不存在就自己建：缺目录等于「没有 provider」，不报错，也不影响启动。

## 四条硬要求

1. **一个自包含文件**。装载方式是
   `import('data:text/javascript,' + encodeURIComponent(源码))`，没有基准目录。
   写 `import './x.js'` 会直接报 `ERR_UNSUPPORTED_RESOLVE_REQUEST`。
2. **只能引 Node 内置模块**（`node:fs`、`node:crypto`、`node:child_process`…）。
   `hono`、`zod` 这类第三方包同样报 `ERR_UNSUPPORTED_RESOLVE_REQUEST`。
   要发 HTTP 就用全局 `fetch`。
3. **必须导出 `id`、`actions`、`submit`**，可选 `poll` 和 `cancel`。
   `export default {...}` 或具名导出都行（装载器取 `mod.default ?? mod`）。
4. **目录是 `<数据根>/providers`**，不是 `server-plugins`。后者是另一套后台插件机制，
   两套不通用。

## 装载规则（写之前先知道）

- 只认目录**第一层**的普通 `.js` 文件；`_` 或 `.` 开头的跳过；不递归、不跟随软链。
- 每 3 秒比对一次目录签名，存盘就自动重载，不用重启服务。
- 单个文件出错只打一行日志，不影响其它 provider，也不会把服务带崩。
- 同 `provider.id` 后加载的覆盖先前的；`action.id` 全局唯一，同名动作后注册的覆盖。
- 校验只看三样：`id` 是非空字符串、`actions` 是数组、`submit` 是函数，
  且每个 action 有字符串 `id`。**不校验 `title`**，但缺了前端会显示空白。

## 契约

```js
const provider = {
  id: 'my-provider',
  actions: [{ id: 'my:do-thing', title: '我的动作' }],
  async submit(action, input) {},
  async poll(taskId, action) {},
  async cancel(taskId, action) {},
}
export default provider
```

`submit` 有三种返回：

- `{ done: true, urls?, text? }` —— 同步做完，立刻终态。
- `{ taskId }` —— 异步，之后进轮询。
- `{ error: '原因' }` —— 直接失败。

`poll` 每拍返回：

```js
{ status: 'running' | 'done' | 'error', progress?, message?, urls?, text?, error?, waiting? }
```

- 默认 1500ms 问一次、总超时 5 分钟；动作上写 `pollIntervalMs` / `pollTimeoutMs` 可覆盖。
- `waiting: true` 表示「在等人」（等验证码之类），这一拍耗掉的时间不计入超时预算。
- `poll` 抛异常会被收成失败，不会留下永远 running 的任务。
- `submit` 必须给三种返回之一。返回空对象 `{}` 时后台会拿 `undefined` 当 taskId 去 poll，
  一直问到超时才失败；返回 `undefined` 或直接抛错会立刻判失败。

`input` 的字段：`canvasId`、`nodeId`、`actionId`、`prompt`、`values`、`resources`。
`resources[].url` 在提交前已被宿主解析成 data URL（或绝对地址），可以直接拿字节用；
`kind` 是 `image` / `video` / `audio` / `text`，文本素材内容在 `value`。

产物 `urls` 给 data URL 或可下载的绝对地址都行。后台会先把字节收进本画布资源目录，
再按节点类型写回 `imageUrl` / `videoUrl` / `audioUrl`。跨机器时优先给 data URL。

## actions 里前端真能看到的字段

底栏只搬这些：`id / title / description / icon / group / order / needsPrompt /
promptBinding / fields / templates / panelHtml / nodeTypes / pollIntervalMs /
pollTimeoutMs / externalRunState`。写别的一律到不了前端（历史上 `icon`、
`templates`、`panelHtml` 就是这样被静默丢掉的）。

- `icon`：三种写法都行 —— SVG 字符串、`data:image/...;base64,...`、或**图标名**。
图标名可以是平台 key（`seedance` / `volcengine` / `kling` / `doubao`…）或者中文名 /
  关键字（`火山引擎`、`可灵`），会做模糊匹配。**不用背清单**：
  `GET /api/agent/icons` 列出全部平台与别名，`GET /api/agent/icons/<你的写法>`
  直接告诉你认不认得出（认不出回 `matched: false`，不是报错）。详见
  [references/icon-names.md](./references/icon-names.md)；
  完整判定顺序、三处消费点、尺寸规则见
  [references/icon-resolution.md](./references/icon-resolution.md)。
- `needsPrompt`：要不要底栏那个大输入框（默认不要）。
- `promptBinding: 'text'`：输入框直接绑文本节点的 `data.text`。
- `nodeTypes: ['image'|'video'|'audio']`：只在对应节点上出现；省略 = 都适用。
- `order`：小的排前面。
- `fields`：可视化参数。每项 `{ key, label, type, default, options?, min?, max?, step?, unit?, kind? }`。
  `type` 只有 `select` / `number` / `boolean` / `text` 四种；`kind` 只有 12 个可识别值。
  每种写法画成什么、哪些值会被忽略，见
  [references/params-and-kinds.md](./references/params-and-kinds.md)。注意 `kind: 'style'`
  会被底栏整条过滤掉，写了也不显示。
- `templates`：预设。`{ id, name, prompt, values?, description?, forTools? }`，
  `values` 的键就是 `fields` 里的 `key`，选中预设时连参数一起填。
- `panelHtml`：自带一段 HTML 面板，替代 `fields` 的内置控件。写法见
  [references/panel-html.md](./references/panel-html.md)。

## 写完怎么验

1. 文件放进 `<数据根>/providers/`。
2. 等 3 秒，后台日志应出现 `provider 目录已变更，动作清单更新为 N 项`。
3. 请求 `GET http://127.0.0.1:<端口>/api/actions`，能搜到自己的 `action.id`。
4. 日志里出现 `provider 加载失败 <文件>：<原因>`，就是语法错了或没通过校验。
5. `icon` 想写平台名时，先用 `GET /api/agent/icons/<写法>` 确认认不认得出。
6. 再回画布底栏下拉里确认动作、图标、参数控件都在（触发器和列表每一行都要看）。

## 图标怎么显示

图标出现在三处：底栏触发器、下拉的**每一行**、预设弹窗的模型选择器。
三处共用 `resolveActionIcon` 一份判定，所以不会出现「触发器有图标、列表里是兜底」。

判定四层，命中就停：你的 `icon`（SVG / Base64）→ `icon` 写成的图标名 →
按动作标题猜平台 → 按节点类型兜底。

两个容易踩的点：

1. `icon` 只影响显示，**不影响分组和搜索** —— 分栏左栏的平台分组仍按标题认。
2. `<svg>` 和 `<img>` 的尺寸规则成对写；只写 `svg` 时 Base64 图标会按原始像素画，
   1×1 的图就是一块空白。

「有哪些图标可写、这个写法认不认得出」不用记，查后台：
`GET /api/agent/icons` 与 `GET /api/agent/icons/<写法>`。

细节（返回的 `{ tone, svg }` 是什么、三处消费点在哪、各容器多少像素、怎么写自测）见
[references/icon-resolution.md](./references/icon-resolution.md)。

## 示例

- [references/example-provider.js](./references/example-provider.js)：最小可跑，同步 + 异步两个动作。
- [references/demo-provider.js](./references/demo-provider.js)：全功能演示，覆盖 4 种 type、
  全部会渲染的 kind、两种图标写法、预设、HTML 面板、异步轮询（含 `waiting`）与取消，
  并真的生成 PNG 产物。
