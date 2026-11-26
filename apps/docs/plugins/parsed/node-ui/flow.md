# 核心流程：它到底怎么工作

> 插件：可视化节点 node-ui · [返回总览](/plugins/parsed/node-ui/)

**先读这一页。** 它是本插件的"想法"与主线；下面各页都是这条线上的零件。
（本页与后续几页讲的是**插件对外的稳定契约**：界面怎么写、能调什么、哪些规则会被代码拦下。）

## 一句话说清它是什么

**一块交给 AI 画的画布。** 节点里没有界面、没有按钮、没有设置项 —— **内容是一段 HTML**，
由 AI 写进去、就地渲染；这段 HTML 还能反过来调画布接口（改节点、跑后台脚本）。

一个可视化节点由**三块**组成：

```text
界面（HTML，长什么样） + 后台脚本（.mjs，干什么活） + 节点声明（data.uiScripts，把两者绑在一起）
```

``````mermaid
flowchart LR
  A[Agent MCP] -- canvas_ui_write --> B[节点 data.uiHtml]
  B -- srcdoc 渲染 --> C[沙箱 iframe]
  C -- postMessage（宿主代发） --> C2[宿主 UiContent]
  C2 -- HTTP /api/task/call + 令牌 --> D[后台脚本 .mjs]
  D -- ctx.save 槽位 + 写节点字段 --> B
  B -- ?v= 时间戳 --> E[下游节点]
``````

> 判断准则：**界面管「长什么样」，脚本管「干什么活」，声明把两者绑在一起。**

## 一条完整的开发流程（照这个顺序走）

``````mermaid
flowchart TD
  A[① 先问：只是展示，还是要干活？] -->|只展示| D[④ 写界面]
  A -->|要干活| B[② 写脚本 _名字.mjs]
  B --> C[③ 调通：先草稿画布验，再上真实节点]
  C -->|通过| B2[去掉下划线，脚本才算可用]
  B2 --> D
  D --> E[⑤ 声明 data.uiScripts]
  E --> F[⑥ canvas_ui_write → 看 lint]
  F -->|lint.ok=false| F
  F -->|通过| G[⑦ canvas_ui_check → ok:true 才算交付]
  G --> H[⑧ canvas_ui_export / package 落盘收藏]
``````

几个关键点，按顺序说清楚：

1. **先判要不要后台**。只是把素材显示出来 = 纯前端，跳到写界面；要转码、批处理、算数据才写脚本。
2. **脚本先用下划线打头**（`_名字.mjs`）：它不进「可用清单」，别的 Agent 不会误用；自己照样能调来测。
3. **验证分两级**：只验脚本时 `canvas_fn_call` 两个 id 都不给，落到 `fn-probe-default` 草稿画布，
   碰不到用户画布；要看真实效果再带 `canvasId` + `nodeId` 跑一次，产物落进那个节点的槽位。
4. **写界面时同时补声明**。`canvas_ui_write` 会顺手扫出 `CanvasUI.task("名字", …)` 补进声明，
   但作者自己写更稳；这一步错了，用户一点按钮就 403。
5. **写完必须过两道检查**：`canvas_ui_write` 返回的 `lint`（这一份 HTML 的规范），
   和 `canvas_ui_check`（整个节点：规范 + 声明 + 说明书 + 产物）。
6. **调试工具不是流程的一步**。`canvas_ui_build_debug_doc` 只在真卡住时用；
   正常写完、检查通过就结束。

> 2026-10-20 起：沙箱 iframe **不再自己发 HTTP**。`save` / `task` / `cancel` / 读画布 / 下单
> 全部经 `postMessage` 交给宿主（同源、带管理令牌）；任务日志由宿主订阅 SSE 再转回来。
> 界面里写 `CanvasUI.api('/api/…')`，不要写 `fetch`。

## 为什么后台半非有不可

用户在画布里引用一个可视化节点时，AI 只拿到一个节点 id。它**不知道**：

- 这个节点是什么（一块会渲染 HTML 的画布）；
- 内容该写进哪个字段；
- 写出来的 HTML 跑在什么环境里、有什么约定；
- 能调哪些后台接口。

