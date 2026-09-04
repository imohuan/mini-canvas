# Cordis 调研：该不该用 @cordisjs/*

日期：2026-09-04 · 来源：npm registry + GitHub(cordiverse/cordis) + 官方 README + 联网检索

## 一、关键事实
1. **官方 README 自述**："Cordis is under active development. The API is not yet stable and may change without notice." + "official documentation is still under construction."
2. **npm 版本状态**：`cordis` latest dist-tag = **4.0.0-rc.9**，next = **4.0.0-beta.5** —— 仍是 RC/预发布，非稳定版。
3. **两个都叫 Cordis、且都未稳定**：
   - `@cordisjs/core`（作者 shigma，Koishi 同源）—— AOP/DI 插件框架，面向 **Node 应用**（机器人/服务端），提供 ctx.plugin / ctx.on / ctx.start / 服务注入 / 作用域清理。
   - context7 里那个 "spatiotemporal composability meta-framework"（cordiverse）—— 学术型/实验型，README 同样说"under active development"，与本需求无关。

## 二、关键判断
1. **不成熟**：两套都是"开发中、API 随时可能变、官方文档未完工、npm 停在 RC"。
2. **不匹配技术栈**：`@cordisjs/*` 是 **Node 进程/AOP** 框架，**不含 Vue 响应式、pinia、DOM、UI 插槽**任何概念。而我们要的是**前端画布引擎**：Vue + pinia + UI 插槽。
3. 真用它，等于：仍要自己把 Vue/pinia/UI 集成层全写了，还**被绑在一个不稳定的外部 API** 上。现成 canvas-core 已具备 Cordis 的核心精华（context、插件生命周期、事件总线、按名注入 api、依赖拓扑），只是乱 + 未抽象干净。

## 三、建议结论
**不用 `@cordisjs/*`**。"采用 Cordis 概念" = 在 canvas-core-v2 **自研一个 Cordis 风格的小内核**：
- 借用其好思想：`ctx.plugin(plugin)` 装载、`ctx.inject` 依赖注入/服务作用域、`ctx.on/emit` 事件、disposal（卸载自动清理副作用）、reusable service。
- 但按前端需要造：底层接 Vue 响应式 + pinia + UI 插槽系统。
- 无外部不稳定依赖、全权可控、贴合 v1 已有一半的骨架。

## 四、备查
- GitHub: github.com/cordiverse/cordis（shigma 主仓库）
- npm: `@cordisjs/core`；`cordis@4.0.0-rc.9`
- 另见 npmx.dev/package/@cordisjs/core 的 API 说明（ctx.plugin/ctx.on/ctx.start/ctx.registry/ctx.inject/服务与 mixin）
