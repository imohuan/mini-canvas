# canvas-foundation 拆包 · go/no-go 决策

日期：2026-09-27 · 类型：架构决策（执行计划 T09）· 结论：**no-go（暂不新建独立包）**
依据：本次改造后的实测依赖（下表均带可复现命令）

## 决策

**暂不新建 @mini-canvas/canvas-foundation。** 保留现有 canvas-data 分包，
继续以"收紧公开接口"的方式收敛画布语义，而不是再拆一层包。

理由不是"拆不动"，而是**拆包的四条准入条件里只满足一条**（见下），
此时新建包只会得到一个换名字的空壳，并付出第三轮搬迁成本。

## 评估用的四条准入条件

计划（T09 ticket）要求同时满足才开实现任务：

1. 职责更清楚；
2. 无反向依赖（数据层不依赖画布语义）；
3. 第二个 headless/render adapter 有真实消费收益；
4. 迁移不重复移动 doc / canvasBasePlugin。

## 实测证据

### 证据一：确实存在一条真实的反向依赖（条件 2 不满足）

数据层文件 graphDocument.ts 反向 import 了画布语义层：

    packages/canvas-data/src/graphDocument.ts:27: import { validateConnection, typeConnectionDef, pickOverflowEvict } from "./canvas/connection"
    packages/canvas-data/src/graphDocument.ts:28: import type { InvalidReason } from "./canvas/connection"

也就是说，今天的 canvas-data/src 并非纯数据 —— 它为了"建边时校验连接规则"
依赖了 canvas/connection.ts。要拆成 foundation，连接规则要么留在数据层（那 foundation
会反向依赖回数据层），要么一起搬（工作量落在同一个包里）。

复现命令：

    rg -n "from .\./canvas|from .\.\./canvas" packages/canvas-data/src --glob "*.ts"

（除本例外，命中的都是 canvas/ 内部自引用与 index.ts 的 export * from "./canvas"。）

### 证据二：没有第二个真实消费者（条件 3 不满足）

两个 headless 消费者刻意不 import canvas-data，并在源码里写明原因：

    packages/cloud-server/src/mcp/canvasDoc.ts:18: 类型定义就地写（不 import @mini-canvas/canvas-data）：本包要能独立 npx 跑，
    packages/cloud-server/src/mcp/canvasDoc.ts:26: 而它有 39 处 import/export 直接依赖 @mini-canvas/kernel，kernel 也是 private 且同样只发 src/。
    packages/mcp-server/src/graph/GraphModel.ts —— 同样自建一份图模型

且两边的画布模型本就不同源（canvasDoc 存语义类型；GraphModel 存渲染类型
type: custom + data.nodeType；边 id 也不同源）。因此不存在"第二个 adapter 因拆包而受益"
的真实消费边 —— 拆出来的 foundation 目前只有 canvas-data 自己会用。

复现命令：

    rg -n "@mini-canvas/(canvas-data|canvas-render|canvas-base)" packages/cloud-server/src packages/mcp-server/src

### 证据三：这不是第一次搬迁（条件 4 不满足）

画布语义层的历史轨迹是"搬进 canvas-data"：

1. canvasBasePlugin.ts（15 行装配收编）与 doc 门面已在早前步骤落地；
2. docs/STATUS.md 明确记：packages/canvas-core-v2 已删除，实现与测试分别迁入 kernel 与 canvas-data。

再搬一次 = 让 doc / canvasBasePlugin 经历第三轮位置变化，而它们没有新增任何行为。

### 证据四：职责边界确实不够干净（条件 1 部分满足）

canvas-data/src 同时含数据能力与画布语义：

    数据层（无画布概念）：nodeStore / edgeStore / graphDocument / history / selection /
                        docService / resourceService / settingsPersist / transient / storage/
    画布语义层（canvas/）：Context / 能力段 / 节点与主题注册表 / 连接校验 / 节点工厂 /
                        画布命令 / 基础装配插件

这一条支持"未来值得拆"，但它单独不足以支付拆包成本。

## 为什么不选"现在就拆"

1. 名字换了、依赖没减少（条件 3）：新包只有 canvas-data 一个消费者。
2. 反向依赖要先解（条件 2）：连接规则归属本身是个独立设计题，不该和"建包"捆在一起。
3. 兼容成本高：24 个插件经 canvas-base 间接依赖这些类型；canvas-data 入口有 328 条测试。

## 选了什么替代方案

在现有分包内做接口收窄，这正是本次 T01–T08 做的事：

1. 用集中服务类型（canvas-data/src/canvas/serviceTypes.ts，T03）替代各处手写结构断言；
2. 用一条权威注册事实源（T01）替代双写；
3. 用有就绪状态的渲染契约（canvas-render/src/contracts/canvasFlowApi.ts，T04）替代静默降级；
4. 让业务插件不再依赖默认主题包（T06/T07），并由 T08 的守卫钉住。

这些改动不改变包结构，却已经把"作者要认多少个入口"显著收窄。

## 何时重新评估（go 的条件）

同时出现以下两条时，再开 foundation 实现票：

1. 出现第二个真实消费者 —— 最可能是 cloud-server/mcp-server 改为直接依赖
   @mini-canvas/canvas-data（前提：先解决"发布只含 src/"的问题，见 STATUS 记录）；
2. 连接规则（canvas/connection.ts）的归属定案 —— 无论留在数据层还是搬进语义层，
   都要先消除 graphDocument.ts → canvas/connection 这条反向依赖。

在那之前，本决策维持 no-go；本文件即该决策的记录，不创建空包。

## 验收

- [x] 按实际消费者分类现有 import，不按包名推测（证据一/二/三）。
- [x] 对比"保持现有包、只收紧接口"与"新增 foundation + 旧包重导出"两种方案。
- [x] 列出 go 的条件与前提；当前明确 no-go。
- [x] 本评估未移动任何生产代码。
- [x] 决策结论可复现（上附命令）。
