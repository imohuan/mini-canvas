# C3 收敛:副作用统一归 Fiber(对齐 Cordis 原版 02 教程)

## 目标语义(对齐 deepseek-harness docs/cordis-tutorial/02)
Cordis 原版单轨:
- 插件实例 = fiber;插件经 ctx.effect/ctx.on/各 register 建立的 disposer **附着到该插件自己的 fiber**。
- `ctx.plugin(子)` 返回子插件 fiber(可 `await fiber.dispose()` 单独卸)。
- `fiber.dispose()` 等全部清理(含异步 disposer)完成;子插件随父插件一起 dispose。
- **没有独立 Scope 概念**。

## canvas-core-v2 现状失真
- 插件副作用被 Context 用"每插件一个独立 Scope(pluginScopes map)"托管;
  Fiber 自带那套 onDispose/effect/disposer 队列在主路径是死代码,只剩状态机在用 → 两套并存。
- `ctx.plugin(子)` 返回父 ctx(扁平并入根),不返回子 fiber、不随父卸载。

## 收敛改动(核心)
1. Context 不再建 per-plugin Scope:改由**插件自己的 Fiber 持 disposer**。
   deriveScope 的 on/effect/inject/provide/清理 → 落到 fiber.effect/fiber.onDispose。
2. 删 Context 的 `pluginScopes` map;装载/热卸/回退/stop 的卸载点改 dispose 对应 fiber。
3. runPlugin 的 cleanup 登记进 fiber;declareConfigIntoStore 的 scope.onDispose → fiber。
4. 保留 rootScope 只服务根 ctx.effect(与 Cordis 根 ctx 对应)。
5. `ctx.plugin(子)` 返回被挂载子插件的 fiber(改 PluginScope.plugin 签名)。
6. retract/reload 语义:卸载(临时回退 PENDING)要**清掉 disposer 但保持 fiber 可复用**,
   故给 Fiber 一个"跑完并清空 disposer、回到 PENDING"的非终结操作(不被 DISPOSED 卡死)。

## 约束
- 插件副作用实测全是同步、无 async disposer、无外部直用 fiber.effect → 可安全同步化。
- Fiber.dispose 需让**同步 disposer 同步执行**、异步 disposer 照旧 await → context.test
  (同步断言 uninstall/stop 后 cleanup 已跑)与 fiber.test(await dispose)都保持绿。
- 每步跑 canvas-core-v2 全量 + canvas-render 全量兜底;不改已有测试语义(可加新用例)。
