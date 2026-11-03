# 补齐 DSH 差距 + 修复问题 —— 执行计划

日期 2026-09-05,分支 feat/cordis-plugin-system,基线 canvas-core-v2 196 / canvas-render 37 / 插件 tsc 绿。
对照：deepseek-harness/docs/cordis-tutorial 01-07 + cordis-api。明细见 docs/tmp/canvas-core-v2-arch/dsh-gap.md。

## 分块(每块独立可验证,顺序由稳到不稳)
- B1 #2 async 卸载 settle：fiber 记 in-flight async disposer;卸载时等它清完再结束。✅ bb4ff86
- B2 #1 裸函数插件：裸函数当 apply(ctx,config) 调用;可 new 的 Service 子类仍当类 new。✅ b8d4066
- B3 #3 Config 数组/嵌套：configSchema 增 array/object 字段(递归校验/默认)。✅ d4e479d
- B4 #6 ctx.registry 只读视图(枚举每插件 fiber/诊断 PENDING)。✅ 17a88ea
  - 完成说明：`ctx.inject(deps,cb)` 简写与 `ctx.plugin()` 返回 Fiber **未做**——前者与既有
    `inject(name,impl)`(提供服务)同名异义会歧义；后者牵连 cold-start 链式返回 this 与 PluginScope 类型签名，
    均有意义但破坏面大，按"最小改动"原则暂缓。registry 已覆盖 cordis 06 诊断需求。
- B5 #4 Loader 层最小实现：applyManifest 支持 `disabled`(清单保留、关闭不装)。✅ 651d7ff
  - 完成说明：组(嵌套子插件随父卸载)与 isolate(服务隔离)未做——二者需子 Context/服务命名空间层，
    与当前刻意采用的"单 ctx 全局一套服务表"扁平架构相抵触，超出画布宿主 JS 组合的实际需求，
    按 gap 文档"看定位/大/超职责"取舍维持现状。group 仅作展示元数据(PluginManifestEntry.group)。

## 护栏
每块后跑 canvas-core-v2 全量 + tsc;B 涉及宿主装配时跑 canvas-render + 插件 tsc;不删不改旧测试(可加新用例)。
每块完成独立 commit,message 中文。

## 完成状态(2026-09-05)
- canvas-core-v2 212 测试全绿(基线 198);canvas-render 38(基线 37);内核+canvas-render+4 插件 tsc 全绿。
- 均为追加性改动,未删改旧测试语义;plugin-theme-default/src/index.ts 他人未提交改动未触碰。
