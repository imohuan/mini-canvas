# 06: 把多选组件从默认主题依赖迁到主题可替换目录

**What to build:** 多选插件能取得标准端口和拖线组件，而不直接依赖默认主题包；切换主题时使用当前主题注册的兼容组件。

**Blocked by:** 05: 让默认主题通过渲染契约消费宿主能力

**Status:** done (commit 70bbb59)

- [x] MovingHandle 与 ConnectionLine 通过有稳定 props 类型的主题目录或主题无关 render contract 提供。
- [x] 多选组件从该契约取组件，运行时不 import plugin-theme-default。
- [x] 目录条目缺失时行为明确：要么清晰 fail-fast，要么使用经批准的可操作降级。
- [x] 热换主题后，多选端口和临时连接线使用新提供的组件，卸载后旧实现不残留。
- [x] 多选拖动、连线、缩放跟手性与现有回归测试保持通过。

落地：主题把 movingHandle / connectionLine 登记进 ui 目录；多选经 useUiComponent 按名取；
生产依赖移除（theme-default 降为 devDependency，仅测试注入真实件断言同款外观）。
浏览器实测：多选回归 22/22、官方 e2e 40/40。
