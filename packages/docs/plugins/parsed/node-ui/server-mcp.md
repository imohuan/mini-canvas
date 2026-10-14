# 后台半与 MCP 工具

> 插件：可视化节点 node-ui · [返回总览](/plugins/parsed/node-ui/)

**一句话**：本插件后台半给 AI 装了一套 MCP 工具 —— 让 AI 能**读约定、写界面、打包收藏、列并调用后台功能函数**。
这是本插件的**核心缝**：没有它，AI 只拿到一个节点 id，什么都不知道。

## 它注册了什么（后台半落点）

| 种类 | 数量 | 内容 |
| --- | --- | --- |
| MCP 工具 | 11 | 下面第一节逐个列 |
| 后台路由 | 6 | `/api/task/*`（见[后台路由](/plugins/parsed/node-ui/routes)） |
| 节点包路由 | 5 | `/api/node-packages/*`（见[节点包](/plugins/parsed/node-ui/node-package)） |
| 其它路由 | 1 | `GET /api/node-ui/info`（报后台自身地址） |

## 一、11 个 MCP 工具逐个

### 画界面这条线（4 个）

#### `canvas_ui_guide(canvasId?)`

| 项 | 内容 |
| --- | --- |
| 参数 | `canvasId`：画布 id（缺省 `'default'`） |
| 返回 | `{ ok, guide }` —— 手册正文 + **这张画布的节点清单** + **这台机器上的脚本清单**（实时现读） |
| 何时用 | **给可视化节点画东西之前第一个调它**。用户一提"可视化节点 / ui 节点 / 面板 / 预览器"就该调 |

> 手册里写清了：它是什么、内容写进哪、HTML 跑在什么环境、必须遵守哪些约定、能调哪些接口，以及**先跟用户确认需求**这一步。

#### `canvas_ui_write(canvasId?, nodeId, html)`

| 项 | 内容 |
| --- | --- |
| 参数 | `nodeId`（必填）、`html`（必填，给代码本体，**不用包 markdown 代码块**） |
| 返回 | `{ ok, nodeId, canvasId, bytes, declaredScripts? }` |
| 干什么 | 把界面整段写进节点，**当场渲染**；顺手扫一遍 HTML，把调到的脚本补进依赖声明（`declaredScripts` 就是补上的那些） |
| 何时用 | 第一次画 / 整段重画 |

#### `canvas_ui_update(canvasId?, nodeId, old, new)`

| 项 | 内容 |
| --- | --- |
| 参数 | `nodeId`、`old`（必填；现在的代码片段，要原样、能在当前 HTML 里找到）、`new`（改后的片段） |
| 返回 | 替换是否成功；`old` 找不到时报错并**回一小段当前内容**，照着改 old 再试 |
| 干什么 | 在现有 HTML 里做**局部替换** |
| 何时用 | 改一小块（改一个 class / 一段文字）—— **别整段重写**（费 token 又容易改坏别处） |

> `old` 出现多次 = 全换掉（会回报次数）；只想换一处就把 `old` 写得更长更精确。

#### `canvas_ui_read(canvasId?, nodeId)`

| 项 | 内容 |
| --- | --- |
| 参数 | `nodeId`（必填） |
| 返回 | `{ html }`（含说明书与声明的脚本） |
| 何时用 | 改之前先看一眼现状 |

### 收藏 / 复现这条线（4 个）

#### `canvas_ui_package(canvasId?, nodeId, name?, folderId?)`

| 项 | 内容 |
| --- | --- |
| 参数 | `nodeId`（必填）、`name`（包名）、`folderId` |
| 干什么 | 把"这个节点 + 它用到的脚本"打成一个 `.mcnode` 包，存进**资产库** |
| 何时用 | 想把这个节点复用到别的画布 |

#### `canvas_ui_describe(canvasId?, nodeId, what, effect?, inputsJson?, outputsJson?)`

| 项 | 内容 |
| --- | --- |
| 干什么 | 给节点写**功能说明书**（写在 `data.uiNodeDoc` 上，跟着包一起走） |
| 何时用 | 收藏之前先写 —— 否则别人看到它只会显示"（没写说明书：不知道它是做什么的）" |

说明书形状：

```json
{
  "what":   "这个节点做什么（必填的那一句）",
  "effect": "功能效果（可选）",
  "inputs":  ["参考图", { "name": "列数", "type": "number", "desc": "几列" }],
  "outputs": [{ "name": "宫格图", "type": "image" }]
}
```

> 写法宽松：`inputs` / `outputs` 每条可以是一行字，也可以是 `{name,type,desc}`。

#### `canvas_ui_favorites(keyword?)`

