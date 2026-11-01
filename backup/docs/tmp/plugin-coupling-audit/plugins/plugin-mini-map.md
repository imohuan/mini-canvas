# plugin-mini-map

## 一句话

右下角小地图：canvas 画节点方块、div 画视口蓝框，拖拽/点击平移视口。数据来自 nodeLayout 与 viewport，自己只维护显隐状态。

## 清单

| 项 | 值 |
|---|---|
| 包名 | @mini-canvas/plugin-mini-map |
| 身份 | installable |
| 源码文件 | 5 个（plugin / config / engine / overlay 404 行 / index） |
| 测试文件 | 2 个，21 个用例 |
| 包依赖的其他插件 | 无 |

## 跨包 import

| 目标 | 入口 | 是否公开出口 | 证据 |
|---|---|---|---|
| canvas-base | Context / PluginModule / ViewportState | 是 | src/miniMapPlugin.ts:16、src/MiniMapOverlay.vue:19 |
| canvas-render | useCanvasRender | 是 | src/MiniMapOverlay.vue:18 |
| 其他插件 | 无 | — | 全 src 无 plugin- import |

没有 L3 硬耦合。

## 运行时协作

| 依赖 | 方式 | 必需/可选 | 证据 |
|---|---|---|---|
| doc | inject + get | 必需 | src/miniMapPlugin.ts:21 |
| nodeLayout | inject + get | 必需 | 同上:21 |
| viewport | inject + get | 必需 | 同上:21；组件内 get 于 src/MiniMapOverlay.vue:232、254、291 |
| settings | tryGet + onChange | 可选 | src/miniMapPlugin.ts:41-47、src/MiniMapOverlay.vue:42-49 |
| mini-map 槽 | slots.register('mini-map') | 宿主需渲染该槽 | src/miniMapPlugin.ts:55-60 |
| mini-map 服务 | ctx.inject('mini-map', reactive state) | 对外提供 | 同上:37 |
| 命令 | mod+m | — | 同上:63-73 |

两条跨包契约：

- 宿主 UI 直接读 mini-map 服务控制开关（packages/ui/src/composables/ui.ts:948-952），说明服务名 visible 是公开 API，不只是本插件内部状态。
- 组件把类型名为 group 的节点过滤掉（src/MiniMapOverlay.vue:91）。这是与 plugin-group 的字符串契约：分组容器不画进小地图。若分组类型改名，小地图会把整块分组画成一个大方块。

显隐是双源：服务 state.visible 与 settings.miniMapVisible 互相同步（src/miniMapPlugin.ts:39-51；组件 watch settings 于 :44-48）。两个源都有写入路径，靠 onChange 回灌保持一致。这是可用的，但任何一处漏写都会让面板开关与浮层显示不一致。

## 全局与宿主粘连

| 对象 | 用途 | 风险 | 证据 |
|---|---|---|---|
| window.devicePixelRatio | canvas 分辨率 | 低 | src/MiniMapOverlay.vue:143 |
| window resize 监听 | 重新量 pane | 低，卸载清理 | 同上:204、208 |
| .csurface-overlay | pane 尺寸兜底 | 中，宿主类名 | 同上:78 |
| .mini-viewer / hitNode 几何 | 命中判定 | 低 | 同上:167-179、257 |
| requestAnimationFrame | 拖拽合帧 | 低，卸载取消 | 同上:209-210、282-289 |

没有 localStorage / 固定 URL / 固定存储键。

## 内部职责与风险

组件 404 行承担了：配置订阅、内容矩形收集、mapState 计算、canvas 绘制、命中判定、拖拽会话、视口写入、resize。引擎 134 行是纯几何。职责偏重但可接受；真正的风险是 canvas 绘制依赖 CSS 变量 --mm-node 的运行时读取（src/MiniMapOverlay.vue:157-159），若主题没定义该变量或值为空，整个地图不画节点且没有兜底。这是“样式即数据”的隐式契约。

测试覆盖引擎 17 例与 canvas 4 例，没有覆盖真实的 pointer 拖拽与 viewport 写入顺序（dragZoomFollow 类测试在 multi-select，不在本包）。

## 单独装卸判断

可独立装卸。不装时没有 mod+m、没有小地图槽。宿主 UI 用 tryGet 读服务（ui.ts:948-952），缺失时开关为 false，不会崩。与其它插件无行为交叉。

## 建议改法

1. 最小改动：--mm-node 读不到时用主题 --ui-ink-dim 兜底，避免整张地图空白。
2. 把“跳过 group 容器”改为读公开的容器能力（nodes.register 的 resizable/transparent 等标记），而不是写死类型名。
3. 验证：补一条“卸载重装后 window resize 监听数量不增长”的测试；现有测试不覆盖组件生命周期。

## 待验证

- 已确认 .csurface-overlay 是公开结构：packages/canvas-render/src/host/CanvasSurface.vue:485-486 渲染该层，packages/docs/canvas-render/z-index.md:83-100 写明其 z-index 与用途。组件用它做 pane 尺寸兜底是合理的。
- settings.miniMapVisible 与 state.visible 的双写是否会在并发 onChange 时抖动；需要真机或单测验证。

