# canvas-core-v2 M1 内核实现计划（owner A 内核纠缠团）

日期：2026-09-04 · 分支：feat/cordis-plugin-system · 状态：**执行中**
依据：`canvas-core-v2-api.md`(API 契约定稿) + ADR-0001 + depmap(owner A)。纯 Node/vitest 可测，零 Vue/pinia 依赖。

## 目标
在 `packages/canvas-core-v2` 写出 **Cordis 风格最小内核**：作用域回收 + Context(plugin/inject/get/on/emit/effect) + Kahn 拓扑/生命周期。这是 tracer bullet 的第一段，M4 用它接最小 text demo 验证 API。

## 产出文件
```
packages/canvas-core-v2/src/
  index.ts            ← barrel(把 core 导出)
  core/
    types.ts          ← Disposable / PluginModule / EventMap / PluginScope / Lifecycle
    Scope.ts          ← 作用域回收(核心增量)
    topo.ts           ← Kahn 拓扑 + 环检测 + 可读路径(吸收 v1 PluginManager.resolveOrder/buildCyclePath)
    EventBus.ts       ← 类型化事件总线(吸收 v1 handler 表，砍 window，dev 白名单 warn)
    Context.ts        ← Context 类 + 子 scope 生命周期
  core/__tests__/
    scope.test.ts     ← 作用域回收零泄漏单测
    topo.test.ts      ← 拓扑/环/缺失/自依赖单测
    context.test.ts   ← inject/get/on/emit/plugin 集成单测
```

## 关键设计决策
1. **插件形状**：`PluginModule = { name; deps?: string[]; setup(ctx: PluginScope): void | (() => void) | Disposable }`——一段式，无 install/uninstall。setup 返回的 cleanup 或经 ctx 登记的副作用都进 scope。
2. **Scope**：LIFO disposables + 子 scope 集；dispose 先子后己、异常各自 try/catch 不中断。插件零 uninstall 代码。
3. **Context 与 PluginScope**：根 Context 有 plugin/start/stop/inject/get/on/emit/effect + 全局事件总线；每个 plugin() 建一个 PluginScope(子视图，继承根的总线与服务表，另有自己的 effect/on/inject 登记进自己 scope)。
4. **事件**：类型化 `on<K extends keyof EventMap>`；单源 emit 不碰 window；dev 下 emit 未声明名 warn(白名单)。
5. **inject/get**：Context 服务表；`get` 缺服务抛错(定稿)，不静默降级。
6. **生命周期**：吸收 v1 状态机但裁掉 deactivate/inactive 三态(无调用路径)，保留 installed/active/uninstalling/error。topo 排序决定 plugin() 装载顺序。
7. **测试**：vitest(node env)，先建 vitest.config.ts + package.json test script。不装新依赖(复用 monorepo vitest)。

## 验证
1. `pnpm --filter @mini-canvas/canvas-core-v2 test` 全绿。
2. scope.dispose 后副作用确实清光(单测断言 on/effect/inject 都失效)。
3. topo：正确顺序 / 缺失依赖报错 / 自依赖报错 / 环给出可读路径。

## 风险
- v2 是纯 TS 新包，首次跑 vitest 需确认根能解析(无 workspace 提升问题，必要时用 mcp-server 的 vitest 路径)。
- 事件白名单需要 EventMap 在编译期已知——先给最小 CanvasEventMap，插件 declare module 扩展留接口。