| 项 | 内容 |
| --- | --- |
| 返回 | 资产库里收藏的可视化节点（带说明书），`keyword` 可按名过滤 |
| 何时用 | 想看"我收藏了哪些能复用的界面" |

#### `canvas_ui_add_favorite(url? | name?, canvasId?, positionX?, positionY?)`

| 项 | 内容 |
| --- | --- |
| 干什么 | 把收藏里的某个节点包**建成画布上的一个节点**（先把包里的脚本写到服务器，再还原节点数据） |
| 返回 | `{ ok, canvasId, nodeId, name, action, version?, written, skipped, doc }` |
| 何时用 | 复用某个收藏节点 —— 建出来的 `nodeId` 之后就能用 `canvas_ui_read/write` 改它 |

> `canvasId` 不传就落到**默认画布**。

### 后台功能函数这条线（3 个，2026-10-14 用户口径）

用户原话：「梳理每个可视化节点可能导出的后台接口或扩展工具函数」，写清
「工具做什么 / 输入参数有哪些 / 返回结果是什么 / 调用示例」，并且
「MCP 可直接调用这些后台接口；**调用时不需要外部传 Canvas ID / Node ID**」。

#### `canvas_fn_list(keyword?)`

| 项 | 内容 |
| --- | --- |
| 返回 | 这台机器上**所有能调的后台功能函数**（每个脚本 × 每个函数 × 说明书）；`keyword` 可按脚本名/函数名/说明过滤 |
| 何时用 | 回答"有哪些后台能力可以用"，或照着挑一个用 `canvas_fn_call` 调 |

> 没写说明书的函数**照样列出来**（名字来自真实 export），只是标一句"没写说明书"——
> 不因为作者偷懒就把这个能力整个藏起来。返回值里还会给"怎么写说明书"的做法。

#### `canvas_fn_info(script, fn?)`

| 项 | 内容 |
| --- | --- |
| 参数 | `script`（必填，脚本名，不带 `.mjs`）、`fn`（可选；不给就列这个脚本的全部函数） |
| 返回 | 该函数做什么 / 参数（名字/类型/是否必填/说明）/ 返回什么 / 怎么调 |

#### `canvas_fn_call(script, fn, argsJson?, wait?, timeoutMs?)`

| 项 | 内容 |
| --- | --- |
| 参数 | `script`+`fn`（必填）、`argsJson`（**位置参数数组**，如 `"[640, \"x.png\"]"`）、`wait`（缺省 true = 等它跑完并回结果） |
| 返回 | `{ ok, script, fn, result? , error?, logs, state, virtualCanvasId }` |
| 干什么 | 直接调用一个后台功能函数并把结果拿回来 |

> **不需要传 Canvas ID / Node ID**：这类函数要它们只是为了"回写画布"，
> 而这里由工具自己造一张**虚拟画布**顶上（id 形如 `fn-probe-default`），专门给你取返回值用。
> 虚拟画布**不会出现在用户的画布列表里**，脚本即使往里写了产物也只是写进那张临时画布。

**完整调用顺序**（AI 该怎么用这三个）：

```text
1. canvas_fn_list                  → 看看这台机器上有什么能力（带说明书）
2. canvas_fn_info("scale", "run")  → 查清楚参数与返回
3. canvas_fn_call("scale", "run", argsJson: "[640]")  → 调它、拿回结果
```

## 二、其余画布操作复用**内置**工具

本插件**不重复造**这些（它们本来就支持 update / delete，而且是增量、带写锁的）：

`canvas_get` / `canvas_overview` / `canvas_list_canvases` /
`canvas_batch_nodes` / `canvas_batch_edges` / `resource_upload` / `generation_*`。

> 2026-10-12 用户指出「我不是有一个删除的功能吗」—— 对，重复了，所以本插件不再各造一个。

## 三、后台半怎么被加载（为什么它必须自包含）

打成**单文件** `dist/server.js` → 丢进 cloud-server 的 `server-plugins` →
启动时用 `import(data:text/javascript)` 加载。

**`data:` URL 里解析不了裸模块名**，所以产物必须自包含：除了 `node:` 内置模块，什么都不许 external
（见 `scripts/build-server.mjs`）。于是它只用 `ctx` 给的能力段（`routes / mcp / tryGet`），**零第三方依赖**。

## 注意事项

1. **手册是"稳定契约"，项目源码是"实现"**：AI 别去翻源码（随时会变），要问"有哪些脚本/动作"用运行时接口。
2. **"画界面"与"生成图片"是两条轨道**：`canvas_ui_*` 是画界面，`generation_*` 是调模型出媒体，别混。
3. **写界面的两个工具会顺手补依赖声明**，但**自己写上更稳**（见[依赖声明与 403](/plugins/parsed/node-ui/declare)）。