少任何一条，AI 都只能瞎猜（或者干脆不画）。所以把它做成 **MCP 工具**：
AI 调一次拿到完整约定，再调一次就把界面写进去。

## 端到端：四步

``````mermaid
flowchart TD
  A[① 读手册 + 看现状<br/>canvas_ui_guide / canvas_ui_read] --> B{② 只展示还是要干活？}
  B -->|只展示| F[纯 HTML 就完了]
  B -->|要干活| C{机器上有现成脚本吗？<br/>看手册尾部实时清单}
  C -->|有| D[直接用]
  C -->|没有| E[Agent 自己写一个 .mjs 到 task-scripts/<br/>write_file 要用户点允许]
  D --> G[③ 写界面 canvas_ui_write<br/>顺带声明 data.uiScripts]
  E --> G
  G --> H[界面里 task 调脚本<br/>脚本里 ctx.save 交产物]
  H --> I[④ 可选：canvas_ui_package 收进资源库]
``````

### 动手之前先跟用户确认需求（**这一步别省**）

1. 这个界面只是「看」，还是要「干活」？只看 → 纯前端；干活 → 需要后台脚本。
2. 要干活的话，机器上已经有能干这个活的脚本吗？看[后台半与 MCP 工具](/plugins/parsed/node-ui/server-mcp)那页的实时清单。
3. 要不要收进资源库（之后能拖到别的画布复用）？要 → 最后调 `canvas_ui_package`。

> 写完才发现「其实需要后台能力、而脚本还没有」，那一整轮界面都得推倒重来。

### 一条真实链路（照着读一遍就懂了）

```text
1. 用户在画布上放一个"可视化"节点，连上一张图片。
2. 用户对 Agent 说："给我在这个节点上画个调色面板。"
3. Agent 调 canvas_ui_guide              ← 拿到约定（沙箱注入什么、能调什么、脚本清单）
4. Agent 调 canvas_ui_write(nodeId, html) ← 界面出现在节点里，用户当场看到
5. 用户拖动滑块 → 界面 CanvasUI.setInputs({...})   ← 参数交上去（进撤销栈）
6. 界面调 CanvasUI.task("scale", "run", [640])      ← 叫后台干活
7. 后台跑 task-scripts/scale.mjs（子进程，带取消信号与进度）
8. 脚本把产物交回（ctx.save）→ 写进节点字段 + 画布资源
9. 用户满意 → Agent 调 canvas_ui_package 把这个节点收进资产库，以后能拖到别的画布
```

## 这一组文档怎么读

| 页 | 回答什么 |
| --- | --- |
| [服务 `uiNode`](/plugins/parsed/node-ui/service) | 前端这边能调什么（建节点 / 写 HTML / 读内容） |
| [节点类型 `ui`](/plugins/parsed/node-ui/node-type) | 节点长什么样、数据字段有哪些 |
| [命令](/plugins/parsed/node-ui/commands) | 外部（Agent / MCP / 快捷键）按 id 调的入口 |
| [界面与沙箱](/plugins/parsed/node-ui/ui-sandbox) | **你写的 HTML 跑在哪**、注入什么、怎么往外输出 |
| [后台半与 MCP 工具](/plugins/parsed/node-ui/server-mcp) | **11 个 MCP 工具**：读手册 / 写界面 / 打包 / 列函数 / 调函数 |
| [任务脚本](/plugins/parsed/node-ui/task-scripts) | **后台脚本怎么写**、ctx 里有什么、产物落哪个字段 |
| [依赖声明与 403](/plugins/parsed/node-ui/declare) | 为什么"不声明就调不动"、怎么自动补 |
| [后台路由](/plugins/parsed/node-ui/routes) | 界面调后台走的 HTTP 接口 |
| [节点包](/plugins/parsed/node-ui/node-package) | 导出 / 导入 / 版本化（`.plumenode`） |
| [常见坑](/plugins/parsed/node-ui/pitfalls) | AI 写界面时最容易踩的七条（复盘沉淀） |
| [事件](/plugins/parsed/node-ui/events) · [设置项](/plugins/parsed/node-ui/config) | 剩下两件小事 |

