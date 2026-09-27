# 09: 评估 canvas-foundation 拆包的收益与兼容成本

**What to build:** 团队有一份基于实际依赖和消费者的决定，明确画布注册语义是否值得从 canvas-data 拆成独立 foundation 包，以及如何保留旧入口。

**Blocked by:** 02: 修正作者 SDK 节点字段透传与包内类型入口; 03: 为作者上下文建立集中服务类型

**Status:** done —— 结论 **no-go**，见 [docs/plans/2026-09-27-canvas-foundation-go-no-go.md](../../../docs/plans/2026-09-27-canvas-foundation-go-no-go.md)

- [x] 数据能力、画布语义、宿主实现的现有 import 关系按实际消费者分类，不按包名推测。
- [x] 对比"保持现有包、只收紧公开接口"和"新增 foundation + 旧包重导出适配"两种方案。
- [x] go 方案证明能减少真实依赖、保持 kernel → data/foundation → render → plugins 单向且无循环。
- [x] go 方案列出兼容 re-export、迁移批次、验证及最终 contract 入口；不重复移动 doc 和 canvasBasePlugin。
- [x] 若拆包收益仅是改名或没有第二个真实消费边，明确 no-go，不创建空包。
- [x] 决策结果链接到后续实现票据；该评估任务本身不移动生产代码。

四条准入条件只满足一条（职责不干净）；反向依赖仍存在（graphDocument.ts → canvas/connection）、
无第二个真实消费者（cloud-server/mcp-server 刻意不 import canvas-data）、迁移会再次移动 doc/canvasBasePlugin。
故维持现有分包 + 接口收窄（即 T01–T08 已落地部分）。
