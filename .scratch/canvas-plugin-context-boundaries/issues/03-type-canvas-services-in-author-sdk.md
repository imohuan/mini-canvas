# 03: 为作者上下文建立集中服务类型

**What to build:** 扩展 kernel 已有的 Services 类型扩展机制，让插件按服务名读取画布服务时可推导正确类型；插件扩展服务仍能声明自己的类型。

**Blocked by:** 02: 修正作者 SDK 节点字段透传与包内类型入口

**Status:** done (commit 2bbe6bc)

- [x] 作者 SDK 有唯一的内置服务映射，覆盖 doc、selection、resources、command、nodeFactory、nodeLayout、viewport 等当前服务。
- [x] get/tryGet 对已知服务名推导返回类型；未知扩展名仍支持显式类型扩展。
- [x] 运行时依赖仍通过 inject 声明，类型映射不会把可选 get 变成隐式硬依赖。
- [x] 编译期 fixture 验证服务名、方法和返回类型；错误服务名或错误方法能被 TypeScript 拦住。
- [x] 不更改现有服务名称、装载顺序或缺失依赖的运行时行为。

落点与审查略有不同：映射声明在 canvas-data 的 canvas/serviceTypes.ts（画布基础服务）与
canvas-render/src/index.ts（渲染层 nodeLayout/viewport）——内核不认识画布，故由其下层补。
顺带修一个已存在缺陷：PluginScope 类型声明了 tryGet，但插件作用域视图运行时从未实现它。
