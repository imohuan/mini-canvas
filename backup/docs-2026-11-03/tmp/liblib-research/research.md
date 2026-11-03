# LiblibAI / LibTV 工作流画布实现方案调研

> 调研日期：2026-09-06
> 用途：判断 ComfyUI 类 AI 工作流画布的新项目技术选型
> 调研范围：LiblibAI（liblib.art / liblib.tv）画布实现 + 主流 AI 工作流 Web UI 通用技术路线
>
> 约定：本文件明确区分「已核实的事实」（带来源链接）与「推断 / 未证实」（明确标注）。LiblibAI 前端为**闭源商业平台**，无公开仓库，无法从源码直接证实；凡涉及 Liblib 内部实现的内容，能核实到的边界已如实说明，其余标为推断。

---

## 0. 调研对象澄清（先对齐"对的是什么标"）

用户的背景是"做类似 ComfyUI 的 AI 工作流画布"。LiblibAI 旗下有两类画布相关产品，需要区分，否则容易对错目标：

- **LiblibAI 主站（liblib.art）**：AI 绘画/模型社区 + 简单文生图工具。招聘信息显示其前端主体为 **React + TypeScript + Node**（已核实，见 §2.2）。
- **LibTV（liblib.tv）**：LiblibAI 于 **2026-03-18** 发布的全新 **"无限画布 + 节点工作流"** AI 视频/图像创作平台，产品形态与用户要做的 ComfyUI 类画布**高度重合**（可自由连线节点组成工作流、双击生成节点、节点含富内容）。——**这才是用户实际想对标的画布**。下文本着"对标 LibTV 画布"展开。
  - 来源：腾讯新闻深度实测（2026-03-19）、量子位（2026-03-23）、Founder Park 知乎专栏产品文、chooseai 工具导航介绍，均发布于 2026-03，见 §3。

---

## 1. 结论速览（3 句话）

1. **LibTV 画布是"DOM 节点 + 局部 canvas 预览媒体"的混合路线**（推断成分高，无源码；依据是产品交互特征 + 社区复刻实践，见 §2、§3），不是 ComfyUI 那种"全图 canvas 统一渲染节点"。
2. **主流 AI 工作流 Web UI 的通用技术路线 = React Flow（xyflow）/ Vue Flow 这类 DOM 节点库 + 节点内嵌 canvas/`<img>` 做图像视频预览**；canvas 统一渲染节点的路线（ComfyUI 官方 LiteGraph）正在被官方主动迁移到 DOM（Vue），原因是 canvas 难改、迭代慢。
3. **给本项目（Vue3 + Vue Flow，见 §6）的选型启示：继续走 Vue Flow DOM 节点路线完全正确**，不要因为"ComfyUI 很强"而误以为要去抄它的 canvas 渲染——ComfyUI 自己都在从 canvas 往 DOM 搬。

---

## 2. 已核实的事实（带来源）

### 2.1 LibTV 产品形态 = 无限画布 + 节点 + 连线工作流
- "LibTV 的核心界面就是一块无限画布，双击任意位置，直接生成节点。文本、图片、视频、音频、脚本，双击就能生成。"（腾讯新闻实测）
  - 来源：https://view.inews.qq.com/a/20260319A05XAY00
- "LibTV 颠覆了传统视频工具的线性时间轴设计，以'无限画布'为核心交互界面……画布可向任意方向无限延展。双击画布或点击左侧加号即可创建节点，支持五种核心类型（文本/图片/视频/音频/脚本）。节点之间可以自由连接，上游输出直接成为下游输入。"
  - 来源：https://www.chooseai.net/news/2943 、 https://news.qq.com/rain/a/20260323A05VI100 （量子位）
- "LibTV 从第一天起，人类创作者和 Agent 各有各的入口……创作者端：工作流画布更可控。打开 LibTV，看到的不是对话框也不是时间线，是一块可以无限放大的画布。文本、图片、视频、音频、脚本五种节点随便摆，用连线串成工作流，可以反复跑。"
  - 来源：https://zhuanlan.zhihu.com/p/2018072443852465515 （Founder Park 机构号，Liblib 官方合作内容）

### 2.2 LiblibAI 公司前端技术栈信号 = React / TypeScript / Node
- LiblibAI 官网招聘页「前端开发工程师｜北京/上海」岗位要求明确写："**熟悉 react 框架、typescript 和 node 开发**"。
  - 来源：https://www.liblib.art/us/joinus （LiblibAI 官方 joinus 页，抓取时间 2026-09-06 仍在线）
  - 说明：这是"公司前端主体技术栈"的直接证据，但**不能**直接证明"LibTV 画布用了 React"（画布可能是独立前端栈/第三方库）。归为"公司级信号"，画布级结论放推断。

