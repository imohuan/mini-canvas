# canvas-core-v2 核心重构：插件副作用/生命周期统一归 Fiber

## 任务概述
现状失真：Context.ts 给每个插件一个独立 `Scope`（pluginScopes map）托管副作用，
而 Fiber.ts 自带完整 disposer 机制（onDispose/effect/collectResult/cleanups/inflight/dispose）
但主路径根本没喂数据给它，只被调状态迁移 + 空转 dispose() → 死代码 + 两套并存。

目标：删掉每插件独立 Scope，把插件副作用/生命周期统一归到该插件自己的 Fiber
（对齐 Cordis 原版 02 教程语义：插件 = 一个 fiber）。Scope 类保留（供 rootScope + 单测）。

## 基线
- canvas-core-v2 vitest：196 passed / 20 files（已确认绿）。
- 分支 feat/cordis-plugin-system；有他人未提交改动（plugin-theme-default、canvas-render tsconfig、docs/tmp），不碰。

## 改动文件
1. `packages/canvas-core-v2/src/core/fiber.ts`
2. `packages/canvas-core-v2/src/core/Context.ts`

（Scope.ts / scope.test.ts 保留；不新增测试，因既有语义测试已覆盖本行为。）

## 步骤
### 1. Fiber.ts 新增同步 `runDisposers(): void`
- 同步逆序(LIFO)跑完并清空当前已登记 cleanups；
- 单 disposer 抛错不阻断其余；
- 若某 disposer 返回 promise（理论上现在不会），fire-and-forget 调用不 await（void + catch）；
- 不改状态机：不置 DISPOSED、不动 _disposeStarted（供卸载/回退/半成品失败后复用重载）。
- 既有 dispose()/effect/onDispose 保持不动。

### 2. Context.ts
- 删 `pluginScopes` map；不再 new Scope / child()。保留 `rootScope`（ctx.effect 用）。
- `deriveScope(scope,name)` → `deriveScope(fiber,name)`：on/once/effect/inject/provide 的清理
  改挂 `fiber.onDispose(...)` / `fiber.effect(...)`；`plugin()` 嵌套内部处理不变。
- `tryActivate`：不再 new Scope / 存 pluginScopes。declareConfigIntoStore 与 runPlugin cleanup 都登记进 fiber；
  配置校验失败/runPlugin 抛错时调 `fiber.runDisposers()` 清半成品，保留 markFailed(FAILED) 供诊断。
- `declareConfigIntoStore(..., fiber)`：`scope.onDispose(()=>store.removeByScope)` → `fiber.onDispose(...)`。
- `stop()`：按 fibers 插入序 reverse 遍历已装插件，每个 `fiber.runDisposers()` 清副作用；
  保留 setLifecycle/emit；末尾清 maps/services/settings。
- `uninstallPlugin`：守卫改为"fiber 存在"（原 scope 存在）；`fiber.runDisposers()` + 移除 fibers；
  保留 setLifecycle/emit/retractUnsatisfiedActives。
- `retractPlugin`：`fiber.runDisposers()` 清副作用 + `fiber.markPending()`，保留 plugins/fibers/configs 登记。
- 不再对 fiber 调 `dispose()`（避免 DISPOSED 阻断 markPending/重载）；清完即移出 map 即可。
- 类型：PluginScope 接口签名不动，改后 typecheck 过。

## 验证
- 每步后：`node node_modules/vitest/vitest.mjs run`（canvas-core-v2 下）。
- 完成后：canvas-core-v2 测试 + canvas-render 测试 + 两包 `tsc --noEmit`。

## 风险/注意
- uninstallPlugin 守卫从 scope→fiber：冷启动 PENDING(缺依赖未建 scope)或 FAILED 遗留 fiber
  现在可被 uninstall 清理（原返回 false）。涉及语义微调，需知会用户。不影响现有测试。
- stop() 现在会对 PENDING/FAILED 插件也走 teardown 事件（原只对已加载 pluginScopes），合理。
- runDisposers 必须不改 fiber 状态，否则 retract 的 markPending 与重装 transition 会被卡住。
