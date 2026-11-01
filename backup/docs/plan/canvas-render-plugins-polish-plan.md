# 方向 A：canvas-render + plugins 新链精修 —— 优化计划（分档）

日期 2026-09-05 · 分支 feat/cordis-plugin-system · 只动新链 canvas-render + plugins，不动内核/根 demo
审计报告：docs/tmp/canvas-render-plugins-audit/report.md（只读，已核实主要结论）

## 审计核心结论
新链内部大体已用上 v2 最新能力（Service 子类/模块 Config/declare module ctx.xxx/HOST_KEY 桥接/schema 驱动面板）。
真实可落地优化收敛为三档（低风险可直接做，中风险需拍板）。

## 第一档：纯增量、低风险
- [x] P1 服务直访统一：TextContent.vue 用已 declare 的 ctx.text 直访(替代 ctx.get + 手写 TextNodeService 桥)。
- [x] P2 ctx.slots 收口：CanvasHost.vue 用 `h.ctx.slots.occupants('overlay')` 替代裸 `get('slots').list`。(c3e1fa8)
- [ ] P3 image-meta dev 注入收编：nodeImagePlugin.ts 的 HMR 演示注入 —— 复核后判定为"有意的 dev 演示锚点、无人消费"，低价值删除，不纳入本期。

## 第二档：中风险、动装配/交互
- [x] 用户拍板：P4 做、P5 改走事件监听、P6 走"方案一(内核单源)"。

### P6 方案一(内核 Selection 单源) —— 设计(源码实据支撑)
✅ 已完成提交 e2fbb91
改动: 内核 Selection 加 onChange 订阅(纯增量); CanvasHost selectedIds ref 改为订阅内核派生(syncSelected),
onNodeClick/onPaneClick/Delete/Ctrl+Z 只写内核 selection, 删手工成对同步; CustomEdge 高亮/命令同源。

### P4 manifest 冷启动开关 —— 设计
✅ 已完成提交 ddd78de
createMiniCanvasHost + CanvasHost 加可选 manifest(与 plugins 二选一, manifest 优先走 applyManifest);
demo 可切 baseManifest 验证 disabled。补 createMiniCanvasHost manifest 用例。

### P5 改走事件(用户指正: 用监听而非查 diagnose)
✅ 已完成提交 a7b6ad5
CanvasHost 监听 ctx:lifecycle-change, lifecycle==='error' 时 emit('plugin-issue')。ERROR 装载失败经事件上报。
说明: PENDING(缺依赖)是内核合法等待态, 不发事件、不轮询——不误报; 仅 ERROR 视为问题。

## 附带发现
- image-meta(nodeImagePlugin.ts) 是 HMR dev 演示锚点、无人消费 → 不删(保演示锚点)。
- _p7_sticker_probe.ts 无人引用(疑早期探针)；删除前查 git 历史确认，待用户点头再清。

## 护栏
每档每项独立 commit + 跑 canvas-render 全量/插件 tsc；不删改旧测试语义；确认插件 dist 非本次改动面(不重build)。