### 2.3 ComfyUI 官方前端（用户的对标对象之一）当前 = canvas 渲染，正在迁 DOM
- ComfyUI_frontend 官方仓库架构：**Vue 3 + TypeScript + Pinia + LiteGraph.js（Canvas2D 渲染节点）+ PrimeVue + Tailwind**；节点图编辑器是 **LiteGraph 的"canvas 2D + Vue components 双渲染模式"**。
  - 来源：ComfyUI_frontend DeepWiki 概述页 https://deepwiki.com/Comfy-Org/ComfyUI_frontend ；ComfyUI_frontend GitHub https://github.com/Comfy-Org/ComfyUI_frontend ；第三方架构快照 https://www.sourcepulse.org/projects/1986999
- LiteGraph 是"图形节点引擎 + 自带 HTML5 Canvas2D 编辑器"，Comfy 官方维护的 fork 已归档但标注由 ComfyUI 使用："Renders on Canvas2D……Optimized to support hundreds of nodes per graph"。
  - 来源：https://github.com/Comfy-Org/litegraph.js
- **Comfy 官方文档「Nodes 2.0」明确：将节点系统从 LiteGraph Canvas 渲染过渡到基于 Vue 的架构**。官方给的原因原文翻译："之前的 Canvas 渲染系统已成为开发瓶颈，即使小的 UI 改动也常需深层修改、耗时数天"；并承认 Vue 版在性能上"仍在朝 Canvas 级性能优化"，LiteGraph 渲染仍保留可切换。
  - 来源：https://docs.comfy.org/interface/nodes-2 （及中文 https://docs.comfy.org/zh/interface/nodes-2 ）

### 2.4 主流 AI 工作流 Web UI 开源实例普遍用 React Flow / Vue Flow（DOM 节点）
- ComfyUI 社区对 LiteGraph 的评论点出 canvas vs DOM 的分野：LiteGraph "性能很好，因为一切都在画布上渲染而非 DOM；React Flow 无法同时渲染这么多节点。"
  - 来源：Reddit r/StableDiffusion 讨论 https://www.reddit.com/r/StableDiffusion/comments/1k5y6d7/why_is_comfyui_using_litegraphjs/
- 多个对标 ComfyUI / AI 生成的开源工作流编辑器，技术栈为 **React Flow（xyflow）/ Vue Flow（DOM 节点）**：
  - `CPloscaru/caraca`：ComfyUI/Freepik 灵感，Canvas = **xyflow (React Flow)**，Next.js + React19 + Zustand。来源：https://github.com/CPloscaru/caraca
  - `aiudalabs/flowAI`：LangGraph 可视化工作流构建器，**ReactFlow**。来源：https://github.com/aiudalabs/flowAI
  - `soneeee22000/agentcanvas`：agent 工作流，**Vue 3 + VueFlow**。来源：https://github.com/soneeee22000/agentcanvas
  - `MaLunan/AIGCCanvasFlow`：**Vue3 + @vue-flow** 的 AIGC 无限画布编辑器，"类似可灵、libTv 等编辑器"。来源：https://github.com/MaLunan/AIGCCanvasFlow
  - 中文技术文也确认 React Flow 已成国内主流工作流平台的画布引擎（"百宝箱、扣子等主流工作流平台的核心画布引擎"）。来源：https://juejin.cn/post/7517916583731593253
- React Flow 定位："用于构建 node-based editors 和 interactive diagrams 的 React 组件库"，官方建议用于富内容节点编辑器场景。来源：https://blog.csdn.net/weixin_44151887/article/details/160343324 （复刻文引言）及 https://www.workflowbuilder.io/compare/react-flow

### 2.5 社区如何复刻 LibTV 画布（旁证其 DOM 路线可实现性）
- CSDN 博客《AI漫剧工具复刻实战：用 React Flow 搭一个前端的无限画布，复刻 TapNow / LiblibTV 的核心交互》：作者用**截图分析 LibTV 界面后，选择 React Flow / Vue Flow 复刻**，判断这类"节点卡片 + 连线 + 无限拖拽缩放"的富内容编辑器最快落地方案就是 React Flow / Vue Flow。文中对 LibTV 画布的具体判断为社区作者观点（非官方）。
  - 来源：https://blog.csdn.net/weixin_44151887/article/details/160343324 ；同一作者内容同步于 gitcode：https://gitcode.csdn.net/69e629aa0a2f6a37c5a11b2c.html
