# 05: 让默认主题通过渲染契约消费宿主能力

**What to build:** 默认主题作为一个可替换适配器完成注册，并在合法渲染宿主内通过稳定的服务和 render facade 工作，不需要从宽泛的内部结构中猜取宿主能力。

**Blocked by:** 01: 统一主题与节点区域注册事实源; 03: 为作者上下文建立集中服务类型; 04: 为 VueFlow 能力建立有就绪状态的渲染 facade

**Status:** done (commit d56c4de)

- [x] 节点壳、背景、边、拖线和设置 UI 所需的宿主能力通过已类型化服务或 render facade 获取。
- [x] 主题组件不再自行对内核/数据服务形状做无约束断言来取得 doc、command、viewport 等能力。
- [x] 主题插件 apply 能注册主题槽和 UI 目录；其组件渲染要求由 render host 契约明确表达。
- [x] 组件在缺少 CanvasSurface/render provider 时按契约明确报错；插件 apply 阶段不误报 VueFlow 后端已就绪。
- [x] 默认主题现有壳、边、背景、设置面板和 UI 目录整链测试继续通过。

说明：BaseNode/CustomEdge/PluginSettingsDialog/useNodeCapability 的手写结构断言已改为按名推导
（T03）；DefaultBackground 不再直接 import VueFlow，改从 useCanvasRender() 取视口。
BaseNode 内保留的 useVueFlow 调用未动 —— 它属红线核心节点件的行为契约。
