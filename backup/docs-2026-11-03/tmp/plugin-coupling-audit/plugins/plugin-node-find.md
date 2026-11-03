# plugin-node-find

## 一句话

Ctrl/Cmd+F 打开节点搜索浮层，按名称/类型过滤并聚焦节点。用 createApp 手动挂到 body，是本组里少数自己管理 Vue 应用生命周期的插件。

## 清单

| 项 | 值 |
|---|---|
| 包名 | @mini-canvas/plugin-node-find |
| 身份 | installable |
| 源码文件 | 4 个（plugin / filter / overlay 199 行 / index） |
| 测试文件 | 1 个，10 个用例 |
| 包依赖的其他插件 | 无 |

## 跨包 import

| 目标 | 入口 | 是否公开出口 | 证据 |
|---|---|---|---|
| canvas-base | PluginModule / Context | 是 | src/nodeFindPlugin.ts:15 |
| canvas-data | 无直接 import（经 ctx 取服务） | — | 同上 |
| canvas-render | 无 import（浮层用原生 DOM + Vue） | — | 同上:14 |
| 其他插件 | 无 | — | 全 src 无 plugin- import |

没有 L3 硬耦合。注意 package.json 把 canvas-render 列入 dependencies，但源码没有 import 它；属于清单层面的多余依赖。

## 运行时协作

| 依赖 | 方式 | 必需/可选 | 证据 |
|---|---|---|---|
| doc | inject + ctx.doc 直访，getNodes/getNode/subscribe | 必需 | src/nodeFindPlugin.ts:21、35、39、75 |
| viewport | inject + ctx.viewport 直访，setCenter/getViewport | 必需 | 同上:21、71、77 |
| nodeLayout | inject + ctx.nodeLayout 直访，getNodeRect | 必需 | 同上:21、69 |
| 命令 | mod+f | — | 同上:82-88 |
| doc 订阅 | 浮层打开期间订阅，关闭退订 | — | 同上:35、61-64 |

它和宿主快捷键面板存在同键风险：mod+f 同时是浏览器查找键，快捷键面板把 ctrl+f 标为系统保留键（packages/plugins/plugin-shortcut-manager/src/ShortcutHelpPanel.vue:58-63）。CanvasHost 命中后会 preventDefault（packages/canvas-render/src/host/CanvasHost.vue:1084），所以画布内 Ctrl+F 能打开本插件浮层，代价是浏览器查找被吞。这是有意取舍，但应在文档里写明。

浮层的生命周期管理是主要风险：createApp 挂 body（src/nodeFindPlugin.ts:31-48），closeOverlay 卸载并 remove 容器（:51-65），ctx.effect 兜底（:91）。若组件内部抛错导致 unmount 未执行，容器会留在 body；若宿主热卸时 apply 的 effect 已先于浮层关闭执行，也会残留。现有测试只测 filter 纯函数，没有测 open/close 的 DOM 生命周期。

无障碍也缺：浮层没有 role="dialog"、aria-modal、aria-label（src/NodeFindOverlay.vue:1-20），列表项是 div 且无 role="option"/tabindex（:8-14），键盘上下键只在输入框上生效（:5-7）。按项目 UI 规范这属于可访问性欠账，不是耦合问题。

## 全局与宿主粘连

| 对象 | 用途 | 风险 | 证据 |
|---|---|---|---|
| document.createElement('div') + body.appendChild | 浮层容器 | 中，全局 DOM | src/nodeFindPlugin.ts:31-32 |
| createApp / mount / unmount | 手动 Vue 应用 | 中，生命周期 | 同上:36、48、53 |
| 无 localStorage / 固定 URL / 定时器 | — | 无 | 本包 src 检索为空 |

## 内部职责与风险

插件入口只做命令、浮层开关、聚焦；过滤算法在 nodeFindFilter（62 行，10 个用例）。职责清楚。风险集中在两处：手动 createApp 与宿主 Vue 应用是两棵树，拿不到宿主 provide 的上下文，只能经 ctx 服务通信；以及浮层订阅 doc 的退订依赖 closeOverlay 被调用。

## 单独装卸判断

可独立装卸。不装时没有 mod+f 搜索。装了会占用浏览器查找键。与其它插件无服务依赖。

## 建议改法

1. 最小改动：package.json 去掉未使用的 canvas-render 依赖，避免安装方误以为需要渲染层。
2. 把浮层改为 overlay 槽 occupant（与 align-guide / shortcut-manager 同模式），由宿主统一挂载与回收，删掉手动 createApp。
3. 验证：补一条“插件热卸后 body 里不残留容器”的测试；现有测试不覆盖。

## 待验证

- 浮层在插件热卸时的实际清理顺序（ctx.effect 与组件 unmount 谁先）未验证。
- 是否有用户依赖 Ctrl+F 打开浏览器查找；这是产品取舍，需要确认。

