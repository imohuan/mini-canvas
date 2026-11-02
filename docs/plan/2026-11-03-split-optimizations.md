# UiContent 拆分优化建议（2026-11-03）

本次只做原样拆分，下列项目**未实施**，留给后续独立改动与验证。

## 1. 空态统一组件的外层样式钩子

`UiContent.vue` 的空态分支曾尝试抽成 `UiEmptyState.vue`，但发现外层 `.ui-empty` 的
`scoped` 数据标记留在宿主样式表里，抽走后极简宿主会丢失父级布局样式，因此已撤回。
如果后续要再抽，先在空态分支保留一层宿主自己的容器，或者把布局样式明确归属到子组件
并在真实画布验证主题空态件与兜底空态两种形态。

## 2. 空态兜底块仍留在入口

当前入口保留约 10 行空态模板和 17 行样式。它依赖宿主注入的 `nodeEmptyState`，
与主题 CSS、scoped 标记绑定较紧，暂不继续拆。后续可以考虑把主题组件和兜底 DOM
都放进子组件，同时验证是否有宿主外层选择器依赖。

## 3. `useUiDebugWindow.ts` 仍偏大

抽完后它约 400 行，仍同时处理邀请确认、SDK 文档拼接、调试窗口、消息回包与状态写入。
若要继续拆，建议单独拆出 `useUiDebugInvite.ts`（邀请/凭据/聚焦）、
`useUiDebugDocs.ts`（调试文档上报与重发）、`useUiDebugMessages.ts`（调试页与 SDK 消息）。
这一步涉及多处共享计时器和生命周期清理，应单独做回归与真机调试验证。

## 4. 入口里的上游素材计算仍偏长

`upstream` 计算包含 `NODE_KIND_FIELDS`、`TYPE_KINDS` 与从连线收集素材的逻辑，
可以抽成 `useUiUpstream.ts`。本次优先保持原顺序与依赖关系，未动这一块；
后续抽取时需保持“优先读 data 快照、否则从连线现算”的语义和空素材过滤。

## 5. 消息监听的注册与清理可以统一

入口仍分别注册 bridge、debug window、SDK 事件和 debug proxy 四个 message 监听，
卸载时分散在多个 `onBeforeUnmount`。后续可以收成一个 `useUiMessages.ts`，
返回唯一的 `dispose()`，减少“新增监听漏摘”的风险；改动前保留现有监听语义和来源校验。

## 6. 窗口消息类型可以收口

`useUiBridge.ts`、`useUiProxy.ts` 与 `useUiDebugWindow.ts` 都各自声明了一部分消息字段，
后续可以聚合成 `ui-content/protocol.ts` 的判别联合类型，让 `save / task / state / output`
等分支在编译期校验完整。本次为纯拆分，未改协议形状。
