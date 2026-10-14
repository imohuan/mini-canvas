# 后台路由（界面调后台走的 HTTP 口）

> 插件：可视化节点 node-ui · [返回总览](/plugins/parsed/node-ui/)

**一句话**：界面里的 `CanvasUI` 助手与后台之间的 HTTP 接口 —— 一共 6 条任务路由、5 条节点包路由、1 条自身信息路由。

## 一、任务路由（`/api/task/*`）

| 方法 | 路径 | 干什么 |
| --- | --- | --- |
| POST | `/api/task/call` | 叫后台干活：`{ type:"call", name, methods, args, canvasId, nodeId, wait? }`；`{ type:"list" }` 列脚本与函数 |
| GET | `/api/task/list` | 列脚本 |
| GET | `/api/task/info?name=xxx` | 某脚本有哪些函数 |
| GET | `/api/task/events?runId=xxx` | **SSE**：`log` / `progress` / `done` / `error` |
| GET | `/api/task/status?runId=xxx` | 查状态（**刷新回来靠它**） |
| POST | `/api/task/cancel` | 取消：`{ runId }` |

```js
// = CanvasUI.task 的底层
POST {base}/api/task/call    { type:"call", name, methods, args, canvasId, nodeId, wait? }
POST {base}/api/task/call    { type:"list" }                    // 列脚本与函数
GET  {base}/api/task/info?name=xxx                              // 某脚本有哪些函数
GET  {base}/api/task/events?runId=xxx                           // SSE: log/progress/done/error
GET  {base}/api/task/status?runId=xxx                           // 查状态（刷新回来靠它）
POST {base}/api/task/cancel  { runId }                          // 取消
```

> `/api/task/call` 会**先核对依赖声明**（见[依赖声明与 403](/plugins/parsed/node-ui/declare)），没有就直接 403。

## 二、读 / 改画布

```js
GET  {base}/api/canvases                                        // 画布清单
GET  {base}/api/canvases/{canvasId}                             // → { ok, nodes, edges, view }
POST {base}/api/canvases/{canvasId}/nodes  { add?,delete?,update? }  // 增量改（推荐）
POST {base}/api/canvases/{canvasId}/edges  { add?,delete?,update? }
PUT  {base}/api/canvases/{canvasId}  { nodes, edges }           // 整体替换（慎用：少一个节点它就没了）
```

> ⚠️ **非默认画布必须用带画布 id 的那条** `/api/canvases/{canvasId}/nodes`。
> 老路径 `/api/canvas/nodes` 只认默认画布，写错会**静默无效**。

## 三、资源

```js
POST {base}/api/canvases/{canvasId}/resources?slot={节点id}&name=out.png  // 交产物到槽位（覆盖）
POST {base}/api/canvases/{canvasId}/resources  (body=字节)                // 只新增、不覆盖
GET  {base}/api/assets  ·  POST {base}/api/assets                         // 资产库
```

## 四、节点包路由（`/api/node-packages/*`）

| 方法 | 路径 | 干什么 |
| --- | --- | --- |
| POST | `/build` | `{ canvasId, nodeId }` → `.mcnode` 字节 |
| POST | `/save` | `{ canvasId, nodeId, name?, folderId? }` |
| POST | `/inspect` | 体检（body = 包字节）：会不会升版本 |
| POST | `/import` | 真落地（body = 包字节） |
| GET | `/read?assetUrl=…` | 读包 |

## 五、调模型（两条别混的轨道）

```js
// 让界面问 AI（单轮，不建会话、不进对话列表）
POST {base}/api/agent/chat/completion  { model?, messages, stream?, max_tokens? }
// 非流式 → OpenAI 形状 { choices:[{message:{content}}], usage }；流式 → SSE，末帧 data: [DONE]

// 调模型出媒体（与「画界面」是两条轨道，别混）
GET  {base}/api/actions                                         // 有哪些 actionId 与参数
POST {base}/api/jobs  { canvasId, nodeId, actionId, prompt?, values? }
```

## 六、插件自身信息

| 方法 | 路径 | 干什么 |
| --- | --- | --- |
| GET | `/api/node-ui/info` | 报后台自身地址（`{ ok, origin }`） |

## 注意事项

1. **发请求必须写绝对地址**：页面基地址是 `about:srcdoc`，相对路径解析不出来（用 `__CANVAS_UI__.baseUrl`）。
2. **优先走 `CanvasUI` 助手**，不要自己裸发请求当主路 —— 助手已经处理了 nodeId、槽位、错误形态。