- 开源复刻项目 AIGCCanvasFlow（Vue3 + VueFlow）README 自述"类似可灵、libTv 等编辑器"，证明**业界普遍认为 LibTV 这类画布用 DOM 节点方案（Vue Flow / React Flow）即可实现**。
  - 来源：https://github.com/MaLunan/AIGCCanvasFlow

---

## 3. 推断 / 未证实（明确标注）

> 以下均因 LibTV / Liblib 画布为闭源、无公开仓库/源码/技术博客，**无法从第一手源码证实**。依据为产品交互特征与间接信号，按置信度排序。

### 3.1 LibTV 画布 = DOM 节点（富内容）+ 局部 canvas 预览媒体（高置信推断）
依据（产品交互特征，均来自已核实的实测报道 §2.1 / §3 附加功能）：
- 节点是**富内容**：图片节点内可框选"聚焦"某个主体、用截图功能框选图内细节、支持打光/亮度/颜色点选、透视角度拖拽；视频节点内可直接**剪辑**（拖动/切片段）。这类需要在节点内做精确像素级定位、框选、拖拽的交互，用 DOM + CSS/绝对定位 + 节点内嵌 `<img>`/`<canvas>` 远比"整块 canvas 自绘节点"容易实现。
- 双击空白即生成富内容节点、五种异构节点（文本表单/图片编辑/视频剪辑/音频/脚本），与 React Flow / Vue Flow 的"自定义富内容 node 组件"范式天然匹配；全 canvas 自绘则每个节点每种控件都要手写命中测试，工程量大得多。
- 没有证据表明 LibTV 出现 ComfyUI 那种"整图统一 canvas 渲染"特征（如大量同构小节点、超高节点数极限性能优化）。LibTV 偏向"创作资产摆布"，节点少而重。
- 结论：**LibTV 画布大概率是"DOM 承载节点与连线（基于 React Flow / Vue Flow 一类 DOM 节点库或同类自研 DOM 画布）+ 节点内用 `<canvas>`/`<video>`/`<img>` 做图像视频媒体预览/编辑"的混合方案**。**"哪个部分是 canvas"推断为：连线层以下（背景网格、可缩放平移视图）与媒体帧预览走 canvas/DOM 混合，节点壳与编辑控件走 DOM。**

### 3.2 LibTV 具体用的是 React Flow 还是 Vue Flow（未证实 / 无法判定）
- LiblibAI 公司级前端栈偏 React/TS（§2.2 招聘信号），但**不能**据此断定 LibTV 画布就是 React Flow —— 独立业务线可能用 Vue 或第三方定制。网上无任何一篇可信材料明确指出 LibTV 的底层画布库。
- 判定：**真伪无法通过网络核实**。若确需，唯一可靠手段是登录 liblib.tv 打开画布后用浏览器 DevTools 检查 DOM：是否出现 `.react-flow__*` / `.vue-flow__*` 类名（分别证明 React Flow / Vue Flow），或整块 `<canvas>` 元素（证明 canvas 渲染）。

### 3.3 LiblibAI 画布历史（liblib.art 的"工作流/图像流"）与 LibTV 关系（低置信、不影响结论）
- 网上检索到的关于 liblib.art 画布的直接技术资料极少；主站与 LibTV 的画布实现是否为同一套前端不得而知。鉴于用户对标的是"类 ComfyUI 交互 + 像 LiblibAI 的界面"，建议把 LibTV 当作当前唯一明确公开的画布对标物即可。

---

## 4. 通用技术路线：主流 AI 工作流 Web UI 怎么做

基于 §2.4 与 ComfyUI 官方动态（§2.3），可归纳出两条分叉 + 一条趋势：

| 路线 | 节点渲染 | 代表 | 性能上限 | 迭代/自定义便利性 | 趋势 |
|---|---|---|---|---|---|
| **A. DOM 节点库** | React Flow(xyflow) / Vue Flow，节点=DOM 组件 | 扣子、百宝箱、caraca、flowAI、agentcanvas、LibTV(推断)、**本项目(Vue Flow)** | 几十~一两百节点流畅；几百同构小节点吃力 | 高——节点即组件，富内容、动效、编辑器好做 | **主流**，社区与商业产品都选它 |
| **B. 全 canvas 自绘** | LiteGraph.js(Canvas2D) | ComfyUI 官方 | 极高——可撑"数百个节点" | 低——官方称"任何小 UI 改动都耗数天"，成开发瓶颈 | 正在**主动迁向 DOM**（Nodes 2.0） |

**主流结论**：绝大多数对标 ComfyUI / 面向业务工作流的 Web UI 走 **A 路线（DOM 节点 + 局部 canvas 预览大图）**。用户任务描述里的猜测"主流是不是都走 DOM 节点 + 局部 canvas 预览大图"——**答案是肯定的**，这与 ComfyUI 官方逆向迁移的方向一致：DOM 负责交互/富内容/开发效率，canvas 只用于大图/视频等重媒体与需要超高帧率/超多节点的极限场景。

---

## 5. 给本项目（mini-canvas，Vue3 + Vue Flow）的选型启示

（结合本仓库实际技术栈：Vue3 + @vue-flow/core@1.48 + three + dagre + pinia，见根 package.json 及 packages/canvas-core*/canvas-render 均依赖 @vue-flow/core）

1. **坚持 Vue Flow（DOM 节点）路线，不要被"ComfyUI 用 canvas"误导。** Vue Flow 是业界验证过的主流方案；canvas 统一渲染只在"几百个同构小节点 + 极致拖拽帧率"时才必要，而类 Liblib 的工作流是"少而重的富内容资产节点"，正适合 DOM。
2. **图像/视频预览用节点内嵌 `<canvas>` / `<img>` / `<video>`，连线与平移缩放交给 Vue Flow 内置能力** —— 这就是"DOM 节点 + 局部 canvas 预览媒体"的落地形态，与 LibTV/主流一致。
3. **参考"canvas 渲染是开发瓶颈"的教训**：别为追求"像 ComfyUI 原生"而去自研全 canvas 自绘节点；那是把 UI 改动成本锁死。Vue Flow 的 custom node 体系已覆盖富内容需求。
4. **真要对齐 LibTV 交互**：重点做对的产品特征是"双击空白生成节点、节点内富编辑器（聚焦/框选/剪辑）、连线成可反复跑的工作流"，这些 DOM 路线都能高效支撑。
5. **若 LibTV 底层库真伪影响选型决策**：只有登录 liblib.tv 用 DevTools 看 DOM class 才能定论（React Flow 的 `.react-flow` 或 Vue Flow 的 `.vue-flow` 前缀），网络公开资料无法判定（见 §3.2）。

---

## 6. 附：参考资料清单

| # | 主题 | URL |
|---|---|---|
| 1 | LibTV 发布实测（腾讯新闻） | https://view.inews.qq.com/a/20260319A05XAY00 |
| 2 | LibTV 量子位报道 | https://news.qq.com/rain/a/20260323A05VI100 |
| 3 | Founder Park 产品文（LibTV 双入口/画布） | https://zhuanlan.zhihu.com/p/2018072443852465515 |
| 4 | chooseai 工具介绍 | https://www.chooseai.net/news/2943 |
| 5 | LiblibAI 官方招聘（React/TS 信号） | https://www.liblib.art/us/joinus |
| 6 | ComfyUI_frontend DeepWiki 架构 | https://deepwiki.com/Comfy-Org/ComfyUI_frontend |
| 7 | Comfy-Org/litegraph.js（已归档，Canvas2D） | https://github.com/Comfy-Org/litegraph.js |
| 8 | ComfyUI Nodes 2.0（canvas→Vue 迁移） | https://docs.comfy.org/interface/nodes-2 |
| 9 | Reddit：为何 ComfyUI 用 LiteGraph（canvas vs DOM 讨论） | https://www.reddit.com/r/StableDiffusion/comments/1k5y6d7/ |
| 10 | CSDN：用 React Flow 复刻 LibTV 无限画布 | https://blog.csdn.net/weixin_44151887/article/details/160343324 |
| 11 | 掘金：工作流画布引擎 React Flow | https://juejin.cn/post/7517916583731593253 |
| 12 | 开源：AIGCCanvasFlow（Vue3+VueFlow，类似可灵/libTv） | https://github.com/MaLunan/AIGCCanvasFlow |
| 13 | 开源：caraca（ComfyUI 灵感，xyflow） | https://github.com/CPloscaru/caraca |
| 14 | 开源：flowAI（LangGraph，ReactFlow） | https://github.com/aiudalabs/flowAI |
| 15 | 开源：agentcanvas（Vue3+VueFlow） | https://github.com/soneeee22000/agentcanvas |
| 16 | React Flow vs Workflow Builder（React Flow 定位） | https://www.workflowbuilder.io/compare/react-flow |
